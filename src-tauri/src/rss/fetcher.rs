use feed_rs::parser;
use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::Url;
use std::io::Cursor;

use super::types::{OpmlFeedEntry, ParsedArticle, ParsedFeed};

const USER_AGENT: &str = "Qx/0.1 (RSS Reader; +https://github.com/mcx/qx)";

/// RSS bridge / aggregator hosts — not the real publisher; use article links for icons.
fn is_feed_proxy_host(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    h == "plink.anyfeeder.com"
        || h.ends_with(".anyfeeder.com")
        || h == "rsshub.app"
        || h.ends_with(".rsshub.app")
        || h == "feedx.net"
        || h.ends_with(".feedx.net")
}

fn absolutize_url(base: &str, maybe_relative: &str) -> Option<String> {
    let value = maybe_relative.trim();
    if value.is_empty() {
        return None;
    }
    if value.starts_with("data:")
        || value.starts_with("http://")
        || value.starts_with("https://")
    {
        return Some(value.to_string());
    }
    let base_url = Url::parse(base).ok()?;
    base_url.join(value).ok().map(|u| u.into())
}

fn host_from_url(url: &str) -> Option<String> {
    let parsed = Url::parse(url.trim()).ok()?;
    let host = parsed.host_str()?.to_string();
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

/// Prefer a real publisher host (from article links) over RSS bridge domains.
fn publisher_host(feed_url: &str, article_links: &[&str]) -> Option<String> {
    for link in article_links {
        if let Some(host) = host_from_url(link) {
            if !is_feed_proxy_host(&host) {
                return Some(host);
            }
        }
    }
    if let Some(host) = host_from_url(feed_url) {
        if !is_feed_proxy_host(&host) {
            return Some(host);
        }
    }
    // Last resort: proxy host still gets *some* icon.
    host_from_url(feed_url)
}

/// Public favicon URL for a host (works as `<img src>` without local cache).
fn favicon_url_for_host(host: &str) -> String {
    // Google S2 is widely used by readers; sz=64 suits the 22px list tile on retina.
    format!("https://www.google.com/s2/favicons?domain={host}&sz=64")
}

/// Resolve a displayable feed icon:
/// 1) feed `<icon>` / `<logo>` (absolutized)
/// 2) publisher favicon via well-known service
pub fn resolve_feed_icon(feed_url: &str, feed_icon: &str, article_links: &[&str]) -> String {
    if let Some(abs) = absolutize_url(feed_url, feed_icon) {
        return abs;
    }
    if let Some(host) = publisher_host(feed_url, article_links) {
        return favicon_url_for_host(&host);
    }
    String::new()
}

/// Build a shared async client lazily.
fn http_client() -> Result<reqwest::Client, String> {
    crate::http_client::client(
        USER_AGENT,
        std::time::Duration::from_secs(15),
        Some(std::time::Duration::from_secs(8)),
    )
}

/// Async HTTP fetch.
async fn fetch_url(url: &str) -> Result<Vec<u8>, String> {
    let resp = http_client()?.get(url).send().await.map_err(|e| {
        if e.is_timeout() {
            format!("timeout fetching {url}")
        } else if e.is_connect() {
            format!("connection failed: {url} — {e}")
        } else {
            format!("http error: {e}")
        }
    })?;

    if !resp.status().is_success() {
        return Err(format!("http status {} for {url}", resp.status()));
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("read body: {e}"))
}

/// Fetch RSS/Atom feed XML and parse into a structured result.
pub async fn fetch_and_parse(url: &str) -> Result<ParsedFeed, String> {
    let body = fetch_url(url).await?;

    // feed-rs parser is synchronous and fast — run it on the current task.
    let feed = parser::parse(Cursor::new(body.as_slice()))
        .map_err(|e| format!("feed parse error: {e}"))?;

    let title = feed
        .title
        .as_ref()
        .map(|t| t.content.clone())
        .unwrap_or_default();

    let icon_raw = feed
        .icon
        .as_ref()
        .map(|i| i.uri.clone())
        .or_else(|| feed.logo.as_ref().map(|l| l.uri.clone()))
        .unwrap_or_default();

    let mut articles = Vec::with_capacity(feed.entries.len());
    for entry in feed.entries {
        let guid = if entry.id.is_empty() {
            entry
                .links
                .first()
                .map(|l| l.href.clone())
                .unwrap_or_default()
        } else {
            entry.id.clone()
        };
        if guid.is_empty() {
            continue;
        }

        let title = entry
            .title
            .as_ref()
            .map(|t| t.content.clone())
            .unwrap_or_default();
        let link = entry
            .links
            .first()
            .map(|l| l.href.clone())
            .unwrap_or_default();
        let summary = entry
            .summary
            .as_ref()
            .map(|s| s.content.clone())
            .unwrap_or_default();
        let content = entry
            .content
            .as_ref()
            .and_then(|c| c.body.clone())
            .unwrap_or_else(|| summary.clone());
        let author = entry
            .authors
            .first()
            .map(|a| a.name.clone())
            .unwrap_or_default();
        let published_at = entry
            .published
            .or(entry.updated)
            .map(|d| d.timestamp())
            .unwrap_or(0);
        let image_url = extract_image(&content).or_else(|| {
            entry.media.iter().find_map(|m| {
                m.content
                    .iter()
                    .find(|c| {
                        c.content_type
                            .as_ref()
                            .map_or(false, |t| t.as_ref().starts_with("image"))
                    })
                    .and_then(|c| c.url.as_ref().map(|u| u.to_string()))
                    .or_else(|| m.thumbnails.first().map(|t| t.image.uri.clone()))
            })
        });

        articles.push(ParsedArticle {
            guid,
            title,
            summary: strip_html(&summary),
            content,
            author,
            link,
            image_url: image_url.unwrap_or_default(),
            published_at,
        });
    }

    let link_refs: Vec<&str> = articles.iter().map(|a| a.link.as_str()).collect();
    let icon = resolve_feed_icon(url, &icon_raw, &link_refs);

    Ok(ParsedFeed {
        title,
        icon,
        articles,
    })
}

fn extract_image(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let idx = lower.find("<img ")?;
    let rest = &html[idx..];
    let src_idx = rest.to_lowercase().find("src=\"")?;
    let after = &rest[src_idx + 5..];
    let end = after.find('"')?;
    Some(after[..end].to_string())
}

#[cfg(test)]
mod tests {
    use super::{is_feed_proxy_host, resolve_feed_icon};

    #[test]
    fn prefers_feed_icon_when_absolute() {
        let icon = resolve_feed_icon(
            "https://www.ithome.com/rss/",
            "https://img.ithome.com/favicon.ico",
            &[],
        );
        assert_eq!(icon, "https://img.ithome.com/favicon.ico");
    }

    #[test]
    fn absolutizes_relative_feed_icon() {
        let icon = resolve_feed_icon("https://www.ithome.com/rss/", "/favicon.ico", &[]);
        assert_eq!(icon, "https://www.ithome.com/favicon.ico");
    }

    #[test]
    fn anyfeeder_uses_article_publisher_host() {
        let icon = resolve_feed_icon(
            "https://plink.anyfeeder.com/zhihu/daily",
            "",
            &["https://daily.zhihu.com/story/123"],
        );
        assert!(icon.contains("daily.zhihu.com"), "{icon}");
        assert!(!icon.contains("anyfeeder"), "{icon}");
    }

    #[test]
    fn direct_feed_host_favicon_when_no_icon() {
        let icon = resolve_feed_icon("http://www.ithome.com/rss/", "", &[]);
        assert!(icon.contains("ithome.com"), "{icon}");
    }

    #[test]
    fn proxy_host_detection() {
        assert!(is_feed_proxy_host("plink.anyfeeder.com"));
        assert!(!is_feed_proxy_host("www.ithome.com"));
    }
}

fn strip_html(s: &str) -> String {
    let mut reader = Reader::from_str(s);
    reader.config_mut().trim_text(true);
    let mut out = String::new();
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Text(e)) => {
                out.push_str(&e.unescape().unwrap_or_default());
            }
            Ok(Event::End(_)) => out.push(' '),
            Err(_) => break,
            Ok(Event::Eof) => break,
            _ => {}
        }
        buf.clear();
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn outline_attrs(e: &quick_xml::events::BytesStart<'_>) -> (String, String) {
    let mut url = String::new();
    let mut title = String::new();
    let mut text = String::new();
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"xmlUrl" => url = attr.unescape_value().unwrap_or_default().to_string(),
            b"title" => title = attr.unescape_value().unwrap_or_default().to_string(),
            b"text" => text = attr.unescape_value().unwrap_or_default().to_string(),
            _ => {}
        }
    }
    let label = if !title.is_empty() { title } else { text };
    (url, label)
}

/// Parse OPML into feeds. Nested folder outlines (no xmlUrl) become folder names.
/// v1 keeps the **nearest parent folder name** only (flat folder list in Qx UI).
pub fn parse_opml(content: &str) -> Vec<OpmlFeedEntry> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut results = Vec::new();
    // Stack of open folder names (outlines without xmlUrl).
    let mut folder_stack: Vec<String> = Vec::new();
    // Whether the matching Start was a folder (needs End pop).
    let mut open_was_folder: Vec<bool> = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) if e.name().as_ref() == b"outline" => {
                let (url, label) = outline_attrs(e);
                if url.is_empty() {
                    if !label.is_empty() {
                        folder_stack.push(label);
                        open_was_folder.push(true);
                    } else {
                        open_was_folder.push(false);
                    }
                } else {
                    results.push(OpmlFeedEntry {
                        url,
                        title: label,
                        folder: folder_stack.last().cloned(),
                    });
                    open_was_folder.push(false);
                }
            }
            Ok(Event::Empty(ref e)) if e.name().as_ref() == b"outline" => {
                let (url, label) = outline_attrs(e);
                if !url.is_empty() {
                    results.push(OpmlFeedEntry {
                        url,
                        title: label,
                        folder: folder_stack.last().cloned(),
                    });
                }
            }
            Ok(Event::End(ref e)) if e.name().as_ref() == b"outline" => {
                if open_was_folder.pop().unwrap_or(false) {
                    let _ = folder_stack.pop();
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    results
}

/// Build OPML. Feeds with the same folder name are nested under one outline group.
pub fn build_opml(feeds: &[(String, String, Option<String>)]) -> String {
    use std::collections::BTreeMap;
    let mut s = String::new();
    s.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    s.push_str(
        "<opml version=\"2.0\">\n  <head>\n    <title>Qx RSS Feeds</title>\n  </head>\n  <body>\n",
    );

    let mut ungrouped: Vec<(&str, &str)> = Vec::new();
    let mut groups: BTreeMap<String, Vec<(&str, &str)>> = BTreeMap::new();
    for (url, title, folder) in feeds {
        match folder.as_ref().map(|f| f.trim()).filter(|f| !f.is_empty()) {
            Some(name) => groups
                .entry(name.to_string())
                .or_default()
                .push((url.as_str(), title.as_str())),
            None => ungrouped.push((url.as_str(), title.as_str())),
        }
    }

    for (folder, items) in groups {
        let fname = quick_xml::escape::escape(&folder);
        s.push_str(&format!(
            "    <outline text=\"{fname}\" title=\"{fname}\">\n"
        ));
        for (url, title) in items {
            let t = quick_xml::escape::escape(title);
            let u = quick_xml::escape::escape(url);
            s.push_str(&format!(
                "      <outline type=\"rss\" text=\"{t}\" title=\"{t}\" xmlUrl=\"{u}\"/>\n"
            ));
        }
        s.push_str("    </outline>\n");
    }
    for (url, title) in ungrouped {
        let t = quick_xml::escape::escape(title);
        let u = quick_xml::escape::escape(url);
        s.push_str(&format!(
            "    <outline type=\"rss\" text=\"{t}\" title=\"{t}\" xmlUrl=\"{u}\"/>\n"
        ));
    }

    s.push_str("  </body>\n</opml>\n");
    s
}
