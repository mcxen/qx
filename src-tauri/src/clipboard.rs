use chrono::Local;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{command, AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
pub struct ClipboardEntry {
    pub id: String,
    pub text: String,
    pub timestamp: String,
}

pub struct ClipboardDb(pub Arc<Mutex<Option<Connection>>>);

fn get_db_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/Library/Application Support/qx", home));
    std::fs::create_dir_all(&dir).ok();
    dir.join("clipboard.db")
}

fn init_db() -> rusqlite::Result<Connection> {
    let path = get_db_path();
    let conn = Connection::open(&path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS clipboard_history (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            timestamp TEXT NOT NULL
        );",
    )?;
    // Cleanup old entries
    conn.execute(
        "DELETE FROM clipboard_history WHERE id NOT IN (
            SELECT id FROM clipboard_history ORDER BY timestamp DESC LIMIT 200
        )",
        [],
    )?;
    Ok(conn)
}

fn compute_id(text: &str) -> String {
    let hash = blake3::hash(text.as_bytes());
    hash.to_hex()[..16].to_string()
}

pub fn start_listener(app: &AppHandle) {
    let conn = init_db().expect("Failed to init clipboard DB");
    let db = Arc::new(Mutex::new(Some(conn)));
    let db_clone = db.clone();
    app.manage(ClipboardDb(db));

    std::thread::spawn(move || {
        let mut last_text = String::new();

        // Initialize with current clipboard
        if let Ok(initial) = read_clipboard() {
            if !initial.is_empty() {
                last_text = initial.clone();
                store(&db_clone, &initial);
            }
        }

        loop {
            std::thread::sleep(std::time::Duration::from_millis(1000));

            if let Ok(text) = read_clipboard() {
                if !text.is_empty() && text != last_text {
                    last_text = text.clone();
                    store(&db_clone, &text);
                    let _ = app.emit("clipboard-updated", ());
                }
            }
        }
    });
}

fn read_clipboard() -> Result<String, String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| format!("{e}"))?;
    cb.get_text().map_err(|e| format!("{e}"))
}

fn store(db: &Arc<Mutex<Option<Connection>>>, text: &str) {
    if let Ok(guard) = db.lock() {
        if let Some(ref conn) = *guard {
            let id = compute_id(text);
            let ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let _ = conn.execute(
                "INSERT OR IGNORE INTO clipboard_history (id, text, timestamp) VALUES (?1, ?2, ?3)",
                params![id, text, ts],
            );
        }
    }
}

#[command]
pub fn get_clipboard_history(
    state: tauri::State<'_, ClipboardDb>,
    limit: Option<u32>,
) -> Vec<ClipboardEntry> {
    let limit = limit.unwrap_or(50);
    let mut results = Vec::new();
    if let Ok(guard) = state.0.lock() {
        if let Some(ref conn) = *guard {
            let mut stmt = conn
                .prepare("SELECT id, text, timestamp FROM clipboard_history ORDER BY timestamp DESC LIMIT ?1")
                .ok();
            if let Some(ref mut stmt) = stmt {
                if let Ok(rows) = stmt.query_map(params![limit], |row| {
                    Ok(ClipboardEntry {
                        id: row.get(0)?,
                        text: row.get(1)?,
                        timestamp: row.get(2)?,
                    })
                }) {
                    for row in rows.flatten() {
                        results.push(row);
                    }
                }
            }
        }
    }
    results
}

#[command]
pub fn clear_clipboard_history(state: tauri::State<'_, ClipboardDb>) -> Result<(), String> {
    if let Ok(guard) = state.0.lock() {
        if let Some(ref conn) = *guard {
            conn.execute("DELETE FROM clipboard_history", [])
                .map_err(|e| format!("{e}"))?;
        }
    }
    Ok(())
}
