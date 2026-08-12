//! Hermes-inspired dual memory + dream consolidation for QxAI.
//!
//! Stores (char-capped, frozen into the system prompt at session start):
//! - MEMORY.md — agent notes about environment / projects / lessons
//! - USER.md — user profile / preferences
//!
//! Dream ("sleep") consolidates verbose entry lists into denser facts via the
//! default model, writing a diary under ~/.qx/memories/dreams/.

use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::g4f::{self, ChatMessage};

pub const MEMORY_CHAR_LIMIT: usize = 2200;
pub const USER_CHAR_LIMIT: usize = 1375;
const ENTRY_SEP: &str = "\n§\n";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryTarget {
    Memory,
    User,
}

impl MemoryTarget {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "memory" | "agent" | "notes" => Ok(Self::Memory),
            "user" | "profile" => Ok(Self::User),
            other => Err(format!("unknown memory target: {other} (use memory|user)")),
        }
    }

    fn file_name(self) -> &'static str {
        match self {
            Self::Memory => "MEMORY.md",
            Self::User => "USER.md",
        }
    }

    fn limit(self) -> usize {
        match self {
            Self::Memory => MEMORY_CHAR_LIMIT,
            Self::User => USER_CHAR_LIMIT,
        }
    }

    fn header(self) -> &'static str {
        match self {
            Self::Memory => "MEMORY (your personal notes)",
            Self::User => "USER PROFILE",
        }
    }
}

fn memories_dir() -> PathBuf {
    crate::paths::state_dir().join("memories")
}

fn dreams_dir() -> PathBuf {
    memories_dir().join("dreams")
}

fn storage_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn with_lock<T>(task: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = storage_lock()
        .lock()
        .map_err(|_| "QxAI memory lock poisoned".to_string())?;
    task()
}

fn ensure_dirs() -> Result<(), String> {
    fs::create_dir_all(memories_dir()).map_err(|e| format!("create memories dir: {e}"))?;
    fs::create_dir_all(dreams_dir()).map_err(|e| format!("create dreams dir: {e}"))?;
    Ok(())
}

fn store_path(target: MemoryTarget) -> PathBuf {
    memories_dir().join(target.file_name())
}

fn read_raw(target: MemoryTarget) -> String {
    let path = store_path(target);
    fs::read_to_string(path).unwrap_or_default()
}

fn parse_entries(raw: &str) -> Vec<String> {
    raw.split(ENTRY_SEP)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

fn join_entries(entries: &[String]) -> String {
    entries.join(ENTRY_SEP)
}

fn write_entries(target: MemoryTarget, entries: &[String]) -> Result<(), String> {
    ensure_dirs()?;
    let body = join_entries(entries);
    let path = store_path(target);
    let tmp = path.with_extension("md.tmp");
    fs::write(&tmp, &body).map_err(|e| format!("write memory tmp: {e}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("replace memory: {e}"))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("commit memory: {e}"))
}

fn usage(entries: &[String], limit: usize) -> (usize, usize, u32) {
    let used = join_entries(entries).chars().count();
    let pct = if limit == 0 {
        0
    } else {
        ((used as f64 / limit as f64) * 100.0).round() as u32
    };
    (used, limit, pct)
}

fn render_block(target: MemoryTarget, entries: &[String]) -> String {
    let (used, limit, pct) = usage(entries, target.limit());
    if entries.is_empty() {
        return format!(
            "══════════════════════════════════════════════\n{} [0% — 0/{limit} chars]\n══════════════════════════════════════════════\n(empty)",
            target.header()
        );
    }
    format!(
        "══════════════════════════════════════════════\n{} [{pct}% — {used}/{limit} chars]\n══════════════════════════════════════════════\n{}",
        target.header(),
        join_entries(entries)
    )
}

/// Frozen dual-store snapshot for system prompt injection (Hermes pattern).
pub fn memory_prompt_snapshot() -> String {
    with_lock(|| {
        ensure_dirs()?;
        let memory = parse_entries(&read_raw(MemoryTarget::Memory));
        let user = parse_entries(&read_raw(MemoryTarget::User));
        Ok(format!(
            "{}\n\n{}",
            render_block(MemoryTarget::Memory, &memory),
            render_block(MemoryTarget::User, &user)
        ))
    })
    .unwrap_or_default()
}

fn migrate_legacy_json_if_needed() {
    let legacy = crate::paths::state_dir().join("qxai-memory.json");
    if !legacy.is_file() {
        return;
    }
    let mem_path = store_path(MemoryTarget::Memory);
    if mem_path.is_file() {
        return;
    }
    let Ok(raw) = fs::read_to_string(&legacy) else {
        return;
    };
    let Ok(entries) = serde_json::from_str::<Vec<Value>>(&raw) else {
        return;
    };
    let mut memory = Vec::new();
    let mut user = Vec::new();
    for entry in entries {
        let text = entry
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if text.is_empty() {
            continue;
        }
        let tags = entry
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| t.as_str())
                    .map(|s| s.to_ascii_lowercase())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if tags
            .iter()
            .any(|t| t.contains("user") || t.contains("pref"))
        {
            user.push(text);
        } else {
            memory.push(text);
        }
    }
    let _ = write_entries(MemoryTarget::Memory, &memory);
    let _ = write_entries(MemoryTarget::User, &user);
}

fn add_entry(target: MemoryTarget, content: String) -> Result<Value, String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("memory content is empty".into());
    }
    let mut entries = parse_entries(&read_raw(target));
    if entries.iter().any(|e| e == &content) {
        return Ok(json!({
            "success": true,
            "message": "no duplicate added",
            "usage": format_usage(&entries, target.limit()),
        }));
    }
    let candidate = {
        let mut next = entries.clone();
        next.push(content.clone());
        next
    };
    let used = join_entries(&candidate).chars().count();
    if used > target.limit() {
        return Ok(json!({
            "success": false,
            "error": format!(
                "Memory at {}/{}. Adding this entry ({} chars) would exceed the limit. Consolidate with replace/remove then retry.",
                join_entries(&entries).chars().count(),
                target.limit(),
                content.chars().count()
            ),
            "current_entries": entries,
            "usage": format_usage(&entries, target.limit()),
        }));
    }
    entries.push(content);
    write_entries(target, &entries)?;
    Ok(json!({
        "success": true,
        "message": "added",
        "usage": format_usage(&entries, target.limit()),
        "entries": entries,
    }))
}

fn format_usage(entries: &[String], limit: usize) -> String {
    let (used, limit, pct) = usage(entries, limit);
    format!("{pct}% — {used}/{limit}")
}

fn replace_entry(target: MemoryTarget, old_text: &str, content: String) -> Result<Value, String> {
    let old_text = old_text.trim();
    let content = content.trim().to_string();
    if old_text.is_empty() || content.is_empty() {
        return Err("replace requires old_text and content".into());
    }
    let mut entries = parse_entries(&read_raw(target));
    let matches: Vec<usize> = entries
        .iter()
        .enumerate()
        .filter(|(_, e)| e.contains(old_text))
        .map(|(i, _)| i)
        .collect();
    if matches.is_empty() {
        return Err(format!("no entry matched old_text: {old_text}"));
    }
    if matches.len() > 1 {
        return Err(format!(
            "old_text matched {} entries; use a more specific substring",
            matches.len()
        ));
    }
    let idx = matches[0];
    entries[idx] = content;
    let used = join_entries(&entries).chars().count();
    if used > target.limit() {
        return Ok(json!({
            "success": false,
            "error": format!(
                "Replace would exceed limit ({used}/{}). Shorten content or remove other entries first.",
                target.limit()
            ),
            "current_entries": entries,
            "usage": format_usage(&entries, target.limit()),
        }));
    }
    write_entries(target, &entries)?;
    Ok(json!({
        "success": true,
        "message": "replaced",
        "usage": format_usage(&entries, target.limit()),
        "entries": entries,
    }))
}

fn remove_entry(target: MemoryTarget, old_text: &str) -> Result<Value, String> {
    let old_text = old_text.trim();
    if old_text.is_empty() {
        return Err("remove requires old_text".into());
    }
    let mut entries = parse_entries(&read_raw(target));
    let matches: Vec<usize> = entries
        .iter()
        .enumerate()
        .filter(|(_, e)| e.contains(old_text))
        .map(|(i, _)| i)
        .collect();
    if matches.is_empty() {
        return Err(format!("no entry matched old_text: {old_text}"));
    }
    if matches.len() > 1 {
        return Err(format!(
            "old_text matched {} entries; use a more specific substring",
            matches.len()
        ));
    }
    entries.remove(matches[0]);
    write_entries(target, &entries)?;
    Ok(json!({
        "success": true,
        "message": "removed",
        "usage": format_usage(&entries, target.limit()),
        "entries": entries,
    }))
}

fn status_all() -> Result<Value, String> {
    ensure_dirs()?;
    let memory = parse_entries(&read_raw(MemoryTarget::Memory));
    let user = parse_entries(&read_raw(MemoryTarget::User));
    let snapshot = format!(
        "{}\n\n{}",
        render_block(MemoryTarget::Memory, &memory),
        render_block(MemoryTarget::User, &user)
    );
    Ok(json!({
        "memory": {
            "usage": format_usage(&memory, MEMORY_CHAR_LIMIT),
            "entries": memory,
            "limit": MEMORY_CHAR_LIMIT,
        },
        "user": {
            "usage": format_usage(&user, USER_CHAR_LIMIT),
            "entries": user,
            "limit": USER_CHAR_LIMIT,
        },
        "snapshot": snapshot,
    }))
}

/// Dream / sleep: consolidate memory stores with the default model.
pub fn run_memory_dream(transcript: Option<String>) -> Result<Value, String> {
    migrate_legacy_json_if_needed();
    let memory = parse_entries(&read_raw(MemoryTarget::Memory));
    let user = parse_entries(&read_raw(MemoryTarget::User));
    if memory.is_empty()
        && user.is_empty()
        && transcript
            .as_ref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(true)
    {
        return Ok(json!({
            "ok": true,
            "message": "nothing to consolidate",
        }));
    }

    let settings = crate::settings::read_settings();
    let provider = Some(settings.agent.default_provider.clone()).filter(|s| !s.is_empty());
    let model = Some(settings.agent.default_model.clone()).filter(|s| !s.is_empty());

    let prompt = format!(
        r#"You are the QxAI dream / sleep consolidator (Hermes-style).

Compress the following into TWO tight stores with hard character caps:
- MEMORY notes (environment, projects, lessons): max {mem_limit} characters total
- USER profile (preferences, style): max {user_limit} characters total

Rules:
- Dense bullet-like sentences separated by the delimiter "§" on its own boundary (use \n§\n between entries).
- Drop ephemera, secrets, raw logs, and duplicates.
- Prefer durable facts the agent should always know.
- Reply with ONLY valid JSON:
{{"memory":["entry1","entry2"],"user":["entry1"],"diary":"short paragraph of what changed"}}

Current MEMORY entries:
{memory}

Current USER entries:
{user}

Optional recent session transcript (for distillation):
{transcript}
"#,
        mem_limit = MEMORY_CHAR_LIMIT,
        user_limit = USER_CHAR_LIMIT,
        memory = if memory.is_empty() {
            "(empty)".into()
        } else {
            memory.join("\n---\n")
        },
        user = if user.is_empty() {
            "(empty)".into()
        } else {
            user.join("\n---\n")
        },
        transcript = transcript
            .as_deref()
            .map(|s| s.chars().take(6000).collect::<String>())
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "(none)".into()),
    );

    let messages = vec![
        ChatMessage {
            role: "system".into(),
            content: json!("You consolidate agent memory. Output JSON only."),
        },
        ChatMessage {
            role: "user".into(),
            content: json!(prompt),
        },
    ];
    let raw = g4f::qxai_chat(provider, model, messages)?;
    let json_text = extract_json_object(&raw).unwrap_or(raw);
    let parsed: Value = serde_json::from_str(&json_text)
        .map_err(|e| format!("dream model returned non-JSON: {e}; raw={json_text}"))?;

    let mut next_memory = value_string_list(parsed.get("memory"));
    let mut next_user = value_string_list(parsed.get("user"));
    // Enforce caps by dropping trailing entries if the model overflowed.
    while join_entries(&next_memory).chars().count() > MEMORY_CHAR_LIMIT {
        next_memory.pop();
    }
    while join_entries(&next_user).chars().count() > USER_CHAR_LIMIT {
        next_user.pop();
    }
    write_entries(MemoryTarget::Memory, &next_memory)?;
    write_entries(MemoryTarget::User, &next_user)?;

    let diary = parsed
        .get("diary")
        .and_then(|v| v.as_str())
        .unwrap_or("consolidated")
        .to_string();
    ensure_dirs()?;
    let stamp = Local::now().format("%Y-%m-%d_%H%M%S").to_string();
    let dream_path = dreams_dir().join(format!("{stamp}.md"));
    let dream_body = format!(
        "# Dream {stamp}\n\n{diary}\n\n## MEMORY\n{}\n\n## USER\n{}\n",
        join_entries(&next_memory),
        join_entries(&next_user)
    );
    fs::write(&dream_path, dream_body).map_err(|e| format!("write dream diary: {e}"))?;

    Ok(json!({
        "ok": true,
        "dreamPath": dream_path.to_string_lossy(),
        "memoryUsage": format_usage(&next_memory, MEMORY_CHAR_LIMIT),
        "userUsage": format_usage(&next_user, USER_CHAR_LIMIT),
        "diary": diary,
    }))
}

fn value_string_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        Some(Value::String(s)) => parse_entries(s),
        _ => vec![],
    }
}

fn extract_json_object(raw: &str) -> Option<String> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(raw[start..=end].to_string())
}

/// Simple FTS-like search over durable QxAI sessions (session_search tool).
pub fn session_search(query: &str, limit: usize) -> Result<Value, String> {
    let query = query.trim().to_ascii_lowercase();
    if query.is_empty() {
        return Err("query is empty".into());
    }
    let path = crate::paths::state_dir()
        .join("QxAiSession")
        .join("sessions.json");
    let raw = fs::read_to_string(&path).unwrap_or_else(|_| "[]".into());
    let sessions: Value = serde_json::from_str(&raw).unwrap_or(json!([]));
    let Some(arr) = sessions.as_array() else {
        return Ok(json!({ "hits": [] }));
    };
    let tokens: Vec<&str> = query.split_whitespace().collect();
    let mut hits = Vec::new();
    for session in arr {
        let id = session.get("id").and_then(|v| v.as_str()).unwrap_or("");
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

// ── Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn qxai_memory_snapshot() -> Result<String, String> {
    migrate_legacy_json_if_needed();
    Ok(memory_prompt_snapshot())
}

#[tauri::command]
pub fn qxai_memory_status() -> Result<Value, String> {
    migrate_legacy_json_if_needed();
    with_lock(status_all)
}

#[tauri::command]
pub fn qxai_memory_mutate(
    action: String,
    target: Option<String>,
    content: Option<String>,
    old_text: Option<String>,
) -> Result<Value, String> {
    migrate_legacy_json_if_needed();
    with_lock(|| {
        let action = action.trim().to_ascii_lowercase();
        match action.as_str() {
            "status" | "list" => status_all(),
            "add" => {
                let target = MemoryTarget::parse(target.as_deref().unwrap_or("memory"))?;
                add_entry(target, content.unwrap_or_default())
            }
            "replace" => {
                let target = MemoryTarget::parse(target.as_deref().unwrap_or("memory"))?;
                replace_entry(
                    target,
                    old_text.as_deref().unwrap_or(""),
                    content.unwrap_or_default(),
                )
            }
            "remove" | "delete" => {
                let target = MemoryTarget::parse(target.as_deref().unwrap_or("memory"))?;
                remove_entry(target, old_text.as_deref().unwrap_or(""))
            }
            other => Err(format!(
                "unknown memory action: {other} (use add|replace|remove|status)"
            )),
        }
    })
}

#[tauri::command]
pub async fn qxai_memory_dream(transcript: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_memory_dream(transcript))
        .await
        .map_err(|e| format!("dream worker failed: {e}"))?
}

#[tauri::command]
pub fn qxai_session_search(query: String, limit: Option<u32>) -> Result<Value, String> {
    session_search(&query, limit.unwrap_or(12).clamp(1, 50) as usize)
}

#[tauri::command]
pub fn qxai_memories_directory() -> Result<String, String> {
    ensure_dirs()?;
    Ok(memories_dir().to_string_lossy().into_owned())
}

// keep path helper referenced for tests / future migration
#[allow(dead_code)]
fn _now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[allow(dead_code)]
fn _path_exists(path: &Path) -> bool {
    path.exists()
}
