use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
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
    pub reclaimable_bytes: u64,
    pub cache_targets: Vec<StorageCacheTarget>,
    pub buckets: Vec<StorageBucket>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Default)]
pub struct StorageCacheTarget {
    pub id: String,
    pub module: String,
    pub label: String,
    pub description: String,
    pub paths: Vec<StoragePath>,
    pub bytes: u64,
    pub files: u64,
    pub records: u64,
    pub retention_days: Option<u32>,
}

#[derive(Debug, Serialize, Default)]
pub struct StorageClearResult {
    pub cleared_bytes: u64,
    pub cleared_files: u64,
    pub cleared_records: u64,
    pub warnings: Vec<String>,
}

fn home_dir() -> PathBuf {
    crate::paths::home_dir()
}

fn app_support_dir() -> PathBuf {
    crate::paths::data_dir()
}

fn qx_home_dir() -> PathBuf {
    crate::paths::state_dir()
}

fn icons_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        return qx_home_dir().join("icons");
    }
    #[cfg(not(target_os = "macos"))]
    {
        crate::paths::cache_dir().join("icons")
    }
}

fn rss_icons_dir() -> PathBuf {
    crate::paths::cache_dir().join("rss-icons")
}

fn plugins_dir() -> PathBuf {
    qx_home_dir().join("plugins")
}

fn plugin_data_dir() -> PathBuf {
    qx_home_dir().join("plugin-data")
}

fn ocr_models_dir() -> PathBuf {
    home_dir().join(".oar")
}

fn output_files_dir() -> PathBuf {
    crate::paths::pictures_dir().join("Qx")
}

fn screencap_db_path() -> PathBuf {
    app_support_dir().join("screencap.db")
}

fn history_db_path() -> PathBuf {
    app_support_dir().join("history.db")
}

fn rss_db_path() -> PathBuf {
    app_support_dir().join("rss.db")
}

fn clipboard_db_path() -> PathBuf {
    app_support_dir().join("clipboard.db")
}

fn clipboard_images_dir() -> PathBuf {
    app_support_dir().join("clipboard_images")
}

fn file_search_cache_paths() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        return vec![dirs::cache_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("qx")
            .join("cardinal-search-cache.zstd")];
    }
    #[cfg(target_os = "windows")]
    {
        return vec![crate::paths::cache_dir()
            .join("search")
            .join("everything-exports")];
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Vec::new()
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CacheClearMode {
    Contents,
    File,
    RemoveDirectory,
}

#[derive(Debug, Clone)]
struct CacheTargetDefinition {
    id: &'static str,
    module: &'static str,
    label: &'static str,
    paths: Vec<PathBuf>,
    mode: CacheClearMode,
}

fn cache_target_definitions() -> Vec<CacheTargetDefinition> {
    let mut targets = vec![
        CacheTargetDefinition {
            id: "application-icons",
            module: "launcher",
            label: "Application Icons",
            paths: vec![icons_dir()],
            mode: CacheClearMode::Contents,
        },
        CacheTargetDefinition {
            id: "rss-icons",
            module: "rss",
            label: "RSS Feed Icons",
            paths: vec![rss_icons_dir()],
            mode: CacheClearMode::Contents,
        },
        CacheTargetDefinition {
            id: "clipboard-previews",
            module: "clipboard",
            label: "Clipboard Previews",
            paths: vec![clipboard_images_dir().join("previews")],
            mode: CacheClearMode::Contents,
        },
        CacheTargetDefinition {
            id: "v2ex-responses",
            module: "v2ex",
            label: "V2EX Responses",
            paths: vec![crate::paths::cache_dir().join("v2ex")],
            mode: CacheClearMode::Contents,
        },
        CacheTargetDefinition {
            id: "weather-response",
            module: "weather",
            label: "Weather Response",
            paths: vec![crate::paths::cache_dir().join("weather-cache.json")],
            mode: CacheClearMode::File,
        },
        CacheTargetDefinition {
            id: "marketplace-archives",
            module: "extensions",
            label: "Marketplace Archives",
            paths: vec![crate::paths::cache_dir().join("marketplace-repos")],
            mode: CacheClearMode::Contents,
        },
        CacheTargetDefinition {
            id: "update-packages",
            module: "updater",
            label: "Update Packages",
            paths: vec![crate::paths::cache_dir().join("updates")],
            mode: CacheClearMode::Contents,
        },
        CacheTargetDefinition {
            id: "ocr-models",
            module: "ocr",
            label: "OCR Models",
            paths: vec![ocr_models_dir()],
            mode: CacheClearMode::Contents,
        },
    ];

    let search_paths = file_search_cache_paths();
    if !search_paths.is_empty() {
        targets.push(CacheTargetDefinition {
            id: "file-search-index",
            module: "file-search",
            label: "File Search Index",
            paths: search_paths,
            mode: if cfg!(target_os = "macos") {
                CacheClearMode::File
            } else {
                CacheClearMode::Contents
            },
        });
    }

    let recording_paths = recording_temp_dirs();
    targets.push(CacheTargetDefinition {
        id: "screen-capture-temp",
        module: "screen-capture",
        label: "Screen Capture Temporary Files",
        paths: recording_paths,
        mode: CacheClearMode::RemoveDirectory,
    });
    targets
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

fn measure_children_excluding(
    dir: &Path,
    excluded_names: &[&str],
    warnings: &mut Vec<String>,
) -> (u64, u64) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return (0, 0),
        Err(error) => {
            warnings.push(format!("read {}: {error}", dir.display()));
            return (0, 0);
        }
    };
    let mut bytes = 0_u64;
    let mut files = 0_u64;
    for entry in entries.flatten() {
        if entry
            .file_name()
            .to_str()
            .map(|name| excluded_names.contains(&name))
            .unwrap_or(false)
        {
            continue;
        }
        let (entry_bytes, entry_files) = measure(&entry.path(), warnings);
        bytes = bytes.saturating_add(entry_bytes);
        files = files.saturating_add(entry_files);
    }
    (bytes, files)
}

fn file_size(path: &Path) -> u64 {
    fs::symlink_metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn merge_clear_result(total: &mut StorageClearResult, result: StorageClearResult) {
    total.cleared_bytes = total.cleared_bytes.saturating_add(result.cleared_bytes);
    total.cleared_files = total.cleared_files.saturating_add(result.cleared_files);
    total.cleared_records = total.cleared_records.saturating_add(result.cleared_records);
    total.warnings.extend(result.warnings);
}

fn open_storage_db(path: &Path) -> Result<rusqlite::Connection, String> {
    let conn =
        rusqlite::Connection::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    conn.busy_timeout(Duration::from_millis(800))
        .map_err(|e| format!("configure {}: {e}", path.display()))?;
    Ok(conn)
}

fn count_query(conn: &rusqlite::Connection, sql: &str) -> u64 {
    conn.query_row(sql, [], |row| row.get::<_, i64>(0))
        .map(|count| count.max(0) as u64)
        .unwrap_or(0)
}

fn optimize_database(conn: &rusqlite::Connection, path: &Path, result: &mut StorageClearResult) {
    if let Err(e) = conn.execute_batch("PRAGMA optimize; VACUUM;") {
        result
            .warnings
            .push(format!("compact {}: {e}", path.display()));
    }
}

fn db_bytes_reclaimed(before: u64, path: &Path) -> u64 {
    before.saturating_sub(file_size(path))
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

async fn storage_io<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|e| format!("storage task failed: {e}"))?
}

#[command]
pub async fn qx_storage_overview() -> StorageOverview {
    storage_io(|| Ok(build_storage_overview()))
        .await
        .unwrap_or_else(|err| StorageOverview {
            total_bytes: 0,
            reclaimable_bytes: 0,
            cache_targets: Vec::new(),
            buckets: Vec::new(),
            warnings: vec![err],
        })
}

fn build_storage_overview() -> StorageOverview {
    let mut warnings: Vec<String> = Vec::new();

    let definitions = cache_target_definitions();
    let mut cache_targets: Vec<StorageCacheTarget> = definitions
        .iter()
        .map(|target| {
            let (bytes, files) = measure_paths(&target.paths, &mut warnings);
            StorageCacheTarget {
                id: target.id.into(),
                module: target.module.into(),
                label: target.label.into(),
                description: String::new(),
                paths: target.paths.iter().cloned().map(path_entry).collect(),
                bytes,
                files,
                records: 0,
                retention_days: None,
            }
        })
        .collect();
    let plugin_cache_definitions = crate::marketplace::registered_plugin_cache_targets();
    let plugin_cache_bytes = plugin_cache_definitions
        .iter()
        .map(|target| target.bytes)
        .sum::<u64>();
    cache_targets.extend(
        plugin_cache_definitions
            .iter()
            .map(|target| StorageCacheTarget {
                id: target.id.clone(),
                module: target.plugin_name.clone(),
                label: target.label.clone(),
                description: target.description.clone(),
                paths: vec![path_entry(target.storage_path.clone())],
                bytes: target.bytes,
                files: 0,
                records: target.records,
                retention_days: target.retention_days,
            }),
    );
    let cache_bytes = cache_targets.iter().map(|target| target.bytes).sum();
    let cache_files = cache_targets.iter().map(|target| target.files).sum();
    let cache_paths = definitions
        .iter()
        .flat_map(|target| target.paths.iter().cloned())
        .chain(
            plugin_cache_definitions
                .iter()
                .map(|target| target.storage_path.clone()),
        )
        .collect::<Vec<_>>();
    let cache = StorageBucket {
        id: "cache".into(),
        label: "Cache".into(),
        paths: cache_paths.into_iter().map(path_entry).collect(),
        bytes: cache_bytes,
        files: cache_files,
        clearable: true,
    };

    // Files: screenshot and screen-recording output folder.
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
    let (clip_bytes, clip_files) =
        measure_children_excluding(&clip_dir, &["previews"], &mut warnings);
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

    // Plugin state is durable user/plugin data, not a cache. Report it
    // separately so the cache total never hides or deletes it.
    let plugin_data_path = plugin_data_dir();
    let (plugin_data_bytes, plugin_data_files) = measure(&plugin_data_path, &mut warnings);
    let plugin_data = StorageBucket {
        id: "plugin-data".into(),
        label: "Plugin Data".into(),
        paths: vec![path_entry(plugin_data_path)],
        bytes: plugin_data_bytes.saturating_sub(plugin_cache_bytes),
        files: plugin_data_files,
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

    let buckets = vec![
        cache,
        files,
        databases,
        clipboard,
        plugins,
        plugin_data,
        settings,
    ];
    let total_bytes = buckets.iter().map(|b| b.bytes).sum();

    StorageOverview {
        total_bytes,
        reclaimable_bytes: cache_bytes,
        cache_targets,
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
    let root_meta =
        fs::symlink_metadata(path).map_err(|e| format!("stat {}: {e}", path.display()))?;
    if root_meta.file_type().is_symlink() || root_meta.is_file() {
        fs::remove_file(path).map_err(|e| format!("remove {}: {e}", path.display()))?;
        return Ok(StorageClearResult {
            cleared_bytes,
            cleared_files: cleared_files.max(1),
            warnings,
            ..StorageClearResult::default()
        });
    }

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
        warnings,
        ..StorageClearResult::default()
    })
}

fn clear_file(path: &Path) -> Result<StorageClearResult, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(StorageClearResult::default())
        }
        Err(error) => return Err(format!("stat {}: {error}", path.display())),
    };
    if meta.is_dir() && !meta.file_type().is_symlink() {
        return Err(format!(
            "refusing to remove directory as a cache file: {}",
            path.display()
        ));
    }
    let bytes = meta.len();
    fs::remove_file(path).map_err(|error| format!("remove {}: {error}", path.display()))?;
    Ok(StorageClearResult {
        cleared_bytes: bytes,
        cleared_files: 1,
        ..StorageClearResult::default()
    })
}

fn remove_cache_directory(path: &Path) -> Result<StorageClearResult, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(StorageClearResult::default())
        }
        Err(error) => return Err(format!("stat {}: {error}", path.display())),
    };
    let mut warnings = Vec::new();
    let (bytes, files) = measure(path, &mut warnings);
    if meta.file_type().is_symlink() || meta.is_file() {
        fs::remove_file(path).map_err(|error| format!("remove {}: {error}", path.display()))?;
    } else {
        fs::remove_dir_all(path).map_err(|error| format!("remove {}: {error}", path.display()))?;
    }
    Ok(StorageClearResult {
        cleared_bytes: bytes,
        cleared_files: files.max(1),
        warnings,
        ..StorageClearResult::default()
    })
}

fn validate_cache_target_path(path: &Path) -> Result<(), String> {
    let protected_roots = [
        PathBuf::from(std::path::MAIN_SEPARATOR.to_string()),
        home_dir(),
        qx_home_dir(),
        app_support_dir(),
        crate::paths::cache_dir(),
        output_files_dir(),
    ];
    if !path.is_absolute() || protected_roots.iter().any(|root| root == path) {
        return Err(format!("refusing unsafe cache target: {}", path.display()));
    }
    Ok(())
}

fn clear_cache_target_definition(
    target: &CacheTargetDefinition,
) -> Result<StorageClearResult, String> {
    let mut total = StorageClearResult::default();
    for path in &target.paths {
        validate_cache_target_path(path)?;
        let result = match target.mode {
            CacheClearMode::Contents => clear_dir_contents(path),
            CacheClearMode::File => clear_file(path),
            CacheClearMode::RemoveDirectory => remove_cache_directory(path),
        }?;
        merge_clear_result(&mut total, result);
    }
    Ok(total)
}

#[command]
pub async fn qx_storage_clear_cache_target(
    target_id: String,
) -> Result<StorageClearResult, String> {
    storage_io(move || {
        if target_id.starts_with("plugin:") {
            let result = crate::marketplace::clear_registered_plugin_cache_target(&target_id)?;
            return Ok(StorageClearResult {
                cleared_bytes: result.cleared_bytes,
                cleared_records: result.cleared_records,
                ..StorageClearResult::default()
            });
        }
        let targets = cache_target_definitions();
        let target = targets
            .iter()
            .find(|target| target.id == target_id)
            .ok_or_else(|| format!("unknown cache target: {target_id}"))?;
        clear_cache_target_definition(target)
    })
    .await
}

#[command]
pub async fn qx_storage_clear_cache() -> Result<StorageClearResult, String> {
    storage_io(clear_cache_sync).await
}

fn clear_cache_sync() -> Result<StorageClearResult, String> {
    let mut total = StorageClearResult::default();
    for target in cache_target_definitions() {
        merge_clear_result(&mut total, clear_cache_target_definition(&target)?);
    }
    let plugin_target_ids = crate::marketplace::registered_plugin_cache_targets()
        .into_iter()
        .map(|target| target.id)
        .collect::<Vec<_>>();
    for target_id in plugin_target_ids {
        let result = crate::marketplace::clear_registered_plugin_cache_target(&target_id)?;
        merge_clear_result(
            &mut total,
            StorageClearResult {
                cleared_bytes: result.cleared_bytes,
                cleared_records: result.cleared_records,
                ..StorageClearResult::default()
            },
        );
    }
    Ok(total)
}

#[command]
pub async fn qx_storage_clear_files() -> Result<StorageClearResult, String> {
    storage_io(clear_files_sync).await
}

fn clear_files_sync() -> Result<StorageClearResult, String> {
    let dir = output_files_dir();
    let mut total = StorageClearResult::default();

    let mut deleted_paths = 0_u64;
    if dir.exists() {
        for entry in fs::read_dir(&dir).map_err(|e| format!("read {}: {e}", dir.display()))? {
            let entry = entry.map_err(|e| format!("entry {}: {e}", dir.display()))?;
            let path = entry.path();
            let is_qx_file = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| {
                    matches!(
                        ext.to_ascii_lowercase().as_str(),
                        "png" | "gif" | "mp4" | "mov"
                    )
                })
                .unwrap_or(false);
            if !is_qx_file || !path.is_file() {
                continue;
            }
            let bytes = fs::symlink_metadata(&path).map(|m| m.len()).unwrap_or(0);
            fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
            total.cleared_bytes = total.cleared_bytes.saturating_add(bytes);
            total.cleared_files = total.cleared_files.saturating_add(1);
            deleted_paths = deleted_paths.saturating_add(1);
        }
    }

    let db_path = screencap_db_path();
    if db_path.exists() {
        match open_storage_db(&db_path) {
            Ok(conn) => {
                let records = count_query(&conn, "SELECT COUNT(*) FROM gif_history");
                if records > 0 {
                    let before = file_size(&db_path);
                    if let Err(e) = conn.execute("DELETE FROM gif_history", []) {
                        total.warnings.push(format!("clear screencap history: {e}"));
                    } else {
                        total.cleared_records = total.cleared_records.saturating_add(records);
                        optimize_database(&conn, &db_path, &mut total);
                        total.cleared_bytes = total
                            .cleared_bytes
                            .saturating_add(db_bytes_reclaimed(before, &db_path));
                    }
                }
            }
            Err(e) if deleted_paths > 0 => total.warnings.push(e),
            Err(_) => {}
        }
    }

    Ok(total)
}

#[command]
pub async fn qx_storage_clear_clipboard() -> Result<StorageClearResult, String> {
    storage_io(clear_clipboard_attachments_sync).await
}

fn clear_clipboard_attachments_sync() -> Result<StorageClearResult, String> {
    let mut total = clear_dir_contents(&clipboard_images_dir())?;

    let db_path = clipboard_db_path();
    if db_path.exists() {
        match open_storage_db(&db_path) {
            Ok(conn) => {
                let refs = count_query(
                    &conn,
                    "SELECT COUNT(*) FROM clipboard_history
                     WHERE image_path IS NOT NULL OR image_pasteboard_path IS NOT NULL",
                );
                if let Err(e) = conn.execute(
                    "UPDATE clipboard_history SET image_path = NULL WHERE image_path IS NOT NULL",
                    [],
                ) {
                    total
                        .warnings
                        .push(format!("reset clipboard image refs: {e}"));
                }
                if let Err(e) = conn.execute(
                    "UPDATE clipboard_history SET image_pasteboard_path = NULL WHERE image_pasteboard_path IS NOT NULL",
                    [],
                ) {
                    total
                        .warnings
                        .push(format!("reset clipboard pasteboard refs: {e}"));
                }
                total.cleared_records = total.cleared_records.saturating_add(refs);
            }
            Err(e) => total.warnings.push(e),
        }
    }

    Ok(total)
}

#[command]
pub async fn qx_storage_clear_clipboard_history() -> Result<StorageClearResult, String> {
    storage_io(clear_clipboard_history_sync).await
}

fn clear_clipboard_history_sync() -> Result<StorageClearResult, String> {
    let mut total = clear_dir_contents(&clipboard_images_dir())?;
    let db_path = clipboard_db_path();
    if !db_path.exists() {
        return Ok(total);
    }

    let conn = open_storage_db(&db_path)?;
    let records = count_query(&conn, "SELECT COUNT(*) FROM clipboard_history");
    if records == 0 {
        return Ok(total);
    }

    let before = file_size(&db_path);
    conn.execute("DELETE FROM clipboard_history", [])
        .map_err(|e| format!("clear clipboard history: {e}"))?;
    total.cleared_records = total.cleared_records.saturating_add(records);
    optimize_database(&conn, &db_path, &mut total);
    total.cleared_bytes = total
        .cleared_bytes
        .saturating_add(db_bytes_reclaimed(before, &db_path));
    Ok(total)
}

#[command]
pub async fn qx_storage_clear_launcher_history() -> Result<StorageClearResult, String> {
    storage_io(clear_launcher_history_sync).await
}

fn clear_launcher_history_sync() -> Result<StorageClearResult, String> {
    let mut total = StorageClearResult::default();
    let db_path = history_db_path();
    if !db_path.exists() {
        return Ok(total);
    }

    let conn = open_storage_db(&db_path)?;
    let records = count_query(&conn, "SELECT COUNT(*) FROM launch_history")
        .saturating_add(count_query(&conn, "SELECT COUNT(*) FROM search_history"))
        .saturating_add(count_query(
            &conn,
            "SELECT COUNT(*) FROM search_click_events",
        ));
    if records == 0 {
        return Ok(total);
    }

    let before = file_size(&db_path);
    conn.execute("DELETE FROM launch_history", [])
        .map_err(|e| format!("clear launch history: {e}"))?;
    conn.execute("DELETE FROM search_history", [])
        .map_err(|e| format!("clear search history: {e}"))?;
    // Table may be absent on very old DBs that never ran the new migration path.
    let _ = conn.execute("DELETE FROM search_click_events", []);
    total.cleared_records = records;
    optimize_database(&conn, &db_path, &mut total);
    total.cleared_bytes = db_bytes_reclaimed(before, &db_path);
    Ok(total)
}

#[command]
pub async fn qx_storage_clear_rss_cache() -> Result<StorageClearResult, String> {
    storage_io(clear_rss_cache_sync).await
}

fn clear_rss_cache_sync() -> Result<StorageClearResult, String> {
    let mut total = StorageClearResult::default();
    let db_path = rss_db_path();
    if !db_path.exists() {
        return Ok(total);
    }

    let conn = open_storage_db(&db_path)?;
    let records = count_query(
        &conn,
        "SELECT COUNT(*) FROM rss_articles WHERE is_starred = 0",
    );
    if records == 0 {
        return Ok(total);
    }

    let before = file_size(&db_path);
    conn.execute("DELETE FROM rss_articles WHERE is_starred = 0", [])
        .map_err(|e| format!("clear RSS offline articles: {e}"))?;
    total.cleared_records = records;
    optimize_database(&conn, &db_path, &mut total);
    total.cleared_bytes = db_bytes_reclaimed(before, &db_path);
    Ok(total)
}

#[command]
pub async fn qx_storage_clear_reclaimable() -> Result<StorageClearResult, String> {
    storage_io(clear_reclaimable_sync).await
}

fn clear_reclaimable_sync() -> Result<StorageClearResult, String> {
    let mut total = StorageClearResult::default();
    merge_clear_result(&mut total, clear_cache_sync()?);
    merge_clear_result(&mut total, clear_clipboard_history_sync()?);
    merge_clear_result(&mut total, clear_launcher_history_sync()?);
    merge_clear_result(&mut total, clear_rss_cache_sync()?);
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn cache_catalog_has_unique_scoped_targets() {
        let targets = cache_target_definitions();
        let mut ids = HashSet::new();
        assert!(!targets.is_empty());
        for target in targets {
            assert!(
                ids.insert(target.id),
                "duplicate cache target {}",
                target.id
            );
            for path in target.paths {
                validate_cache_target_path(&path).unwrap();
            }
        }
    }

    #[test]
    fn directory_cleanup_preserves_registered_root() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("qx-storage-test-{}-{nonce}", std::process::id()));
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("nested/cache.bin"), b"cache").unwrap();
        let result = clear_dir_contents(&root).unwrap();
        assert_eq!(result.cleared_files, 1);
        assert!(root.is_dir());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 0);
        fs::remove_dir(&root).unwrap();
    }

    #[test]
    fn protected_storage_roots_are_never_cache_targets() {
        for root in [
            home_dir(),
            qx_home_dir(),
            app_support_dir(),
            crate::paths::cache_dir(),
        ] {
            assert!(validate_cache_target_path(&root).is_err());
        }
    }
}
