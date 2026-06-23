use rusqlite::{Connection, params};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::command;

static DB_PATH: OnceLock<PathBuf> = OnceLock::new();

fn get_db_path() -> &'static PathBuf {
    DB_PATH.get_or_init(|| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let dir = PathBuf::from(format!("{}/Library/Application Support/qx", home));
        let _ = fs::create_dir_all(&dir);
        dir.join("history.db")
    })
}

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
        CREATE INDEX IF NOT EXISTS idx_launch_ts ON launch_history(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_search_ts ON search_history(timestamp DESC);",
    )?;
    Ok(conn)
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
    let conn = init_db().map_err(|e| format!("DB init failed: {e}"))?;
    conn.execute(
        "INSERT INTO launch_history (path, name) VALUES (?1, ?2)",
        params![path, name],
    )
    .map_err(|e| format!("Failed to record launch: {e}"))?;
    Ok(())
}

/// Get recent launch history.
#[command]
pub fn get_launch_history(limit: u32) -> Result<Vec<HistoryEntry>, String> {
    let conn = init_db().map_err(|e| format!("DB init failed: {e}"))?;
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
}

/// Clear launch history.
#[command]
pub fn clear_launch_history() -> Result<(), String> {
    let conn = init_db().map_err(|e| format!("DB init failed: {e}"))?;
    conn.execute("DELETE FROM launch_history", [])
        .map_err(|e| format!("Failed to clear: {e}"))?;
    Ok(())
}

/// Record a search query. Skips duplicates (same query as the most recent entry).
#[command]
pub fn record_search(query: String) -> Result<(), String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(());
    }
    let conn = init_db().map_err(|e| format!("DB init failed: {e}"))?;

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

    conn.execute(
        "INSERT INTO search_history (query) VALUES (?1)",
        params![q],
    )
    .map_err(|e| format!("Failed to record search: {e}"))?;

    // Prune to max 100 entries
    let _ = conn.execute(
        "DELETE FROM search_history WHERE id NOT IN (
            SELECT id FROM search_history ORDER BY timestamp DESC LIMIT 100
        )",
        [],
    );

    Ok(())
}

/// Get recent search history.
#[command]
pub fn get_search_history(limit: u32) -> Result<Vec<SearchEntry>, String> {
    let conn = init_db().map_err(|e| format!("DB init failed: {e}"))?;
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
}

/// Clear all search history.
#[command]
pub fn clear_search_history() -> Result<(), String> {
    let conn = init_db().map_err(|e| format!("DB init failed: {e}"))?;
    conn.execute("DELETE FROM search_history", [])
        .map_err(|e| format!("Failed to clear: {e}"))?;
    Ok(())
}

/// Delete a single search entry by ID.
#[command]
pub fn delete_search_entry(id: i64) -> Result<(), String> {
    let conn = init_db().map_err(|e| format!("DB init failed: {e}"))?;
    conn.execute("DELETE FROM search_history WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete: {e}"))?;
    Ok(())
}
