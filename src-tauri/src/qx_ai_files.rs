//! Bounded, revision-checked filesystem tools for QxAI.
//!
//! These commands are the native counterpart of the agent's Read / Glob /
//! Write / Edit tools. Blocking filesystem work stays off the async runtime,
//! reads are text-only and bounded, and mutations require the revision returned
//! by a previous read whenever the target already exists.

use glob::Pattern;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use walkdir::WalkDir;

const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_READ_LINES: usize = 200;
const MAX_READ_LINES: usize = 1_000;
const DEFAULT_DIRECTORY_ENTRIES: usize = 200;
const MAX_DIRECTORY_ENTRIES: usize = 500;
const DEFAULT_GLOB_RESULTS: usize = 100;
const MAX_GLOB_RESULTS: usize = 500;
const MAX_GLOB_VISITS: usize = 100_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReadFileRequest {
    path: String,
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReadFileResult {
    path: String,
    revision: String,
    content: String,
    start_line: usize,
    end_line: usize,
    total_lines: usize,
    truncated: bool,
    encoding: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiListDirectoryRequest {
    path: String,
    #[serde(default)]
    max_entries: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiFileEntry {
    path: String,
    name: String,
    kind: String,
    size: Option<u64>,
    modified_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiDirectoryResult {
    path: String,
    entries: Vec<AiFileEntry>,
    truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGlobFilesRequest {
    root: String,
    pattern: String,
    #[serde(default)]
    max_results: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiGlobFilesResult {
    root: String,
    pattern: String,
    paths: Vec<String>,
    truncated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiWriteFileRequest {
    path: String,
    content: String,
    #[serde(default)]
    expected_revision: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEditFileRequest {
    path: String,
    old_text: String,
    new_text: String,
    expected_revision: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiWriteFileResult {
    path: String,
    revision: String,
    bytes: usize,
    created: bool,
    replacements: usize,
}

fn ensure_files_enabled() -> Result<(), String> {
    let settings = crate::settings::read_settings().agent;
    if !settings.agent_mode_enabled {
        return Err("AI Agent mode is disabled in Settings > Agent".to_string());
    }
    if !settings.tools_enabled {
        return Err("AI tools are disabled in Settings > Agent".to_string());
    }
    if !settings.file_search_enabled {
        return Err("AI file tools are disabled in Settings > Agent".to_string());
    }
    Ok(())
}

fn expand_path(value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("file path is empty".to_string());
    }
    if trimmed.contains('\0') {
        return Err("file path must not contain NUL".to_string());
    }
    let expanded = if trimmed == "~" {
        crate::paths::home_dir()
    } else if let Some(rest) = trimmed.strip_prefix("~/") {
        crate::paths::home_dir().join(rest)
    } else {
        PathBuf::from(trimmed)
    };
    if expanded.is_absolute() {
        Ok(expanded)
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(expanded))
            .map_err(|error| format!("resolve working directory: {error}"))
    }
}

fn modified_at_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_millis() as u64)
}

fn file_entry(path: PathBuf) -> Result<AiFileEntry, String> {
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("inspect {}: {error}", path.display()))?;
    let kind = if metadata.file_type().is_symlink() {
        "symlink"
    } else if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        "file"
    } else {
        "other"
    };
    Ok(AiFileEntry {
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string()),
        path: path.display().to_string(),
        kind: kind.to_string(),
        size: metadata.is_file().then_some(metadata.len()),
        modified_at_ms: modified_at_ms(&metadata),
    })
}

fn revision(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn decode_text(bytes: &[u8]) -> Result<(String, &'static str), String> {
    if bytes.starts_with(&[0xff, 0xfe]) {
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16(&units)
            .map(|text| (text, "utf-16le"))
            .map_err(|_| "file contains invalid UTF-16LE text".to_string());
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16(&units)
            .map(|text| (text, "utf-16be"))
            .map_err(|_| "file contains invalid UTF-16BE text".to_string());
    }
    if bytes.contains(&0) {
        return Err("file appears to be binary; read_file only accepts text".to_string());
    }
    let without_bom = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    if let Ok(text) = std::str::from_utf8(without_bom) {
        return Ok((text.to_string(), "utf-8"));
    }
    let (decoded, _, had_errors) = encoding_rs::GB18030.decode(without_bom);
    if had_errors {
        return Err("file is not valid UTF-8, UTF-16, or GB18030 text".to_string());
    }
    Ok((decoded.into_owned(), "gb18030"))
}

fn read_text_snapshot(path: &Path) -> Result<(Vec<u8>, String, &'static str), String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("inspect {}: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a regular file", path.display()));
    }
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(format!(
            "{} is larger than the {} MiB read_file limit; use grep for bounded content search",
            path.display(),
            MAX_TEXT_BYTES / (1024 * 1024)
        ));
    }
    let bytes = fs::read(path).map_err(|error| format!("read {}: {error}", path.display()))?;
    let (text, encoding) = decode_text(&bytes)?;
    Ok((bytes, text, encoding))
}

fn read_file(req: AiReadFileRequest) -> Result<AiReadFileResult, String> {
    let path = expand_path(&req.path)?;
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("resolve {}: {error}", path.display()))?;
    let (bytes, text, encoding) = read_text_snapshot(&canonical)?;
    let lines = text.lines().collect::<Vec<_>>();
    let total_lines = lines.len().max(1);
    let start_line = req.offset.unwrap_or(1).clamp(1, total_lines);
    let limit = req
        .limit
        .unwrap_or(DEFAULT_READ_LINES)
        .clamp(1, MAX_READ_LINES);
    let selected = lines
        .iter()
        .skip(start_line - 1)
        .take(limit)
        .enumerate()
        .map(|(index, line)| format!("{:>6}\t{}", start_line + index, line))
        .collect::<Vec<_>>();
    let end_line = (start_line + selected.len().saturating_sub(1)).min(total_lines);
    Ok(AiReadFileResult {
        path: canonical.display().to_string(),
        revision: revision(&bytes),
        content: selected.join("\n"),
        start_line,
        end_line,
        total_lines,
        truncated: end_line < total_lines,
        encoding: encoding.to_string(),
    })
}

fn list_directory(req: AiListDirectoryRequest) -> Result<AiDirectoryResult, String> {
    let path = expand_path(&req.path)?;
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("resolve {}: {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!("{} is not a directory", canonical.display()));
    }
    let max_entries = req
        .max_entries
        .unwrap_or(DEFAULT_DIRECTORY_ENTRIES)
        .clamp(1, MAX_DIRECTORY_ENTRIES);
    let mut paths = fs::read_dir(&canonical)
        .map_err(|error| format!("read directory {}: {error}", canonical.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("read directory {}: {error}", canonical.display()))?
        .into_iter()
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    paths.sort_by(|left, right| {
        let left_dir = left.is_dir();
        let right_dir = right.is_dir();
        right_dir
            .cmp(&left_dir)
            .then_with(|| left.file_name().cmp(&right.file_name()))
    });
    let truncated = paths.len() > max_entries;
    let entries = paths
        .into_iter()
        .take(max_entries)
        .map(file_entry)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(AiDirectoryResult {
        path: canonical.display().to_string(),
        entries,
        truncated,
    })
}

fn glob_files(req: AiGlobFilesRequest) -> Result<AiGlobFilesResult, String> {
    let root = expand_path(&req.root)?;
    let canonical = root
        .canonicalize()
        .map_err(|error| format!("resolve {}: {error}", root.display()))?;
    if !canonical.is_dir() {
        return Err(format!("{} is not a directory", canonical.display()));
    }
    let pattern_text = req.pattern.trim();
    if pattern_text.is_empty() {
        return Err("glob pattern is empty".to_string());
    }
    let pattern = Pattern::new(pattern_text)
        .map_err(|error| format!("invalid glob pattern {pattern_text:?}: {error}"))?;
    let max_results = req
        .max_results
        .unwrap_or(DEFAULT_GLOB_RESULTS)
        .clamp(1, MAX_GLOB_RESULTS);
    let mut paths = Vec::new();
    let mut truncated = false;
    for entry in WalkDir::new(&canonical)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .take(MAX_GLOB_VISITS)
    {
        if entry.depth() == 0 || !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(&canonical)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .replace('\\', "/");
        if !pattern.matches(&relative) {
            continue;
        }
        if paths.len() == max_results {
            truncated = true;
            break;
        }
        paths.push(entry.path().display().to_string());
    }
    paths.sort();
    Ok(AiGlobFilesResult {
        root: canonical.display().to_string(),
        pattern: pattern_text.to_string(),
        paths,
        truncated,
    })
}

fn validate_write_target(path: &Path) -> Result<(), String> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() {
            return Err("write_file and edit_file do not follow symbolic links".to_string());
        }
        if !metadata.is_file() {
            return Err(format!("{} is not a regular file", path.display()));
        }
    }
    Ok(())
}

fn atomic_write(
    path: &Path,
    content: &[u8],
    expected_revision: Option<&str>,
) -> Result<bool, String> {
    validate_write_target(path)?;
    let created = !path.exists();
    if created {
        if expected_revision.is_some() {
            return Err("expectedRevision was supplied, but the target does not exist".to_string());
        }
    } else {
        let expected = expected_revision.ok_or_else(|| {
            "existing files require expectedRevision from read_file before write_file".to_string()
        })?;
        let current =
            fs::read(path).map_err(|error| format!("read current {}: {error}", path.display()))?;
        let actual = revision(&current);
        if actual != expected {
            return Err(format!(
                "file changed since it was read (expected {expected}, current {actual}); read it again"
            ));
        }
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| format!("create {}: {error}", parent.display()))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy())
        .unwrap_or_default();
    let temp = parent.join(format!(".{name}.qx-{}-{nonce}.tmp", std::process::id()));
    let write_result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|error| format!("create {}: {error}", temp.display()))?;
        file.write_all(content)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("write {}: {error}", temp.display()))?;
        if !created {
            let expected = expected_revision.unwrap_or_default();
            let latest =
                fs::read(path).map_err(|error| format!("recheck {}: {error}", path.display()))?;
            if revision(&latest) != expected {
                return Err(
                    "file changed while the update was being prepared; read it again".to_string(),
                );
            }
            #[cfg(target_os = "windows")]
            fs::remove_file(path)
                .map_err(|error| format!("replace {}: {error}", path.display()))?;
            fs::rename(&temp, path)
                .map_err(|error| format!("commit {}: {error}", path.display()))?;
        } else {
            fs::hard_link(&temp, path).map_err(|error| {
                format!(
                    "create {} without replacing a concurrent file: {error}",
                    path.display()
                )
            })?;
            fs::remove_file(&temp)
                .map_err(|error| format!("finish creating {}: {error}", path.display()))?;
        }
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    write_result?;
    Ok(created)
}

fn write_file(req: AiWriteFileRequest) -> Result<AiWriteFileResult, String> {
    if req.content.len() as u64 > MAX_TEXT_BYTES {
        return Err(format!(
            "content exceeds the {} MiB write_file limit",
            MAX_TEXT_BYTES / (1024 * 1024)
        ));
    }
    let path = expand_path(&req.path)?;
    let created = atomic_write(
        &path,
        req.content.as_bytes(),
        req.expected_revision.as_deref(),
    )?;
    Ok(AiWriteFileResult {
        path: path.display().to_string(),
        revision: revision(req.content.as_bytes()),
        bytes: req.content.len(),
        created,
        replacements: 0,
    })
}

fn edit_file(req: AiEditFileRequest) -> Result<AiWriteFileResult, String> {
    if req.old_text.is_empty() {
        return Err("oldText must not be empty".to_string());
    }
    let path = expand_path(&req.path)?;
    validate_write_target(&path)?;
    let (bytes, text, _) = read_text_snapshot(&path)?;
    let actual_revision = revision(&bytes);
    if actual_revision != req.expected_revision {
        return Err(format!(
            "file changed since it was read (expected {}, current {}); read it again",
            req.expected_revision, actual_revision
        ));
    }
    let matches = text.match_indices(&req.old_text).count();
    if matches != 1 {
        return Err(format!(
            "oldText must match exactly once; found {matches} matches"
        ));
    }
    let updated = text.replacen(&req.old_text, &req.new_text, 1);
    if updated.len() as u64 > MAX_TEXT_BYTES {
        return Err(format!(
            "edited content exceeds the {} MiB limit",
            MAX_TEXT_BYTES / (1024 * 1024)
        ));
    }
    atomic_write(&path, updated.as_bytes(), Some(&req.expected_revision))?;
    Ok(AiWriteFileResult {
        path: path.display().to_string(),
        revision: revision(updated.as_bytes()),
        bytes: updated.len(),
        created: false,
        replacements: 1,
    })
}

#[tauri::command]
pub async fn qxai_file_info(path: String) -> Result<AiFileEntry, String> {
    ensure_files_enabled()?;
    crate::runtime::blocking(move || expand_path(&path).and_then(file_entry))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn qxai_read_file(req: AiReadFileRequest) -> Result<AiReadFileResult, String> {
    ensure_files_enabled()?;
    crate::runtime::blocking(move || read_file(req))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn qxai_list_directory(req: AiListDirectoryRequest) -> Result<AiDirectoryResult, String> {
    ensure_files_enabled()?;
    crate::runtime::blocking(move || list_directory(req))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn qxai_glob_files(req: AiGlobFilesRequest) -> Result<AiGlobFilesResult, String> {
    ensure_files_enabled()?;
    crate::runtime::blocking(move || glob_files(req))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn qxai_write_file(req: AiWriteFileRequest) -> Result<AiWriteFileResult, String> {
    ensure_files_enabled()?;
    crate::runtime::blocking(move || write_file(req))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn qxai_edit_file(req: AiEditFileRequest) -> Result<AiWriteFileResult, String> {
    ensure_files_enabled()?;
    crate::runtime::blocking(move || edit_file(req))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("qx-ai-files-{name}-{nonce}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn read_write_and_edit_are_revision_checked() {
        let dir = temp_dir("revision");
        let path = dir.join("notes.md");
        let created = write_file(AiWriteFileRequest {
            path: path.display().to_string(),
            content: "one\ntwo\nthree\n".to_string(),
            expected_revision: None,
        })
        .unwrap();
        assert!(created.created);
        let read = read_file(AiReadFileRequest {
            path: path.display().to_string(),
            offset: Some(2),
            limit: Some(1),
        })
        .unwrap();
        assert_eq!(read.content, "     2\ttwo");
        let edited = edit_file(AiEditFileRequest {
            path: path.display().to_string(),
            old_text: "two".to_string(),
            new_text: "second".to_string(),
            expected_revision: read.revision,
        })
        .unwrap();
        assert_eq!(edited.replacements, 1);
        assert_eq!(fs::read_to_string(&path).unwrap(), "one\nsecond\nthree\n");
        assert!(write_file(AiWriteFileRequest {
            path: path.display().to_string(),
            content: "stale".to_string(),
            expected_revision: Some(created.revision),
        })
        .is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn glob_and_directory_listing_are_bounded() {
        let dir = temp_dir("glob");
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/a.rs"), "fn a() {}").unwrap();
        fs::write(dir.join("src/b.ts"), "export {};").unwrap();
        let matched = glob_files(AiGlobFilesRequest {
            root: dir.display().to_string(),
            pattern: "**/*.rs".to_string(),
            max_results: Some(10),
        })
        .unwrap();
        assert_eq!(matched.paths.len(), 1);
        assert!(matched.paths[0].ends_with("a.rs"));
        let listed = list_directory(AiListDirectoryRequest {
            path: dir.display().to_string(),
            max_entries: Some(10),
        })
        .unwrap();
        assert_eq!(listed.entries[0].kind, "directory");
        let _ = fs::remove_dir_all(dir);
    }
}
