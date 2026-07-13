use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::types::{Article, Feed};

pub struct RssDb(pub Arc<Mutex<Connection>>);

pub fn db_path() -> PathBuf {
    let dir = crate::paths::data_dir();
    std::fs::create_dir_all(&dir).ok();
    dir.join("rss.db")
}

pub fn open() -> rusqlite::Result<Connection> {
    let conn = Connection::open(db_path())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS rss_feeds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL UNIQUE,
            title TEXT,
            icon TEXT,
            last_fetched INTEGER,
            error_count INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
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
            published_at INTEGER,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_articles_feed ON rss_articles(feed_id);
        CREATE INDEX IF NOT EXISTS idx_articles_read ON rss_articles(is_read);",
    )?;
    Ok(conn)
}

pub fn insert_feed(conn: &Connection, url: &str, title: &str, icon: &str) -> rusqlite::Result<i64> {
    let now = chrono::Local::now().timestamp();
    conn.execute(
        "INSERT OR IGNORE INTO rss_feeds (url, title, icon, last_fetched, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
        params![url, title, icon, now],
    )?;
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
    conn.execute(
        "UPDATE rss_feeds SET title = ?1, icon = ?2, last_fetched = ?3, error_count = 0 WHERE id = ?4",
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
                (SELECT COUNT(*) FROM rss_articles a WHERE a.feed_id = f.id AND a.is_read = 0) AS unread
         FROM rss_feeds f ORDER BY f.title ASC",
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
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn list_articles(
    conn: &Connection,
    feed_id: Option<i64>,
    only_unread: bool,
    query: Option<&str>,
) -> rusqlite::Result<Vec<Article>> {
    let mut sql = String::from(
        "SELECT id, feed_id, guid, title, summary, content, author, link, image_url, is_read, is_starred, published_at, created_at FROM rss_articles WHERE 1=1",
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
            published_at: row.get::<_, Option<i64>>(11)?.unwrap_or(0),
            created_at: row.get(12)?,
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
        "SELECT id, feed_id, guid, title, summary, content, author, link, image_url, is_read, is_starred, published_at, created_at FROM rss_articles WHERE id = ?1",
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
            published_at: row.get::<_, Option<i64>>(11)?.unwrap_or(0),
            created_at: row.get(12)?,
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
