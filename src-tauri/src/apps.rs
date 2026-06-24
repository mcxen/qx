use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
pub struct AppEntry {
    pub name: String,
    pub path: String,
    pub icon: String,
    pub kind: String,
}

static APP_CACHE: Mutex<Vec<AppEntry>> = Mutex::new(Vec::new());
static DB_PATH: OnceLock<PathBuf> = OnceLock::new();
static CACHE_INITIALIZED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn get_db_path() -> &'static PathBuf {
    DB_PATH.get_or_init(|| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        let dir = PathBuf::from(format!("{}/Library/Application Support/qx", home));
        let _ = fs::create_dir_all(&dir);
        dir.join("apps.db")
    })
}

fn init_db() -> Result<Connection, rusqlite::Error> {
    let conn = Connection::open(get_db_path())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS apps (
            path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            icon TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT 'app',
            last_seen TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;
    // Ensure the table has the expected columns even if created by an older schema
    conn.execute_batch("ALTER TABLE apps ADD COLUMN kind TEXT NOT NULL DEFAULT 'app';")
        .ok();
    conn.execute_batch(
        "ALTER TABLE apps ADD COLUMN last_seen TEXT NOT NULL DEFAULT (datetime('now'));",
    )
    .ok();
    Ok(conn)
}

/// Load all apps from the SQLite DB into APP_CACHE.
/// Returns the number of entries loaded (0 if DB is empty/new).
fn load_from_db() -> Vec<AppEntry> {
    let conn = match init_db() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[apps] DB init failed: {e}");
            return Vec::new();
        }
    };

    let mut stmt = match conn.prepare("SELECT path, name, icon, kind FROM apps ORDER BY name") {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[apps] DB query prepare failed: {e}");
            return Vec::new();
        }
    };

    let rows = match stmt.query_map([], |row| {
        Ok(AppEntry {
            path: row.get(0)?,
            name: row.get(1)?,
            icon: row.get(2)?,
            kind: row.get(3)?,
        })
    }) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[apps] DB query failed: {e}");
            return Vec::new();
        }
    };

    let mut entries = Vec::new();
    for row in rows.flatten() {
        entries.push(row);
    }
    entries
}

/// Sync the provided app entries into the DB (upsert + delete stale).
fn sync_db(entries: &[AppEntry]) {
    let conn = match init_db() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[apps] DB sync init failed: {e}");
            return;
        }
    };

    // Collect current paths
    let current_paths: Vec<String> = entries.iter().map(|e| e.path.clone()).collect();

    // Upsert all current entries
    for entry in entries {
        let result = conn.execute(
            "INSERT INTO apps (path, name, icon, kind, last_seen)
             VALUES (?1, ?2, ?3, ?4, datetime('now'))
             ON CONFLICT(path) DO UPDATE SET
                name = excluded.name,
                icon = excluded.icon,
                kind = excluded.kind,
                last_seen = datetime('now')",
            params![entry.path, entry.name, entry.icon, entry.kind],
        );
        if let Err(e) = result {
            eprintln!("[apps] DB upsert failed for {}: {e}", entry.path);
        }
    }

    // Delete entries no longer present
    if !current_paths.is_empty() {
        let placeholders: Vec<String> = current_paths
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "DELETE FROM apps WHERE path NOT IN ({})",
            placeholders.join(",")
        );
        let params: Vec<&dyn rusqlite::types::ToSql> = current_paths
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let _ = conn.execute(&sql, params.as_slice());
    } else {
        // No current apps, clear everything
        let _ = conn.execute("DELETE FROM apps", []);
    }
}

fn get_icon_cache_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/.qx/icons", home));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn has_info_plist(app_path: &PathBuf) -> bool {
    app_path.join("Contents").join("Info.plist").is_file()
}

fn icon_cache_path(app_path: &PathBuf, app_name: &str) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    app_path.to_string_lossy().hash(&mut hasher);
    let path_hash = hasher.finish();
    let safe_name = app_name
        .chars()
        .map(|c| match c {
            '/' | ':' => '-',
            _ => c,
        })
        .collect::<String>();
    get_icon_cache_dir().join(format!("{safe_name}-{path_hash:016x}.png"))
}

fn legacy_icon_cache_path(app_name: &str) -> PathBuf {
    let safe_name = app_name.replace('/', "-");
    get_icon_cache_dir().join(format!("{safe_name}.png"))
}

fn has_current_cached_icon(app_path: &PathBuf, app_name: &str, icon: &str) -> bool {
    if icon.is_empty() {
        return false;
    }
    let current_path = icon_cache_path(app_path, app_name);
    icon == current_path.to_string_lossy() && current_path.exists()
}

/// Convert .icns to .png using macOS built-in `sips` tool, cache results.
/// Chromium/Tauri webview cannot render .icns, only PNG/JPEG/GIF/WebP.
fn icon_to_png(icns_path: &PathBuf, app_path: &PathBuf, app_name: &str) -> String {
    let png_path = icon_cache_path(app_path, app_name);

    if png_path.exists() {
        let png_modified = fs::metadata(&png_path).ok().and_then(|m| m.modified().ok());
        let icns_modified = fs::metadata(icns_path).ok().and_then(|m| m.modified().ok());
        if let (Some(png_m), Some(icns_m)) = (png_modified, icns_modified) {
            if png_m >= icns_m {
                return png_path.to_string_lossy().to_string();
            }
        }
    }

    let output = Command::new("sips")
        .args([
            "-s",
            "format",
            "png",
            icns_path.to_str().unwrap_or(""),
            "--out",
            png_path.to_str().unwrap_or(""),
        ])
        .output();

    match output {
        Ok(o) if o.status.success() && png_path.exists() => png_path.to_string_lossy().to_string(),
        _ => String::new(),
    }
}

#[cfg(target_os = "macos")]
fn appkit_icon_to_png(app_path: &PathBuf, app_name: &str) -> String {
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSSize, NSString};

    let png_path = icon_cache_path(app_path, app_name);
    if png_path.exists() {
        return png_path.to_string_lossy().to_string();
    }

    let app_path_string = app_path.to_string_lossy();
    let ns_path = NSString::from_str(&app_path_string);
    let empty_props = NSDictionary::new();

    let write_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let workspace = NSWorkspace::sharedWorkspace();
        let image = workspace.iconForFile(&ns_path);
        image.setSize(NSSize::new(256.0, 256.0));
        let tiff = image.TIFFRepresentation()?;
        let bitmap = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)?;
        let png = unsafe {
            bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &empty_props)
        }?;
        fs::write(&png_path, unsafe { png.as_bytes_unchecked() }).ok()?;
        Some(())
    }));

    match write_result {
        Ok(Some(())) if png_path.exists() => png_path.to_string_lossy().to_string(),
        _ => String::new(),
    }
}

#[cfg(not(target_os = "macos"))]
fn appkit_icon_to_png(_app_path: &PathBuf, _app_name: &str) -> String {
    String::new()
}

fn resolve_app_bundle(path: PathBuf) -> Option<PathBuf> {
    if has_info_plist(&path) {
        return Some(path);
    }

    let wrapper_dir = path.join("Wrapper");
    if let Ok(entries) = fs::read_dir(&wrapper_dir) {
        for entry in entries.flatten() {
            let nested = entry.path();
            if nested.extension().map(|e| e == "app").unwrap_or(false) && has_info_plist(&nested) {
                return Some(nested);
            }
        }
    }

    let mut stack = vec![path];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let nested = entry.path();
            if nested.extension().map(|e| e == "app").unwrap_or(false) {
                if has_info_plist(&nested) {
                    return Some(nested);
                }
                stack.push(nested);
            } else if nested.is_dir() {
                stack.push(nested);
            }
        }
    }

    None
}

fn plist_value(info_plist: &PathBuf, key: &str) -> Option<String> {
    let output = Command::new("plutil")
        .args(["-extract", key, "raw", "-o", "-", info_plist.to_str()?])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn resolve_icon_path(app_path: &PathBuf, app_name: &str) -> Option<PathBuf> {
    let resources = app_path.join("Contents").join("Resources");
    let info_plist = app_path.join("Contents").join("Info.plist");

    for key in ["CFBundleIconFile", "CFBundleIconName"] {
        if let Some(icon_name) = plist_value(&info_plist, key) {
            let file_name = if icon_name.ends_with(".icns") {
                icon_name
            } else {
                format!("{icon_name}.icns")
            };
            let path = resources.join(file_name);
            if path.exists() {
                return Some(path);
            }
        }
    }

    let guessed = resources.join(format!("{app_name}.icns"));
    if guessed.exists() {
        return Some(guessed);
    }

    fs::read_dir(resources)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.extension().map(|ext| ext == "icns").unwrap_or(false))
}

/// Fast scan: only checks for already-cached PNG icons (no `sips` subprocess).
/// This makes the scan near-instant even on first run.
fn scan_dir_fast(dir: &PathBuf, results: &mut Vec<AppEntry>) {
    if !dir.exists() {
        return;
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let original_path = entry.path();
            if original_path
                .extension()
                .map(|e| e == "app")
                .unwrap_or(false)
            {
                let path = resolve_app_bundle(original_path.clone()).unwrap_or(original_path);
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let png_path = icon_cache_path(&path, &name);
                let legacy_png_path = legacy_icon_cache_path(&name);
                let icon = if png_path.exists() {
                    png_path.to_string_lossy().to_string()
                } else if legacy_png_path.exists() {
                    legacy_png_path.to_string_lossy().to_string()
                } else {
                    String::new()
                };
                results.push(AppEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    icon,
                    kind: "app".to_string(),
                });
            }
        }
    }
}

fn scan_all_apps() -> Vec<AppEntry> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
        PathBuf::from(format!("{}/Applications", home)),
    ];

    let mut results = Vec::new();
    for dir in dirs {
        scan_dir_fast(&dir, &mut results);
    }
    results
}

/// Initialize the app cache from persistent DB, then spawn a background
/// re-scan. The cold load from DB is ~1ms. The background scan eventually
/// updates both DB and in-memory cache and emits 'apps:updated'.
pub fn ensure_cache(app: Option<&AppHandle>) {
    // Phase 1: Load from DB (instant)
    let db_entries = load_from_db();
    {
        let mut cache = APP_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if !db_entries.is_empty() {
            *cache = db_entries;
        }
    }
    CACHE_INITIALIZED.store(true, std::sync::atomic::Ordering::SeqCst);

    // If we have entries from DB, we're already usable.
    // If DB was empty, do the initial scan synchronously so the user
    // sees apps on first search.
    let need_initial_scan = {
        let cache = APP_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        cache.is_empty()
    };

    if need_initial_scan {
        let fresh = scan_all_apps();
        sync_db(&fresh);
        let mut cache = APP_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        *cache = fresh;
    }

    // Phase 2: Spawn background re-scan to catch changes
    if let Some(handle) = app {
        let app_handle = handle.clone();
        std::thread::spawn(move || {
            let fresh = scan_all_apps();
            // Update DB
            sync_db(&fresh);
            // Update in-memory cache
            {
                let mut cache = APP_CACHE.lock().unwrap_or_else(|e| e.into_inner());
                *cache = fresh;
            }
            let _ = app_handle.emit("apps:updated", ());
        });
    }
}

/// Background icon pre-conversion. Called once at startup so the first
/// search is instant. Emits `apps:icons-ready` when done so the frontend
/// can refresh results with icons.
pub fn preload_icons(app: &AppHandle) {
    let apps = APP_CACHE.lock().unwrap_or_else(|e| e.into_inner()).clone();

    let handle = app.clone();
    std::thread::spawn(move || {
        let mut changed = false;
        for entry in apps.iter() {
            let app_path = PathBuf::from(&entry.path);
            if has_current_cached_icon(&app_path, &entry.name, &entry.icon) {
                continue;
            }
            let mut png = appkit_icon_to_png(&app_path, &entry.name);
            if png.is_empty() {
                if let Some(icon_path) = resolve_icon_path(&app_path, &entry.name) {
                    png = icon_to_png(&icon_path, &app_path, &entry.name);
                }
            }
            if !png.is_empty() {
                if let Ok(mut cache) = APP_CACHE.lock() {
                    for c in cache.iter_mut() {
                        if c.path == entry.path {
                            c.icon = png.clone();
                            changed = true;
                            break;
                        }
                    }
                }
                // Also update DB
                if let Ok(conn) = init_db() {
                    let _ = conn.execute(
                        "UPDATE apps SET icon = ?1 WHERE path = ?2",
                        params![png, entry.path],
                    );
                }
            }
        }
        if changed {
            let _ = handle.emit("apps:icons-ready", ());
        }
    });
}

#[tauri::command]
pub fn search_apps(query: String) -> Result<Vec<AppEntry>, String> {
    // Ensure cache is initialized (if ensure_cache wasn't called yet)
    if !CACHE_INITIALIZED.load(std::sync::atomic::Ordering::SeqCst) {
        ensure_cache(None);
    }

    let cache = APP_CACHE
        .lock()
        .map_err(|e| format!("lock poisoned: {e}"))?;

    if query.is_empty() {
        let results: Vec<AppEntry> = cache.iter().take(20).cloned().collect();
        return Ok(results);
    }

    let q = query.to_lowercase();
    let mut scored: Vec<(i32, &AppEntry)> = Vec::with_capacity(cache.len() / 2);
    for app in cache.iter() {
        let name_lower = app.name.to_lowercase();
        if name_lower == q {
            scored.push((0, app));
        } else if name_lower.starts_with(&q) {
            scored.push((1, app));
        } else if name_lower.contains(&q) {
            scored.push((2, app));
        }
    }

    scored.sort_by_key(|(score, _)| *score);
    scored.truncate(12);
    Ok(scored.into_iter().map(|(_, app)| app.clone()).collect())
}

#[tauri::command]
pub async fn search_files(query: String) -> Vec<AppEntry> {
    crate::file_search::search(query, 12).await
}
