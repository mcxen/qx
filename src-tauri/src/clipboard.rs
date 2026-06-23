use chrono::Local;
use dirs;
use image::codecs::png::PngEncoder;
use image::ExtendedColorType;
use image::ImageEncoder;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::image::Image as TauriImage;
use tauri::{command, AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

// --- Image safety limits ---
/// Maximum allowed image dimension in pixels (width or height).
/// A 4096×4096 RGBA image is ~64 MB — safely reject anything larger.
const MAX_IMAGE_DIMENSION: u32 = 4096;
/// Maximum total pixel count (width × height).
const MAX_IMAGE_PIXELS: u64 = 16_777_216; // 4096 × 4096
const MAX_PASTEBOARD_SNAPSHOT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
struct PasteboardSnapshot {
    entries: Vec<PasteboardSnapshotEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PasteboardSnapshotEntry {
    type_name: String,
    file_name: String,
}

// --- macOS clipboard change count (lightweight content-change detection) ---
/// Returns the current `NSPasteboard` changeCount on macOS, or `None` on
/// other platforms.  Reading this integer is **orders of magnitude cheaper**
/// than decoding a full RGBA image from the clipboard.
#[cfg(target_os = "macos")]
fn clipboard_change_count() -> Option<i64> {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;

    use std::ffi::CStr;
    let cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSPasteboard\0").ok()?)?;
    unsafe {
        let pasteboard: *mut objc2::runtime::NSObject = msg_send![cls, generalPasteboard];
        if pasteboard.is_null() {
            return None;
        }
        let count: i64 = msg_send![pasteboard, changeCount];
        Some(count)
    }
}

#[cfg(target_os = "macos")]
fn should_snapshot_pasteboard_type(type_name: &str) -> bool {
    let lower = type_name.to_ascii_lowercase();
    lower.contains("png")
        || lower.contains("tiff")
        || lower.contains("jpeg")
        || lower.contains("jpg")
        || lower.contains("image")
        || lower.contains("pdf")
        || lower.contains("file-url")
        || lower.contains("url")
        || lower.contains("filename")
}

#[cfg(target_os = "macos")]
fn snapshot_current_pasteboard(id: &str) -> Option<String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, NSObject};
    use std::ffi::CStr;

    let dir = get_image_dir().join(format!("{id}.pasteboard"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).ok()?;

    let mut entries = Vec::new();
    let mut total_bytes = 0usize;

    unsafe {
        let cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSPasteboard\0").ok()?)?;
        let pasteboard: *mut NSObject = msg_send![cls, generalPasteboard];
        if pasteboard.is_null() {
            return None;
        }

        let types: *mut NSObject = msg_send![pasteboard, types];
        if types.is_null() {
            return None;
        }

        let count: usize = msg_send![types, count];
        for index in 0..count {
            let pasteboard_type: *mut NSObject = msg_send![types, objectAtIndex: index];
            if pasteboard_type.is_null() {
                continue;
            }

            let type_ptr: *const std::os::raw::c_char = msg_send![pasteboard_type, UTF8String];
            if type_ptr.is_null() {
                continue;
            }
            let type_name = CStr::from_ptr(type_ptr).to_string_lossy().to_string();
            if !should_snapshot_pasteboard_type(&type_name) {
                continue;
            }

            let data: *mut NSObject = msg_send![pasteboard, dataForType: pasteboard_type];
            if data.is_null() {
                continue;
            }
            let len: usize = msg_send![data, length];
            if len == 0 || total_bytes.saturating_add(len) > MAX_PASTEBOARD_SNAPSHOT_BYTES {
                continue;
            }
            let bytes: *const u8 = msg_send![data, bytes];
            if bytes.is_null() {
                continue;
            }

            let file_name = format!("{:02}.bin", entries.len());
            let file_path = dir.join(&file_name);
            let slice = std::slice::from_raw_parts(bytes, len);
            if fs::write(&file_path, slice).is_ok() {
                total_bytes += len;
                entries.push(PasteboardSnapshotEntry {
                    type_name,
                    file_name,
                });
            }
        }
    }

    if entries.is_empty() {
        let _ = fs::remove_dir_all(&dir);
        return None;
    }

    let manifest = PasteboardSnapshot { entries };
    let manifest_path = dir.join("manifest.json");
    let json = serde_json::to_vec(&manifest).ok()?;
    fs::write(&manifest_path, json).ok()?;
    Some(manifest_path.to_string_lossy().to_string())
}

#[cfg(not(target_os = "macos"))]
fn snapshot_current_pasteboard(_id: &str) -> Option<String> {
    None
}

#[cfg(target_os = "macos")]
fn restore_pasteboard_snapshot(manifest_path: &str) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, NSObject};
    use std::ffi::{CStr, CString};

    let manifest_bytes =
        fs::read(manifest_path).map_err(|e| format!("read pasteboard snapshot: {e}"))?;
    let snapshot: PasteboardSnapshot = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("parse pasteboard snapshot: {e}"))?;
    if snapshot.entries.is_empty() {
        return Err("pasteboard snapshot is empty".to_string());
    }

    let base_dir = PathBuf::from(manifest_path)
        .parent()
        .ok_or_else(|| "pasteboard snapshot has no parent directory".to_string())?
        .to_path_buf();

    unsafe {
        let pasteboard_cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSPasteboard\0").unwrap())
            .ok_or_else(|| "NSPasteboard class missing".to_string())?;
        let string_cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSString\0").unwrap())
            .ok_or_else(|| "NSString class missing".to_string())?;
        let data_cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSData\0").unwrap())
            .ok_or_else(|| "NSData class missing".to_string())?;
        let array_cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSMutableArray\0").unwrap())
            .ok_or_else(|| "NSMutableArray class missing".to_string())?;

        let pasteboard: *mut NSObject = msg_send![pasteboard_cls, generalPasteboard];
        if pasteboard.is_null() {
            return Err("general pasteboard missing".to_string());
        }

        let types: *mut NSObject = msg_send![array_cls, arrayWithCapacity: snapshot.entries.len()];
        if types.is_null() {
            return Err("failed to create pasteboard type array".to_string());
        }

        let mut type_strings = Vec::new();
        for entry in &snapshot.entries {
            let c_type = CString::new(entry.type_name.as_str())
                .map_err(|_| "pasteboard type contains NUL".to_string())?;
            let type_string: *mut NSObject =
                msg_send![string_cls, stringWithUTF8String: c_type.as_ptr()];
            if type_string.is_null() {
                continue;
            }
            let _: () = msg_send![types, addObject: type_string];
            type_strings.push((entry, type_string));
        }

        if type_strings.is_empty() {
            return Err("pasteboard snapshot has no restorable types".to_string());
        }

        let _: isize = msg_send![pasteboard, clearContents];
        let _: isize =
            msg_send![pasteboard, declareTypes: types, owner: std::ptr::null_mut::<NSObject>()];

        let mut restored = 0usize;
        for (entry, type_string) in type_strings {
            let bytes = match fs::read(base_dir.join(&entry.file_name)) {
                Ok(bytes) => bytes,
                Err(_) => continue,
            };
            if bytes.is_empty() {
                continue;
            }
            let data: *mut NSObject =
                msg_send![data_cls, dataWithBytes: bytes.as_ptr(), length: bytes.len()];
            if data.is_null() {
                continue;
            }
            let ok: bool = msg_send![pasteboard, setData: data, forType: type_string];
            if ok {
                restored += 1;
            }
        }

        if restored == 0 {
            return Err("no pasteboard snapshot data restored".to_string());
        }
    }

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn restore_pasteboard_snapshot(_manifest_path: &str) -> Result<(), String> {
    Err("pasteboard snapshots are only supported on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
fn clipboard_change_count() -> Option<i64> {
    None // format probing not available on this platform
}

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
    let base = dirs::data_dir().unwrap_or_else(|| {
        PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()))
            .join("Library/Application Support/qx")
    });
    let dir = base.join("qx");
    std::fs::create_dir_all(&dir).ok();
    dir.join("clipboard.db")
}

fn get_image_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| {
        PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()))
            .join("Library/Application Support/qx")
    });
    let dir = base.join("qx/clipboard_images");
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
    ensure_column(&conn, "image_pasteboard_path", "TEXT")?;

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

fn lock_db(db: &Arc<Mutex<Option<Connection>>>) -> MutexGuard<'_, Option<Connection>> {
    db.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn ensure_connection(guard: &mut Option<Connection>) -> rusqlite::Result<&Connection> {
    if guard.is_none() {
        *guard = Some(init_db()?);
    }
    Ok(guard.as_ref().expect("clipboard connection initialized"))
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
            let mut last_change_count: Option<i64> = None;

            // Initialize with current clipboard via Tauri plugin API
            if let Ok(text) = app_handle.clipboard().read_text() {
                if !text.is_empty() {
                    last_text = text.clone();
                    store(&db_clone, &text, None, None);
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
                        store(&db_clone, &text, None, None);
                        let _ = app_handle.emit("clipboard-updated", ());
                    }
                    Err(e) => {
                        eprintln!("clipboard read text error: {e}");
                    }
                    _ => {}
                }

                // Check for new image
                //
                // On macOS we use NSPasteboard::changeCount to skip the
                // expensive read_image() when clipboard content hasn't
                // actually changed (the common case — nothing to do).
                let should_check_image = match clipboard_change_count() {
                    Some(current) => {
                        let changed = last_change_count.map_or(true, |prev| prev != current);
                        last_change_count = Some(current);
                        changed
                    }
                    None => true, // non-macOS: always check
                };

                if should_check_image {
                    match app_handle.clipboard().read_image() {
                        Ok(image) => {
                            let width = image.width();
                            let height = image.height();

                            // --- Safety guard: reject oversized images ---
                            if width > MAX_IMAGE_DIMENSION
                                || height > MAX_IMAGE_DIMENSION
                                || (width as u64).saturating_mul(height as u64) > MAX_IMAGE_PIXELS
                            {
                                continue;
                            }

                            // Borrow the RGBA slice — no heap copy.
                            let rgba = image.rgba();

                            let hash = blake3::hash(rgba);
                            let hash_hex = hash.to_hex()[..16].to_string();

                            if !rgba.is_empty() && hash_hex != last_image_hash {
                                last_image_hash = hash_hex.clone();

                                let filename = format!("{}.png", hash_hex);
                                let image_dir = get_image_dir();
                                let image_path = image_dir.join(&filename);

                                // Encode directly from the borrowed slice —
                                // avoids the intermediate RgbaImage
                                // allocation and the .to_vec() copy.
                                if let Ok(file) = std::fs::File::create(&image_path) {
                                    let encoder = PngEncoder::new(file);
                                    if encoder
                                        .write_image(rgba, width, height, ExtendedColorType::Rgba8)
                                        .is_ok()
                                    {
                                        let path_str = image_path.to_string_lossy().to_string();
                                        let pasteboard_path =
                                            snapshot_current_pasteboard(&hash_hex);
                                        store(
                                            &db_clone,
                                            "",
                                            Some(&path_str),
                                            pasteboard_path.as_deref(),
                                        );
                                        let _ = app_handle.emit("clipboard-updated", ());
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("clipboard read_image: {e}");
                        }
                    }
                }
            }
        })
        .ok();
}

fn store(
    db: &Arc<Mutex<Option<Connection>>>,
    text: &str,
    image_path: Option<&str>,
    image_pasteboard_path: Option<&str>,
) {
    let mut guard = lock_db(db);
    let Ok(conn) = ensure_connection(&mut guard) else {
        return;
    };
    let id = if !text.is_empty() {
        compute_id(text)
    } else if let Some(path) = image_path {
        compute_id(path)
    } else {
        return; // nothing to store
    };
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let _ = conn.execute(
        "INSERT INTO clipboard_history (id, text, timestamp, image_path, image_pasteboard_path)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET
            text = excluded.text,
            timestamp = excluded.timestamp,
            image_path = COALESCE(excluded.image_path, clipboard_history.image_path),
            image_pasteboard_path = COALESCE(excluded.image_pasteboard_path, clipboard_history.image_pasteboard_path)",
        params![id, text, ts, image_path, image_pasteboard_path],
    );
}

#[command]
pub fn get_clipboard_history(
    state: tauri::State<'_, ClipboardDb>,
    limit: Option<u32>,
) -> Result<Vec<ClipboardEntry>, String> {
    let limit = limit.unwrap_or(50);
    let mut results = Vec::new();
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, text, timestamp, pinned, copy_count, image_path
             FROM clipboard_history
             ORDER BY pinned DESC, timestamp DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("{e}"))?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(ClipboardEntry {
                id: row.get(0)?,
                text: row.get(1)?,
                timestamp: row.get(2)?,
                pinned: row.get::<_, i64>(3)? != 0,
                copy_count: row.get(4)?,
                image_path: row.get(5)?,
            })
        })
        .map_err(|e| format!("{e}"))?;
    for row in rows {
        results.push(row.map_err(|e| format!("{e}"))?);
    }
    Ok(results)
}

#[command]
pub fn read_clipboard_image_now(
    app: tauri::AppHandle,
    db: tauri::State<'_, ClipboardDb>,
) -> Result<Option<String>, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    match app.clipboard().read_image() {
        Ok(image) => {
            let width = image.width();
            let height = image.height();
            if width > MAX_IMAGE_DIMENSION
                || height > MAX_IMAGE_DIMENSION
                || (width as u64).saturating_mul(height as u64) > MAX_IMAGE_PIXELS
            {
                return Ok(None);
            }
            let rgba = image.rgba();
            let hash = blake3::hash(rgba);
            let hash_hex = hash.to_hex()[..16].to_string();
            if rgba.is_empty() {
                return Ok(None);
            }
            let filename = format!("{}.png", hash_hex);
            let image_dir = get_image_dir();
            let image_path = image_dir.join(&filename);
            if !image_path.exists() {
                if let Ok(file) = std::fs::File::create(&image_path) {
                    use image::codecs::png::PngEncoder;
                    use image::ExtendedColorType;
                    use image::ImageEncoder;
                    let encoder = PngEncoder::new(file);
                    if encoder
                        .write_image(rgba, width, height, ExtendedColorType::Rgba8)
                        .is_err()
                    {
                        let _ = std::fs::remove_file(&image_path);
                        return Ok(None);
                    }
                }
            }
            let path_str = image_path.to_string_lossy().to_string();
            let pasteboard_path = snapshot_current_pasteboard(&hash_hex);
            let mut guard = lock_db(&db.0);
            let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let _ = conn.execute(
                "INSERT INTO clipboard_history (id, text, timestamp, image_path, image_pasteboard_path)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    timestamp = excluded.timestamp,
                    image_path = COALESCE(excluded.image_path, clipboard_history.image_path),
                    image_pasteboard_path = COALESCE(excluded.image_pasteboard_path, clipboard_history.image_pasteboard_path)",
                rusqlite::params![hash_hex, "", ts, path_str, pasteboard_path],
            );
            let _ = app.emit("clipboard-updated", ());
            Ok(Some(path_str))
        }
        Err(e) => {
            eprintln!("clipboard read_clipboard_image_now: {e}");
            Ok(None)
        }
    }
}

#[command]
pub fn write_clipboard_image_entry(
    app: tauri::AppHandle,
    db: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<(), String> {
    let (image_path, image_pasteboard_path): (String, Option<String>) = {
        let mut guard = lock_db(&db.0);
        let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
        conn.query_row(
            "SELECT image_path, image_pasteboard_path
             FROM clipboard_history
             WHERE id = ?1 AND image_path IS NOT NULL",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("clipboard image entry not found: {e}"))?
    };

    if let Some(manifest_path) = image_pasteboard_path {
        if restore_pasteboard_snapshot(&manifest_path).is_ok() {
            return Ok(());
        }
    }

    let decoded = image::open(&image_path)
        .map_err(|e| format!("decode clipboard image: {e}"))?
        .to_rgba8();
    let (width, height) = decoded.dimensions();
    if width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || (width as u64).saturating_mul(height as u64) > MAX_IMAGE_PIXELS
    {
        return Err("clipboard image is too large".to_string());
    }

    let image = TauriImage::new_owned(decoded.into_raw(), width, height);
    app.clipboard()
        .write_image(&image)
        .map_err(|e| format!("write clipboard image: {e}"))?;
    Ok(())
}

#[command]
pub fn clear_clipboard_history(state: tauri::State<'_, ClipboardDb>) -> Result<(), String> {
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    conn.execute("DELETE FROM clipboard_history", [])
        .map_err(|e| format!("{e}"))?;
    Ok(())
}

#[command]
pub fn delete_clipboard_entry(
    state: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<(), String> {
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    conn.execute("DELETE FROM clipboard_history WHERE id = ?1", params![id])
        .map_err(|e| format!("{e}"))?;
    Ok(())
}

#[command]
pub fn toggle_clipboard_pin(
    state: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<(), String> {
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    conn.execute(
        "UPDATE clipboard_history
         SET pinned = CASE pinned WHEN 1 THEN 0 ELSE 1 END
         WHERE id = ?1",
        params![id],
    )
    .map_err(|e| format!("{e}"))?;
    Ok(())
}

#[command]
pub fn record_clipboard_copy(
    state: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<(), String> {
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "UPDATE clipboard_history
         SET copy_count = copy_count + 1,
             timestamp = ?2
         WHERE id = ?1",
        params![id, ts],
    )
    .map_err(|e| format!("{e}"))?;
    Ok(())
}
