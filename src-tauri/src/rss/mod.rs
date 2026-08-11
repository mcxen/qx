mod article_image_cache;
pub mod fetcher;
mod icon_cache;
pub mod storage;
pub mod types;

use rusqlite::params;
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tauri::{command, AppHandle, Emitter, Manager, State};

use storage::RssDb;
use types::{Article, Feed, Folder, RssDashboardSnapshot};

use crate::settings;

const BACKGROUND_REFRESH_CHECK_INTERVAL: Duration = Duration::from_secs(15 * 60);
const BACKGROUND_REFRESH_STARTUP_DELAY: Duration = Duration::from_secs(60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RssRefreshProgress {
    scope: &'static str,
    phase: &'static str,
    feed_id: Option<i64>,
    feed_title: Option<String>,
    completed: usize,
    total: usize,
    failed: usize,
}

struct RssRefreshAllOutcome {
    article_count: usize,
    failed: usize,
}

fn emit_refresh_progress(app: &AppHandle, progress: RssRefreshProgress) {
    let _ = app.emit("rss:refresh-progress", progress);
}

/// Always register `RssDb` so invoke commands never hit "state not managed".
/// If the first open fails (path/permissions/corrupt file), store `None` and
/// retry lazily on the next command — same pattern as clipboard.
pub fn init(app: &tauri::AppHandle) {
    let conn = match storage::open() {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("[rss] DB init failed (will retry on demand): {e}");
            crate::diagnostics::log(
                crate::diagnostics::LogLevel::Error,
                "rss.init",
                "rss database open failed at startup",
                serde_json::json!({ "error": e.to_string() }),
            );
            None
        }
    };
    let db = RssDb(
        Arc::new(std::sync::Mutex::new(conn)),
        Arc::new(tokio::sync::Mutex::new(())),
    );
    app.manage(db.clone());
    tauri::async_runtime::spawn(warm_feed_icon_cache(db.clone()));
    start_background_refresh(app.clone(), db);
}

fn background_refresh_is_due(
    enabled: bool,
    interval_hours: u32,
    last_refresh_at: Option<i64>,
    now: i64,
) -> bool {
    let interval_secs = i64::from(interval_hours.max(1)) * 60 * 60;
    enabled
        && last_refresh_at
            .map(|last| now.saturating_sub(last) >= interval_secs)
            .unwrap_or(true)
}

fn start_background_refresh(app: AppHandle, db: RssDb) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(BACKGROUND_REFRESH_STARTUP_DELAY).await;
        loop {
            let due_db = db.clone();
            let due = crate::runtime::blocking(move || {
                let rss_settings = settings::read_settings().rss;
                let now = chrono::Local::now().timestamp();
                let last_refresh_at = with_db(&due_db, |conn| {
                    storage::last_refresh_all_at(conn).map_err(|error| error.to_string())
                })
                .unwrap_or(None);
                background_refresh_is_due(
                    rss_settings.background_refresh_enabled,
                    rss_settings.background_refresh_interval_hours,
                    last_refresh_at,
                    now,
                )
            })
            .await
            .unwrap_or(false);
            if due {
                if let Ok(_refresh_guard) = db.1.try_lock() {
                    let result = refresh_all_inner(&app, &db).await;
                    let (level, message, fields) = match result {
                        Ok(outcome) if outcome.failed > 0 => (
                            crate::diagnostics::LogLevel::Warn,
                            "daily RSS background refresh completed with feed failures",
                            serde_json::json!({
                                "articleCount": outcome.article_count,
                                "failedFeeds": outcome.failed,
                            }),
                        ),
                        Ok(outcome) => (
                            crate::diagnostics::LogLevel::Info,
                            "daily RSS background refresh completed",
                            serde_json::json!({ "articleCount": outcome.article_count }),
                        ),
                        Err(error) => (
                            crate::diagnostics::LogLevel::Warn,
                            "daily RSS background refresh failed",
                            serde_json::json!({ "error": error }),
                        ),
                    };
                    crate::diagnostics::log(level, "rss.background_refresh", message, fields);
                }
            }
            tokio::time::sleep(BACKGROUND_REFRESH_CHECK_INTERVAL).await;
        }
    });
}

async fn warm_feed_icon_cache(db: RssDb) {
    let feeds = {
        let mut guard = db.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let Ok(conn) = storage::ensure_open(&mut guard) else {
            return;
        };
        storage::all_feed_icons(conn).unwrap_or_default()
    };

    for (id, url, source) in feeds {
        let cached = icon_cache::resolve(&url, &source).await;
        if cached == source || cached.is_empty() {
            continue;
        }
        let mut guard = db.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Ok(conn) = storage::ensure_open(&mut guard) {
            let _ = storage::update_feed_icon(conn, id, &cached);
        }
    }
}

fn with_db<F, R>(state: &RssDb, f: F) -> Result<R, String>
where
    F: FnOnce(&rusqlite::Connection) -> Result<R, String>,
{
    let mut guard = state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let conn = storage::ensure_open(&mut guard)?;
    f(conn)
}

async fn with_db_async<F, R>(state: &RssDb, f: F) -> Result<R, String>
where
    F: FnOnce(&rusqlite::Connection) -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    let db = state.clone();
    crate::runtime::blocking(move || with_db(&db, f))
        .await
        .map_err(String::from)?
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
    // Refresh the timestamp for existing rows too. This clears legacy values
    // that came from `entry.updated` and keeps the displayed date tied to the
    // article publication field.
    conn.execute(
        "UPDATE rss_articles SET published_at = ?1 WHERE guid = ?2",
        params![a.published_at, a.guid],
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
        let mut feeds = storage::list_feeds(conn).map_err(|e| format!("{e}"))?;
        for feed in &mut feeds {
            let icon = feed.icon.trim();
            if !icon.is_empty()
                && !(icon.starts_with("https://") || icon.starts_with("http://"))
                && !Path::new(icon).is_file()
            {
                feed.icon = fetcher::resolve_feed_icon(&feed.url, "", &[]);
            }
        }
        Ok(feeds)
    })
}

#[command]
pub async fn rss_add_feed(state: State<'_, RssDb>, url: String) -> Result<Feed, String> {
    let mut parsed = fetcher::fetch_and_parse(&url).await?;
    parsed.icon = icon_cache::resolve(&url, &parsed.icon).await;
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
pub async fn rss_dashboard_snapshot(
    state: State<'_, RssDb>,
    limit: Option<u32>,
) -> Result<RssDashboardSnapshot, String> {
    with_db_async(&state, move |conn| {
        storage::dashboard_snapshot(conn, limit.unwrap_or(6) as usize).map_err(|e| format!("{e}"))
    })
    .await
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
pub async fn rss_set_reading_progress(
    state: State<'_, RssDb>,
    id: i64,
    progress: f64,
) -> Result<(), String> {
    if !progress.is_finite() {
        return Err("reading progress must be finite".to_string());
    }
    let db = state.0.clone();
    crate::runtime::blocking(move || {
        let mut guard = db.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let conn = storage::ensure_open(&mut guard)?;
        storage::set_reading_progress(conn, id, progress).map_err(|e| format!("{e}"))
    })
    .await
    .map_err(|error| error.to_string())?
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
pub async fn rss_refresh_feed(
    app: AppHandle,
    state: State<'_, RssDb>,
    id: i64,
) -> Result<usize, String> {
    let _refresh_guard = state.1.lock().await;
    let target = with_db(&state, |conn| Ok(storage::feed_target_by_id(conn, id)))?;
    let (url, title) = target.ok_or_else(|| "feed not found".to_string())?;
    emit_refresh_progress(
        &app,
        RssRefreshProgress {
            scope: "feed",
            phase: "fetching",
            feed_id: Some(id),
            feed_title: Some(title.clone()),
            completed: 0,
            total: 1,
            failed: 0,
        },
    );
    let mut parsed = match fetcher::fetch_and_parse(&url).await {
        Ok(parsed) => parsed,
        Err(error) => {
            let _ = with_db(&state, |conn| {
                storage::increment_feed_error(conn, id).map_err(|e| format!("{e}"))
            });
            emit_refresh_progress(
                &app,
                RssRefreshProgress {
                    scope: "feed",
                    phase: "finished",
                    feed_id: Some(id),
                    feed_title: Some(title),
                    completed: 1,
                    total: 1,
                    failed: 1,
                },
            );
            return Err(error);
        }
    };
    parsed.icon = icon_cache::resolve(&url, &parsed.icon).await;
    emit_refresh_progress(
        &app,
        RssRefreshProgress {
            scope: "feed",
            phase: "saving",
            feed_id: Some(id),
            feed_title: Some(title.clone()),
            completed: 0,
            total: 1,
            failed: 0,
        },
    );
    let count = parsed.articles.len();
    if let Err(error) = with_db(&state, |conn| {
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
    }) {
        emit_refresh_progress(
            &app,
            RssRefreshProgress {
                scope: "feed",
                phase: "finished",
                feed_id: Some(id),
                feed_title: Some(title),
                completed: 1,
                total: 1,
                failed: 1,
            },
        );
        return Err(error);
    }
    emit_refresh_progress(
        &app,
        RssRefreshProgress {
            scope: "feed",
            phase: "finished",
            feed_id: Some(id),
            feed_title: Some(title),
            completed: 1,
            total: 1,
            failed: 0,
        },
    );
    Ok(count)
}

#[command]
pub async fn rss_refresh_all(app: AppHandle, state: State<'_, RssDb>) -> Result<usize, String> {
    let _refresh_guard = state.1.lock().await;
    Ok(refresh_all_inner(&app, &state).await?.article_count)
}

async fn refresh_all_inner(app: &AppHandle, state: &RssDb) -> Result<RssRefreshAllOutcome, String> {
    let refresh_started_at = chrono::Local::now().timestamp();
    with_db_async(state, move |conn| {
        storage::set_last_refresh_all_at(conn, refresh_started_at).map_err(|e| format!("{e}"))
    })
    .await?;
    let feeds = with_db_async(state, |conn| {
        storage::all_feed_targets(conn).map_err(|e| format!("{e}"))
    })
    .await?;

    let feed_count = feeds.len();
    let mut total = 0usize;
    let mut completed = 0usize;
    let mut failed = 0usize;
    emit_refresh_progress(
        app,
        RssRefreshProgress {
            scope: "all",
            phase: "fetching",
            feed_id: None,
            feed_title: None,
            completed,
            total: feed_count,
            failed,
        },
    );
    for (id, url, title) in feeds {
        emit_refresh_progress(
            app,
            RssRefreshProgress {
                scope: "all",
                phase: "fetching",
                feed_id: Some(id),
                feed_title: Some(title.clone()),
                completed,
                total: feed_count,
                failed,
            },
        );
        match fetcher::fetch_and_parse(&url).await {
            Ok(mut parsed) => {
                parsed.icon = icon_cache::resolve(&url, &parsed.icon).await;
                emit_refresh_progress(
                    app,
                    RssRefreshProgress {
                        scope: "all",
                        phase: "saving",
                        feed_id: Some(id),
                        feed_title: Some(title.clone()),
                        completed,
                        total: feed_count,
                        failed,
                    },
                );
                let article_count = parsed.articles.len();
                let stored = with_db_async(state, move |conn| {
                    for a in &parsed.articles {
                        let _ = store_article(conn, id, a);
                    }
                    let _ = prune_feed(conn, id);
                    storage::update_feed_meta(conn, id, &parsed.title, &parsed.icon)
                        .map_err(|e| format!("{e}"))?;
                    Ok::<(), String>(())
                })
                .await;
                if stored.is_ok() {
                    total += article_count;
                } else {
                    failed += 1;
                }
            }
            Err(_) => {
                failed += 1;
                let _ = with_db_async(state, move |conn| {
                    storage::increment_feed_error(conn, id).map_err(|e| format!("{e}"))
                })
                .await;
            }
        }
        completed += 1;
        emit_refresh_progress(
            app,
            RssRefreshProgress {
                scope: "all",
                phase: "fetching",
                feed_id: Some(id),
                feed_title: Some(title),
                completed,
                total: feed_count,
                failed,
            },
        );
    }
    let retention = crate::runtime::blocking(|| rss_settings().retention_days)
        .await
        .map_err(String::from)?;
    if retention > 0 {
        let _ = with_db_async(state, move |conn| {
            storage::delete_old_articles(conn, retention).map_err(|e| format!("{e}"))
        })
        .await;
    }
    emit_refresh_progress(
        app,
        RssRefreshProgress {
            scope: "all",
            phase: "finished",
            feed_id: None,
            feed_title: None,
            completed,
            total: feed_count,
            failed,
        },
    );
    Ok(RssRefreshAllOutcome {
        article_count: total,
        failed,
    })
}

#[command]
pub async fn rss_import_opml(state: State<'_, RssDb>, content: String) -> Result<usize, String> {
    let entries = fetcher::parse_opml(&content);
    let mut count = 0usize;
    for entry in entries {
        let parsed = fetcher::fetch_and_parse(&entry.url).await.ok();
        let (t, icon, articles) = match parsed {
            Some(mut p) => {
                p.icon = icon_cache::resolve(&entry.url, &p.icon).await;
                (
                    if p.title.is_empty() {
                        entry.title.clone()
                    } else {
                        p.title
                    },
                    p.icon,
                    p.articles,
                )
            }
            None => (entry.title.clone(), String::new(), Vec::new()),
        };
        let folder_name = entry.folder.clone();
        let _ = with_db(&state, |conn| {
            let folder_id = match folder_name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                Some(name) => Some(
                    storage::get_or_create_folder_by_name(conn, name)
                        .map_err(|e| format!("{e}"))?,
                ),
                None => None,
            };
            let id = storage::insert_feed_in_folder(conn, &entry.url, &t, &icon, folder_id)
                .map_err(|e| format!("{e}"))?;
            if let Some(fid) = folder_id {
                let _ = storage::set_feed_folder(conn, id, Some(fid));
            }
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
    let rows: Vec<(String, String, Option<String>)> = feeds
        .into_iter()
        .map(|f| (f.url, f.title, f.folder_name))
        .collect();
    Ok(fetcher::build_opml(&rows))
}

#[command]
pub fn rss_list_folders(state: State<RssDb>) -> Result<Vec<Folder>, String> {
    with_db(&state, |conn| {
        storage::list_folders(conn).map_err(|e| format!("{e}"))
    })
}

#[command]
pub fn rss_create_folder(
    state: State<RssDb>,
    name: String,
    parent_id: Option<i64>,
) -> Result<Folder, String> {
    with_db(&state, |conn| {
        let id = storage::create_folder(conn, &name, parent_id).map_err(|e| format!("{e}"))?;
        storage::list_folders(conn)
            .map_err(|e| format!("{e}"))?
            .into_iter()
            .find(|f| f.id == id)
            .ok_or_else(|| "folder not found after create".to_string())
    })
}

#[command]
pub fn rss_rename_folder(state: State<RssDb>, id: i64, name: String) -> Result<(), String> {
    with_db(&state, |conn| {
        storage::rename_folder(conn, id, &name).map_err(|e| format!("{e}"))
    })
}

#[command]
pub fn rss_delete_folder(state: State<RssDb>, id: i64) -> Result<(), String> {
    with_db(&state, |conn| {
        storage::delete_folder(conn, id).map_err(|e| format!("{e}"))
    })
}

#[command]
pub fn rss_set_feed_folder(
    state: State<RssDb>,
    feed_id: i64,
    folder_id: Option<i64>,
) -> Result<Feed, String> {
    with_db(&state, |conn| {
        storage::set_feed_folder(conn, feed_id, folder_id).map_err(|e| format!("{e}"))?;
        storage::list_feeds(conn)
            .map_err(|e| format!("{e}"))?
            .into_iter()
            .find(|f| f.id == feed_id)
            .ok_or_else(|| "feed not found".to_string())
    })
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

#[command]
pub async fn rss_cache_article_image(
    app: AppHandle,
    url: String,
    referer: Option<String>,
) -> Result<String, String> {
    let path = article_image_cache::resolve(&url, referer.as_deref()).await?;
    app.asset_protocol_scope()
        .allow_file(Path::new(&path))
        .map_err(|error| format!("allow cached RSS image failed: {error}"))?;
    Ok(path)
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

#[cfg(test)]
mod tests {
    use super::background_refresh_is_due;

    #[test]
    fn background_refresh_requires_enabled_and_elapsed_day() {
        let day = 24 * 60 * 60;
        let now = 2 * day;
        assert!(!background_refresh_is_due(false, 24, None, now));
        assert!(background_refresh_is_due(true, 24, None, now));
        assert!(!background_refresh_is_due(
            true,
            24,
            Some(now - day + 1),
            now,
        ));
        assert!(background_refresh_is_due(true, 24, Some(now - day), now));
        assert!(background_refresh_is_due(
            true,
            6,
            Some(now - 6 * 60 * 60),
            now
        ));
    }

    #[test]
    fn future_timestamp_does_not_trigger_refresh_loop() {
        assert!(!background_refresh_is_due(true, 24, Some(200), 100));
    }
}
