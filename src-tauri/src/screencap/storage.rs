use super::GifEntry;
use chrono::Local;
use rusqlite::{params, Connection};
use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn captures_dir() -> PathBuf {
    let base = crate::paths::pictures_dir();
    let dir = base.join("Qx");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn db_path() -> PathBuf {
    let dir = crate::paths::data_dir();
    let _ = fs::create_dir_all(&dir);
    dir.join("screencap.db")
}

fn open_db() -> rusqlite::Result<Connection> {
    let conn = Connection::open(db_path())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS gif_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            frame_count INTEGER,
            duration_ms INTEGER,
            created_at INTEGER NOT NULL
        );",
    )?;
    Ok(conn)
}

pub(super) fn insert_history(
    path: &Path,
    width: u32,
    height: u32,
    frames: u32,
    duration_ms: u64,
) -> rusqlite::Result<i64> {
    let conn = open_db()?;
    let now = Local::now().timestamp();
    conn.execute(
        "INSERT INTO gif_history (file_path, width, height, frame_count, duration_ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![path.to_string_lossy(), width, height, frames, duration_ms, now],
    )?;
    Ok(conn.last_insert_rowid())
}

pub(super) fn save_capture(source_path: String, dest_path: String) -> Result<String, String> {
    fs::copy(&source_path, &dest_path).map_err(|error| format!("copy: {error}"))?;
    Ok(dest_path)
}

pub(super) fn list_history(limit: Option<u32>) -> Vec<GifEntry> {
    let limit = limit.unwrap_or(50) as i64;
    let conn = match open_db() {
        Ok(connection) => connection,
        Err(_) => return Vec::new(),
    };
    let mut statement = match conn.prepare(
        "SELECT id, file_path, width, height, frame_count, duration_ms, created_at FROM gif_history ORDER BY created_at DESC LIMIT ?1",
    ) {
        Ok(statement) => statement,
        Err(_) => return Vec::new(),
    };
    let rows = statement.query_map(params![limit], |row| {
        Ok(GifEntry {
            id: row.get(0)?,
            path: row.get(1)?,
            width: row.get::<_, Option<i64>>(2)?.unwrap_or(0) as u32,
            height: row.get::<_, Option<i64>>(3)?.unwrap_or(0) as u32,
            frame_count: row.get::<_, Option<i64>>(4)?.unwrap_or(0) as u32,
            duration_ms: row.get::<_, Option<i64>>(5)?.unwrap_or(0) as u64,
            created_at: row.get(6)?,
        })
    });
    rows.map(|rows| rows.flatten().collect())
        .unwrap_or_default()
}

pub(super) fn delete_capture(id: i64) -> Result<(), String> {
    let conn = open_db().map_err(|error| format!("db: {error}"))?;
    let file_path: String = conn
        .query_row(
            "SELECT file_path FROM gif_history WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|error| format!("not found: {error}"))?;
    conn.execute("DELETE FROM gif_history WHERE id = ?1", params![id])
        .map_err(|error| format!("delete: {error}"))?;
    let _ = fs::remove_file(file_path);
    Ok(())
}
