use crate::apps::AppEntry;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init(app: &tauri::AppHandle) {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let _ = RESOURCE_DIR.set(resource_dir);
    }
    init_platform();
}

pub async fn search(query: String, limit: usize) -> Vec<AppEntry> {
    let q = query.trim().to_string();
    if q.len() < 2 {
        return Vec::new();
    }

    tauri::async_runtime::spawn_blocking(move || search_platform(&q, limit))
        .await
        .unwrap_or_default()
}

fn entry_from_path(path: &str) -> AppEntry {
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
}

#[cfg(target_os = "windows")]
fn resource_bin(name: &str) -> Option<PathBuf> {
    RESOURCE_DIR
        .get()
        .map(|dir| dir.join("search").join(name))
        .filter(|path| path.exists())
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use search_cache::SearchCache;
    use search_cancel::CancellationToken;
    use std::sync::atomic::AtomicBool;

    const IGNORE_PATH: &str = "/System/Volumes/Data";
    static CARDINAL_CACHE: OnceLock<Mutex<Option<SearchCache>>> = OnceLock::new();
    static CARDINAL_READY: std::sync::atomic::AtomicBool =
        std::sync::atomic::AtomicBool::new(false);
    static NEVER_STOPPED: AtomicBool = AtomicBool::new(false);

    pub fn init_platform() {
        CARDINAL_CACHE.get_or_init(|| Mutex::new(None));
        std::thread::Builder::new()
            .name("qx-cardinal-cache".to_string())
            .spawn(|| {
                let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
                let root = PathBuf::from(home);
                let cache_path = dirs::cache_dir()
                    .unwrap_or_else(std::env::temp_dir)
                    .join("qx")
                    .join("cardinal-search-cache.zstd");
                if let Some(parent) = cache_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let ignore_paths = vec![PathBuf::from(IGNORE_PATH)];
                let include_paths = Vec::new();
                let cache = SearchCache::try_read_persistent_cache(
                    &root,
                    &cache_path,
                    &ignore_paths,
                    &include_paths,
                    &NEVER_STOPPED,
                )
                .unwrap_or_else(|_| {
                    let mut cache = SearchCache::walk_fs_with_ignore(&root, &ignore_paths);
                    let _ = cache.flush_snapshot_to_file(&cache_path);
                    cache
                });

                let store = CARDINAL_CACHE.get_or_init(|| Mutex::new(None));
                let mut guard = store
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                *guard = Some(cache);
                CARDINAL_READY.store(true, std::sync::atomic::Ordering::Release);
            })
            .ok();
    }

    pub fn search_platform(query: &str, limit: usize) -> Vec<AppEntry> {
        if CARDINAL_READY.load(std::sync::atomic::Ordering::Acquire) {
            if let Some(store) = CARDINAL_CACHE.get() {
                let mut guard = store
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if let Some(cache) = guard.as_mut() {
                    if let Ok(Some(nodes)) = cache.query_files(query, CancellationToken::noop()) {
                        return nodes
                            .into_iter()
                            .filter_map(|node| node.path.to_str().map(super::entry_from_path))
                            .take(limit)
                            .collect();
                    }
                }
            }
        }
        search_mdfind(query, limit)
    }

    fn search_mdfind(query: &str, limit: usize) -> Vec<AppEntry> {
        let output = Command::new("mdfind")
            .args([
                "-onlyin",
                &std::env::var("HOME").unwrap_or_else(|_| "/".to_string()),
                "-name",
                query,
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
            .take(limit)
            .map(super::entry_from_path)
            .collect()
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;

    pub fn init_platform() {}

    pub fn search_platform(query: &str, limit: usize) -> Vec<AppEntry> {
        let Some(es) = find_everything_cli() else {
            return Vec::new();
        };
        let output = Command::new(es)
            .args(["-n", &limit.to_string(), query])
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
            .take(limit)
            .map(super::entry_from_path)
            .collect()
    }

    fn find_everything_cli() -> Option<PathBuf> {
        if let Some(path) = resource_bin("es.exe") {
            return Some(path);
        }
        let candidates = [
            r"C:\Program Files\Everything\es.exe",
            r"C:\Program Files (x86)\Everything\es.exe",
        ];
        candidates
            .iter()
            .map(PathBuf::from)
            .find(|path| path.exists())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::*;

    pub fn init_platform() {}

    pub fn search_platform(_query: &str, _limit: usize) -> Vec<AppEntry> {
        Vec::new()
    }
}

use platform::{init_platform, search_platform};
