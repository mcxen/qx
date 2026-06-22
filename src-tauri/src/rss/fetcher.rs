use feed_rs::parser;
use quick_xml::events::Event;
use quick_xml::Reader;
use std::io::Cursor;

use super::types::{ParsedArticle, ParsedFeed};

const USER_AGENT: &str = "Qx/0.1 (RSS Reader; +https://github.com/mcx/qx)";

pub fn fetch_and_parse(url: &str) -> Result<ParsedFeed, String> {
    let body = fetch_url(url)?;
    let feed = parser::parse(Cursor::new(body.as_slice()))
        .map_err(|e| format!("feed parse error: {e}"))?;
    let title = feed
        .title
        .as_ref()
        .map(|t| t.content.clone())
        .unwrap_or_default();
    let icon = feed
        .icon
        .as_ref()
        .map(|i| i.uri.clone())
        .or_else(|| feed.logo.as_ref().map(|l| l.uri.clone()))
        .unwrap_or_default();

    let mut articles = Vec::new();
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

    Ok(ParsedFeed {
        title,
        icon,
        articles,
    })
}

fn fetch_url(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .get(url)
        .send()
        .map_err(|e| format!("http request: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("http status {}", resp.status()));
    }
    resp.bytes()
        .map(|b| b.to_vec())
        .map_err(|e| format!("read body: {e}"))
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

pub fn parse_opml(content: &str) -> Vec<(String, String)> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut results = Vec::new();
    let mut current_title = String::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) if e.name().as_ref() == b"outline" => {
                let mut url = String::new();
                let mut title = String::new();
                for attr in e.attributes().flatten() {
                    match attr.key.as_ref() {
                        b"xmlUrl" => url = attr.unescape_value().unwrap_or_default().to_string(),
                        b"title" | b"text" => {
                            title = attr.unescape_value().unwrap_or_default().to_string();
                        }
                        _ => {}
                    }
                }
                if !url.is_empty() {
                    current_title = title.clone();
                    results.push((url, title));
                }
            }
            _ => {}
            Err(_) => break,
            Ok(Event::Eof) => break,
            _ => {}
        }
        buf.clear();
    }
    let _ = current_title;
    results
}

pub fn build_opml(feeds: &[(i64, String, String)]) -> String {
    let mut s = String::new();
    s.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    s.push_str(
        "<opml version=\"2.0\">\n  <head>\n    <title>Qx RSS Feeds</title>\n  </head>\n  <body>\n",
    );
    for (_, url, title) in feeds {
        let t = quick_xml::escape::escape(title);
        s.push_str(&format!(
            "    <outline type=\"rss\" text=\"{}\" title=\"{}\" xmlUrl=\"{}\"/>\n",
            t, t, url
        ));
    }
    s.push_str("  </body>\n</opml>\n");
    s
}
