use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
pub struct AppEntry {
    pub name: String,
    pub path: String,
    pub icon: String,
    pub kind: String,
}

static APP_CACHE: Mutex<Vec<AppEntry>> = Mutex::new(Vec::new());

fn get_icon_cache_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/.qx/icons", home));
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Convert .icns to .png using macOS built-in `sips` tool, cache results.
/// Chromium/Tauri webview cannot render .icns, only PNG/JPEG/GIF/WebP.
fn icon_to_png(icns_path: &PathBuf, app_name: &str) -> String {
    let cache_dir = get_icon_cache_dir();
    let safe_name = app_name.replace('/', "-");
    let png_path = cache_dir.join(format!("{}.png", safe_name));

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
        let cache_dir = get_icon_cache_dir();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "app").unwrap_or(false) {
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let safe_name = name.replace('/', "-");
                let png_path = cache_dir.join(format!("{}.png", safe_name));
                let icon = if png_path.exists() {
                    png_path.to_string_lossy().to_string()
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

fn ensure_cache() {
    let mut cache = APP_CACHE.lock().unwrap();
    if cache.is_empty() {
        *cache = scan_all_apps();
    }
}

/// Background icon pre-conversion. Called once at startup so the first
/// search is instant. Emits `apps:icons-ready` when done so the frontend
/// can refresh results with icons.
pub fn preload_icons(app: &AppHandle) {
    ensure_cache();
    let apps = APP_CACHE.lock().unwrap().clone();

    let handle = app.clone();
    std::thread::spawn(move || {
        let mut changed = false;
        for entry in apps.iter() {
            if !entry.icon.is_empty() {
                continue;
            }
            let app_path = PathBuf::from(&entry.path);
            if let Some(icon_path) = resolve_icon_path(&app_path, &entry.name) {
                let png = icon_to_png(&icon_path, &entry.name);
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
                }
            }
        }
        if changed {
            let _ = handle.emit("apps:icons-ready", ());
        }
    });
}

#[tauri::command]
pub fn search_apps(query: String) -> Vec<AppEntry> {
    ensure_cache();
    let results: Vec<AppEntry> = APP_CACHE.lock().unwrap().clone();

    if query.is_empty() {
        let mut sorted = results;
        sorted.sort_by(|a, b| a.name.cmp(&b.name));
        sorted.truncate(20);
        return sorted;
    }

    let q = query.to_lowercase();
    let mut scored: Vec<(i32, AppEntry)> = results
        .into_iter()
        .filter_map(|app| {
            let name_lower = app.name.to_lowercase();
            if name_lower == q {
                Some((0, app))
            } else if name_lower.starts_with(&q) {
                Some((1, app))
            } else if name_lower.contains(&q) {
                Some((2, app))
            } else {
                None
            }
        })
        .collect();

    scored.sort_by_key(|(score, _)| *score);
    scored.truncate(12);
    scored.into_iter().map(|(_, app)| app).collect()
}

#[tauri::command]
pub fn search_files(query: String) -> Vec<AppEntry> {
    let q = query.trim();
    if q.len() < 2 {
        return Vec::new();
    }

    let output = Command::new("mdfind")
        .args([
            "-onlyin",
            &std::env::var("HOME").unwrap_or_else(|_| "/".to_string()),
            "-name",
            q,
        ])
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(12)
        .map(|path| {
            let path_buf = PathBuf::from(path);
            let name = path_buf
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(path)
                .to_string();
            AppEntry {
                name,
                path: path.to_string(),
                icon: "builtin:file".to_string(),
                kind: "file".to_string(),
            }
        })
        .collect()
}
