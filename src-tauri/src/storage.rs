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
    pub buckets: Vec<StorageBucket>,
    pub warnings: Vec<String>,
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
    qx_home_dir().join("icons")
}

fn plugins_dir() -> PathBuf {
    qx_home_dir().join("plugins")
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
            buckets: Vec::new(),
            warnings: vec![err],
        })
}

fn build_storage_overview() -> StorageOverview {
    let mut warnings: Vec<String> = Vec::new();

    // Cache: icons + OCR models + update staging + temp recordings (multi-path).
    let mut cache_paths: Vec<PathBuf> = vec![
        icons_dir(),
        ocr_models_dir(),
        qx_home_dir().join("cache").join("updates"),
    ];
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
        warnings,
        ..StorageClearResult::default()
    })
}

#[command]
pub async fn qx_storage_clear_cache() -> Result<StorageClearResult, String> {
    storage_io(clear_cache_sync).await
}

fn clear_cache_sync() -> Result<StorageClearResult, String> {
    let mut total = StorageClearResult::default();

    for path in [icons_dir(), ocr_models_dir()] {
        let r = clear_dir_contents(&path)?;
        total.cleared_bytes = total.cleared_bytes.saturating_add(r.cleared_bytes);
        total.cleared_files = total.cleared_files.saturating_add(r.cleared_files);
        total.warnings.extend(r.warnings);
    }
    for path in recording_temp_dirs() {
        let mut warnings: Vec<String> = Vec::new();
        let (b, f) = measure(&path, &mut warnings);
        if path.exists() {
            fs::remove_dir_all(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
        }
        total.cleared_bytes = total.cleared_bytes.saturating_add(b);
        total.cleared_files = total.cleared_files.saturating_add(f);
        total.warnings.extend(warnings);
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
