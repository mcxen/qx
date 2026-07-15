use crate::apps::AppEntry;
#[cfg(target_os = "macos")]
use fswalk::NodeFileType;
use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "macos")]
use std::sync::Mutex;
use std::sync::OnceLock;
use tauri::Manager;

static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init(app: &tauri::AppHandle) {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let _ = RESOURCE_DIR.set(resource_dir);
    }
    init_platform();
}

pub async fn search(query: String, limit: usize) -> Vec<AppEntry> {
    let Some(q) = normalize_query(&query) else {
        return Vec::new();
    };

    tauri::async_runtime::spawn_blocking(move || search_platform(&q, limit))
        .await
        .unwrap_or_default()
}

fn normalize_query(query: &str) -> Option<String> {
    let normalized = query.split_whitespace().collect::<Vec<_>>().join(" ");
    (normalized.chars().count() >= 2).then_some(normalized)
}

fn entry_from_path(path: &str) -> AppEntry {
    entry_from_path_with_kind(path, PathBuf::from(path).is_dir())
}

fn entry_from_path_with_kind(path: &str, is_dir: bool) -> AppEntry {
    let path_buf = PathBuf::from(path);
    let name = path_buf
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string();
    AppEntry {
        name: name.clone(),
        display_name: name,
        path: path.to_string(),
        icon: if is_dir {
            "builtin:folder".to_string()
        } else {
            "builtin:file".to_string()
        },
        kind: if is_dir {
            "folder".to_string()
        } else {
            "file".to_string()
        },
        aliases: String::new(),
    }
}

#[cfg(target_os = "windows")]
fn resource_bin(name: &str) -> Option<PathBuf> {
    let dir = RESOURCE_DIR.get()?;
    [
        dir.join("search").join(name),
        dir.join("resources").join("search").join(name),
    ]
    .into_iter()
    .find(|path| path.exists())
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use search_cache::SearchCache;
    use search_cancel::CancellationToken;
    use std::cmp::Reverse;
    use std::collections::HashMap;
    use std::sync::atomic::AtomicBool;

    const IGNORE_PATH: &str = "/System/Volumes/Data";
    static CARDINAL_CACHE: OnceLock<Mutex<Option<SearchCache>>> = OnceLock::new();
    static CARDINAL_READY: std::sync::atomic::AtomicBool =
        std::sync::atomic::AtomicBool::new(false);
    static NEVER_STOPPED: AtomicBool = AtomicBool::new(false);

    fn cardinal_queries(query: &str) -> Vec<String> {
        let lower = query.to_ascii_lowercase();
        let has_type_filter = [
            "file:",
            "files:",
            "folder:",
            "folders:",
            "dir:",
            "directory:",
            "type:",
            "ext:",
            "name:",
            "path:",
            "parent:",
            "infolder:",
            "size:",
            "dm:",
            "dc:",
            "content:",
            "regex:",
            "tag:",
        ]
        .iter()
        .any(|prefix| lower.contains(prefix));
        if has_type_filter {
            return vec![query.to_string()];
        }

        let quoted = query.replace('"', "\"\"");
        let mut queries = vec![format!(r#"name:"{quoted}""#), query.to_string()];
        if query.contains(' ') {
            queries.push(format!(r#""{quoted}""#));
        }
        queries.push(format!(r#"{query} | folder:"{quoted}""#));
        queries.dedup();
        queries
    }

    fn relevance_rank(path: &std::path::Path, query: &str) -> u8 {
        let needle = query.to_ascii_lowercase();
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if file_name == needle {
            0
        } else if stem == needle {
            1
        } else if file_name.starts_with(&needle) {
            2
        } else if file_name
            .split(|character: char| !character.is_alphanumeric())
            .any(|part| part.starts_with(&needle))
        {
            3
        } else if file_name.contains(&needle) {
            4
        } else if path
            .to_string_lossy()
            .to_ascii_lowercase()
            .contains(&needle)
        {
            5
        } else {
            6
        }
    }

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
                    let mut candidates: HashMap<PathBuf, (bool, u64, usize)> = HashMap::new();
                    let candidate_limit = limit.saturating_mul(100).max(200);
                    for (strategy_rank, cardinal_query) in
                        cardinal_queries(query).into_iter().enumerate()
                    {
                        let Ok(Some(nodes)) =
                            cache.query_files(&cardinal_query, CancellationToken::noop())
                        else {
                            continue;
                        };
                        for node in nodes.into_iter().take(candidate_limit) {
                            let is_dir = node.metadata.file_type_hint() == NodeFileType::Dir;
                            let modified = node
                                .metadata
                                .as_ref()
                                .and_then(|metadata| metadata.mtime())
                                .map(|value| u64::from(value.get()))
                                .unwrap_or(0);
                            candidates
                                .entry(node.path)
                                .and_modify(|current| {
                                    current.1 = current.1.max(modified);
                                    current.2 = current.2.min(strategy_rank);
                                })
                                .or_insert((is_dir, modified, strategy_rank));
                        }
                    }
                    if !candidates.is_empty() {
                        let mut ranked = candidates.into_iter().collect::<Vec<_>>();
                        ranked.sort_by_key(|(path, (is_dir, modified, strategy_rank))| {
                            (
                                relevance_rank(path, query),
                                *is_dir as u8,
                                Reverse(*modified),
                                *strategy_rank,
                                path.as_os_str().len(),
                            )
                        });
                        return ranked
                            .into_iter()
                            .filter_map(|(path, (is_dir, _, _))| {
                                path.to_str()
                                    .map(|path| super::entry_from_path_with_kind(path, is_dir))
                            })
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

    #[cfg(test)]
    mod tests {
        use super::{cardinal_queries, relevance_rank};
        use std::path::Path;

        #[test]
        fn cardinal_uses_multiple_recall_strategies_for_plain_queries() {
            let queries = cardinal_queries("project notes");
            assert!(queries.len() >= 3);
            assert_eq!(
                cardinal_queries("ext:pdf report"),
                vec!["ext:pdf report".to_string()]
            );
        }

        #[test]
        fn exact_file_names_rank_before_fuzzy_paths() {
            assert!(
                relevance_rank(Path::new("/tmp/report.pdf"), "report.pdf")
                    < relevance_rank(Path::new("/tmp/report-backup.pdf"), "report.pdf")
            );
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::collections::HashMap;
    use std::ffi::OsStr;
    use std::os::windows::process::CommandExt;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    const EVERYTHING_INSTANCE: &str = "Qx";
    const CACHE_TTL: Duration = Duration::from_secs(20);
    static EVERYTHING_READY: AtomicBool = AtomicBool::new(false);
    static QUERY_CACHE: OnceLock<Mutex<HashMap<String, (Instant, Vec<AppEntry>)>>> =
        OnceLock::new();

    fn background_command(program: impl AsRef<OsStr>) -> Command {
        let mut command = Command::new(program);
        // Qx is a GUI helper. Console-based sidecars such as es.exe must never
        // surface a terminal window while the user types a search query.
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }

    pub fn init_platform() {
        QUERY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        std::thread::Builder::new()
            .name("qx-everything-cache".to_string())
            .spawn(|| {
                let Some(everything) = find_everything_engine() else {
                    return;
                };
                let _ = background_command(everything)
                    .args([
                        "-instance",
                        EVERYTHING_INSTANCE,
                        "-startup",
                        "-app-data",
                        "-no-update-notification",
                    ])
                    .spawn();

                // Everything builds and persists its own filesystem database in
                // the background. Probe IPC without holding up Tauri setup.
                for _ in 0..60 {
                    if query_everything("qx-ready-probe", 1).is_some() {
                        EVERYTHING_READY.store(true, Ordering::Release);
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
            })
            .ok();
    }

    pub fn search_platform(query: &str, limit: usize) -> Vec<AppEntry> {
        let cache_key = format!("{limit}\0{}", query.to_lowercase());
        if EVERYTHING_READY.load(Ordering::Acquire) {
            if let Some(cache) = QUERY_CACHE.get() {
                let guard = cache
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if let Some((created, results)) = guard.get(&cache_key) {
                    if created.elapsed() <= CACHE_TTL {
                        return results.clone();
                    }
                }
            }
        }

        // A query can also make progress while the initial readiness probe is
        // running. ES returns immediately when IPC is unavailable.
        let results = query_everything(query, limit).unwrap_or_default();
        if !results.is_empty() {
            EVERYTHING_READY.store(true, Ordering::Release);
        }
        if EVERYTHING_READY.load(Ordering::Acquire) {
            if let Some(cache) = QUERY_CACHE.get() {
                let mut guard = cache
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                guard.retain(|_, (created, _)| created.elapsed() <= CACHE_TTL);
                guard.insert(cache_key, (Instant::now(), results.clone()));
            }
        }
        results
    }

    fn query_everything(query: &str, limit: usize) -> Option<Vec<AppEntry>> {
        let es = find_everything_cli()?;
        let output = background_command(es)
            .args([
                "-instance",
                EVERYTHING_INSTANCE,
                "-n",
                &limit.to_string(),
                "-utf8",
                query,
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }

        Some(
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|line| !line.trim().is_empty())
                .take(limit)
                .map(super::entry_from_path)
                .collect(),
        )
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

    fn find_everything_engine() -> Option<PathBuf> {
        if let Some(path) = resource_bin("everything.exe") {
            return Some(path);
        }
        [
            r"C:\Program Files\Everything\Everything.exe",
            r"C:\Program Files (x86)\Everything\Everything.exe",
        ]
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

#[cfg(test)]
mod tests {
    use super::normalize_query;

    #[test]
    fn file_queries_ignore_blank_and_collapse_whitespace() {
        assert_eq!(normalize_query("   "), None);
        assert_eq!(normalize_query(" a "), None);
        assert_eq!(
            normalize_query("  project   notes  ").as_deref(),
            Some("project notes")
        );
    }
}
