use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

#[derive(Debug, Serialize, Default)]
pub struct StorageBucket {
    pub id: String,
    pub label: String,
    pub paths: Vec<StoragePath>,
    pub bytes: u64,
    pub files: u64,
    pub clearable: bool,
}

#[derive(Debug, Serialize)]
pub struct StoragePath {
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Serialize)]
pub struct StorageOverview {
    pub total_bytes: u64,
    pub buckets: Vec<StorageBucket>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Default)]
pub struct StorageClearResult {
    pub cleared_bytes: u64,
    pub cleared_files: u64,
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

fn app_support_dir() -> PathBuf {
    let base = dirs::data_dir().unwrap_or_else(|| home_dir().join("Library/Application Support"));
    base.join("qx")
}

fn qx_home_dir() -> PathBuf {
    home_dir().join(".qx")
}

fn icons_dir() -> PathBuf {
    qx_home_dir().join("icons")
}

fn plugins_dir() -> PathBuf {
    qx_home_dir().join("plugins")
}

fn ocr_models_dir() -> PathBuf {
    home_dir().join(".oar")
}

fn output_files_dir() -> PathBuf {
    dirs::picture_dir()
        .unwrap_or_else(|| home_dir().join("Pictures"))
        .join("Qx")
}

fn screencap_db_path() -> PathBuf {
    app_support_dir().join("screencap.db")
}

fn clipboard_db_path() -> PathBuf {
    app_support_dir().join("clipboard.db")
}

fn clipboard_images_dir() -> PathBuf {
    app_support_dir().join("clipboard_images")
}

const DATABASE_FILES: &[&str] = &[
    "apps.db",
    "clipboard.db",
    "history.db",
    "rss.db",
    "screencap.db",
];

fn recording_temp_dirs() -> Vec<PathBuf> {
    let temp = std::env::temp_dir();
    fs::read_dir(&temp)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with("qx_recording_"))
                    .unwrap_or(false)
        })
        .collect()
}

fn measure(path: &Path, warnings: &mut Vec<String>) -> (u64, u64) {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (0, 0),
        Err(e) => {
            warnings.push(format!("stat {}: {e}", path.display()));
            return (0, 0);
        }
    };

    if meta.is_file() {
        return (meta.len(), 1);
    }
    if !meta.is_dir() {
        return (0, 0);
    }

    let entries = match fs::read_dir(path) {
        Ok(it) => it,
        Err(e) => {
            warnings.push(format!("read {}: {e}", path.display()));
            return (0, 0);
        }
    };

    let mut bytes = 0_u64;
    let mut files = 0_u64;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                warnings.push(format!("entry {}: {e}", path.display()));
                continue;
            }
        };
        let (b, f) = measure(&entry.path(), warnings);
        bytes = bytes.saturating_add(b);
        files = files.saturating_add(f);
    }
    (bytes, files)
}

fn path_entry(path: PathBuf) -> StoragePath {
    let exists = path.exists();
    StoragePath {
        path: path.to_string_lossy().into_owned(),
        exists,
    }
}

fn measure_paths(paths: &[PathBuf], warnings: &mut Vec<String>) -> (u64, u64) {
    let mut bytes = 0_u64;
    let mut files = 0_u64;
    for p in paths {
        let (b, f) = measure(p, warnings);
        bytes = bytes.saturating_add(b);
        files = files.saturating_add(f);
    }
    (bytes, files)
}

fn settings_top_level_size(dir: &Path, warnings: &mut Vec<String>) -> (u64, u64) {
    let entries = match fs::read_dir(dir) {
        Ok(it) => it,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return (0, 0),
        Err(e) => {
            warnings.push(format!("read {}: {e}", dir.display()));
            return (0, 0);
        }
    };
    let mut bytes = 0_u64;
    let mut files = 0_u64;
    for entry in entries.flatten() {
        let path = entry.path();
        let meta = match fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(e) => {
                warnings.push(format!("stat {}: {e}", path.display()));
                continue;
            }
        };
        if meta.is_file() {
            bytes = bytes.saturating_add(meta.len());
            files = files.saturating_add(1);
        }
    }
    (bytes, files)
}

#[command]
pub fn qx_storage_overview() -> StorageOverview {
    let mut warnings: Vec<String> = Vec::new();

    // Cache: icons + OCR models + temp recordings (multi-path).
    let mut cache_paths: Vec<PathBuf> = vec![icons_dir(), ocr_models_dir()];
    cache_paths.extend(recording_temp_dirs());
    let (cache_bytes, cache_files) = measure_paths(&cache_paths, &mut warnings);
    let cache = StorageBucket {
        id: "cache".into(),
        label: "Cache".into(),
        paths: cache_paths.into_iter().map(path_entry).collect(),
        bytes: cache_bytes,
        files: cache_files,
        clearable: true,
    };

    // Files: GIF/PNG output folder.
    let files_path = output_files_dir();
    let (files_bytes, files_count) = measure(&files_path, &mut warnings);
    let files = StorageBucket {
        id: "files".into(),
        label: "Files".into(),
        paths: vec![path_entry(files_path)],
        bytes: files_bytes,
        files: files_count,
        clearable: true,
    };

    // Databases: only the known .db files inside app support dir.
    let support = app_support_dir();
    let db_paths: Vec<PathBuf> = DATABASE_FILES
        .iter()
        .map(|name| support.join(name))
        .collect();
    let (db_bytes, db_files) = measure_paths(&db_paths, &mut warnings);
    let databases = StorageBucket {
        id: "databases".into(),
        label: "Databases".into(),
        paths: vec![path_entry(support.clone())],
        bytes: db_bytes,
        files: db_files,
        clearable: false,
    };

    // Clipboard: images cache directory (separate from databases).
    let clip_dir = clipboard_images_dir();
    let (clip_bytes, clip_files) = measure(&clip_dir, &mut warnings);
    let clipboard = StorageBucket {
        id: "clipboard".into(),
        label: "Clipboard".into(),
        paths: vec![path_entry(clip_dir)],
        bytes: clip_bytes,
        files: clip_files,
        clearable: true,
    };

    // Plugins: ~/.qx/plugins.
    let plugins_path = plugins_dir();
    let (plugins_bytes, plugins_files) = measure(&plugins_path, &mut warnings);
    let plugins = StorageBucket {
        id: "plugins".into(),
        label: "Plugins".into(),
        paths: vec![path_entry(plugins_path)],
        bytes: plugins_bytes,
        files: plugins_files,
        clearable: false,
    };

    // Settings: only top-level files inside ~/.qx (avoids double counting subdirs).
    let qx_home = qx_home_dir();
    let (settings_bytes, settings_files) = settings_top_level_size(&qx_home, &mut warnings);
    let settings = StorageBucket {
        id: "settings".into(),
        label: "Settings".into(),
        paths: vec![path_entry(qx_home)],
        bytes: settings_bytes,
        files: settings_files,
        clearable: false,
    };

    let buckets = vec![cache, files, databases, clipboard, plugins, settings];
    let total_bytes = buckets.iter().map(|b| b.bytes).sum();

    StorageOverview {
        total_bytes,
        buckets,
        warnings,
    }
}

fn clear_dir_contents(path: &Path) -> Result<StorageClearResult, String> {
    if !path.exists() {
        return Ok(StorageClearResult::default());
    }
    let mut warnings: Vec<String> = Vec::new();
    let (cleared_bytes, cleared_files) = measure(path, &mut warnings);

    for entry in fs::read_dir(path).map_err(|e| format!("read {}: {e}", path.display()))? {
        let entry = entry.map_err(|e| format!("entry {}: {e}", path.display()))?;
        let child = entry.path();
        let meta =
            fs::symlink_metadata(&child).map_err(|e| format!("stat {}: {e}", child.display()))?;
        if meta.is_dir() {
            fs::remove_dir_all(&child).map_err(|e| format!("remove {}: {e}", child.display()))?;
        } else {
            fs::remove_file(&child).map_err(|e| format!("remove {}: {e}", child.display()))?;
        }
    }
    Ok(StorageClearResult {
        cleared_bytes,
        cleared_files,
    })
}

#[command]
pub fn qx_storage_clear_cache() -> Result<StorageClearResult, String> {
    let mut total = StorageClearResult::default();

    for path in [icons_dir(), ocr_models_dir()] {
        let r = clear_dir_contents(&path)?;
        total.cleared_bytes = total.cleared_bytes.saturating_add(r.cleared_bytes);
        total.cleared_files = total.cleared_files.saturating_add(r.cleared_files);
    }
    for path in recording_temp_dirs() {
        let mut warnings: Vec<String> = Vec::new();
        let (b, f) = measure(&path, &mut warnings);
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
        }
        total.cleared_bytes = total.cleared_bytes.saturating_add(b);
        total.cleared_files = total.cleared_files.saturating_add(f);
    }
    Ok(total)
}

#[command]
pub fn qx_storage_clear_files() -> Result<StorageClearResult, String> {
    let dir = output_files_dir();
    let mut total = StorageClearResult::default();
    if !dir.exists() {
        return Ok(total);
    }

    for entry in fs::read_dir(&dir).map_err(|e| format!("read {}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| format!("entry {}: {e}", dir.display()))?;
        let path = entry.path();
        let is_qx_file = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "png" | "gif"))
            .unwrap_or(false);
        if !is_qx_file || !path.is_file() {
            continue;
        }
        let bytes = fs::symlink_metadata(&path).map(|m| m.len()).unwrap_or(0);
        fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
        total.cleared_bytes = total.cleared_bytes.saturating_add(bytes);
        total.cleared_files = total.cleared_files.saturating_add(1);
    }

    if total.cleared_files > 0 {
        if let Ok(conn) = rusqlite::Connection::open(screencap_db_path()) {
            let _ = conn.execute("DELETE FROM gif_history", []);
        }
    }

    Ok(total)
}

#[command]
pub fn qx_storage_clear_clipboard() -> Result<StorageClearResult, String> {
    let total = clear_dir_contents(&clipboard_images_dir())?;

    if total.cleared_files > 0 {
        if let Ok(conn) = rusqlite::Connection::open(clipboard_db_path()) {
            let _ = conn.execute(
                "UPDATE clipboard_history SET image_path = NULL WHERE image_path IS NOT NULL",
                [],
            );
            let _ = conn.execute(
                "UPDATE clipboard_history SET image_pasteboard_path = NULL WHERE image_pasteboard_path IS NOT NULL",
                [],
            );
        }
    }

    Ok(total)
}
