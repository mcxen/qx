use arboard::{Clipboard, ImageData};
use chrono::Local;
use dirs;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::ExtendedColorType;
use image::ImageEncoder;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{command, AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

mod capture;
pub(crate) mod editing;
mod file_list;
pub(crate) mod history;
pub(crate) mod media;
mod native;
#[cfg(test)]
mod tests;

use capture::CaptureCursor;
use file_list::{
    decode as decode_stored_file_paths, identity_seed, normalize as normalize_file_paths,
};
use native::{change_count as clipboard_change_count, is_file_reference_type};

// --- Image safety limits ---
/// Maximum allowed image dimension in pixels (width or height).
/// A 4096×4096 RGBA image is ~64 MB — safely reject anything larger.
const MAX_IMAGE_DIMENSION: u32 = 4096;
/// Maximum total pixel count (width × height).
const MAX_IMAGE_PIXELS: u64 = 16_777_216; // 4096 × 4096
const MAX_STORED_IMAGE_BYTES: u64 = 12 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 512 * 1024;
const MAX_PASTEBOARD_SNAPSHOT_BYTES: usize = 512 * 1024;
const CLIPBOARD_RETENTION_DAYS: i64 = 90;
const CLIPBOARD_UNPINNED_LIMIT: i64 = 300;

#[derive(Debug, Serialize, Deserialize)]
struct PasteboardSnapshot {
    entries: Vec<PasteboardSnapshotEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PasteboardSnapshotEntry {
    type_name: String,
    file_name: String,
}

#[cfg(target_os = "macos")]
fn should_snapshot_pasteboard_type(type_name: &str) -> bool {
    is_file_reference_type(type_name)
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

fn pasteboard_snapshot_has_file_reference(manifest_path: &str) -> bool {
    let Ok(manifest_bytes) = fs::read(manifest_path) else {
        return false;
    };
    let Ok(snapshot) = serde_json::from_slice::<PasteboardSnapshot>(&manifest_bytes) else {
        return false;
    };

    snapshot.entries.iter().any(|entry| {
        let lower = entry.type_name.to_ascii_lowercase();
        lower.contains("file-url") || lower.contains("filename")
    })
}

fn write_rgba_image_to_clipboard(rgba: Vec<u8>, width: u32, height: u32) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| format!("open clipboard: {e}"))?;
    clipboard
        .set_image(ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(rgba),
        })
        .map_err(|e| format!("write clipboard image: {e}"))
}

pub(crate) fn write_image_file_to_clipboard(
    app: &tauri::AppHandle,
    path: &std::path::Path,
) -> Result<(), String> {
    let decoded = image::open(path)
        .map_err(|error| format!("decode clipboard image: {error}"))?
        .to_rgba8();
    let (width, height) = decoded.dimensions();
    if width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || (width as u64).saturating_mul(height as u64) > MAX_IMAGE_PIXELS
    {
        return Err("clipboard image is too large".to_string());
    }
    let rgba = decoded.into_raw();
    if let Err(arboard_error) = write_rgba_image_to_clipboard(rgba.clone(), width, height) {
        let image = tauri::image::Image::new_owned(rgba, width, height);
        use tauri_plugin_clipboard_manager::ClipboardExt;
        app.clipboard().write_image(&image).map_err(|tauri_error| {
            format!("write clipboard image: {arboard_error}; tauri fallback: {tauri_error}")
        })?;
    }
    Ok(())
}

/// Public IPC: copy a PNG/JPEG (or other image crate format) file onto the system clipboard.
/// Used by capture toast, plugins, and any feature that must re-publish a disk image.
#[command]
pub fn clipboard_write_image_file(app: AppHandle, path: String) -> Result<(), String> {
    write_image_file_to_clipboard(&app, Path::new(&path))
}

#[derive(Debug, Serialize, Clone)]
pub struct ClipboardEntry {
    pub id: String,
    pub text: String,
    pub timestamp: String,
    pub pinned: bool,
    pub copy_count: i64,
    pub image_path: Option<String>,
    pub file_path: Option<String>,
    /// Ordered native file-list payload. `file_path` remains the primary item
    /// for compatibility, preview and old databases.
    pub file_paths: Vec<String>,
    pub file_kind: Option<String>,
    /// Cached OCR text for images (searchable). Empty / null means not recognized yet.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ocr_text: Option<String>,
}

pub struct ClipboardDb(pub Arc<Mutex<Option<Connection>>>);

pub struct ClipboardShutdown(pub Arc<AtomicBool>);

fn get_db_path() -> PathBuf {
    let dir = crate::paths::data_dir();
    std::fs::create_dir_all(&dir).ok();
    dir.join("clipboard.db")
}

fn get_image_dir() -> PathBuf {
    let dir = crate::paths::data_dir().join("clipboard_images");
    std::fs::create_dir_all(&dir).ok();
    dir
}

fn is_clipboard_artifact_path(path: &Path) -> bool {
    path.starts_with(get_image_dir())
}

fn remove_clipboard_artifact(path: &str) {
    let path = PathBuf::from(path);
    if !is_clipboard_artifact_path(&path) {
        return;
    }
    if path.is_dir() {
        let _ = fs::remove_dir_all(&path);
    } else {
        let _ = fs::remove_file(&path);
    }
}

fn is_artifact_referenced(conn: &Connection, path: &str) -> bool {
    conn.query_row(
        "SELECT COUNT(*)
         FROM clipboard_history
         WHERE image_path = ?1 OR image_pasteboard_path = ?1",
        params![path],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
    .unwrap_or(true)
}

fn remove_unreferenced_artifacts(conn: &Connection, paths: impl IntoIterator<Item = String>) {
    let mut seen = HashSet::new();
    for path in paths {
        if path.is_empty() || !seen.insert(path.clone()) {
            continue;
        }
        if !is_artifact_referenced(conn, &path) {
            remove_clipboard_artifact(&path);
        }
    }
}

fn collect_artifact_paths(conn: &Connection, sql: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let Ok(mut stmt) = conn.prepare(sql) else {
        return paths;
    };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,
            row.get::<_, Option<String>>(1)?,
        ))
    }) else {
        return paths;
    };
    for row in rows.flatten() {
        if let Some(path) = row.0 {
            paths.push(path);
        }
        if let Some(path) = row.1 {
            paths.push(path);
        }
    }
    paths
}

fn cleanup_orphan_clipboard_artifacts(conn: &Connection) {
    let image_dir = get_image_dir();
    let mut referenced = HashSet::new();
    if let Ok(mut stmt) =
        conn.prepare("SELECT image_path, image_pasteboard_path FROM clipboard_history")
    {
        if let Ok(rows) = stmt.query_map([], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        }) {
            for row in rows.flatten() {
                if let Some(path) = row.0 {
                    referenced.insert(path);
                }
                if let Some(path) = row.1 {
                    referenced.insert(path);
                }
            }
        }
    }

    let Ok(entries) = fs::read_dir(&image_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();
        if !referenced.contains(&path_str) {
            remove_clipboard_artifact(&path_str);
        }
    }
}

fn compact_pasteboard_snapshot(manifest_path: &str) -> Option<String> {
    let manifest_path = PathBuf::from(manifest_path);
    if !is_clipboard_artifact_path(&manifest_path) {
        return None;
    }

    let manifest_bytes = fs::read(&manifest_path).ok()?;
    let mut snapshot = serde_json::from_slice::<PasteboardSnapshot>(&manifest_bytes).ok()?;
    let base_dir = manifest_path.parent()?.to_path_buf();
    let mut kept = Vec::new();
    let mut total_bytes = 0usize;

    for entry in std::mem::take(&mut snapshot.entries) {
        let file_path = base_dir.join(&entry.file_name);
        if !is_file_reference_type(&entry.type_name) {
            let _ = fs::remove_file(file_path);
            continue;
        }

        let len = fs::metadata(&file_path)
            .map(|m| m.len() as usize)
            .unwrap_or(0);
        if len == 0 || total_bytes.saturating_add(len) > MAX_PASTEBOARD_SNAPSHOT_BYTES {
            let _ = fs::remove_file(file_path);
            continue;
        }

        total_bytes += len;
        kept.push(entry);
    }

    if kept.is_empty() {
        let _ = fs::remove_dir_all(&base_dir);
        return None;
    }

    snapshot.entries = kept;
    let json = serde_json::to_vec(&snapshot).ok()?;
    fs::write(&manifest_path, json).ok()?;
    Some(manifest_path.to_string_lossy().to_string())
}

fn compact_existing_pasteboard_snapshots(conn: &Connection) {
    let mut rows = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, image_pasteboard_path
         FROM clipboard_history
         WHERE image_pasteboard_path IS NOT NULL",
    ) {
        if let Ok(mapped) = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) {
            for row in mapped.flatten() {
                rows.push(row);
            }
        }
    }

    for (id, manifest_path) in rows {
        if compact_pasteboard_snapshot(&manifest_path).is_none() {
            let _ = conn.execute(
                "UPDATE clipboard_history
                 SET image_pasteboard_path = NULL
                 WHERE id = ?1 AND image_pasteboard_path = ?2",
                params![id, manifest_path],
            );
        }
    }
}

fn enforce_existing_image_limits(conn: &Connection) {
    let mut rows = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT id, image_path, image_pasteboard_path
         FROM clipboard_history
         WHERE pinned = 0 AND image_path IS NOT NULL",
    ) {
        if let Ok(mapped) = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        }) {
            for row in mapped.flatten() {
                rows.push(row);
            }
        }
    }

    let mut paths = Vec::new();
    for (id, image_path, pasteboard_path) in rows {
        let image = PathBuf::from(&image_path);
        let bytes = fs::metadata(&image).map(|m| m.len()).unwrap_or(0);
        if bytes > 0 && bytes <= MAX_STORED_IMAGE_BYTES {
            continue;
        }

        let _ = conn.execute("DELETE FROM clipboard_history WHERE id = ?1", params![id]);
        paths.push(image_path);
        if let Some(path) = pasteboard_path {
            paths.push(path);
        }
    }
    remove_unreferenced_artifacts(conn, paths);
}

fn prune_clipboard_storage(conn: &Connection) {
    let cutoff = (Local::now() - chrono::Duration::days(CLIPBOARD_RETENTION_DAYS))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let mut paths = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT image_path, image_pasteboard_path
         FROM clipboard_history
         WHERE pinned = 0
           AND (
             timestamp < ?1
             OR id NOT IN (
               SELECT id
               FROM clipboard_history
               WHERE pinned = 0 AND timestamp >= ?1
               ORDER BY timestamp DESC
               LIMIT ?2
             )
           )",
    ) {
        if let Ok(rows) = stmt.query_map(params![cutoff, CLIPBOARD_UNPINNED_LIMIT], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        }) {
            for row in rows.flatten() {
                if let Some(path) = row.0 {
                    paths.push(path);
                }
                if let Some(path) = row.1 {
                    paths.push(path);
                }
            }
        }
    }

    let _ = conn.execute(
        "DELETE FROM clipboard_history
         WHERE pinned = 0
           AND (
             timestamp < ?1
             OR id NOT IN (
               SELECT id
               FROM clipboard_history
               WHERE pinned = 0 AND timestamp >= ?1
               ORDER BY timestamp DESC
               LIMIT ?2
             )
           )",
        params![cutoff, CLIPBOARD_UNPINNED_LIMIT],
    );
    remove_unreferenced_artifacts(conn, paths);
}

fn ensure_clipboard_png_file(
    image_path: &Path,
    rgba: &[u8],
    width: u32,
    height: u32,
) -> Result<(), String> {
    if image_path.exists() {
        if let Ok(metadata) = fs::metadata(image_path) {
            if metadata.len() > 0 && metadata.len() <= MAX_STORED_IMAGE_BYTES {
                return Ok(());
            }
        }
        let _ = fs::remove_file(image_path);
    }

    let file = fs::File::create(image_path).map_err(|e| format!("create clipboard image: {e}"))?;
    let encoder = PngEncoder::new_with_quality(file, CompressionType::Best, FilterType::Adaptive);
    if let Err(e) = encoder.write_image(rgba, width, height, ExtendedColorType::Rgba8) {
        let _ = fs::remove_file(image_path);
        return Err(format!("encode clipboard image: {e}"));
    }

    let bytes = fs::metadata(image_path).map(|m| m.len()).unwrap_or(0);
    if bytes == 0 || bytes > MAX_STORED_IMAGE_BYTES {
        let _ = fs::remove_file(image_path);
        return Err("clipboard image exceeds storage limit".to_string());
    }
    Ok(())
}

fn init_db() -> rusqlite::Result<Connection> {
    let path = get_db_path();
    let conn = Connection::open(&path)?;
    ensure_clipboard_schema(&conn)?;

    enforce_existing_image_limits(&conn);
    compact_existing_pasteboard_snapshots(&conn);
    prune_clipboard_storage(&conn);
    cleanup_orphan_clipboard_artifacts(&conn);
    Ok(conn)
}

fn ensure_clipboard_schema(conn: &Connection) -> rusqlite::Result<()> {
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
    ensure_column(&conn, "file_path", "TEXT")?;
    ensure_column(&conn, "file_paths", "TEXT")?;
    ensure_column(&conn, "file_kind", "TEXT")?;
    ensure_column(&conn, "ocr_text", "TEXT")?;
    Ok(())
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

fn compute_image_id(image_path: &str) -> String {
    PathBuf::from(image_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| compute_id(image_path))
}

fn compute_file_list_id(paths: &[String]) -> Option<String> {
    identity_seed(paths).map(|seed| compute_id(&seed))
}

fn clipboard_file_kind(path: &Path) -> &'static str {
    if path.is_dir() {
        return "folder";
    }
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "heic" => "image",
        "mp4" | "mov" | "m4v" | "avi" | "mkv" | "webm" | "mpeg" | "mpg" => "video",
        "mp3" | "m4a" | "wav" | "aac" | "flac" | "ogg" => "audio",
        "pdf" => "pdf",
        _ => "file",
    }
}

/// Lookup a clipboard history image/file path by id for system OCR and friends.
pub(crate) fn image_path_for_entry(db: &ClipboardDb, id: &str) -> Result<Option<String>, String> {
    let mut guard = lock_db(&db.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    conn.query_row(
        "SELECT image_path, file_path, file_paths, file_kind FROM clipboard_history WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            let image_path: Option<String> = row.get(0)?;
            let file_path: Option<String> = row.get(1)?;
            let file_paths_json: Option<String> = row.get(2)?;
            let file_kind: Option<String> = row.get(3)?;
            Ok((image_path, file_path, file_paths_json, file_kind))
        },
    )
    .optional()
    .map_err(|e| format!("clipboard lookup: {e}"))
    .map(|row| {
        let Some((image_path, file_path, file_paths_json, file_kind)) = row else {
            return None;
        };
        if let Some(path) = image_path.filter(|p| !p.is_empty()) {
            return Some(path);
        }
        let paths = decode_stored_file_paths(file_paths_json.as_deref(), file_path.as_deref());
        for path in &paths {
            if is_image_extension(path) {
                return Some(path.clone());
            }
        }
        let path = file_path.filter(|p| !p.is_empty())?;
        let kind = file_kind.unwrap_or_default();
        if kind == "image" || is_image_extension(&path) {
            Some(path)
        } else {
            None
        }
    })
}

/// Persist OCR text on a clipboard row so launcher/module search can find images by content.
pub(crate) fn set_entry_ocr_text(db: &ClipboardDb, id: &str, ocr_text: &str) -> Result<(), String> {
    let mut guard = lock_db(&db.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    let changed = conn
        .execute(
            "UPDATE clipboard_history SET ocr_text = ?1 WHERE id = ?2",
            rusqlite::params![ocr_text, id],
        )
        .map_err(|e| format!("store clipboard ocr_text: {e}"))?;
    if changed == 0 {
        return Err("clipboard entry not found".to_string());
    }
    Ok(())
}

/// Image clipboard rows that still need OCR (for batch / background fill).
pub(crate) fn list_entries_needing_ocr(
    db: &ClipboardDb,
    limit: u32,
) -> Result<Vec<(String, String)>, String> {
    let mut guard = lock_db(&db.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, image_path, file_path, file_paths, file_kind, ocr_text
             FROM clipboard_history
             ORDER BY pinned DESC, timestamp DESC
             LIMIT 400",
        )
        .map_err(|e| format!("list ocr candidates: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|e| format!("list ocr candidates rows: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, image_path, file_path, file_paths_json, file_kind, ocr_text) =
            row.map_err(|e| format!("ocr candidate: {e}"))?;
        if ocr_text.as_ref().is_some_and(|t| !t.trim().is_empty()) {
            continue;
        }
        if let Some(path) = image_path.filter(|p| !p.is_empty()) {
            out.push((id, path));
        } else {
            let paths = decode_stored_file_paths(file_paths_json.as_deref(), file_path.as_deref());
            let path = paths
                .into_iter()
                .find(|p| is_image_extension(p))
                .or_else(|| {
                    let path = file_path.filter(|p| !p.is_empty())?;
                    let kind = file_kind.unwrap_or_default();
                    if kind == "image" || is_image_extension(&path) {
                        Some(path)
                    } else {
                        None
                    }
                });
            if let Some(path) = path {
                out.push((id, path));
            }
        }
        if out.len() as u32 >= limit {
            break;
        }
    }
    Ok(out)
}

fn is_image_extension(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".webp")
        || lower.ends_with(".gif")
        || lower.ends_with(".bmp")
        || lower.ends_with(".heic")
        || lower.ends_with(".tif")
        || lower.ends_with(".tiff")
}

/// After an image lands in history, optionally OCR it in the background when enabled.
pub(crate) fn queue_auto_ocr_for_entry(app: &AppHandle, entry_id: String, image_path: String) {
    if image_path.trim().is_empty() {
        return;
    }
    let settings = crate::settings::read_settings();
    if !settings.advanced.ocr_enabled {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = crate::runtime::blocking(move || {
            crate::ocr::recognize_image_path(std::path::Path::new(&image_path), "clipboard")
        })
        .await;
        match result {
            Ok(Ok(ocr)) => {
                if let Some(db) = app.try_state::<ClipboardDb>() {
                    let _ = set_entry_ocr_text(&db, &entry_id, &ocr.text);
                    let _ = app.emit("clipboard-updated", ());
                }
            }
            Ok(Err(error)) => {
                crate::diagnostics::log(
                    crate::diagnostics::LogLevel::Debug,
                    "clipboard.ocr",
                    "auto OCR skipped/failed",
                    serde_json::json!({ "id": entry_id, "error": error }),
                );
            }
            Err(error) => {
                crate::diagnostics::log(
                    crate::diagnostics::LogLevel::Debug,
                    "clipboard.ocr",
                    "auto OCR worker failed",
                    serde_json::json!({ "id": entry_id, "error": error.to_string() }),
                );
            }
        }
    });
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

fn backfill_clipboard_file_kinds(db: &Arc<Mutex<Option<Connection>>>) {
    let candidates: Vec<(String, String)> = {
        let mut guard = lock_db(db);
        let Ok(conn) = ensure_connection(&mut guard) else {
            return;
        };
        let Ok(mut stmt) = conn.prepare(
            "SELECT id, file_path FROM clipboard_history
             WHERE file_path IS NOT NULL AND file_kind IS NULL
             ORDER BY timestamp DESC LIMIT 300",
        ) else {
            return;
        };
        let Ok(rows) = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?))) else {
            return;
        };
        rows.flatten().collect()
    };
    if candidates.is_empty() {
        return;
    }

    // Filesystem metadata is resolved without holding the database lock.
    let resolved: Vec<_> = candidates
        .into_iter()
        .map(|(id, path)| {
            let kind = clipboard_file_kind(Path::new(&path));
            (id, kind)
        })
        .collect();

    let mut guard = lock_db(db);
    let Ok(conn) = ensure_connection(&mut guard) else {
        return;
    };
    for (id, kind) in resolved {
        let _ = conn.execute(
            "UPDATE clipboard_history SET file_kind = ?1 WHERE id = ?2 AND file_kind IS NULL",
            params![kind, id],
        );
    }
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
            backfill_clipboard_file_kinds(&db_clone);
            let _ = app_handle.emit("clipboard-updated", ());
            let mut last_text = String::new();
            let mut last_image_hash = String::new();
            let mut capture_cursor = CaptureCursor::default();
            let mut last_native_error_change: Option<i64> = None;

            loop {
                if shutdown_clone.load(Ordering::Relaxed) {
                    break;
                }
                let current_change = clipboard_change_count();
                if !capture_cursor.should_attempt(current_change) {
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    continue;
                }

                // CF_HDROP / file URLs win over text and bitmap previews. A
                // transient OpenClipboard failure must not consume the sequence:
                // Explorer and RDP commonly keep the clipboard locked briefly.
                let file_paths = match native::read_file_paths() {
                    Ok(paths) => paths,
                    Err(error) => {
                        if current_change != last_native_error_change {
                            last_native_error_change = current_change;
                            crate::diagnostics::log(
                                crate::diagnostics::LogLevel::Warn,
                                "clipboard.capture",
                                "native file clipboard read will be retried",
                                serde_json::json!({
                                    "sequence": current_change,
                                    "error": error,
                                }),
                            );
                        }
                        std::thread::sleep(std::time::Duration::from_millis(250));
                        continue;
                    }
                };

                if !file_paths.is_empty() {
                    let snapshot_id = compute_file_list_id(&file_paths)
                        .unwrap_or_else(|| compute_id(&file_paths.join("\0")));
                    let pasteboard_path = snapshot_current_pasteboard(&snapshot_id);
                    match store_file_list(
                        &db_clone,
                        "",
                        None,
                        pasteboard_path.as_deref(),
                        Some(&file_paths),
                    ) {
                        Ok(entry_id) => {
                            last_text.clear();
                            last_image_hash.clear();
                            capture_cursor.commit(current_change);
                            last_native_error_change = None;
                            if let Some(image) = file_paths.iter().find(|p| is_image_extension(p)) {
                                queue_auto_ocr_for_entry(
                                    &app_handle,
                                    entry_id,
                                    image.clone(),
                                );
                            }
                            let _ = app_handle.emit("clipboard-updated", ());
                        }
                        Err(error) => {
                            if current_change != last_native_error_change {
                                last_native_error_change = current_change;
                                crate::diagnostics::log(
                                    crate::diagnostics::LogLevel::Error,
                                    "clipboard.capture",
                                    "failed to store native file clipboard entry; capture will retry",
                                    serde_json::json!({
                                        "sequence": current_change,
                                        "error": error,
                                    }),
                                );
                            }
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    continue;
                }

                let mut readable_format = false;
                let mut stored_entry = false;
                let mut storage_error = None;

                // Text and bitmap formats may coexist. Capture both while the
                // same sequence is open, but never turn a native file list into
                // path-shaped text.
                if let Ok(text) = app_handle.clipboard().read_text() {
                    readable_format = true;
                    if !text.is_empty() && (current_change.is_some() || text != last_text) {
                        match store(&db_clone, &text, None, None, None) {
                            Ok(_) => stored_entry = true,
                            Err(error) => storage_error = Some(error),
                        }
                    }
                    last_text = text;
                }

                if let Ok(image) = app_handle.clipboard().read_image() {
                    readable_format = true;
                    let width = image.width();
                    let height = image.height();
                    if width <= MAX_IMAGE_DIMENSION
                        && height <= MAX_IMAGE_DIMENSION
                        && (width as u64).saturating_mul(height as u64) <= MAX_IMAGE_PIXELS
                    {
                        let rgba = image.rgba();
                        let hash_hex = blake3::hash(rgba).to_hex()[..16].to_string();
                        if !rgba.is_empty()
                            && (current_change.is_some() || hash_hex != last_image_hash)
                        {
                            let image_path = get_image_dir().join(format!("{hash_hex}.png"));
                            if ensure_clipboard_png_file(&image_path, rgba, width, height).is_ok() {
                                let path_str = image_path.to_string_lossy().to_string();
                                let pasteboard_path = snapshot_current_pasteboard(&hash_hex);
                                match store(
                                    &db_clone,
                                    "",
                                    Some(&path_str),
                                    pasteboard_path.as_deref(),
                                    None,
                                ) {
                                    Ok(entry_id) => {
                                        stored_entry = true;
                                        queue_auto_ocr_for_entry(
                                            &app_handle,
                                            entry_id,
                                            path_str.clone(),
                                        );
                                    }
                                    Err(error) => storage_error = Some(error),
                                }
                            }
                        }
                        last_image_hash = hash_hex;
                    }
                }

                if let Some(error) = storage_error {
                    if current_change != last_native_error_change {
                        last_native_error_change = current_change;
                        crate::diagnostics::log(
                            crate::diagnostics::LogLevel::Error,
                            "clipboard.capture",
                            "failed to store clipboard entry; capture will retry",
                            serde_json::json!({
                                "sequence": current_change,
                                "error": error,
                            }),
                        );
                    }
                // Commit the sequence only after at least one format was read
                // and every storable payload was persisted. If another process
                // owned the clipboard or SQLite failed, retry the same sequence.
                } else if readable_format {
                    capture_cursor.commit(current_change);
                    last_native_error_change = None;
                }
                if stored_entry {
                    let _ = app_handle.emit("clipboard-updated", ());
                }
                std::thread::sleep(std::time::Duration::from_millis(250));
            }
        })
        .ok();
}

fn store(
    db: &Arc<Mutex<Option<Connection>>>,
    text: &str,
    image_path: Option<&str>,
    image_pasteboard_path: Option<&str>,
    file_path: Option<&str>,
) -> Result<String, String> {
    let file_paths = file_path.map(|path| vec![path.to_string()]);
    store_file_list(
        db,
        text,
        image_path,
        image_pasteboard_path,
        file_paths.as_deref(),
    )
}

fn store_file_list(
    db: &Arc<Mutex<Option<Connection>>>,
    text: &str,
    image_path: Option<&str>,
    image_pasteboard_path: Option<&str>,
    file_paths: Option<&[String]>,
) -> Result<String, String> {
    if !text.is_empty() && text.as_bytes().len() > MAX_TEXT_BYTES {
        return Err("clipboard text exceeds storage limit".to_string());
    }

    let file_paths = normalize_file_paths(file_paths.unwrap_or_default().iter().cloned());
    let file_path = file_paths.first().map(String::as_str);
    let file_paths_json = (!file_paths.is_empty())
        .then(|| serde_json::to_string(&file_paths).ok())
        .flatten();

    let mut guard = lock_db(db);
    let conn = ensure_connection(&mut guard).map_err(|error| error.to_string())?;
    let id = if !file_paths.is_empty() {
        let Some(id) = compute_file_list_id(&file_paths) else {
            return Err("clipboard file list is empty".to_string());
        };
        id
    } else if !text.is_empty() {
        compute_id(text)
    } else if let Some(path) = image_path {
        compute_image_id(path)
    } else {
        return Err("clipboard entry has no supported content".to_string());
    };
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let file_kind = file_path.map(|path| clipboard_file_kind(Path::new(path)));
    conn.execute(
        "INSERT INTO clipboard_history (id, text, timestamp, image_path, image_pasteboard_path, file_path, file_paths, file_kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET
            text = excluded.text,
            timestamp = excluded.timestamp,
            image_path = COALESCE(excluded.image_path, clipboard_history.image_path),
            image_pasteboard_path = COALESCE(excluded.image_pasteboard_path, clipboard_history.image_pasteboard_path),
            file_path = COALESCE(excluded.file_path, clipboard_history.file_path),
            file_paths = COALESCE(excluded.file_paths, clipboard_history.file_paths),
            file_kind = COALESCE(excluded.file_kind, clipboard_history.file_kind)",
        params![
            id,
            text,
            ts,
            image_path,
            image_pasteboard_path,
            file_path,
            file_paths_json,
            file_kind
        ],
    )
    .map_err(|error| format!("store clipboard entry: {error}"))?;
    prune_clipboard_storage(conn);
    Ok(id)
}
