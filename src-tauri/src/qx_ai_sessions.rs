//! QxAI durable session store — **folder layout only** (no legacy migration).
//!
//! ```text
//! ~/.qx/QxAiSession/
//!   .qxai-layout-v3            # layout marker (missing/old → wipe & restart empty)
//!   index.json                 # lightweight catalog
//!   sessions/<conversation-id>/
//!     session.json
//!     files/*
//! ```
//!
//! Old layouts are **deleted wholesale** (no convert). Missing `.qxai-layout-v3`
//! also triggers a one-time empty reset so broken half-migrations cannot freeze load.
//! Deletes remove the whole session directory (JSON + attachments).

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
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

fn sessions_dir() -> PathBuf {
    sessions_root().join("sessions")
}

fn index_file() -> PathBuf {
    sessions_root().join("index.json")
}

fn session_dir(id: &str) -> PathBuf {
    sessions_dir().join(id)
}

fn session_file(id: &str) -> PathBuf {
    session_dir(id).join("session.json")
}

fn session_files_dir(id: &str) -> PathBuf {
    session_dir(id).join("files")
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

fn ensure_root() -> Result<(), String> {
    fs::create_dir_all(sessions_dir())
        .map_err(|error| format!("create {}: {error}", sessions_dir().display()))?;
    Ok(())
}

fn layout_marker() -> PathBuf {
    sessions_root().join(".qxai-layout-v3")
}

/// Drop legacy / half-migrated trees without reading them. User starts empty.
/// Called once until `.qxai-layout-v3` exists and no legacy paths remain.
fn purge_legacy_storage() {
    let root = sessions_root();
    let has_legacy = root.join("sessions.json").exists()
        || root.join("sessions.json.bak").exists()
        || root.join("files").is_dir();
    let needs_reset = has_legacy || !layout_marker().is_file();
    if !needs_reset {
        return;
    }
    // Nuclear wipe — no parse, no copy, no path rewrite (avoids UI freezes).
    let _ = fs::remove_dir_all(&root);
    let _ = crate::qx_ai_memory::wipe_memory_store_for_reset();
    let _ = ensure_root();
    let _ = fs::write(layout_marker(), b"v3\n");
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

fn conversation_summary(conversation: &Value) -> Value {
    let id = conversation
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let messages = conversation
        .get("messages")
        .and_then(Value::as_array)
        .map(|a| a.len())
        .unwrap_or(0);
    json!({
        "id": id,
        "name": conversation.get("name").cloned().unwrap_or(json!("")),
        "createdAt": conversation.get("createdAt").cloned().unwrap_or(json!(0)),
        "provider": conversation.get("provider").cloned().unwrap_or(json!("")),
        "model": conversation.get("model").cloned().unwrap_or(json!("")),
        "messageCount": messages,
        "updatedAt": conversation
            .get("updatedAt")
            .cloned()
            .or_else(|| conversation.get("createdAt").cloned())
            .unwrap_or(json!(0)),
    })
}

fn rebuild_index_from_disk() -> Result<(), String> {
    ensure_root()?;
    let mut summaries = Vec::new();
    let dir = sessions_dir();
    if dir.is_dir() {
        for entry in fs::read_dir(&dir).map_err(|e| format!("read {}: {e}", dir.display()))? {
            let entry = entry.map_err(|e| format!("entry: {e}"))?;
            if !entry.path().is_dir() {
                continue;
            }
            let id = entry.file_name();
            let Some(id) = id.to_str() else {
                continue;
            };
            if checked_id(id).is_err() {
                continue;
            }
            let path = session_file(id);
            if !path.is_file() {
                continue;
            }
            let bytes = fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|e| format!("decode {}: {e}", path.display()))?;
            summaries.push(conversation_summary(&value));
        }
    }
    summaries.sort_by(|a, b| {
        let a_t = a.get("createdAt").and_then(Value::as_i64).unwrap_or(0);
        let b_t = b.get("createdAt").and_then(Value::as_i64).unwrap_or(0);
        b_t.cmp(&a_t)
    });
    atomic_write_json(&index_file(), &Value::Array(summaries))
}

fn load_all_conversations() -> Result<Value, String> {
    purge_legacy_storage();
    ensure_root()?;
    let mut conversations = Vec::new();
    let dir = sessions_dir();
    if dir.is_dir() {
        let Ok(entries) = fs::read_dir(&dir) else {
            return Ok(Value::Array(Vec::new()));
        };
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let id = entry.file_name();
            let Some(id) = id.to_str() else {
                continue;
            };
            if checked_id(id).is_err() {
                continue;
            }
            let path = session_file(id);
            if !path.is_file() {
                continue;
            }
            // Skip corrupt session files instead of failing the whole load.
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                continue;
            };
            if !value.is_object() {
                continue;
            }
            conversations.push(value);
        }
    }
    conversations.sort_by(|a, b| {
        let a_t = a.get("createdAt").and_then(Value::as_i64).unwrap_or(0);
        let b_t = b.get("createdAt").and_then(Value::as_i64).unwrap_or(0);
        b_t.cmp(&a_t)
    });
    Ok(Value::Array(conversations))
}

fn save_all_conversations(conversations: Value) -> Result<(), String> {
    purge_legacy_storage();
    ensure_root()?;
    let Some(arr) = conversations.as_array() else {
        return Err("QxAI conversations must be an array".into());
    };

    let mut keep: HashSet<String> = HashSet::new();
    let mut summaries = Vec::new();
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    for item in arr {
        let Some(id) = item.get("id").and_then(Value::as_str) else {
            continue;
        };
        let id = checked_id(id)?;
        keep.insert(id.to_string());

        let mut object = match item.as_object() {
            Some(map) => map.clone(),
            None => continue,
        };
        object
            .entry("updatedAt".to_string())
            .or_insert(json!(now_ms));
        let conversation = Value::Object(object);
        // Ensure files dir exists for the session unit.
        fs::create_dir_all(session_files_dir(id))
            .map_err(|e| format!("create {}: {e}", session_files_dir(id).display()))?;
        atomic_write_json(&session_file(id), &conversation)?;
        summaries.push(conversation_summary(&conversation));
    }

    // Remove session directories no longer present (JSON + attachments).
    if sessions_dir().is_dir() {
        for entry in fs::read_dir(sessions_dir()).map_err(|e| format!("read sessions dir: {e}"))? {
            let entry = entry.map_err(|e| format!("entry: {e}"))?;
            let name = entry.file_name();
            let Some(id) = name.to_str() else {
                continue;
            };
            if !keep.contains(id) && entry.path().is_dir() {
                fs::remove_dir_all(entry.path())
                    .map_err(|e| format!("remove {}: {e}", entry.path().display()))?;
            }
        }
    }

    summaries.sort_by(|a, b| {
        let a_t = a.get("createdAt").and_then(Value::as_i64).unwrap_or(0);
        let b_t = b.get("createdAt").and_then(Value::as_i64).unwrap_or(0);
        b_t.cmp(&a_t)
    });
    atomic_write_json(&index_file(), &Value::Array(summaries))?;
    Ok(())
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
    purge_legacy_storage();
    let destination = session_files_dir(conversation_id);
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
    let root = sessions_root()
        .canonicalize()
        .map_err(|error| format!("resolve QxAI session root: {error}"))?;
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
            object.remove("createdAt");
            object.remove("tokenCount");
            object.remove("tokenSpeed");
            object.remove("durationMs");
            object.remove("reasoningDurationMs");
            object.remove("usage");
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
                    text.push_str(&format!(
                        "\n\n<attached-file name=\"{name}\">\n{contents}\n</attached-file>"
                    ));
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
    crate::runtime::blocking(|| with_storage_lock(load_all_conversations))
        .await
        .map_err(|error| format!("load QxAI sessions task failed: {error}"))?
}

#[tauri::command]
pub async fn qxai_sessions_save(conversations: Value) -> Result<(), String> {
    if !conversations.is_array() {
        return Err("QxAI conversations must be an array".to_string());
    }
    crate::runtime::blocking(move || with_storage_lock(|| save_all_conversations(conversations)))
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
            let id = checked_id(&conversation_id)?;
            let path = session_dir(id);
            if path.exists() {
                fs::remove_dir_all(&path)
                    .map_err(|error| format!("remove {}: {error}", path.display()))?;
            }
            rebuild_index_from_disk()?;
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
            ensure_root()?;
            Ok(sessions_root().to_string_lossy().into_owned())
        })
    })
    .await
    .map_err(|error| format!("open QxAI sessions task failed: {error}"))?
}

/// Lightweight catalog (index.json). Falls back to rebuilding from disk.
#[tauri::command]
pub async fn qxai_sessions_index() -> Result<Value, String> {
    crate::runtime::blocking(|| {
        with_storage_lock(|| {
            purge_legacy_storage();
            let path = index_file();
            if path.is_file() {
                let bytes = fs::read(&path).map_err(|e| format!("read index: {e}"))?;
                let value: Value =
                    serde_json::from_slice(&bytes).map_err(|e| format!("decode index: {e}"))?;
                if value.is_array() {
                    return Ok(value);
                }
            }
            rebuild_index_from_disk()?;
            let bytes = fs::read(&index_file()).map_err(|e| format!("read index: {e}"))?;
            serde_json::from_slice(&bytes).map_err(|e| format!("decode index: {e}"))
        })
    })
    .await
    .map_err(|error| format!("index QxAI sessions task failed: {error}"))?
}

pub(crate) fn storage_path() -> PathBuf {
    sessions_root()
}

/// FTS-like search over per-session JSON files (used by memory session_search tool).
pub fn session_search(query: &str, limit: usize) -> Result<Value, String> {
    let query = query.trim().to_ascii_lowercase();
    if query.is_empty() {
        return Err("query is empty".into());
    }
    purge_legacy_storage();
    let tokens: Vec<&str> = query.split_whitespace().collect();
    let mut hits = Vec::new();
    let dir = sessions_dir();
    if !dir.is_dir() {
        return Ok(json!({ "hits": [] }));
    }
    for entry in fs::read_dir(&dir).map_err(|e| format!("read sessions: {e}"))? {
        let entry = entry.map_err(|e| format!("entry: {e}"))?;
        if !entry.path().is_dir() {
            continue;
        }
        let id = entry.file_name();
        let Some(id) = id.to_str() else {
            continue;
        };
        if checked_id(id).is_err() {
            continue;
        }
        let path = session_file(id);
        if !path.is_file() {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let Ok(session) = serde_json::from_slice::<Value>(&bytes) else {
            continue;
        };
        let name = session.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let messages = session
            .get("messages")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for (index, message) in messages.iter().enumerate() {
            let role = message.get("role").and_then(|v| v.as_str()).unwrap_or("");
            let content = message
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if tokens
                .iter()
                .all(|t| content.contains(t) || name.to_ascii_lowercase().contains(t))
            {
                let snippet = message
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .chars()
                    .take(280)
                    .collect::<String>();
                hits.push(json!({
                    "conversationId": id,
                    "name": name,
                    "messageIndex": index,
                    "role": role,
                    "snippet": snippet,
                }));
                if hits.len() >= limit {
                    return Ok(json!({ "hits": hits }));
                }
            }
        }
    }
    Ok(json!({ "hits": hits }))
}
