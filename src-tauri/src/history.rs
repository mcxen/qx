use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::command;

static DB_PATH: OnceLock<PathBuf> = OnceLock::new();
static DB: OnceLock<Mutex<Option<Connection>>> = OnceLock::new();

fn get_db_path() -> &'static PathBuf {
    DB_PATH.get_or_init(|| {
        let dir = crate::paths::data_dir();
        let _ = fs::create_dir_all(&dir);
        dir.join("history.db")
    })
}

/// Rolling window for search-result click aggregation (days).
const SEARCH_CLICK_RETENTION_DAYS: i64 = 30;

fn init_db() -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(get_db_path())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS launch_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL,
            name TEXT NOT NULL,
            timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS search_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query TEXT NOT NULL,
            timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS search_click_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL,
            name TEXT NOT NULL,
            kind TEXT,
            icon TEXT,
            timestamp TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_launch_ts ON launch_history(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_search_ts ON search_history(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_search_click_ts ON search_click_events(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_search_click_path_ts ON search_click_events(path, timestamp DESC);",
    )?;
    Ok(conn)
}

fn prune_search_clicks(conn: &Connection) {
    let _ = conn.execute(
        &format!(
            "DELETE FROM search_click_events
             WHERE timestamp < datetime('now', '-{SEARCH_CLICK_RETENTION_DAYS} days')"
        ),
        [],
    );
}

fn with_db<T>(f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let db = DB.get_or_init(|| Mutex::new(None));
    let mut guard = db.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.is_none() {
        *guard = Some(init_db().map_err(|e| format!("DB init failed: {e}"))?);
    }
    f(guard.as_ref().expect("history connection initialized"))
}

#[derive(Debug, Serialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize)]
pub struct SearchEntry {
    pub id: i64,
    pub query: String,
    pub timestamp: String,
}

/// Record that an app/file was launched.
#[command]
pub fn record_launch(path: String, name: String) -> Result<(), String> {
    with_db(|conn| {
        conn.execute(
            "INSERT INTO launch_history (path, name) VALUES (?1, ?2)",
            params![path, name],
        )
        .map_err(|e| format!("Failed to record launch: {e}"))?;
        Ok(())
    })
}

/// Get recent launch history.
#[command]
pub fn get_launch_history(limit: u32) -> Result<Vec<HistoryEntry>, String> {
    with_db(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, name, path, timestamp
                 FROM launch_history
                 ORDER BY timestamp DESC
                 LIMIT ?1",
            )
            .map_err(|e| format!("Query prepare failed: {e}"))?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(HistoryEntry {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    path: row.get(2)?,
                    timestamp: row.get(3)?,
                })
            })
            .map_err(|e| format!("Query failed: {e}"))?;
        let mut out = Vec::new();
        for row in rows.flatten() {
            out.push(row);
        }
        Ok(out)
    })
}

/// Clear launch history.
#[command]
pub fn clear_launch_history() -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM launch_history", [])
            .map_err(|e| format!("Failed to clear: {e}"))?;
        Ok(())
    })
}

/// Record a search query. Skips duplicates (same query as the most recent entry).
#[command]
pub fn record_search(query: String) -> Result<(), String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(());
    }
    with_db(|conn| {
        // Skip if the same query was the last one
        let duplicate: bool = conn
            .query_row(
                "SELECT 1 FROM search_history WHERE query = ?1 ORDER BY timestamp DESC LIMIT 1",
                params![q],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if duplicate {
            // Touch the timestamp
            let _ = conn.execute(
                "UPDATE search_history SET timestamp = datetime('now') WHERE id = (
                    SELECT id FROM search_history WHERE query = ?1 ORDER BY timestamp DESC LIMIT 1
                )",
                params![q],
            );
            return Ok(());
        }

        conn.execute("INSERT INTO search_history (query) VALUES (?1)", params![q])
            .map_err(|e| format!("Failed to record search: {e}"))?;

        // Prune to max 100 entries
        let _ = conn.execute(
            "DELETE FROM search_history WHERE id NOT IN (
                SELECT id FROM search_history ORDER BY timestamp DESC LIMIT 100
            )",
            [],
        );

        Ok(())
    })
}

/// Get recent search history.
#[command]
pub fn get_search_history(limit: u32) -> Result<Vec<SearchEntry>, String> {
    with_db(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, query, timestamp
                 FROM search_history
                 ORDER BY timestamp DESC
                 LIMIT ?1",
            )
            .map_err(|e| format!("Query prepare failed: {e}"))?;
        let rows = stmt
            .query_map(params![limit], |row| {
                Ok(SearchEntry {
                    id: row.get(0)?,
                    query: row.get(1)?,
                    timestamp: row.get(2)?,
                })
            })
            .map_err(|e| format!("Query failed: {e}"))?;
        let mut out = Vec::new();
        for row in rows.flatten() {
            out.push(row);
        }
        Ok(out)
    })
}

/// Clear all search history.
#[command]
pub fn clear_search_history() -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM search_history", [])
            .map_err(|e| format!("Failed to clear: {e}"))?;
        Ok(())
    })
}

/// Delete a single search entry by ID.
#[command]
pub fn delete_search_entry(id: i64) -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM search_history WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete: {e}"))?;
        Ok(())
    })
}

/// Aggregated search-result click stats (rolling window).
#[derive(Debug, Serialize)]
pub struct SearchClickStat {
    pub path: String,
    pub name: String,
    pub kind: Option<String>,
    pub icon: Option<String>,
    pub click_count: i64,
    pub last_clicked: String,
}

/// Record that a launcher search result was opened/clicked.
///
/// Fire-and-forget from the frontend. Events older than 30 days are pruned on write.
#[command]
pub fn record_search_click(
    path: String,
    name: String,
    kind: Option<String>,
    icon: Option<String>,
) -> Result<(), String> {
    let path = path.trim();
    let name = name.trim();
    if path.is_empty() || name.is_empty() {
        return Ok(());
    }
    with_db(|conn| {
        conn.execute(
            "INSERT INTO search_click_events (path, name, kind, icon) VALUES (?1, ?2, ?3, ?4)",
            params![path, name, kind, icon],
        )
        .map_err(|e| format!("Failed to record search click: {e}"))?;
        prune_search_clicks(conn);
        Ok(())
    })
}

/// Top search-result clicks in the last `days` (default 30), ordered by count then recency.
#[command]
pub fn get_search_click_stats(
    limit: Option<u32>,
    days: Option<u32>,
) -> Result<Vec<SearchClickStat>, String> {
    let limit = limit.unwrap_or(40).clamp(1, 200) as i64;
    let days = days
        .unwrap_or(SEARCH_CLICK_RETENTION_DAYS as u32)
        .clamp(1, 90) as i64;
    with_db(|conn| {
        // Opportunistic prune so idle installs still drop stale rows.
        prune_search_clicks(conn);
        // Aggregate by path, attach name/kind/icon from the most recent click row.
        let mut stmt = conn
            .prepare(
                "SELECT c.path,
                        COALESCE(e.name, c.path) AS name,
                        e.kind,
                        e.icon,
                        c.click_count,
                        c.last_clicked
                 FROM (
                   SELECT path,
                          COUNT(*) AS click_count,
                          MAX(timestamp) AS last_clicked
                   FROM search_click_events
                   WHERE timestamp >= datetime('now', ?1)
                   GROUP BY path
                 ) c
                 LEFT JOIN search_click_events e
                   ON e.path = c.path AND e.timestamp = c.last_clicked
                 GROUP BY c.path
                 ORDER BY c.click_count DESC, c.last_clicked DESC
                 LIMIT ?2",
            )
            .map_err(|e| format!("Query prepare failed: {e}"))?;
        let day_filter = format!("-{days} days");
        let rows = stmt
            .query_map(params![day_filter, limit], |row| {
                Ok(SearchClickStat {
                    path: row.get(0)?,
                    name: row.get(1)?,
                    kind: row.get(2)?,
                    icon: row.get(3)?,
                    click_count: row.get(4)?,
                    last_clicked: row.get(5)?,
                })
            })
            .map_err(|e| format!("Query failed: {e}"))?;
        let mut out = Vec::new();
        for row in rows.flatten() {
            out.push(row);
        }
        Ok(out)
    })
}

/// Drop all search-result click events (settings / storage reclaim).
#[command]
pub fn clear_search_click_stats() -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM search_click_events", [])
            .map_err(|e| format!("Failed to clear search clicks: {e}"))?;
        Ok(())
    })
}
