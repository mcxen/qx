use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
pub struct AppEntry {
    pub name: String,
    pub display_name: String,
    pub path: String,
    pub icon: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified_at: Option<u64>,
    #[serde(skip_serializing)]
    pub aliases: String,
}

static APP_CACHE: Mutex<Vec<AppEntry>> = Mutex::new(Vec::new());
static DB_PATH: OnceLock<PathBuf> = OnceLock::new();
static CACHE_INITIALIZED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn app_cache_lock() -> Option<std::sync::MutexGuard<'static, Vec<AppEntry>>> {
    match APP_CACHE.lock() {
        Ok(guard) => Some(guard),
        Err(err) => {
            eprintln!("[apps] app cache lock poisoned; ignoring cached state: {err}");
            None
        }
    }
}

fn get_db_path() -> &'static PathBuf {
    DB_PATH.get_or_init(|| {
        let dir = crate::paths::data_dir();
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
            display_name TEXT NOT NULL DEFAULT '',
            icon TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT 'app',
            aliases TEXT NOT NULL DEFAULT '',
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
    conn.execute_batch("ALTER TABLE apps ADD COLUMN aliases TEXT NOT NULL DEFAULT '';")
        .ok();
    conn.execute_batch("ALTER TABLE apps ADD COLUMN display_name TEXT NOT NULL DEFAULT '';")
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

    let mut stmt = match conn
        .prepare("SELECT path, name, display_name, icon, kind, aliases FROM apps ORDER BY name")
    {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[apps] DB query prepare failed: {e}");
            return Vec::new();
        }
    };

    let rows = match stmt.query_map([], |row| {
        let path: String = row.get(0)?;
        let name: String = row.get(1)?;
        let display_name: String = row.get(2).unwrap_or_default();
        let display_name = if display_name.is_empty() {
            name.clone()
        } else {
            display_name
        };
        Ok(AppEntry {
            path,
            name,
            display_name,
            icon: row.get(3)?,
            kind: row.get(4)?,
            modified_at: None,
            aliases: row.get(5)?,
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

/// Prefer on-disk PNG / previous DB path over wiping icons to empty.
/// Fast scan never runs sips, so a rescan used to write `icon=""` and erase
/// good paths from apps.db — after reinstall that looked like “all icons gone”.
fn heal_entry_icon(entry: &mut AppEntry) {
    if !entry.icon.is_empty() && Path::new(&entry.icon).is_file() {
        return;
    }
    let app_path = PathBuf::from(&entry.path);
    let current = icon_cache_path(&app_path, &entry.name);
    if current.is_file() {
        entry.icon = current.to_string_lossy().to_string();
        return;
    }
    let legacy = legacy_icon_cache_path(&entry.name);
    if legacy.is_file() {
        entry.icon = legacy.to_string_lossy().to_string();
        return;
    }
    // Keep a previous path only if the file still exists.
    if !entry.icon.is_empty() && !Path::new(&entry.icon).is_file() {
        entry.icon.clear();
    }
}

fn preserve_icons_from_previous(mut fresh: Vec<AppEntry>, previous: &[AppEntry]) -> Vec<AppEntry> {
    use std::collections::HashMap;
    let prev: HashMap<&str, &AppEntry> = previous
        .iter()
        .map(|entry| (entry.path.as_str(), entry))
        .collect();
    for entry in &mut fresh {
        if entry.icon.is_empty() {
            if let Some(old) = prev.get(entry.path.as_str()) {
                if !old.icon.is_empty() && Path::new(&old.icon).is_file() {
                    entry.icon = old.icon.clone();
                }
            }
        }
        heal_entry_icon(entry);
    }
    fresh
}

/// Sync the provided app entries into the DB (upsert + delete stale).
/// Never overwrite a good on-disk icon path with an empty string.
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
            "INSERT INTO apps (path, name, display_name, icon, kind, aliases, last_seen)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
             ON CONFLICT(path) DO UPDATE SET
                name = excluded.name,
                display_name = excluded.display_name,
                icon = CASE
                    WHEN excluded.icon = '' AND icon != '' THEN icon
                    ELSE excluded.icon
                END,
                kind = excluded.kind,
                aliases = excluded.aliases,
                last_seen = datetime('now')",
            params![
                entry.path,
                entry.name,
                entry.display_name,
                entry.icon,
                entry.kind,
                entry.aliases
            ],
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

#[cfg(target_os = "macos")]
fn get_icon_cache_dir() -> PathBuf {
    let dir = crate::paths::state_dir().join("icons");
    let _ = fs::create_dir_all(&dir);
    dir
}

#[cfg(not(target_os = "macos"))]
fn get_icon_cache_dir() -> PathBuf {
    let dir = crate::paths::cache_dir().join("icons");
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

fn push_alias(aliases: &mut Vec<String>, value: Option<String>, primary_name: &str) {
    let Some(value) = value else {
        return;
    };
    let value = value.trim();
    if value.is_empty() || value == primary_name {
        return;
    }
    if !aliases.iter().any(|alias| alias == value) {
        aliases.push(value.to_string());
    }
}

fn localized_string_value(strings_path: &PathBuf, key: &str) -> Option<String> {
    plist_value(strings_path, key)
}

fn contains_han(s: &str) -> bool {
    s.chars().any(|c| {
        let code = c as u32;
        (0x4E00..=0x9FFF).contains(&code)
            || (0x3400..=0x4DBF).contains(&code)
            || (0x20000..=0x2A6DF).contains(&code)
            || (0xF900..=0xFAFF).contains(&code)
    })
}

fn pinyin_variants(text: &str) -> (String, String) {
    use pinyin::ToPinyin;
    let mut full = String::new();
    let mut initials = String::new();
    for ch in text.chars() {
        match ch.to_pinyin() {
            Some(py) => {
                let plain = py.plain();
                full.push_str(plain);
                if let Some(first) = plain.chars().next() {
                    initials.push(first);
                }
            }
            None => {
                if !ch.is_whitespace() {
                    full.push(ch);
                    if ch.is_ascii_alphanumeric() {
                        initials.push(ch);
                    }
                }
            }
        }
    }
    (full, initials)
}

/// Resolve the localized name set for a `.app` bundle.
/// Returns `(display_name, aliases_joined_by_newline)` where `display_name`
/// prefers zh-Hans lproj > zh_CN lproj > built-in dictionary > CFBundleDisplayName > primary_name.
fn resolve_localized_names(app_path: &PathBuf, primary_name: &str) -> (String, String) {
    let info_plist = app_path.join("Contents").join("Info.plist");
    let resources = app_path.join("Contents").join("Resources");
    let mut aliases: Vec<String> = Vec::new();
    let mut zh_display: Option<String> = None;

    let take_zh_candidate = |value: Option<String>| -> Option<String> {
        let value = value?;
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return None;
        }
        if contains_han(trimmed) {
            Some(trimmed.to_string())
        } else {
            None
        }
    };

    // 1. zh-Hans / zh_CN / Chinese lproj -- highest priority for display name.
    let zh_lprojs = [
        "zh-Hans.lproj",
        "zh_CN.lproj",
        "Chinese.lproj",
        "zh-Hant.lproj",
        "zh_TW.lproj",
    ];
    for lproj in zh_lprojs {
        let strings_path = resources.join(lproj).join("InfoPlist.strings");
        if !strings_path.is_file() {
            continue;
        }
        let display = localized_string_value(&strings_path, "CFBundleDisplayName");
        let bundle = localized_string_value(&strings_path, "CFBundleName");
        if zh_display.is_none() {
            if let Some(v) = take_zh_candidate(display.clone()) {
                zh_display = Some(v);
            } else if let Some(v) = take_zh_candidate(bundle.clone()) {
                zh_display = Some(v);
            }
        }
        push_alias(&mut aliases, display, primary_name);
        push_alias(&mut aliases, bundle, primary_name);
    }

    // 2. Built-in dictionary by CFBundleIdentifier (covers Apple system apps
    //    whose strings files do not include a Chinese display name).
    let bundle_id = plist_value(&info_plist, "CFBundleIdentifier");
    if let Some(ref id) = bundle_id {
        if let Some(zh_names) = crate::apps_zh_dict::lookup(id) {
            for (idx, name) in zh_names.iter().enumerate() {
                if idx == 0 && zh_display.is_none() && contains_han(name) {
                    zh_display = Some((*name).to_string());
                }
                push_alias(&mut aliases, Some((*name).to_string()), primary_name);
            }
        }
    }

    // 3. Plain CFBundleDisplayName / CFBundleName from Info.plist (often English).
    push_alias(
        &mut aliases,
        plist_value(&info_plist, "CFBundleDisplayName"),
        primary_name,
    );
    push_alias(
        &mut aliases,
        plist_value(&info_plist, "CFBundleName"),
        primary_name,
    );

    // 4. Fallback: walk every other *.lproj/InfoPlist.strings for completeness.
    if let Ok(entries) = fs::read_dir(&resources) {
        for entry in entries.flatten() {
            let lproj = entry.path();
            if !lproj.is_dir() || lproj.extension().map(|ext| ext != "lproj").unwrap_or(true) {
                continue;
            }
            let strings_path = lproj.join("InfoPlist.strings");
            if !strings_path.is_file() {
                continue;
            }
            push_alias(
                &mut aliases,
                localized_string_value(&strings_path, "CFBundleDisplayName"),
                primary_name,
            );
            push_alias(
                &mut aliases,
                localized_string_value(&strings_path, "CFBundleName"),
                primary_name,
            );
        }
    }

    // 5. Generate pinyin for every Chinese alias so users can type "weixin" / "wx".
    let chinese_aliases: Vec<String> = aliases
        .iter()
        .filter(|a| contains_han(a))
        .cloned()
        .collect();
    if let Some(ref display) = zh_display {
        if !chinese_aliases.iter().any(|a| a == display) {
            // ensure pinyin for the display name itself is generated even if it
            // was not pushed to aliases (it could equal primary_name only when
            // primary is Chinese, but display from dictionary is fine to use).
            let (full, initials) = pinyin_variants(display);
            if !full.is_empty() && full != *display {
                push_alias(&mut aliases, Some(full), primary_name);
            }
            if !initials.is_empty() {
                push_alias(&mut aliases, Some(initials), primary_name);
            }
        }
    }
    for zh in chinese_aliases {
        let (full, initials) = pinyin_variants(&zh);
        if !full.is_empty() && full != zh {
            push_alias(&mut aliases, Some(full), primary_name);
        }
        if !initials.is_empty() {
            push_alias(&mut aliases, Some(initials), primary_name);
        }
    }

    let display_name = zh_display.unwrap_or_else(|| primary_name.to_string());
    (display_name, aliases.join("\n"))
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
                let (display_name, aliases) = resolve_localized_names(&path, &name);
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
                    display_name,
                    path: path.to_string_lossy().to_string(),
                    icon,
                    kind: "app".to_string(),
                    modified_at: None,
                    aliases,
                });
            }
        }
    }
}

#[cfg(target_os = "macos")]
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

#[cfg(target_os = "windows")]
fn scan_all_apps() -> Vec<AppEntry> {
    fn scan_start_menu(dir: PathBuf, results: &mut Vec<AppEntry>) {
        let mut stack = vec![dir];
        while let Some(current) = stack.pop() {
            let Ok(entries) = fs::read_dir(current) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                let is_shortcut = path
                    .extension()
                    .and_then(|extension| extension.to_str())
                    .map(|extension| extension.eq_ignore_ascii_case("lnk"))
                    .unwrap_or(false);
                if !is_shortcut {
                    continue;
                }
                let name = path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                results.push(AppEntry {
                    display_name: name.clone(),
                    name,
                    path: path.to_string_lossy().to_string(),
                    icon: String::new(),
                    kind: "app".to_string(),
                    modified_at: None,
                    aliases: String::new(),
                });
            }
        }
    }

    let mut roots = Vec::new();
    if let Some(app_data) = std::env::var_os("APPDATA") {
        roots.push(
            PathBuf::from(app_data)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    if let Some(program_data) = std::env::var_os("PROGRAMDATA") {
        roots.push(
            PathBuf::from(program_data)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }

    let mut results = Vec::new();
    for root in roots {
        scan_start_menu(root, &mut results);
    }
    results.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    results.dedup_by(|left, right| left.path.eq_ignore_ascii_case(&right.path));
    results
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn scan_all_apps() -> Vec<AppEntry> {
    Vec::new()
}

/// Initialize the app cache from persistent DB, then spawn a background
/// re-scan. The cold load from DB is ~1ms. The background scan eventually
/// updates both DB and in-memory cache and emits 'apps:updated'.
pub fn ensure_cache(app: Option<&AppHandle>) {
    // Phase 1: Load from DB (instant) and heal broken icon paths against disk.
    let mut db_entries = load_from_db();
    for entry in &mut db_entries {
        heal_entry_icon(entry);
    }
    if let Some(mut cache) = app_cache_lock() {
        if !db_entries.is_empty() {
            *cache = db_entries;
        }
    }
    CACHE_INITIALIZED.store(true, std::sync::atomic::Ordering::SeqCst);

    // Phase 2: Always scan in the background, including a truly cold first
    // launch. Directory walking, plist reads and icon discovery must never
    // delay Tauri setup or shortcut/tray registration.
    if let Some(handle) = app {
        let app_handle = handle.clone();
        let _ = std::thread::Builder::new()
            .name("qx-app-scan".to_string())
            .spawn(move || {
                let previous = app_cache_lock()
                    .map(|cache| cache.clone())
                    .unwrap_or_default();
                let fresh = preserve_icons_from_previous(scan_all_apps(), &previous);
                sync_db(&fresh);
                if let Some(mut cache) = app_cache_lock() {
                    *cache = fresh;
                }
                let _ = app_handle.emit("apps:updated", ());
                // Generate missing PNGs *after* scan so we never race a fast
                // scan that would wipe icons we just wrote.
                fill_missing_icons(&app_handle);
            });
    } else if app_cache_lock()
        .map(|cache| cache.is_empty())
        .unwrap_or(true)
    {
        // Recovery path used only from search_apps' spawn_blocking worker if
        // startup initialization was skipped or failed.
        let previous = app_cache_lock()
            .map(|cache| cache.clone())
            .unwrap_or_default();
        let fresh = preserve_icons_from_previous(scan_all_apps(), &previous);
        sync_db(&fresh);
        if let Some(mut cache) = app_cache_lock() {
            *cache = fresh;
        }
    }
}

/// Convert missing app icons to PNG and update cache + DB.
/// Emits `apps:icons-ready` when any icon changed.
fn fill_missing_icons(app: &AppHandle) {
    let apps = app_cache_lock()
        .map(|cache| cache.clone())
        .unwrap_or_default();
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
        if png.is_empty() {
            continue;
        }
        if let Ok(mut cache) = APP_CACHE.lock() {
            for c in cache.iter_mut() {
                if c.path == entry.path {
                    c.icon = png.clone();
                    changed = true;
                    break;
                }
            }
        }
        if let Ok(conn) = init_db() {
            let _ = conn.execute(
                "UPDATE apps SET icon = ?1 WHERE path = ?2",
                params![png, entry.path],
            );
        }
    }
    if changed {
        let _ = app.emit("apps:icons-ready", ());
    }
}

/// Background icon pre-conversion entry point.
/// Prefer the post-scan path inside `ensure_cache`; kept for manual/best-effort fill.
#[allow(dead_code)]
pub fn preload_icons(app: &AppHandle) {
    let handle = app.clone();
    let _ = std::thread::Builder::new()
        .name("qx-icon-preload".to_string())
        .spawn(move || {
            // Small delay so first search_apps can serve DB rows without sips contention.
            std::thread::sleep(std::time::Duration::from_millis(800));
            fill_missing_icons(&handle);
        });
}

#[tauri::command]
pub async fn search_apps(query: String) -> Result<Vec<AppEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
            let display_lower = app.display_name.to_lowercase();
            let aliases_lower = app.aliases.to_lowercase();
            if name_lower == q || display_lower == q {
                scored.push((0, app));
            } else if name_lower.starts_with(&q) || display_lower.starts_with(&q) {
                scored.push((1, app));
            } else if name_lower.contains(&q) || display_lower.contains(&q) {
                scored.push((2, app));
            } else if aliases_lower.lines().any(|alias| alias == q) {
                scored.push((3, app));
            } else if aliases_lower.lines().any(|alias| alias.starts_with(&q)) {
                scored.push((4, app));
            } else if aliases_lower.contains(&q) {
                scored.push((5, app));
            }
        }

        scored.sort_by_key(|(score, _)| *score);
        scored.truncate(12);
        Ok(scored.into_iter().map(|(_, app)| app.clone()).collect())
    })
    .await
    .map_err(|e| format!("search apps task failed: {e}"))?
}

#[tauri::command]
pub async fn search_files(
    query: String,
    pass: Option<u32>,
    categories: Option<Vec<crate::settings::FileSearchCategory>>,
    category_id: Option<String>,
    request_id: Option<u64>,
) -> Vec<AppEntry> {
    // Progressive passes: 0 quick, 1 expanded, 2+ system/broader.
    // Frontend merges asynchronously so later hits chase onto the list.
    let pass = pass.unwrap_or(0);
    let limit = match pass {
        0 => 16,
        1 => 24,
        _ => 32,
    };
    crate::file_search::search(
        query,
        limit,
        pass,
        categories.unwrap_or_default(),
        category_id,
        request_id,
    )
    .await
}
