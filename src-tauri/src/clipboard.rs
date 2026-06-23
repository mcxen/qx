use chrono::Local;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{command, AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

#[derive(Debug, Serialize, Clone)]
pub struct ClipboardEntry {
    pub id: String,
    pub text: String,
    pub timestamp: String,
    pub pinned: bool,
    pub copy_count: i64,
    pub image_path: Option<String>,
}

pub struct ClipboardDb(pub Arc<Mutex<Option<Connection>>>);

pub struct ClipboardShutdown(pub Arc<AtomicBool>);

fn get_db_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/Library/Application Support/qx", home));
    std::fs::create_dir_all(&dir).ok();
    dir.join("clipboard.db")
}

fn get_image_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/Library/Application Support/qx/clipboard_images", home));
    std::fs::create_dir_all(&dir).ok();
    dir
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
    ensure_column(&conn, "pinned", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(&conn, "copy_count", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(&conn, "image_path", "TEXT")?;

    // Cleanup old unpinned entries while preserving user-curated items.
    conn.execute(
        "DELETE FROM clipboard_history WHERE id NOT IN (
            SELECT id FROM clipboard_history
            WHERE pinned = 0
            ORDER BY timestamp DESC
            LIMIT 300
        ) AND pinned = 0",
        [],
    )?;
    Ok(conn)
}

fn ensure_column(conn: &Connection, name: &str, definition: &str) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(clipboard_history)")?;
    let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for column in columns.flatten() {
        if column == name {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE clipboard_history ADD COLUMN {name} {definition}"),
        [],
    )?;
    Ok(())
}

fn compute_id(text: &str) -> String {
    let hash = blake3::hash(text.as_bytes());
    hash.to_hex()[..16].to_string()
}

pub fn start_listener(app: &AppHandle) {
    let conn = match init_db() {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("clipboard DB init failed: {e}");
            None
        }
    };
    let db = Arc::new(Mutex::new(conn));
    let db_clone = db.clone();
    app.manage(ClipboardDb(db));

    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = shutdown.clone();
    app.manage(ClipboardShutdown(shutdown));

    let app_handle = app.clone();
    std::thread::Builder::new()
        .name("qx-clipboard".to_string())
        .spawn(move || {
            let mut last_text = String::new();
            let mut last_image_hash = String::new();

            // Initialize with current clipboard via Tauri plugin API
            if let Ok(text) = app_handle.clipboard().read_text() {
                if !text.is_empty() {
                    last_text = text.clone();
                    store(&db_clone, &text, None);
                }
            }

            loop {
                if shutdown_clone.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(1000));

                if shutdown_clone.load(Ordering::Relaxed) {
                    break;
                }

                // Check for new text
                match app_handle.clipboard().read_text() {
                    Ok(text) if !text.is_empty() && text != last_text => {
                        last_text = text.clone();
                        store(&db_clone, &text, None);
                        let _ = app_handle.emit("clipboard-updated", ());
                    }
                    Err(e) => {
                        eprintln!("clipboard read text error: {e}");
                    }
                    _ => {}
                }

                // Check for new image
                match app_handle.clipboard().read_image() {
                    Ok(image) => {
                        let rgba = image.rgba().to_vec();
                        let width = image.width();
                        let height = image.height();
                        let hash = blake3::hash(&rgba);
                        let hash_hex = hash.to_hex()[..16].to_string();

                        if !rgba.is_empty() && hash_hex != last_image_hash {
                            last_image_hash = hash_hex.clone();

                            let filename = format!("{}.png", hash_hex);
                            let image_dir = get_image_dir();
                            let image_path = image_dir.join(&filename);

                            // Save RGBA bytes as PNG
                            if let Some(img) =
                                image::RgbaImage::from_raw(width, height, rgba)
                            {
                                if img.save(&image_path).is_ok() {
                                    let path_str = image_path.to_string_lossy().to_string();
                                    store(&db_clone, "", Some(&path_str));
                                    let _ = app_handle.emit("clipboard-updated", ());
                                }
                            }
                        }
                    }
                    Err(_) => {
                        // No image in clipboard — this is normal, not an error worth logging
                    }
                }
            }
        })
        .ok();
}

fn store(db: &Arc<Mutex<Option<Connection>>>, text: &str, image_path: Option<&str>) {
    if let Ok(guard) = db.lock() {
        if let Some(ref conn) = *guard {
            let id = if !text.is_empty() {
                compute_id(text)
            } else if let Some(path) = image_path {
                compute_id(path)
            } else {
                return; // nothing to store
            };
            let ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let _ = conn.execute(
                "INSERT INTO clipboard_history (id, text, timestamp, image_path)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(id) DO UPDATE SET
                    text = excluded.text,
                    timestamp = excluded.timestamp,
                    image_path = COALESCE(excluded.image_path, clipboard_history.image_path)",
                params![id, text, ts, image_path],
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
                .prepare(
                    "SELECT id, text, timestamp, pinned, copy_count, image_path
                     FROM clipboard_history
                     ORDER BY pinned DESC, timestamp DESC
                     LIMIT ?1",
                )
                .ok();
            if let Some(ref mut stmt) = stmt {
                if let Ok(rows) = stmt.query_map(params![limit], |row| {
                    Ok(ClipboardEntry {
                        id: row.get(0)?,
                        text: row.get(1)?,
                        timestamp: row.get(2)?,
                        pinned: row.get::<_, i64>(3)? != 0,
                        copy_count: row.get(4)?,
                        image_path: row.get(5)?,
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

#[command]
pub fn delete_clipboard_entry(
    state: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<(), String> {
    if let Ok(guard) = state.0.lock() {
        if let Some(ref conn) = *guard {
            conn.execute("DELETE FROM clipboard_history WHERE id = ?1", params![id])
                .map_err(|e| format!("{e}"))?;
        }
    }
    Ok(())
}

#[command]
pub fn toggle_clipboard_pin(
    state: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<(), String> {
    if let Ok(guard) = state.0.lock() {
        if let Some(ref conn) = *guard {
            conn.execute(
                "UPDATE clipboard_history
                 SET pinned = CASE pinned WHEN 1 THEN 0 ELSE 1 END
                 WHERE id = ?1",
                params![id],
            )
            .map_err(|e| format!("{e}"))?;
        }
    }
    Ok(())
}

#[command]
pub fn record_clipboard_copy(
    state: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<(), String> {
    if let Ok(guard) = state.0.lock() {
        if let Some(ref conn) = *guard {
            let ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            conn.execute(
                "UPDATE clipboard_history
                 SET copy_count = copy_count + 1,
                     timestamp = ?2
                 WHERE id = ?1",
                params![id, ts],
            )
            .map_err(|e| format!("{e}"))?;
        }
    }
    Ok(())
}
