pub mod fetcher;
pub mod storage;
pub mod types;

use std::sync::Arc;
use tauri::{command, Manager, State};

use storage::RssDb;
use types::{Article, Feed};

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

#[command]
pub fn rss_list_feeds(state: State<RssDb>) -> Result<Vec<Feed>, String> {
    with_db(&state, |conn| {
        storage::list_feeds(conn).map_err(|e| format!("{e}"))
    })
}

#[command]
pub fn rss_add_feed(state: State<RssDb>, url: String) -> Result<Feed, String> {
    let parsed = fetcher::fetch_and_parse(&url)?;
    with_db(&state, |conn| {
        let id = storage::insert_feed(conn, &url, &parsed.title, &parsed.icon)
            .map_err(|e| format!("{e}"))?;
        for a in &parsed.articles {
            let _ = storage::insert_article(conn, id, a);
        }
        storage::update_feed_meta(conn, id, &parsed.title, &parsed.icon)
            .map_err(|e| format!("{e}"))?;
        let mut feeds = storage::list_feeds(conn).map_err(|e| format!("{e}"))?;
        feeds
            .into_iter()
            .find(|f| f.id == id)
            .ok_or_else(|| "feed not found after insert".to_string())
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
pub fn rss_refresh_feed(state: State<RssDb>, id: i64) -> Result<usize, String> {
    let url = with_db(&state, |conn| Ok(storage::feed_url_by_id(conn, id)))?;
    let url = url.ok_or_else(|| "feed not found".to_string())?;
    let parsed = fetcher::fetch_and_parse(&url)?;
    let count = parsed.articles.len();
    with_db(&state, |conn| {
        for a in &parsed.articles {
            let _ = storage::insert_article(conn, id, a);
        }
        storage::update_feed_meta(conn, id, &parsed.title, &parsed.icon)
            .map_err(|e| format!("{e}"))?;
        Ok::<(), String>(())
    })?;
    Ok(count)
}

#[command]
pub fn rss_refresh_all(state: State<RssDb>) -> Result<usize, String> {
    let feeds = with_db(&state, |conn| {
        storage::all_feed_urls(conn).map_err(|e| format!("{e}"))
    })?;
    let mut total = 0usize;
    for (id, url) in feeds {
        match fetcher::fetch_and_parse(&url) {
            Ok(parsed) => {
                let _ = with_db(&state, |conn| {
                    for a in &parsed.articles {
                        let _ = storage::insert_article(conn, id, a);
                    }
                    storage::update_feed_meta(conn, id, &parsed.title, &parsed.icon)
                        .map_err(|e| format!("{e}"))?;
                    Ok::<(), String>(())
                });
                total += 1;
            }
            Err(_) => {
                let _ = with_db(&state, |conn| {
                    storage::increment_feed_error(conn, id).map_err(|e| format!("{e}"))
                });
            }
        }
    }
    Ok(total)
}

#[command]
pub fn rss_import_opml(state: State<RssDb>, content: String) -> Result<usize, String> {
    let feeds = fetcher::parse_opml(&content);
    let mut count = 0usize;
    for (url, title) in feeds {
        let parsed = fetcher::fetch_and_parse(&url).ok();
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
                let _ = storage::insert_article(conn, id, a);
            }
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
