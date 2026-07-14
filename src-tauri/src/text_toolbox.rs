//! Disk-backed scratchpad for the Documents / Text Toolbox module.
//! Files live under `~/Documents/Qx Text Toolbox` (created on demand).
//!
//! Users can open that folder in Finder/Explorer and drop files in;
//! the left list reads the folder, the right pane edits the selected file.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::command;

const WORKSPACE_DIR_NAME: &str = "Qx Text Toolbox";

/// Hard cap so Text Toolbox never pulls multi‑MB payloads through IPC into the UI thread.
/// Scratchpad use stays responsive; oversized files stay on disk (open in an external editor).
const MAX_FILE_BYTES: u64 = 1_500_000; // ~1.5 MB
/// Cap directory scan so a huge dropped folder cannot stall list IPC.
const MAX_LIST_ENTRIES: usize = 400;

const TEXT_EXTENSIONS: &[&str] = &[
    "txt", "md", "markdown", "json", "sql", "js", "mjs", "cjs", "jsx", "ts", "tsx", "java", "py",
    "rs", "go", "html", "htm", "css", "scss", "xml", "yml", "yaml", "sh", "bash", "zsh", "c", "h",
    "cpp", "hpp", "cc", "cs", "kt", "kts", "swift", "toml", "ini", "log", "csv",
];

fn file_too_large_msg(size: u64) -> String {
    format!(
        "file too large ({} KB; max {} KB). Open it in an external editor.",
        size / 1024,
        MAX_FILE_BYTES / 1024
    )
}

fn ensure_size_ok(size: u64) -> Result<(), String> {
    if size > MAX_FILE_BYTES {
        return Err(file_too_large_msg(size));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileEntry {
    pub name: String,
    pub path: String,
    pub language: String,
    pub size: u64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Content stats + optional language checks (JSON via `serde_json`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextInspectResult {
    pub chars: usize,
    pub lines: usize,
    pub words: usize,
    pub bytes: usize,
    pub language: String,
    /// Present when `language == "json"` — parse with serde_json (no custom parser).
    pub json: Option<JsonCheckResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonCheckResult {
    pub ok: bool,
    pub message: Option<String>,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

fn documents_root() -> PathBuf {
    dirs::document_dir()
        .unwrap_or_else(|| crate::paths::home_dir().join("Documents"))
        .join(WORKSPACE_DIR_NAME)
}

pub fn workspace_dir() -> PathBuf {
    let dir = documents_root();
    let _ = fs::create_dir_all(&dir);
    dir
}

fn is_safe_name(name: &str) -> bool {
    let name = name.trim();
    if name.is_empty() || name.len() > 200 {
        return false;
    }
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return false;
    }
    // Disallow absolute / hidden control
    if name.starts_with('.') && name != ".gitignore" {
        // allow .env style? keep simple: no leading dot except none
        return false;
    }
    true
}

fn ensure_extension(name: &str, language: &str) -> String {
    let trimmed = name.trim();
    if Path::new(trimmed).extension().is_some() {
        return trimmed.to_string();
    }
    let ext = match language {
        "markdown" => "md",
        "json" => "json",
        "sql" => "sql",
        "javascript" => "js",
        "typescript" => "ts",
        "java" => "java",
        "python" => "py",
        "rust" => "rs",
        "go" => "go",
        "html" => "html",
        "css" => "css",
        "xml" => "xml",
        "yaml" => "yml",
        "shell" => "sh",
        "c" => "c",
        "cpp" => "cpp",
        "csharp" => "cs",
        "kotlin" => "kt",
        "swift" => "swift",
        _ => "txt",
    };
    format!("{trimmed}.{ext}")
}

fn language_from_name(name: &str) -> String {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "md" | "markdown" => "markdown",
        "json" => "json",
        "sql" => "sql",
        "js" | "mjs" | "cjs" | "jsx" => "javascript",
        "ts" | "tsx" => "typescript",
        "java" => "java",
        "py" => "python",
        "rs" => "rust",
        "go" => "go",
        "html" | "htm" => "html",
        "css" | "scss" => "css",
        "xml" => "xml",
        "yml" | "yaml" => "yaml",
        "sh" | "bash" | "zsh" => "shell",
        "c" | "h" => "c",
        "cpp" | "hpp" | "cc" => "cpp",
        "cs" => "csharp",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        _ => "plain",
    }
    .to_string()
}

fn is_text_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| TEXT_EXTENSIONS.iter().any(|t| t.eq_ignore_ascii_case(ext)))
        .unwrap_or(false)
}

fn system_time_unix(t: SystemTime) -> i64 {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn mtime_unix(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .map(system_time_unix)
        .unwrap_or(0)
}

fn ctime_unix(path: &Path) -> i64 {
    // Birth time when available; fall back to mtime (Linux often lacks created()).
    fs::metadata(path)
        .and_then(|m| m.created())
        .map(system_time_unix)
        .unwrap_or_else(|_| mtime_unix(path))
}

fn entry_from_path(path: &Path, name: &str, size: Option<u64>) -> TextFileEntry {
    let size = size.unwrap_or_else(|| fs::metadata(path).map(|m| m.len()).unwrap_or(0));
    TextFileEntry {
        language: language_from_name(name),
        path: path.display().to_string(),
        name: name.to_string(),
        size,
        created_at: ctime_unix(path),
        updated_at: mtime_unix(path),
    }
}

fn inspect_content(content: &str, language: &str) -> TextInspectResult {
    let bytes = content.len();
    let chars = content.chars().count();
    let lines = if content.is_empty() {
        0
    } else {
        // Count newlines + 1 (last line without trailing \n still counts)
        content.lines().count().max(1)
    };
    let words = content.split_whitespace().count();

    let json = if language == "json" {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            // Allow empty / in-progress drafts — no error while still typing first chars
            Some(JsonCheckResult {
                ok: true,
                message: None,
                line: None,
                column: None,
            })
        } else {
            match serde_json::from_str::<serde_json::Value>(content) {
                Ok(_) => Some(JsonCheckResult {
                    ok: true,
                    message: Some("valid JSON".to_string()),
                    line: None,
                    column: None,
                }),
                Err(err) => Some(JsonCheckResult {
                    ok: false,
                    message: Some(err.to_string()),
                    line: Some(err.line()),
                    column: Some(err.column()),
                }),
            }
        }
    } else {
        None
    };

    TextInspectResult {
        chars,
        lines,
        words,
        bytes,
        language: language.to_string(),
        json,
    }
}

fn resolve_in_workspace(name: &str) -> Result<PathBuf, String> {
    if !is_safe_name(name) {
        return Err("invalid file name".to_string());
    }
    let root = workspace_dir();
    let path = root.join(name.trim());
    // Path must stay under workspace
    let root_canon = root
        .canonicalize()
        .unwrap_or(root.clone());
    if let Ok(canon) = path.canonicalize() {
        if !canon.starts_with(&root_canon) {
            return Err("path escapes workspace".to_string());
        }
        return Ok(canon);
    }
    // New file may not exist yet
    if path
        .parent()
        .map(|p| p == root.as_path() || p.starts_with(&root))
        .unwrap_or(false)
        || path.parent() == Some(root.as_path())
    {
        return Ok(path);
    }
    // For non-existing file, parent is workspace
    if path.parent() == Some(root.as_path()) || path.parent().is_none() {
        return Ok(root.join(name.trim()));
    }
    Ok(root.join(name.trim()))
}

#[command]
pub fn docs_workspace_path() -> Result<String, String> {
    Ok(workspace_dir().display().to_string())
}

#[command]
pub fn docs_open_workspace() -> Result<String, String> {
    let dir = workspace_dir();
    let path = dir.display().to_string();
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open")
            .arg(&dir)
            .status()
            .map_err(|e| format!("open workspace: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .status()
            .map_err(|e| format!("open workspace: {e}"))?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(&dir).status();
    }
    Ok(path)
}

#[command]
pub fn docs_list_files() -> Result<Vec<TextFileEntry>, String> {
    let dir = workspace_dir();
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("read workspace: {e}"))?;
    for entry in entries.flatten() {
        if out.len() >= MAX_LIST_ENTRIES {
            break;
        }
        let path = entry.path();
        if !path.is_file() || !is_text_file(&path) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file")
            .to_string();
        out.push(entry_from_path(&path, &name, None));
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.name.cmp(&b.name)));
    Ok(out)
}

#[command]
pub fn docs_read_file(name: String) -> Result<String, String> {
    let path = resolve_in_workspace(&name)?;
    if !path.is_file() {
        return Err(format!("file not found: {name}"));
    }
    let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    ensure_size_ok(size)?;
    fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))
}

#[command]
pub fn docs_write_file(name: String, content: String) -> Result<TextFileEntry, String> {
    ensure_size_ok(content.len() as u64)?;
    let path = resolve_in_workspace(&name)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent: {e}"))?;
    }
    fs::write(&path, content.as_bytes()).map_err(|e| format!("write {}: {e}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(name.trim())
        .to_string();
    Ok(entry_from_path(
        &path,
        &file_name,
        Some(content.len() as u64),
    ))
}

#[command]
pub fn docs_create_file(name: String, language: Option<String>) -> Result<TextFileEntry, String> {
    let lang = language.as_deref().unwrap_or("plain");
    let final_name = ensure_extension(&name, lang);
    if !is_safe_name(&final_name) {
        return Err("invalid file name".to_string());
    }
    let path = workspace_dir().join(&final_name);
    if path.exists() {
        return Err(format!("file already exists: {final_name}"));
    }
    fs::write(&path, b"").map_err(|e| format!("create {}: {e}", path.display()))?;
    Ok(entry_from_path(&path, &final_name, Some(0)))
}

#[command]
pub fn docs_rename_file(name: String, new_name: String) -> Result<TextFileEntry, String> {
    let from = resolve_in_workspace(&name)?;
    if !from.is_file() {
        return Err(format!("file not found: {name}"));
    }
    let dest_name = if Path::new(new_name.trim()).extension().is_some() {
        new_name.trim().to_string()
    } else {
        // keep extension from original if user omits it
        let ext = from
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{e}"))
            .unwrap_or_default();
        let base = new_name.trim();
        if base.contains('.') {
            base.to_string()
        } else {
            format!("{base}{ext}")
        }
    };
    if !is_safe_name(&dest_name) {
        return Err("invalid new file name".to_string());
    }
    let to = workspace_dir().join(&dest_name);
    if to.exists() {
        return Err(format!("target exists: {dest_name}"));
    }
    fs::rename(&from, &to).map_err(|e| format!("rename: {e}"))?;
    Ok(entry_from_path(&to, &dest_name, None))
}

#[command]
pub fn docs_delete_file(name: String) -> Result<(), String> {
    let path = resolve_in_workspace(&name)?;
    if !path.is_file() {
        return Err(format!("file not found: {name}"));
    }
    fs::remove_file(&path).map_err(|e| format!("delete {}: {e}", path.display()))
}

#[command]
pub fn docs_set_language(name: String, language: String) -> Result<TextFileEntry, String> {
    // Rename extension to match language when possible (keep stem).
    let from = resolve_in_workspace(&name)?;
    if !from.is_file() {
        return Err(format!("file not found: {name}"));
    }
    let stem = from
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file")
        .to_string();
    let new_name = ensure_extension(&stem, &language);
    if new_name == name {
        return Ok(entry_from_path(&from, &name, None));
    }
    docs_rename_file(name, new_name)
}

/// Stats + language checks for the bottom island. JSON uses `serde_json` (already in tree).
/// Safe to call frequently from the UI — pure CPU, no disk.
#[command]
pub fn docs_inspect_text(content: String, language: String) -> TextInspectResult {
    // Cap work for pathological sizes (content already in UI memory).
    if content.len() as u64 > MAX_FILE_BYTES {
        return TextInspectResult {
            chars: content.chars().count(),
            lines: 0,
            words: 0,
            bytes: content.len(),
            language,
            json: None,
        };
    }
    inspect_content(&content, &language)
}
