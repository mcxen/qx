//! Cross-platform file-manager selection and bounded file operations.
//!
//! Finder/Explorer discovery stays below this service. Frontend modules and
//! plugins consume one immutable selection snapshot and submit operations
//! against its revision, so a stale panel can never mutate a newer selection.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
#[cfg(target_os = "windows")]
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

const MAX_SELECTION_ITEMS: usize = 512;
const MAX_ARCHIVE_ENTRIES: usize = 50_000;
const MAX_EXTRACTED_BYTES: u64 = 20 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SelectedFile {
    pub path: String,
    pub name: String,
    pub parent: String,
    pub kind: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSelectionSnapshot {
    pub revision: u64,
    pub captured_at_ms: u64,
    pub source: String,
    pub items: Vec<SelectedFile>,
    pub error: Option<String>,
}

impl Default for FileSelectionSnapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            captured_at_ms: 0,
            source: "none".to_string(),
            items: Vec::new(),
            error: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationRequest {
    pub revision: u64,
    pub operation: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationResult {
    pub operation: String,
    pub output_paths: Vec<String>,
    pub affected_count: usize,
}

#[derive(Debug, Clone, Copy)]
enum SelectionHint {
    #[cfg(target_os = "windows")]
    ExplorerWindow(isize),
    #[cfg(target_os = "macos")]
    Finder,
}

fn snapshot_store() -> &'static Mutex<FileSelectionSnapshot> {
    static STORE: OnceLock<Mutex<FileSelectionSnapshot>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(FileSelectionSnapshot::default()))
}

fn publish_snapshot(app: &AppHandle, snapshot: FileSelectionSnapshot) {
    if let Ok(mut stored) = snapshot_store().lock() {
        *stored = snapshot.clone();
    }
    let _ = app.emit("file-manager:selection", &snapshot);
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn next_revision() -> u64 {
    static REVISION: AtomicU64 = AtomicU64::new(0);
    let now = now_ms();
    let mut current = REVISION.load(Ordering::SeqCst);
    loop {
        let next = now.max(current.saturating_add(1));
        match REVISION.compare_exchange(current, next, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return next,
            Err(observed) => current = observed,
        }
    }
}

fn selection_hint() -> Option<SelectionHint> {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow};
        let window = unsafe { GetForegroundWindow() };
        if window.is_null() {
            return None;
        }
        let mut class_name = [0u16; 128];
        let length =
            unsafe { GetClassNameW(window, class_name.as_mut_ptr(), class_name.len() as i32) };
        if length <= 0 {
            return None;
        }
        let class_name = String::from_utf16_lossy(&class_name[..length as usize]);
        if matches!(class_name.as_str(), "CabinetWClass" | "ExploreWClass") {
            return Some(SelectionHint::ExplorerWindow(window as isize));
        }
        None
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSWorkspace;
        let workspace = NSWorkspace::sharedWorkspace();
        let frontmost = workspace.frontmostApplication()?;
        let bundle_id = frontmost.bundleIdentifier()?;
        (bundle_id.to_string() == "com.apple.finder").then_some(SelectionHint::Finder)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

/// Snapshot the file-manager context before Qx takes foreground focus.
/// Discovery runs off the UI thread; callers continue showing the panel.
pub(crate) fn capture_before_summon(app: &AppHandle) {
    static CAPTURE_GENERATION: AtomicU64 = AtomicU64::new(0);
    let generation = CAPTURE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let Some(hint) = selection_hint() else {
        // Qx itself or another non-file-manager app is in front. Preserve the
        // most recent immutable selection instead of erasing the context while
        // the user switches between File Actions and QxPreview.
        return;
    };
    let app = app.clone();
    std::thread::spawn(move || {
        let next = capture_selection(hint);
        if CAPTURE_GENERATION.load(Ordering::SeqCst) == generation {
            publish_snapshot(&app, next);
        }
    });
}

fn selected_file(path: PathBuf) -> Option<SelectedFile> {
    if !path.is_absolute() {
        return None;
    }
    let name = path.file_name()?.to_string_lossy().to_string();
    let parent = path.parent()?.display().to_string();
    let metadata = fs::symlink_metadata(&path).ok();
    let kind = match metadata.as_ref() {
        Some(metadata) if metadata.is_dir() => "folder",
        Some(metadata) if metadata.file_type().is_symlink() => "symlink",
        _ => "file",
    };
    Some(SelectedFile {
        path: path.display().to_string(),
        name,
        parent,
        kind: kind.to_string(),
        exists: metadata.is_some(),
    })
}

fn build_snapshot(
    source: &str,
    paths: Vec<PathBuf>,
    error: Option<String>,
) -> FileSelectionSnapshot {
    let mut seen = std::collections::HashSet::new();
    let items = paths
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        .take(MAX_SELECTION_ITEMS)
        .filter_map(selected_file)
        .collect();
    FileSelectionSnapshot {
        revision: next_revision(),
        captured_at_ms: now_ms(),
        source: source.to_string(),
        items,
        error,
    }
}

#[cfg(target_os = "windows")]
fn capture_selection(hint: SelectionHint) -> FileSelectionSnapshot {
    use std::process::Command;
    let SelectionHint::ExplorerWindow(hwnd) = hint;
    let script = format!(
        r#"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $target=[int64]{hwnd}; $shell=New-Object -ComObject Shell.Application; $window=@($shell.Windows()) | Where-Object {{ [int64]$_.HWND -eq $target }} | Select-Object -First 1; if ($null -eq $window) {{ '[]'; exit 0 }}; ConvertTo-Json -Compress -InputObject @($window.Document.SelectedItems() | ForEach-Object {{ $_.Path }})"#
    );
    let mut command = Command::new(crate::windows_process::powershell_binary());
    command.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    match crate::windows_process::output_with_timeout(&mut command, Duration::from_secs(3)) {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            match serde_json::from_str::<Vec<String>>(stdout.trim()) {
                Ok(paths) => build_snapshot(
                    "explorer",
                    paths.into_iter().map(PathBuf::from).collect(),
                    None,
                ),
                Err(error) => build_snapshot(
                    "explorer",
                    Vec::new(),
                    Some(format!("parse Explorer selection: {error}")),
                ),
            }
        }
        Ok(output) => build_snapshot(
            "explorer",
            Vec::new(),
            Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        ),
        Err(error) => build_snapshot(
            "explorer",
            Vec::new(),
            Some(format!("read Explorer selection: {error}")),
        ),
    }
}

#[cfg(target_os = "macos")]
fn capture_selection(_hint: SelectionHint) -> FileSelectionSnapshot {
    use std::process::Command;
    let script = r#"const finder=Application('Finder'); JSON.stringify(finder.selection().map(item => item.url()));"#;
    match Command::new("osascript")
        .args(["-l", "JavaScript", "-e", script])
        .output()
    {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            match serde_json::from_str::<Vec<String>>(stdout.trim()) {
                Ok(urls) => {
                    let paths = urls
                        .into_iter()
                        .filter_map(|value| url::Url::parse(&value).ok())
                        .filter_map(|value| value.to_file_path().ok())
                        .collect();
                    build_snapshot("finder", paths, None)
                }
                Err(error) => build_snapshot(
                    "finder",
                    Vec::new(),
                    Some(format!("parse Finder selection: {error}")),
                ),
            }
        }
        Ok(output) => build_snapshot(
            "finder",
            Vec::new(),
            Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        ),
        Err(error) => build_snapshot(
            "finder",
            Vec::new(),
            Some(format!("read Finder selection: {error}")),
        ),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn capture_selection(_hint: SelectionHint) -> FileSelectionSnapshot {
    build_snapshot(
        "unsupported",
        Vec::new(),
        Some("file-manager selection is only supported on macOS and Windows".to_string()),
    )
}

#[tauri::command]
pub fn file_manager_get_selection() -> FileSelectionSnapshot {
    snapshot_store()
        .lock()
        .map(|snapshot| snapshot.clone())
        .unwrap_or_default()
}

fn validate_leaf_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." {
        return Err("name must not be empty, . or ..".to_string());
    }
    if name.contains('/')
        || name.contains(char::from(92))
        || name.contains(char::from(0))
        || name.chars().any(char::is_control)
    {
        return Err(
            "name must be one file name without separators or control characters".to_string(),
        );
    }
    #[cfg(target_os = "windows")]
    {
        if name.contains(['<', '>', ':', '"', '|', '?', '*']) || name.ends_with(['.', ' ']) {
            return Err("name contains characters Windows does not allow".to_string());
        }
        let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
        if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && stem[3..].parse::<u8>().is_ok())
        {
            return Err("name is reserved by Windows".to_string());
        }
    }
    Ok(name)
}

pub(crate) fn selection_for_revision(revision: u64) -> Result<FileSelectionSnapshot, String> {
    let snapshot = snapshot_store()
        .lock()
        .map_err(|_| "file selection store is unavailable".to_string())?
        .clone();
    if revision == 0 || revision != snapshot.revision {
        return Err("file selection changed; reopen the module and try again".to_string());
    }
    if snapshot.items.is_empty() {
        return Err("no files or folders are selected".to_string());
    }
    Ok(snapshot)
}

pub(crate) fn selected_path_for_preview(revision: u64, index: usize) -> Result<PathBuf, String> {
    let snapshot = selection_for_revision(revision)?;
    let item = snapshot
        .items
        .get(index)
        .ok_or_else(|| "selected item is no longer available".to_string())?;
    let path = PathBuf::from(&item.path);
    if !path.exists() {
        return Err(format!(
            "selected item no longer exists: {}",
            path.display()
        ));
    }
    Ok(path)
}

fn selected_paths(snapshot: &FileSelectionSnapshot) -> Result<Vec<PathBuf>, String> {
    snapshot
        .items
        .iter()
        .map(|item| {
            let path = PathBuf::from(&item.path);
            if !path.exists() {
                Err(format!(
                    "selected item no longer exists: {}",
                    path.display()
                ))
            } else {
                Ok(path)
            }
        })
        .collect()
}

fn common_parent(paths: &[PathBuf]) -> Result<PathBuf, String> {
    let parent = paths
        .first()
        .and_then(|path| path.parent())
        .ok_or_else(|| "selected item has no parent folder".to_string())?;
    if paths.iter().all(|path| path.parent() == Some(parent)) {
        Ok(parent.to_path_buf())
    } else {
        Err("selected items must be in the same folder for this operation".to_string())
    }
}

fn ensure_available(path: &Path) -> Result<(), String> {
    if path.exists() {
        Err(format!("destination already exists: {}", path.display()))
    } else {
        Ok(())
    }
}

fn rename_selected(
    paths: &[PathBuf],
    requested_path: Option<&str>,
    name: &str,
) -> Result<Vec<PathBuf>, String> {
    if paths.len() != 1 {
        return Err("rename requires exactly one selected item".to_string());
    }
    let source = &paths[0];
    if requested_path.is_some_and(|value| Path::new(value) != source) {
        return Err("rename target is not part of the current selection".to_string());
    }
    let target = source
        .parent()
        .ok_or_else(|| "selected item has no parent folder".to_string())?
        .join(validate_leaf_name(name)?);
    ensure_available(&target)?;
    fs::rename(source, &target).map_err(|error| format!("rename {}: {error}", source.display()))?;
    Ok(vec![target])
}

fn collect_selected(paths: &[PathBuf], name: &str) -> Result<Vec<PathBuf>, String> {
    let parent = common_parent(paths)?;
    let target_dir = parent.join(validate_leaf_name(name)?);
    ensure_available(&target_dir)?;
    let plans = paths
        .iter()
        .map(|source| {
            let file_name = source
                .file_name()
                .ok_or_else(|| format!("invalid selected path: {}", source.display()))?;
            Ok((source.clone(), target_dir.join(file_name)))
        })
        .collect::<Result<Vec<_>, String>>()?;
    fs::create_dir(&target_dir)
        .map_err(|error| format!("create folder {}: {error}", target_dir.display()))?;
    let mut moved = Vec::new();
    for (source, target) in &plans {
        if let Err(error) = fs::rename(source, target) {
            for (original, moved_target) in moved.iter().rev() {
                let _ = fs::rename(moved_target, original);
            }
            let _ = fs::remove_dir(&target_dir);
            return Err(format!("move {}: {error}", source.display()));
        }
        moved.push((source.clone(), target.clone()));
    }
    Ok(vec![target_dir])
}

fn add_path_to_zip<W: Write + Seek>(
    writer: &mut zip::ZipWriter<W>,
    source: &Path,
    archive_path: &Path,
    entry_count: &mut usize,
) -> Result<(), String> {
    *entry_count = entry_count.saturating_add(1);
    if *entry_count > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "selection contains more than {MAX_ARCHIVE_ENTRIES} archive entries"
        ));
    }
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("inspect {}: {error}", source.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "symbolic links are not archived: {}",
            source.display()
        ));
    }
    let name = archive_path.to_string_lossy().replace('\\', "/");
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(if metadata.is_dir() { 0o755 } else { 0o644 });
    if metadata.is_dir() {
        writer
            .add_directory(format!("{}/", name.trim_end_matches('/')), options)
            .map_err(|error| format!("add ZIP folder: {error}"))?;
        let mut entries = fs::read_dir(source)
            .map_err(|error| format!("read folder {}: {error}", source.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read folder {}: {error}", source.display()))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            add_path_to_zip(
                writer,
                &entry.path(),
                &archive_path.join(entry.file_name()),
                entry_count,
            )?;
        }
    } else {
        writer
            .start_file(name, options)
            .map_err(|error| format!("add ZIP file: {error}"))?;
        let mut input = fs::File::open(source)
            .map_err(|error| format!("open {}: {error}", source.display()))?;
        std::io::copy(&mut input, writer)
            .map_err(|error| format!("compress {}: {error}", source.display()))?;
    }
    Ok(())
}

fn compress_selected(paths: &[PathBuf], name: &str) -> Result<Vec<PathBuf>, String> {
    let parent = common_parent(paths)?;
    let mut archive_name = validate_leaf_name(name)?.to_string();
    if !archive_name.to_ascii_lowercase().ends_with(".zip") {
        archive_name.push_str(".zip");
    }
    let target = parent.join(archive_name);
    ensure_available(&target)?;
    let file = fs::File::create(&target)
        .map_err(|error| format!("create {}: {error}", target.display()))?;
    let mut writer = zip::ZipWriter::new(file);
    let mut entry_count = 0;
    let result = paths.iter().try_for_each(|path| {
        let name = path
            .file_name()
            .ok_or_else(|| format!("invalid selected path: {}", path.display()))?;
        add_path_to_zip(&mut writer, path, Path::new(name), &mut entry_count)
    });
    if let Err(error) = result.and_then(|_| {
        writer
            .finish()
            .map(|_| ())
            .map_err(|error| format!("finish ZIP: {error}"))
    }) {
        let _ = fs::remove_file(&target);
        return Err(error);
    }
    Ok(vec![target])
}

fn extract_one_zip(source: &Path) -> Result<PathBuf, String> {
    if source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("zip"))
        != Some(true)
    {
        return Err(format!(
            "only ZIP archives are supported: {}",
            source.display()
        ));
    }
    let parent = source
        .parent()
        .ok_or_else(|| "archive has no parent folder".to_string())?;
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Archive");
    let target = parent.join(validate_leaf_name(stem)?);
    ensure_available(&target)?;
    let file =
        fs::File::open(source).map_err(|error| format!("open {}: {error}", source.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("read ZIP {}: {error}", source.display()))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "archive has more than {MAX_ARCHIVE_ENTRIES} entries"
        ));
    }
    let total = (0..archive.len()).try_fold(0u64, |sum, index| {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("read ZIP entry: {error}"))?;
        sum.checked_add(entry.size())
            .ok_or_else(|| "archive size overflow".to_string())
    })?;
    if total > MAX_EXTRACTED_BYTES {
        return Err("archive expands beyond the 20 GiB safety limit".to_string());
    }
    fs::create_dir(&target).map_err(|error| format!("create {}: {error}", target.display()))?;
    let extract_result = (0..archive.len()).try_for_each(|index| -> Result<(), String> {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("read ZIP entry: {error}"))?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| format!("unsafe ZIP path: {}", entry.name()))?
            .to_path_buf();
        let mode = entry.unix_mode().unwrap_or_default();
        if mode & 0o170000 == 0o120000 {
            return Err(format!(
                "symbolic link ZIP entry is not allowed: {}",
                entry.name()
            ));
        }
        let output = target.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&output)
                .map_err(|error| format!("create {}: {error}", output.display()))?;
        } else {
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("create {}: {error}", parent.display()))?;
            }
            let mut file = fs::File::create(&output)
                .map_err(|error| format!("create {}: {error}", output.display()))?;
            std::io::copy(&mut entry, &mut file)
                .map_err(|error| format!("extract {}: {error}", output.display()))?;
        }
        Ok(())
    });
    if let Err(error) = extract_result {
        let _ = fs::remove_dir_all(&target);
        return Err(error);
    }
    Ok(target)
}

fn extract_selected(paths: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    let mut outputs = Vec::new();
    for path in paths {
        match extract_one_zip(path) {
            Ok(output) => outputs.push(output),
            Err(error) => {
                for output in outputs.iter().rev() {
                    let _ = fs::remove_dir_all(output);
                }
                return Err(error);
            }
        }
    }
    Ok(outputs)
}

fn perform_operation(request: FileOperationRequest) -> Result<FileOperationResult, String> {
    let snapshot = selection_for_revision(request.revision)?;
    let paths = selected_paths(&snapshot)?;
    let outputs = match request.operation.as_str() {
        "rename" => rename_selected(
            &paths,
            request.path.as_deref(),
            request.name.as_deref().unwrap_or(""),
        )?,
        "collect" => collect_selected(&paths, request.name.as_deref().unwrap_or(""))?,
        "compress" => compress_selected(&paths, request.name.as_deref().unwrap_or(""))?,
        "extract" => extract_selected(&paths)?,
        _ => return Err("operation must be rename, collect, compress, or extract".to_string()),
    };
    let output_paths = outputs
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>();
    Ok(FileOperationResult {
        operation: request.operation,
        output_paths,
        affected_count: paths.len(),
    })
}

#[tauri::command]
pub async fn file_manager_perform_operation(
    app: AppHandle,
    request: FileOperationRequest,
) -> Result<FileOperationResult, String> {
    let result = tauri::async_runtime::spawn_blocking(move || perform_operation(request))
        .await
        .map_err(|error| format!("file operation task failed: {error}"))??;
    let next = build_snapshot(
        "operation",
        result.output_paths.iter().map(PathBuf::from).collect(),
        None,
    );
    publish_snapshot(&app, next);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{
        collect_selected, compress_selected, extract_one_zip, rename_selected, validate_leaf_name,
        FileOperationRequest,
    };
    use std::io::Write;
    use std::path::PathBuf;

    fn test_dir(label: &str) -> PathBuf {
        let nonce = super::now_ms();
        let path = std::env::temp_dir().join(format!(
            "qx-file-manager-{label}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir(&path).expect("create test dir");
        path
    }

    #[test]
    fn leaf_names_reject_traversal_and_separators() {
        for name in ["", ".", "..", "../escape", "a/b", "a\\b", "bad\0name"] {
            assert!(validate_leaf_name(name).is_err(), "accepted {name:?}");
        }
        assert_eq!(validate_leaf_name("Archive 2026"), Ok("Archive 2026"));
    }

    #[test]
    fn operation_request_uses_camel_case_contract() {
        let request: FileOperationRequest = serde_json::from_value(serde_json::json!({
            "revision": 42,
            "operation": "compress",
            "name": "Bundle.zip"
        }))
        .expect("request");
        assert_eq!(request.revision, 42);
        assert_eq!(request.operation, "compress");
    }

    #[test]
    fn rename_and_collect_keep_operations_inside_the_common_parent() {
        let root = test_dir("rename-collect");
        let first = root.join("first.txt");
        let second = root.join("second.txt");
        std::fs::write(&first, b"first").expect("first");
        std::fs::write(&second, b"second").expect("second");

        let renamed = rename_selected(&[first], None, "renamed.txt")
            .expect("rename")
            .remove(0);
        let collected = collect_selected(&[renamed, second], "Bundle")
            .expect("collect")
            .remove(0);
        assert_eq!(collected, root.join("Bundle"));
        assert_eq!(
            std::fs::read(collected.join("renamed.txt")).expect("renamed"),
            b"first"
        );
        assert_eq!(
            std::fs::read(collected.join("second.txt")).expect("second"),
            b"second"
        );
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn zip_round_trip_preserves_files_and_folders() {
        let root = test_dir("round-trip");
        let folder = root.join("folder");
        std::fs::create_dir(&folder).expect("folder");
        std::fs::write(root.join("hello.txt"), b"hello").expect("file");
        std::fs::write(folder.join("nested.txt"), b"nested").expect("nested");

        let archive = compress_selected(&[root.join("hello.txt"), folder], "bundle.zip")
            .expect("compress")
            .remove(0);
        let extracted = extract_one_zip(&archive).expect("extract");
        assert_eq!(
            std::fs::read(extracted.join("hello.txt")).expect("hello"),
            b"hello"
        );
        assert_eq!(
            std::fs::read(extracted.join("folder").join("nested.txt")).expect("nested"),
            b"nested"
        );
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn extraction_rejects_parent_traversal() {
        let root = test_dir("zip-slip");
        let archive_path = root.join("malicious.zip");
        let file = std::fs::File::create(&archive_path).expect("archive");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("../outside.txt", zip::write::SimpleFileOptions::default())
            .expect("entry");
        writer.write_all(b"blocked").expect("contents");
        writer.finish().expect("finish");

        assert!(extract_one_zip(&archive_path).is_err());
        assert!(!root.parent().expect("parent").join("outside.txt").exists());
        std::fs::remove_dir_all(root).expect("cleanup");
    }
}
