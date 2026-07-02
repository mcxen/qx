pub mod fetcher;
pub mod storage;
pub mod types;

use rusqlite::params;
use std::sync::Arc;
use tauri::{command, Manager, State};

use storage::RssDb;
use types::{Article, Feed};

use crate::settings;

pub fn init(app: &tauri::AppHandle) {
    if let Ok(conn) = storage::open() {
        app.manage(RssDb(Arc::new(std::sync::Mutex::new(conn))));
    }
}

fn with_db<F, R>(state: &State<RssDb>, f: F) -> Result<R, String>
where
    F: FnOnce(&rusqlite::Connection) -> Result<R, String>,
{
    let guard = state.0.lock().map_err(|e| format!("db lock: {e}"))?;
    f(&guard)
}

fn rss_settings() -> settings::RssSettings {
    settings::read_settings().rss
}

fn store_article(
    conn: &rusqlite::Connection,
    feed_id: i64,
    a: &types::ParsedArticle,
) -> rusqlite::Result<()> {
    let s = rss_settings();
    let content = if s.offline_cache_enabled {
        a.content.clone()
    } else {
        String::new()
    };
    let now = chrono::Local::now().timestamp();
    conn.execute(
        "INSERT OR IGNORE INTO rss_articles
         (feed_id, guid, title, summary, content, author, link, image_url, is_read, is_starred, published_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, 0, ?9, ?10)",
        params![
            feed_id,
            a.guid,
            a.title,
            a.summary,
            content,
            a.author,
            a.link,
            a.image_url,
            a.published_at,
            now,
        ],
    )?;
    Ok(())
}

fn prune_feed(conn: &rusqlite::Connection, feed_id: i64) -> rusqlite::Result<()> {
    let max = rss_settings().max_articles_per_feed;
    storage::prune_articles(conn, feed_id, max)
}

#[command]
pub fn rss_list_feeds(state: State<RssDb>) -> Result<Vec<Feed>, String> {
    with_db(&state, |conn| {
        storage::list_feeds(conn).map_err(|e| format!("{e}"))
    })
}

#[command]
pub async fn rss_add_feed(state: State<'_, RssDb>, url: String) -> Result<Feed, String> {
    let parsed = fetcher::fetch_and_parse(&url).await?;
    with_db(&state, |conn| {
        let id = storage::insert_feed(conn, &url, &parsed.title, &parsed.icon)
            .map_err(|e| format!("{e}"))?;
        for a in &parsed.articles {
            let _ = store_article(conn, id, a);
        }
        let _ = prune_feed(conn, id);
        storage::update_feed_meta(conn, id, &parsed.title, &parsed.icon)
            .map_err(|e| format!("{e}"))?;
        let feeds = storage::list_feeds(conn).map_err(|e| format!("{e}"))?;
        feeds
            .into_iter()
            .find(|f| f.id == id)
            .ok_or_else(|| "feed not found after insert".to_string())
    })
}

#[command]
pub fn rss_update_feed(
    state: State<RssDb>,
    id: i64,
    url: String,
    title: String,
) -> Result<Feed, String> {
    let url_trimmed = url.trim().to_string();
    if url_trimmed.is_empty() {
        return Err("URL cannot be empty".to_string());
    }
    with_db(&state, |conn| {
        storage::update_feed(conn, id, &url_trimmed, &title).map_err(|e| format!("{e}"))?;
        storage::list_feeds(conn)
            .map_err(|e| format!("{e}"))?
            .into_iter()
            .find(|f| f.id == id)
            .ok_or_else(|| "feed not found after update".to_string())
    })
}

#[command]
pub fn rss_remove_feed(state: State<RssDb>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        storage::delete_feed(conn, id).map_err(|e| format!("{e}"))
    })
}

#[command]
pub fn rss_list_articles(
    state: State<RssDb>,
    feed_id: Option<i64>,
    only_unread: bool,
    query: Option<String>,
) -> Result<Vec<Article>, String> {
    with_db(&state, |conn| {
        storage::list_articles(conn, feed_id, only_unread, query.as_deref())
            .map_err(|e| format!("{e}"))
    })
}

#[command]
pub fn rss_get_article(state: State<RssDb>, id: i64) -> Result<Option<Article>, String> {
    with_db(&state, |conn| {
        storage::get_article(conn, id).map_err(|e| format!("{e}"))
    })
}

#[command]
pub fn rss_mark_read(state: State<RssDb>, id: i64, is_read: bool) -> Result<(), String> {
    with_db(&state, |conn| {
        storage::set_read(conn, id, is_read).map_err(|e| format!("{e}"))
    })
}

#[command]
pub fn rss_mark_all_read(state: State<RssDb>, feed_id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        storage::mark_all_read(conn, feed_id).map_err(|e| format!("{e}"))
    })
}

#[command]
pub fn rss_toggle_star(state: State<RssDb>, id: i64, is_starred: bool) -> Result<(), String> {
    with_db(&state, |conn| {
        storage::set_starred(conn, id, is_starred).map_err(|e| format!("{e}"))
    })
}

#[command]
pub async fn rss_refresh_feed(state: State<'_, RssDb>, id: i64) -> Result<usize, String> {
    let url = with_db(&state, |conn| Ok(storage::feed_url_by_id(conn, id)))?;
    let url = url.ok_or_else(|| "feed not found".to_string())?;
    let parsed = fetcher::fetch_and_parse(&url).await?;
    let count = parsed.articles.len();
    with_db(&state, |conn| {
        for a in &parsed.articles {
            let _ = store_article(conn, id, a);
        }
        let _ = prune_feed(conn, id);
        let retention = rss_settings().retention_days;
        if retention > 0 {
            let _ = storage::delete_old_articles(conn, retention);
        }
        storage::update_feed_meta(conn, id, &parsed.title, &parsed.icon)
            .map_err(|e| format!("{e}"))?;
        Ok::<(), String>(())
    })?;
    Ok(count)
}

#[command]
pub async fn rss_refresh_all(state: State<'_, RssDb>) -> Result<usize, String> {
    let feeds = with_db(&state, |conn| {
        storage::all_feed_urls(conn).map_err(|e| format!("{e}"))
    })?;

    let mut total = 0usize;
    for (id, url) in feeds {
        match fetcher::fetch_and_parse(&url).await {
            Ok(parsed) => {
                total += parsed.articles.len();
                let _ = with_db(&state, |conn| {
                    for a in &parsed.articles {
                        let _ = store_article(conn, id, a);
                    }
                    let _ = prune_feed(conn, id);
                    storage::update_feed_meta(conn, id, &parsed.title, &parsed.icon)
                        .map_err(|e| format!("{e}"))?;
                    Ok::<(), String>(())
                });
            }
            Err(_) => {
                let _ = with_db(&state, |conn| {
                    storage::increment_feed_error(conn, id).map_err(|e| format!("{e}"))
                });
            }
        }
    }
    let retention = rss_settings().retention_days;
    if retention > 0 {
        let _ = with_db(&state, |conn| {
            storage::delete_old_articles(conn, retention).map_err(|e| format!("{e}"))
        });
    }
    Ok(total)
}

#[command]
pub async fn rss_import_opml(state: State<'_, RssDb>, content: String) -> Result<usize, String> {
    let feeds = fetcher::parse_opml(&content);
    let mut count = 0usize;
    for (url, title) in feeds {
        let parsed = fetcher::fetch_and_parse(&url).await.ok();
        let (t, icon, articles) = match parsed {
            Some(p) => (
                if p.title.is_empty() {
                    title.clone()
                } else {
                    p.title
                },
                p.icon,
                p.articles,
            ),
            None => (title.clone(), String::new(), Vec::new()),
        };
        let _ = with_db(&state, |conn| {
            let id = storage::insert_feed(conn, &url, &t, &icon).map_err(|e| format!("{e}"))?;
            for a in &articles {
                let _ = store_article(conn, id, a);
            }
            let _ = prune_feed(conn, id);
            storage::update_feed_meta(conn, id, &t, &icon).map_err(|e| format!("{e}"))?;
            Ok::<(), String>(())
        });
        count += 1;
    }
    Ok(count)
}

#[command]
pub fn rss_export_opml(state: State<RssDb>) -> Result<String, String> {
    let feeds = with_db(&state, |conn| {
        storage::list_feeds(conn).map_err(|e| format!("{e}"))
    })?;
    let triples: Vec<(i64, String, String)> =
        feeds.into_iter().map(|f| (f.id, f.url, f.title)).collect();
    Ok(fetcher::build_opml(&triples))
}

#[command]
pub fn rss_clear_read_articles(state: State<RssDb>) -> Result<usize, String> {
    with_db(&state, |conn| {
        storage::delete_read_articles(conn).map_err(|e| format!("{e}"))
    })
}

#[command]
pub fn rss_clear_all_articles(state: State<RssDb>) -> Result<usize, String> {
    with_db(&state, |conn| {
        storage::delete_all_articles(conn).map_err(|e| format!("{e}"))
    })
}

#[command]
pub async fn rss_fetch_original_content(url: String) -> Result<String, String> {
    use std::time::Duration;

    let parsed_url = reqwest::Url::parse(&url).map_err(|e| format!("invalid URL: {e}"))?;
    match parsed_url.scheme() {
        "http" | "https" => {}
        s => return Err(format!("unsupported scheme: {s}")),
    }

    let client = crate::http_client::client(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Qx/1.0",
        Duration::from_secs(20),
        None,
    )?;

    let resp = client
        .get(parsed_url)
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let html = resp.text().await.map_err(|e| format!("read body: {e}"))?;
    Ok(extract_article_body(&html))
}

fn extract_article_body(html: &str) -> String {
    let strip_tags = [
        "script", "style", "nav", "footer", "header", "aside", "iframe", "noscript",
    ];
    let mut result = html.to_string();
    for tag in &strip_tags {
        let pattern = format!(r"(?is)<{tag}[\s>].*?</{tag}>");
        if let Ok(re) = regex::Regex::new(&pattern) {
            result = re.replace_all(&result, "").to_string();
        }
    }

    if let Ok(re) = regex::Regex::new(r"(?is)<article[^>]*>(.*)</article>") {
        if let Some(cap) = re.captures(&result) {
            if let Some(body) = cap.get(1) {
                return body.as_str().trim().to_string();
            }
        }
    }

    if let Ok(re) = regex::Regex::new(r"(?is)<body[^>]*>(.*)</body>") {
        if let Some(cap) = re.captures(&result) {
            if let Some(body) = cap.get(1) {
                return body.as_str().trim().to_string();
            }
        }
    }

    result.trim().to_string()
}
