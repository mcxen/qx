use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::types::{Article, Feed, Folder};

/// Managed Tauri state. Connection may be `None` if the first open failed;
/// callers reconnect lazily via `ensure_open`.
pub struct RssDb(pub Arc<Mutex<Option<Connection>>>);

/// Open (or re-open) the DB into `slot` if empty.
pub fn ensure_open(slot: &mut Option<Connection>) -> Result<&Connection, String> {
    if slot.is_none() {
        *slot = Some(open().map_err(|e| format!("rss db open: {e}"))?);
    }
    slot.as_ref()
        .ok_or_else(|| "rss db unavailable".to_string())
}

pub fn db_path() -> PathBuf {
    let dir = crate::paths::data_dir();
    std::fs::create_dir_all(&dir).ok();
    dir.join("rss.db")
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    name: &str,
    definition: &str,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(Result::ok)
        .any(|column| column == name);
    if !exists {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {name} {definition}"),
            [],
        )?;
    }
    Ok(())
}

fn migrate_schema(conn: &mut Connection) -> rusqlite::Result<()> {
    let transaction = conn.transaction()?;
    transaction.execute_batch(
        "CREATE TABLE IF NOT EXISTS rss_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            parent_id INTEGER REFERENCES rss_folders(id) ON DELETE CASCADE,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS rss_feeds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL UNIQUE,
            title TEXT,
            icon TEXT,
            last_fetched INTEGER,
            error_count INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            folder_id INTEGER REFERENCES rss_folders(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS rss_articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            feed_id INTEGER NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
            guid TEXT NOT NULL UNIQUE,
            title TEXT,
            summary TEXT,
            content TEXT,
            author TEXT,
            link TEXT,
            image_url TEXT,
            is_read INTEGER DEFAULT 0,
            is_starred INTEGER DEFAULT 0,
            reading_progress REAL NOT NULL DEFAULT 0,
            published_at INTEGER,
            created_at INTEGER NOT NULL
        );",
    )?;
    // Old databases must gain columns before any index or query references them.
    // CREATE TABLE IF NOT EXISTS does not alter an existing table.
    ensure_column(
        &transaction,
        "rss_feeds",
        "folder_id",
        "INTEGER REFERENCES rss_folders(id) ON DELETE SET NULL",
    )?;
    ensure_column(
        &transaction,
        "rss_articles",
        "reading_progress",
        "REAL NOT NULL DEFAULT 0",
    )?;
    transaction.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_articles_feed ON rss_articles(feed_id);
        CREATE INDEX IF NOT EXISTS idx_articles_read ON rss_articles(is_read);
        CREATE INDEX IF NOT EXISTS idx_feeds_folder ON rss_feeds(folder_id);
        CREATE TABLE IF NOT EXISTS rss_meta (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );",
    )?;
    transaction.commit()
}

pub fn open() -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(db_path())?;
    migrate_schema(&mut conn)?;
    // First-open (or first upgrade) default catalog. INSERT OR IGNORE — safe if
    // the user already added the same URL. Flag prevents re-adding after delete.
    seed_default_catalog_if_needed(&conn)?;
    // Existing installs often have empty icon columns; fill favicon URLs from
    // the feed host without a network round-trip (proxy feeds improve after refresh).
    let _ = backfill_empty_feed_icons(&conn);
    Ok(conn)
}

/// Built-in starter subscriptions. Folders are simple Chinese categories.
/// Titles are placeholders until the next successful refresh rewrites feed meta.
///
/// Bump `DEFAULT_CATALOG_VERSION` when adding feeds so existing installs receive
/// new URLs once (`INSERT OR IGNORE` — already-present or user-kept URLs stay).
const DEFAULT_CATALOG_META_KEY: &str = "default_catalog_version";
const DEFAULT_CATALOG_VERSION: &str = "3";

struct DefaultFeed {
    url: &'static str,
    title: &'static str,
}

struct DefaultFolder {
    name: &'static str,
    sort_order: i64,
    feeds: &'static [DefaultFeed],
}

const DEFAULT_CATALOG: &[DefaultFolder] = &[
    DefaultFolder {
        name: "科技",
        sort_order: 0,
        feeds: &[
            DefaultFeed {
                url: "http://www.ithome.com/rss/",
                title: "IT之家",
            },
            DefaultFeed {
                url: "https://www.expreview.com/rss.php",
                title: "超能网",
            },
            DefaultFeed {
                url: "https://www.ruanyifeng.com/blog/atom.xml",
                title: "阮一峰的网络日志",
            },
        ],
    },
    DefaultFolder {
        name: "新闻",
        sort_order: 1,
        feeds: &[
            DefaultFeed {
                url: "https://plink.anyfeeder.com/newscn/whxw",
                title: "文海新闻",
            },
            DefaultFeed {
                url: "https://plink.anyfeeder.com/zaobao/realtime/china",
                title: "联合早报 · 中国",
            },
        ],
    },
    DefaultFolder {
        name: "资讯",
        sort_order: 2,
        feeds: &[
            DefaultFeed {
                url: "https://plink.anyfeeder.com/pentitugua",
                title: "喷嚏图卦",
            },
            DefaultFeed {
                url: "https://plink.anyfeeder.com/zhihu/daily",
                title: "知乎日报",
            },
            DefaultFeed {
                url: "https://plink.anyfeeder.com/weixin/qnwzwx",
                title: "青年文摘",
            },
        ],
    },
];

fn meta_get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM rss_meta WHERE key = ?1 LIMIT 1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

fn meta_set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO rss_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// URLs that were briefly in the starter catalog and should be removed on upgrade
/// when they are still the default (user can re-add manually if desired).
const DEFAULT_CATALOG_RETIRED_URLS: &[&str] = &["https://plink.anyfeeder.com/infzm/news"];

/// Seed / upgrade starter folders + feeds (keyed by catalog version in `rss_meta`).
pub fn seed_default_catalog_if_needed(conn: &Connection) -> rusqlite::Result<()> {
    // Migrate legacy flag from the first catalog revision.
    if meta_get(conn, "default_catalog_v1")?.as_deref() == Some("1")
        && meta_get(conn, DEFAULT_CATALOG_META_KEY)?.is_none()
    {
        let _ = meta_set(conn, DEFAULT_CATALOG_META_KEY, "1");
    }

    if meta_get(conn, DEFAULT_CATALOG_META_KEY)?.as_deref() == Some(DEFAULT_CATALOG_VERSION) {
        return Ok(());
    }

    for folder in DEFAULT_CATALOG {
        let folder_id = create_folder(conn, folder.name, None)?;
        let _ = conn.execute(
            "UPDATE rss_folders SET sort_order = ?1 WHERE id = ?2",
            params![folder.sort_order, folder_id],
        );
        for feed in folder.feeds {
            // Prefill favicon from feed URL host (proxy feeds improve after first refresh
            // once article links reveal the real publisher domain).
            let icon = super::fetcher::resolve_feed_icon(feed.url, "", &[]);
            let _ = insert_feed_in_folder(conn, feed.url, feed.title, &icon, Some(folder_id));
        }
    }

    // Drop retired starter feeds (e.g. summary-only INFZM bridge).
    for url in DEFAULT_CATALOG_RETIRED_URLS {
        let _ = conn.execute("DELETE FROM rss_feeds WHERE url = ?1", params![url]);
    }

    meta_set(conn, DEFAULT_CATALOG_META_KEY, DEFAULT_CATALOG_VERSION)?;
    Ok(())
}

/// Assign favicon service URLs for feeds that still have an empty `icon` column.
fn backfill_empty_feed_icons(conn: &Connection) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT id, url FROM rss_feeds
         WHERE icon IS NULL OR TRIM(icon) = ''",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, url) in rows {
        let icon = super::fetcher::resolve_feed_icon(&url, "", &[]);
        if icon.is_empty() {
            continue;
        }
        conn.execute(
            "UPDATE rss_feeds SET icon = ?1 WHERE id = ?2 AND (icon IS NULL OR TRIM(icon) = '')",
            params![icon, id],
        )?;
    }
    Ok(())
}

pub fn insert_feed(conn: &Connection, url: &str, title: &str, icon: &str) -> rusqlite::Result<i64> {
    insert_feed_in_folder(conn, url, title, icon, None)
}

pub fn insert_feed_in_folder(
    conn: &Connection,
    url: &str,
    title: &str,
    icon: &str,
    folder_id: Option<i64>,
) -> rusqlite::Result<i64> {
    let now = chrono::Local::now().timestamp();
    conn.execute(
        "INSERT OR IGNORE INTO rss_feeds (url, title, icon, last_fetched, created_at, folder_id)
         VALUES (?1, ?2, ?3, 0, ?4, ?5)",
        params![url, title, icon, now, folder_id],
    )?;
    // Keep folder assignment if feed already existed.
    if folder_id.is_some() {
        let _ = conn.execute(
            "UPDATE rss_feeds SET folder_id = COALESCE(folder_id, ?1) WHERE url = ?2",
            params![folder_id, url],
        );
    }
    let id: i64 = conn.query_row(
        "SELECT id FROM rss_feeds WHERE url = ?1",
        params![url],
        |row| row.get(0),
    )?;
    Ok(id)
}

pub fn update_feed_meta(
    conn: &Connection,
    id: i64,
    title: &str,
    icon: &str,
) -> rusqlite::Result<()> {
    let now = chrono::Local::now().timestamp();
    // Never wipe a good icon with an empty refresh payload.
    conn.execute(
        "UPDATE rss_feeds SET
            title = CASE WHEN ?1 = '' THEN title ELSE ?1 END,
            icon = CASE WHEN ?2 = '' THEN icon ELSE ?2 END,
            last_fetched = ?3,
            error_count = 0
         WHERE id = ?4",
        params![title, icon, now, id],
    )?;
    Ok(())
}

pub fn increment_feed_error(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE rss_feeds SET error_count = error_count + 1 WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn list_feeds(conn: &Connection) -> rusqlite::Result<Vec<Feed>> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.url, f.title, f.icon, f.last_fetched, f.error_count, f.created_at,
                (SELECT COUNT(*) FROM rss_articles a WHERE a.feed_id = f.id AND a.is_read = 0) AS unread,
                f.folder_id,
                d.name AS folder_name
         FROM rss_feeds f
         LEFT JOIN rss_folders d ON d.id = f.folder_id
         ORDER BY
           CASE WHEN f.folder_id IS NULL THEN 1 ELSE 0 END,
           COALESCE(d.sort_order, 0) ASC,
           COALESCE(d.name, '') COLLATE NOCASE ASC,
           f.title COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Feed {
            id: row.get(0)?,
            url: row.get(1)?,
            title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            icon: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            last_fetched: row.get::<_, Option<i64>>(4)?.unwrap_or(0),
            error_count: row.get::<_, Option<i64>>(5)?.unwrap_or(0),
            created_at: row.get(6)?,
            unread_count: row.get(7)?,
            folder_id: row.get(8)?,
            folder_name: row.get(9)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn list_folders(conn: &Connection) -> rusqlite::Result<Vec<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT d.id, d.name, d.parent_id, d.sort_order, d.created_at,
                (SELECT COUNT(*) FROM rss_feeds f WHERE f.folder_id = d.id) AS feed_count
         FROM rss_folders d
         ORDER BY d.sort_order ASC, d.name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Folder {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
            sort_order: row.get(3)?,
            created_at: row.get(4)?,
            feed_count: row.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn create_folder(
    conn: &Connection,
    name: &str,
    parent_id: Option<i64>,
) -> rusqlite::Result<i64> {
    let now = chrono::Local::now().timestamp();
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "folder name empty"),
        )));
    }
    // Reuse existing folder with same name under same parent.
    if let Ok(id) = conn.query_row(
        "SELECT id FROM rss_folders WHERE name = ?1 AND (
            (?2 IS NULL AND parent_id IS NULL) OR parent_id = ?2
         ) LIMIT 1",
        params![trimmed, parent_id],
        |row| row.get::<_, i64>(0),
    ) {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO rss_folders (name, parent_id, sort_order, created_at) VALUES (?1, ?2, 0, ?3)",
        params![trimmed, parent_id, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_folder(conn: &Connection, id: i64, name: &str) -> rusqlite::Result<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
            std::io::Error::new(std::io::ErrorKind::InvalidInput, "folder name empty"),
        )));
    }
    conn.execute(
        "UPDATE rss_folders SET name = ?1 WHERE id = ?2",
        params![trimmed, id],
    )?;
    Ok(())
}

pub fn delete_folder(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    // Feeds become ungrouped; child folders cascade via FK when present.
    conn.execute(
        "UPDATE rss_feeds SET folder_id = NULL WHERE folder_id = ?1",
        params![id],
    )?;
    conn.execute("DELETE FROM rss_folders WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_feed_folder(
    conn: &Connection,
    feed_id: i64,
    folder_id: Option<i64>,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE rss_feeds SET folder_id = ?1 WHERE id = ?2",
        params![folder_id, feed_id],
    )?;
    Ok(())
}

pub fn get_or_create_folder_by_name(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    create_folder(conn, name, None)
}

pub fn list_articles(
    conn: &Connection,
    feed_id: Option<i64>,
    only_unread: bool,
    query: Option<&str>,
) -> rusqlite::Result<Vec<Article>> {
    let mut sql = String::from(
        "SELECT id, feed_id, guid, title, summary, content, author, link, image_url, is_read, is_starred, reading_progress, published_at, created_at FROM rss_articles WHERE 1=1",
    );
    let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    if let Some(fid) = feed_id {
        sql.push_str(" AND feed_id = ?");
        params_vec.push(Box::new(fid));
    }
    if only_unread {
        sql.push_str(" AND is_read = 0");
    }
    if let Some(q) = query {
        if !q.is_empty() {
            sql.push_str(" AND (title LIKE ? OR summary LIKE ?)");
            let like = format!("%{}%", q);
            params_vec.push(Box::new(like.clone()));
            params_vec.push(Box::new(like));
        }
    }
    sql.push_str(" ORDER BY published_at DESC NULLS LAST LIMIT 500");
    let mut stmt = conn.prepare(&sql)?;
    let params_ref: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|b| b.as_ref()).collect();
    let rows = stmt.query_map(params_ref.as_slice(), |row| {
        Ok(Article {
            id: row.get(0)?,
            feed_id: row.get(1)?,
            guid: row.get(2)?,
            title: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            summary: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            content: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            author: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            link: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            image_url: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
            is_read: row.get::<_, i64>(9)? != 0,
            is_starred: row.get::<_, i64>(10)? != 0,
            reading_progress: row.get::<_, f64>(11)?.clamp(0.0, 100.0),
            published_at: row.get::<_, Option<i64>>(12)?.unwrap_or(0),
            created_at: row.get(13)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn get_article(conn: &Connection, id: i64) -> rusqlite::Result<Option<Article>> {
    let mut stmt = conn.prepare(
        "SELECT id, feed_id, guid, title, summary, content, author, link, image_url, is_read, is_starred, reading_progress, published_at, created_at FROM rss_articles WHERE id = ?1",
    )?;
    let mut rows = stmt.query(params![id])?;
    if let Ok(Some(row)) = rows.next() {
        return Ok(Some(Article {
            id: row.get(0)?,
            feed_id: row.get(1)?,
            guid: row.get(2)?,
            title: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
            summary: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            content: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            author: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            link: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            image_url: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
            is_read: row.get::<_, i64>(9)? != 0,
            is_starred: row.get::<_, i64>(10)? != 0,
            reading_progress: row.get::<_, f64>(11)?.clamp(0.0, 100.0),
            published_at: row.get::<_, Option<i64>>(12)?.unwrap_or(0),
            created_at: row.get(13)?,
        }));
    }
    Ok(None)
}

pub fn set_read(conn: &Connection, id: i64, is_read: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE rss_articles SET is_read = ?1 WHERE id = ?2",
        params![if is_read { 1 } else { 0 }, id],
    )?;
    Ok(())
}

pub fn set_reading_progress(conn: &Connection, id: i64, progress: f64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE rss_articles SET reading_progress = ?1 WHERE id = ?2",
        params![progress.clamp(0.0, 100.0), id],
    )?;
    Ok(())
}

pub fn mark_all_read(conn: &Connection, feed_id: i64) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE rss_articles SET is_read = 1 WHERE feed_id = ?1",
        params![feed_id],
    )?;
    Ok(())
}

pub fn set_starred(conn: &Connection, id: i64, is_starred: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE rss_articles SET is_starred = ?1 WHERE id = ?2",
        params![if is_starred { 1 } else { 0 }, id],
    )?;
    Ok(())
}

pub fn delete_feed(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM rss_articles WHERE feed_id = ?1", params![id])?;
    conn.execute("DELETE FROM rss_feeds WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn feed_url_by_id(conn: &Connection, id: i64) -> Option<String> {
    conn.query_row(
        "SELECT url FROM rss_feeds WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )
    .ok()
}

pub fn all_feed_urls(conn: &Connection) -> rusqlite::Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare("SELECT id, url FROM rss_feeds")?;
    let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn update_feed(conn: &Connection, id: i64, url: &str, title: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE rss_feeds SET url = ?1, title = ?2 WHERE id = ?3",
        params![url, title, id],
    )?;
    Ok(())
}

pub fn prune_articles(conn: &Connection, feed_id: i64, max_count: u32) -> rusqlite::Result<()> {
    if max_count == 0 {
        return Ok(());
    }
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM rss_articles WHERE feed_id = ?1",
        params![feed_id],
        |row| row.get(0),
    )?;
    if count <= max_count as i64 {
        return Ok(());
    }
    let to_delete = count - max_count as i64;
    conn.execute(
        "DELETE FROM rss_articles
         WHERE feed_id = ?1
         AND is_starred = 0
         ORDER BY published_at ASC NULLS FIRST, created_at ASC
         LIMIT ?2",
        params![feed_id, to_delete],
    )?;
    Ok(())
}

pub fn delete_old_articles(conn: &Connection, max_age_days: u32) -> rusqlite::Result<usize> {
    if max_age_days == 0 {
        return Ok(0);
    }
    let cutoff = chrono::Local::now().timestamp() - (max_age_days as i64 * 86400);
    conn.execute(
        "DELETE FROM rss_articles
         WHERE is_starred = 0
           AND COALESCE(published_at, created_at) < ?1",
        params![cutoff],
    )
}

pub fn delete_read_articles(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM rss_articles WHERE is_read = 1 AND is_starred = 0",
        [],
    )
}

pub fn delete_all_articles(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM rss_articles", [])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_schema_adds_columns_before_dependent_indexes() {
        let mut conn = Connection::open_in_memory().expect("open legacy rss db");
        conn.execute_batch(
            "CREATE TABLE rss_feeds (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                url TEXT NOT NULL UNIQUE,
                title TEXT,
                icon TEXT,
                last_fetched INTEGER,
                error_count INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE rss_articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                feed_id INTEGER NOT NULL REFERENCES rss_feeds(id) ON DELETE CASCADE,
                guid TEXT NOT NULL UNIQUE,
                title TEXT,
                summary TEXT,
                content TEXT,
                author TEXT,
                link TEXT,
                image_url TEXT,
                is_read INTEGER DEFAULT 0,
                is_starred INTEGER DEFAULT 0,
                published_at INTEGER,
                created_at INTEGER NOT NULL
            );
            INSERT INTO rss_feeds (url, title, created_at)
            VALUES ('https://example.com/feed.xml', 'Legacy feed', 1);
            INSERT INTO rss_articles (feed_id, guid, title, created_at)
            VALUES (1, 'legacy-guid', 'Legacy article', 1);",
        )
        .expect("create legacy schema");

        migrate_schema(&mut conn).expect("upgrade legacy schema");
        // Re-running startup migrations must also remain safe.
        migrate_schema(&mut conn).expect("repeat schema migration");

        let folder_id: Option<i64> = conn
            .query_row("SELECT folder_id FROM rss_feeds WHERE id = 1", [], |row| {
                row.get(0)
            })
            .expect("read migrated folder column");
        assert_eq!(folder_id, None);

        let reading_progress: f64 = conn
            .query_row(
                "SELECT reading_progress FROM rss_articles WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read migrated progress column");
        assert_eq!(reading_progress, 0.0);

        let folder_index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'index' AND name = 'idx_feeds_folder'",
                [],
                |row| row.get(0),
            )
            .expect("read migrated folder index");
        assert_eq!(folder_index_count, 1);
    }

    #[test]
    fn reading_progress_is_clamped_and_persisted() {
        let conn = Connection::open_in_memory().expect("open in-memory rss db");
        conn.execute_batch(
            "CREATE TABLE rss_articles (
                id INTEGER PRIMARY KEY,
                reading_progress REAL NOT NULL DEFAULT 0
            );
            INSERT INTO rss_articles (id) VALUES (1);",
        )
        .expect("create article");

        set_reading_progress(&conn, 1, 42.0).expect("save progress");
        let saved: f64 = conn
            .query_row(
                "SELECT reading_progress FROM rss_articles WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read progress");
        assert_eq!(saved, 42.0);

        set_reading_progress(&conn, 1, 140.0).expect("clamp progress");
        let clamped: f64 = conn
            .query_row(
                "SELECT reading_progress FROM rss_articles WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .expect("read clamped progress");
        assert_eq!(clamped, 100.0);
    }
}
