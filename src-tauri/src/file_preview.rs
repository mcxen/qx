//! Bounded, snapshot-scoped file reads for the File Actions quick preview.
//!
//! The WebView never receives a general filesystem capability. Every request
//! must identify one item in the current immutable file-manager snapshot.

use serde::Serialize;
use std::io::Read;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;
use tauri::ipc::Response;

const MAX_PREVIEW_BYTES: u64 = 256 * 1024 * 1024;
const MAX_FOLDER_ENTRIES: usize = 500;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePreviewInfo {
    name: String,
    extension: String,
    kind: String,
    size: Option<u64>,
    modified_at_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPreviewEntry {
    name: String,
    kind: String,
    size: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderPreview {
    entries: Vec<FolderPreviewEntry>,
    truncated: bool,
}

fn resolve(revision: u64, index: usize) -> Result<PathBuf, String> {
    crate::file_manager::selected_path_for_preview(revision, index)
}

#[tauri::command]
pub async fn file_preview_info(revision: u64, index: usize) -> Result<FilePreviewInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve(revision, index)?;
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("inspect {}: {error}", path.display()))?;
        let kind = if metadata.is_dir() {
            "folder"
        } else if metadata.file_type().is_symlink() {
            "symlink"
        } else {
            "file"
        };
        Ok(FilePreviewInfo {
            name: path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_default(),
            extension: path
                .extension()
                .map(|value| value.to_string_lossy().to_ascii_lowercase())
                .unwrap_or_default(),
            kind: kind.to_string(),
            size: metadata.is_file().then_some(metadata.len()),
            modified_at_ms: metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_millis() as u64),
        })
    })
    .await
    .map_err(|error| format!("preview metadata task failed: {error}"))?
}

#[tauri::command]
pub async fn file_preview_read(
    revision: u64,
    index: usize,
    max_bytes: Option<u64>,
) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve(revision, index)?;
        let metadata = std::fs::metadata(&path)
            .map_err(|error| format!("inspect {}: {error}", path.display()))?;
        if !metadata.is_file() {
            return Err("only regular files can be read for preview".to_string());
        }
        let limit = max_bytes
            .unwrap_or(MAX_PREVIEW_BYTES)
            .min(MAX_PREVIEW_BYTES);
        if metadata.len() > limit && max_bytes.is_none() {
            return Err("file is larger than the 256 MB quick-preview limit".to_string());
        }
        let mut bytes = Vec::with_capacity(metadata.len().min(limit) as usize);
        std::fs::File::open(&path)
            .map_err(|error| format!("open {}: {error}", path.display()))?
            .take(limit)
            .read_to_end(&mut bytes)
            .map_err(|error| format!("read {}: {error}", path.display()))?;
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|error| format!("preview read task failed: {error}"))?
}

#[tauri::command]
pub async fn file_preview_folder(revision: u64, index: usize) -> Result<FolderPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve(revision, index)?;
        let mut children = std::fs::read_dir(&path)
            .map_err(|error| format!("read folder {}: {error}", path.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read folder {}: {error}", path.display()))?;
        children.sort_by_key(|entry| entry.file_name());
        let truncated = children.len() > MAX_FOLDER_ENTRIES;
        let entries = children
            .into_iter()
            .take(MAX_FOLDER_ENTRIES)
            .map(|entry| {
                let metadata = entry.metadata().ok();
                FolderPreviewEntry {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    kind: if metadata.as_ref().is_some_and(|value| value.is_dir()) {
                        "folder".to_string()
                    } else {
                        "file".to_string()
                    },
                    size: metadata
                        .as_ref()
                        .and_then(|value| value.is_file().then_some(value.len())),
                }
            })
            .collect();
        Ok(FolderPreview { entries, truncated })
    })
    .await
    .map_err(|error| format!("folder preview task failed: {error}"))?
}
