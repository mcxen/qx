use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_IMAGE_CONTEXT_BYTES: u64 = 40 * 1024 * 1024;
const MAX_TEXT_BYTES: u64 = 256 * 1024;
const MAX_ATTACHMENTS_PER_IMPORT: usize = 16;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxAiAttachment {
    path: String,
    name: String,
    kind: String,
    size: u64,
    mime_type: String,
}

fn sessions_root() -> PathBuf {
    crate::paths::state_dir().join("QxAiSession")
}

fn sessions_file() -> PathBuf {
    sessions_root().join("sessions.json")
}

fn attachments_root() -> PathBuf {
    sessions_root().join("files")
}

fn storage_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub(crate) fn with_storage_lock<T>(task: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = storage_lock()
        .lock()
        .map_err(|_| "QxAI session storage lock poisoned".to_string())?;
    task()
}

fn checked_id(id: &str) -> Result<&str, String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("invalid QxAI session id".to_string());
    }
    Ok(id)
}

fn atomic_write_json(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("missing parent for {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| format!("create {}: {error}", parent.display()))?;
    let temp = path.with_extension("json.tmp");
    let bytes =
        serde_json::to_vec_pretty(value).map_err(|error| format!("encode sessions: {error}"))?;
    fs::write(&temp, bytes).map_err(|error| format!("write {}: {error}", temp.display()))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("replace {}: {error}", path.display()))?;
    }
    fs::rename(&temp, path).map_err(|error| format!("commit {}: {error}", path.display()))
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "txt" | "md" | "markdown" | "log" => "text/plain",
        "json" => "application/json",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        "xml" => "application/xml",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn attachment_kind(mime: &str) -> &'static str {
    if mime.starts_with("image/") {
        "image"
    } else {
        "file"
    }
}

fn import_attachments_sync(
    conversation_id: &str,
    paths: Vec<String>,
) -> Result<Vec<QxAiAttachment>, String> {
    let conversation_id = checked_id(conversation_id)?;
    if paths.len() > MAX_ATTACHMENTS_PER_IMPORT {
        return Err(format!(
            "select at most {MAX_ATTACHMENTS_PER_IMPORT} attachments at a time"
        ));
    }
    let destination = attachments_root().join(conversation_id);
    fs::create_dir_all(&destination)
        .map_err(|error| format!("create {}: {error}", destination.display()))?;
    let mut imported = Vec::new();
    for (index, source) in paths.into_iter().enumerate() {
        let source = PathBuf::from(source);
        let metadata =
            fs::metadata(&source).map_err(|error| format!("read {}: {error}", source.display()))?;
        if !metadata.is_file() {
            return Err(format!("attachment is not a file: {}", source.display()));
        }
        let original_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| format!("invalid attachment name: {}", source.display()))?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let safe_name = original_name
            .chars()
            .map(|character| {
                if matches!(character, '/' | '\\' | ':') {
                    '_'
                } else {
                    character
                }
            })
            .collect::<String>();
        let target = destination.join(format!("{stamp}-{index}-{safe_name}"));
        fs::copy(&source, &target)
            .map_err(|error| format!("copy {}: {error}", source.display()))?;
        let mime = mime_for(&target);
        imported.push(QxAiAttachment {
            path: target.to_string_lossy().into_owned(),
            name: original_name.to_string(),
            kind: attachment_kind(mime).to_string(),
            size: metadata.len(),
            mime_type: mime.to_string(),
        });
    }
    Ok(imported)
}

fn text_attachment(path: &Path, size: u64) -> Result<Option<String>, String> {
    let mime = mime_for(path);
    let is_text =
        mime.starts_with("text/") || matches!(mime, "application/json" | "application/xml");
    if !is_text || size > MAX_TEXT_BYTES {
        return Ok(None);
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| format!("read attachment {}: {error}", path.display()))
}

fn checked_managed_attachment(path: PathBuf) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("resolve attachment {}: {error}", path.display()))?;
    let root = attachments_root()
        .canonicalize()
        .map_err(|error| format!("resolve QxAI attachment root: {error}"))?;
    if !canonical.starts_with(&root) {
        return Err(format!(
            "attachment is outside QxAiSession storage: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

/// Convert durable QxAI message attachments into OpenAI-compatible content.
/// Images become data URLs; bounded text files become inline context. Other
/// files retain a managed path so the permissioned Qx tools can inspect them.
pub(crate) fn prepare_provider_messages(messages: Vec<Value>) -> Result<Vec<Value>, String> {
    messages
        .into_iter()
        .map(|mut message| {
            let Some(object) = message.as_object_mut() else {
                return Ok(message);
            };
            let is_user = object.get("role").and_then(Value::as_str) == Some("user");
            let attachments = object.remove("attachments").unwrap_or(Value::Null);
            object.remove("reasoning");
            object.remove("steps");
            object.remove("skill");
            if !is_user {
                return Ok(message);
            }
            let Some(attachments) = attachments.as_array() else {
                return Ok(message);
            };
            if attachments.is_empty() {
                return Ok(message);
            }

            let base_text = object
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let mut text = base_text;
            let mut image_parts = Vec::new();
            let mut image_context_bytes = 0_u64;
            for attachment in attachments {
                let path = attachment
                    .get("path")
                    .and_then(Value::as_str)
                    .map(PathBuf::from)
                    .ok_or_else(|| "attachment path is missing".to_string())?;
                let path = checked_managed_attachment(path)?;
                let metadata = fs::metadata(&path)
                    .map_err(|error| format!("read attachment {}: {error}", path.display()))?;
                let name = attachment
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("attachment");
                let mime = attachment
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .unwrap_or_else(|| mime_for(&path));
                if mime.starts_with("image/")
                    && metadata.len() <= MAX_IMAGE_BYTES
                    && image_context_bytes.saturating_add(metadata.len())
                        <= MAX_IMAGE_CONTEXT_BYTES
                {
                    let bytes = fs::read(&path)
                        .map_err(|error| format!("read image {}: {error}", path.display()))?;
                    image_context_bytes = image_context_bytes.saturating_add(metadata.len());
                    image_parts.push(json!({
                        "type": "image_url",
                        "image_url": { "url": format!("data:{mime};base64,{}", BASE64.encode(bytes)) }
                    }));
                } else if let Some(contents) = text_attachment(&path, metadata.len())? {
                    text.push_str(&format!("\n\n<attached-file name=\"{name}\">\n{contents}\n</attached-file>"));
                } else {
                    text.push_str(&format!(
                        "\n\nAttached file: {name} (managed local path: {})",
                        path.display()
                    ));
                }
            }
            if image_parts.is_empty() {
                object.insert("content".to_string(), Value::String(text));
            } else {
                let mut parts = vec![json!({ "type": "text", "text": text })];
                parts.extend(image_parts);
                object.insert("content".to_string(), Value::Array(parts));
            }
            Ok(message)
        })
        .collect()
}

#[tauri::command]
pub async fn qxai_sessions_load() -> Result<Value, String> {
    crate::runtime::blocking(|| {
        with_storage_lock(|| {
            let path = sessions_file();
            if !path.exists() {
                return Ok(Value::Array(Vec::new()));
            }
            let bytes =
                fs::read(&path).map_err(|error| format!("read {}: {error}", path.display()))?;
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|error| format!("decode {}: {error}", path.display()))?;
            if !value.is_array() {
                return Err("QxAI sessions file must contain an array".to_string());
            }
            Ok(value)
        })
    })
    .await
    .map_err(|error| format!("load QxAI sessions task failed: {error}"))?
}

#[tauri::command]
pub async fn qxai_sessions_save(conversations: Value) -> Result<(), String> {
    if !conversations.is_array() {
        return Err("QxAI conversations must be an array".to_string());
    }
    crate::runtime::blocking(move || {
        with_storage_lock(|| atomic_write_json(&sessions_file(), &conversations))
    })
    .await
    .map_err(|error| format!("save QxAI sessions task failed: {error}"))?
}

#[tauri::command]
pub async fn qxai_session_import_attachments(
    app: tauri::AppHandle,
    conversation_id: String,
    paths: Vec<String>,
) -> Result<Vec<QxAiAttachment>, String> {
    let imported = crate::runtime::blocking(move || {
        with_storage_lock(|| import_attachments_sync(&conversation_id, paths))
    })
    .await
    .map_err(|error| format!("import QxAI attachments task failed: {error}"))??;

    // Allow convertFileSrc previews for managed attachment copies.
    for attachment in &imported {
        if attachment.kind == "image" {
            let _ = app
                .asset_protocol_scope()
                .allow_file(std::path::Path::new(&attachment.path));
        }
    }
    Ok(imported)
}

#[tauri::command]
pub async fn qxai_session_delete(conversation_id: String) -> Result<(), String> {
    crate::runtime::blocking(move || {
        with_storage_lock(|| {
            let path = attachments_root().join(checked_id(&conversation_id)?);
            if path.exists() {
                fs::remove_dir_all(&path)
                    .map_err(|error| format!("remove {}: {error}", path.display()))?;
            }
            Ok(())
        })
    })
    .await
    .map_err(|error| format!("delete QxAI session task failed: {error}"))?
}

#[tauri::command]
pub async fn qxai_sessions_directory() -> Result<String, String> {
    crate::runtime::blocking(|| {
        with_storage_lock(|| {
            let root = sessions_root();
            fs::create_dir_all(&root)
                .map_err(|error| format!("create {}: {error}", root.display()))?;
            Ok(root.to_string_lossy().into_owned())
        })
    })
    .await
    .map_err(|error| format!("open QxAI sessions task failed: {error}"))?
}

pub(crate) fn storage_path() -> PathBuf {
    sessions_root()
}
