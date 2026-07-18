use arboard::{Clipboard, ImageData};
use chrono::Local;
use dirs;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::ExtendedColorType;
use image::ImageEncoder;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{command, AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

pub(crate) mod editing;
pub(crate) mod history;
pub(crate) mod media;

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

fn is_file_reference_pasteboard_type(type_name: &str) -> bool {
    let lower = type_name.to_ascii_lowercase();
    lower.contains("file-url") || lower.contains("filename")
}

fn decode_file_reference_path(value: &str) -> Option<PathBuf> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let raw = value
        .strip_prefix("file://localhost")
        .or_else(|| value.strip_prefix("file://"))
        .unwrap_or(value);
    let decoded = urlencoding::decode(raw).ok()?.into_owned();
    Some(PathBuf::from(decoded))
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
fn current_pasteboard_file_path() -> Option<String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, NSObject};
    use std::ffi::{CStr, CString};

    unsafe fn string_value(value: *mut NSObject) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let ptr: *const std::os::raw::c_char = unsafe { msg_send![value, UTF8String] };
        if ptr.is_null() {
            return None;
        }
        Some(
            unsafe { CStr::from_ptr(ptr) }
                .to_string_lossy()
                .into_owned(),
        )
    }

    fn existing_file_path(value: &str) -> Option<String> {
        let path = decode_file_reference_path(value)?;
        path.exists().then(|| path.to_string_lossy().to_string())
    }

    unsafe {
        let pasteboard_cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSPasteboard\0").ok()?)?;
        let string_cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSString\0").ok()?)?;
        let pasteboard: *mut NSObject = msg_send![pasteboard_cls, generalPasteboard];
        if pasteboard.is_null() {
            return None;
        }

        // Fast path used by Finder and most native apps.
        let type_name = CString::new("public.file-url").ok()?;
        let pasteboard_type: *mut NSObject =
            msg_send![string_cls, stringWithUTF8String: type_name.as_ptr()];
        let value: *mut NSObject = msg_send![pasteboard, stringForType: pasteboard_type];
        if let Some(path) = string_value(value).and_then(|value| existing_file_path(&value)) {
            return Some(path);
        }

        // Some capture tools put the file URL on an individual pasteboard item
        // while also publishing a bitmap preview. Prefer the file reference so
        // an MP4 is not accidentally persisted as an image.
        let items: *mut NSObject = msg_send![pasteboard, pasteboardItems];
        if !items.is_null() {
            let item_count: usize = msg_send![items, count];
            for item_index in 0..item_count {
                let item: *mut NSObject = msg_send![items, objectAtIndex: item_index];
                if item.is_null() {
                    continue;
                }
                let types: *mut NSObject = msg_send![item, types];
                if types.is_null() {
                    continue;
                }
                let type_count: usize = msg_send![types, count];
                for type_index in 0..type_count {
                    let item_type: *mut NSObject = msg_send![types, objectAtIndex: type_index];
                    let Some(item_type_name) = string_value(item_type) else {
                        continue;
                    };
                    if !is_file_reference_pasteboard_type(&item_type_name) {
                        continue;
                    }
                    let item_value: *mut NSObject = msg_send![item, stringForType: item_type];
                    if let Some(path) =
                        string_value(item_value).and_then(|value| existing_file_path(&value))
                    {
                        return Some(path);
                    }
                }
            }
        }

        // Legacy Cocoa clients still expose NSFilenamesPboardType as an array.
        let legacy_name = CString::new("NSFilenamesPboardType").ok()?;
        let legacy_type: *mut NSObject =
            msg_send![string_cls, stringWithUTF8String: legacy_name.as_ptr()];
        let file_names: *mut NSObject = msg_send![pasteboard, propertyListForType: legacy_type];
        if !file_names.is_null() {
            let count: usize = msg_send![file_names, count];
            if count > 0 {
                let first: *mut NSObject = msg_send![file_names, objectAtIndex: 0usize];
                if let Some(path) = string_value(first).and_then(|value| existing_file_path(&value))
                {
                    return Some(path);
                }
            }
        }
        None
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn current_pasteboard_file_path() -> Option<String> {
    None
}

#[cfg(target_os = "windows")]
fn current_pasteboard_file_path() -> Option<String> {
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard,
    };
    use windows_sys::Win32::UI::Shell::DragQueryFileW;

    const CF_HDROP: u32 = 15;
    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return None;
        }
        let handle = GetClipboardData(CF_HDROP);
        if handle.is_null() {
            CloseClipboard();
            return None;
        }
        let length = DragQueryFileW(handle, 0, std::ptr::null_mut(), 0);
        if length == 0 {
            CloseClipboard();
            return None;
        }
        let mut buffer = vec![0u16; length as usize + 1];
        let copied = DragQueryFileW(handle, 0, buffer.as_mut_ptr(), buffer.len() as u32);
        CloseClipboard();
        if copied == 0 {
            return None;
        }
        buffer.truncate(copied as usize);
        let path = PathBuf::from(String::from_utf16_lossy(&buffer));
        path.exists().then(|| path.to_string_lossy().to_string())
    }
}

#[cfg(target_os = "macos")]
fn should_snapshot_pasteboard_type(type_name: &str) -> bool {
    is_file_reference_pasteboard_type(type_name)
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

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn clipboard_change_count() -> Option<i64> {
    None // format probing not available on this platform
}

#[cfg(target_os = "windows")]
fn clipboard_change_count() -> Option<i64> {
    let value = unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() };
    (value != 0).then_some(i64::from(value))
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
    pub file_kind: Option<String>,
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
        if !is_file_reference_pasteboard_type(&entry.type_name) {
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
    ensure_column(&conn, "file_kind", "TEXT")?;

    enforce_existing_image_limits(&conn);
    compact_existing_pasteboard_snapshots(&conn);
    prune_clipboard_storage(&conn);
    cleanup_orphan_clipboard_artifacts(&conn);
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

fn compute_image_id(image_path: &str) -> String {
    PathBuf::from(image_path)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| compute_id(image_path))
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
            let mut last_change_count: Option<i64> = None;

            // Initialize with current clipboard via Tauri plugin API
            if let Ok(text) = app_handle.clipboard().read_text() {
                if !text.is_empty() {
                    last_text = text.clone();
                    store(&db_clone, &text, None, None, None);
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

                let current_file_path = current_pasteboard_file_path();

                // Check for new text. File URLs are recorded as native file
                // entries below, never duplicated as path-shaped text.
                match app_handle.clipboard().read_text() {
                    Ok(text)
                        if current_file_path.is_none() && !text.is_empty() && text != last_text =>
                    {
                        last_text = text.clone();
                        store(&db_clone, &text, None, None, None);
                        let _ = app_handle.emit("clipboard-updated", ());
                    }
                    Ok(text) if text.is_empty() => {
                        last_text.clear();
                    }
                    Err(e) => {
                        last_text.clear();
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
                    if let Some(file_path) = current_file_path {
                        let snapshot_id = compute_id(&file_path);
                        let pasteboard_path = snapshot_current_pasteboard(&snapshot_id);
                        store(
                            &db_clone,
                            "",
                            None,
                            pasteboard_path.as_deref(),
                            Some(&file_path),
                        );
                        let _ = app_handle.emit("clipboard-updated", ());
                        continue;
                    }
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

                                // Encode directly from the borrowed slice and
                                // skip unusually large PNG outputs.
                                if ensure_clipboard_png_file(&image_path, rgba, width, height)
                                    .is_ok()
                                {
                                    let path_str = image_path.to_string_lossy().to_string();
                                    let pasteboard_path = snapshot_current_pasteboard(&hash_hex);
                                    store(
                                        &db_clone,
                                        "",
                                        Some(&path_str),
                                        pasteboard_path.as_deref(),
                                        None,
                                    );
                                    let _ = app_handle.emit("clipboard-updated", ());
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
    file_path: Option<&str>,
) {
    if !text.is_empty() && text.as_bytes().len() > MAX_TEXT_BYTES {
        return;
    }

    let mut guard = lock_db(db);
    let Ok(conn) = ensure_connection(&mut guard) else {
        return;
    };
    let id = if let Some(path) = file_path {
        compute_id(path)
    } else if !text.is_empty() {
        compute_id(text)
    } else if let Some(path) = image_path {
        compute_image_id(path)
    } else {
        return; // nothing to store
    };
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let file_kind = file_path.map(|path| clipboard_file_kind(Path::new(path)));
    let _ = conn.execute(
        "INSERT INTO clipboard_history (id, text, timestamp, image_path, image_pasteboard_path, file_path, file_kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            text = excluded.text,
            timestamp = excluded.timestamp,
            image_path = COALESCE(excluded.image_path, clipboard_history.image_path),
            image_pasteboard_path = COALESCE(excluded.image_pasteboard_path, clipboard_history.image_pasteboard_path),
            file_path = COALESCE(excluded.file_path, clipboard_history.file_path),
            file_kind = COALESCE(excluded.file_kind, clipboard_history.file_kind)",
        params![id, text, ts, image_path, image_pasteboard_path, file_path, file_kind],
    );
    prune_clipboard_storage(conn);
}
