use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::command;

#[derive(Debug, Serialize)]
pub struct StorageBucket {
    pub id: String,
    pub label: String,
    pub path: String,
    pub bytes: u64,
    pub files: u64,
    pub clearable: bool,
}

#[derive(Debug, Serialize)]
pub struct StorageOverview {
    pub total_bytes: u64,
    pub buckets: Vec<StorageBucket>,
}

#[derive(Debug, Serialize)]
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
    home_dir().join("Library/Application Support/qx")
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
    dirs::data_dir()
        .unwrap_or_else(|| home_dir().join("Library/Application Support"))
        .join("qx")
        .join("screencap.db")
}

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

fn directory_size(path: &Path) -> (u64, u64) {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return (0, 0);
    };

    if metadata.is_file() {
        return (metadata.len(), 1);
    }
    if !metadata.is_dir() {
        return (0, 0);
    }

    let mut bytes = 0_u64;
    let mut files = 0_u64;
    let Ok(entries) = fs::read_dir(path) else {
        return (0, 0);
    };
    for entry in entries.flatten() {
        let child = entry.path();
        let (child_bytes, child_files) = directory_size(&child);
        bytes = bytes.saturating_add(child_bytes);
        files = files.saturating_add(child_files);
    }
    (bytes, files)
}

fn bucket(id: &str, label: &str, path: PathBuf, clearable: bool) -> StorageBucket {
    let (bytes, files) = directory_size(&path);
    StorageBucket {
        id: id.to_string(),
        label: label.to_string(),
        path: path.to_string_lossy().to_string(),
        bytes,
        files,
        clearable,
    }
}

fn cache_bucket() -> StorageBucket {
    let icon_path = icons_dir();
    let ocr_path = ocr_models_dir();
    let mut bytes = 0_u64;
    let mut files = 0_u64;
    for path in std::iter::once(icon_path)
        .chain(std::iter::once(ocr_path))
        .chain(recording_temp_dirs())
    {
        let (path_bytes, path_files) = directory_size(&path);
        bytes = bytes.saturating_add(path_bytes);
        files = files.saturating_add(path_files);
    }
    StorageBucket {
        id: "cache".to_string(),
        label: "Cache".to_string(),
        path: "~/.qx/icons, ~/.oar, temp recordings".to_string(),
        bytes,
        files,
        clearable: true,
    }
}

#[command]
pub fn qx_storage_overview() -> StorageOverview {
    let cache = cache_bucket();
    let files = bucket("files", "Files", output_files_dir(), true);
    let databases = bucket("databases", "Databases", app_support_dir(), false);
    let plugins = bucket("plugins", "Plugins", plugins_dir(), false);
    let mut settings = bucket("settings", "Settings", qx_home_dir(), false);
    let (icon_bytes, icon_files) = directory_size(&icons_dir());
    settings.bytes = settings
        .bytes
        .saturating_sub(icon_bytes)
        .saturating_sub(plugins.bytes);
    settings.files = settings
        .files
        .saturating_sub(icon_files)
        .saturating_sub(plugins.files);

    let buckets = vec![cache, files, databases, plugins, settings];
    let total_bytes = buckets.iter().map(|bucket| bucket.bytes).sum();
    StorageOverview {
        total_bytes,
        buckets,
    }
}

fn remove_dir_contents(path: &Path) -> Result<StorageClearResult, String> {
    let (cleared_bytes, cleared_files) = directory_size(path);
    if !path.exists() {
        return Ok(StorageClearResult {
            cleared_bytes: 0,
            cleared_files: 0,
        });
    }
    for entry in fs::read_dir(path).map_err(|e| format!("read {}: {e}", path.display()))? {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let child = entry.path();
        if child.is_dir() {
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
    let mut cleared_bytes = 0_u64;
    let mut cleared_files = 0_u64;

    for path in [icons_dir(), ocr_models_dir()] {
        let result = remove_dir_contents(&path)?;
        cleared_bytes = cleared_bytes.saturating_add(result.cleared_bytes);
        cleared_files = cleared_files.saturating_add(result.cleared_files);
    }
    for path in recording_temp_dirs() {
        let (path_bytes, path_files) = directory_size(&path);
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
        }
        cleared_bytes = cleared_bytes.saturating_add(path_bytes);
        cleared_files = cleared_files.saturating_add(path_files);
    }

    Ok(StorageClearResult {
        cleared_bytes,
        cleared_files,
    })
}

#[command]
pub fn qx_storage_clear_files() -> Result<StorageClearResult, String> {
    let dir = output_files_dir();
    let mut cleared_bytes = 0_u64;
    let mut cleared_files = 0_u64;

    if !dir.exists() {
        return Ok(StorageClearResult {
            cleared_bytes,
            cleared_files,
        });
    }

    for entry in fs::read_dir(&dir).map_err(|e| format!("read {}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| format!("read entry: {e}"))?;
        let path = entry.path();
        let is_qx_file = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "png" | "gif"))
            .unwrap_or(false);
        if !is_qx_file || !path.is_file() {
            continue;
        }
        let (path_bytes, path_files) = directory_size(&path);
        fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
        cleared_bytes = cleared_bytes.saturating_add(path_bytes);
        cleared_files = cleared_files.saturating_add(path_files);
    }

    if cleared_files > 0 {
        if let Ok(conn) = rusqlite::Connection::open(screencap_db_path()) {
            let _ = conn.execute("DELETE FROM gif_history", []);
        }
    }

    Ok(StorageClearResult {
        cleared_bytes,
        cleared_files,
    })
}
