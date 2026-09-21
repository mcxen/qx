//! QxAI long-term memory — **SQLite + FTS5** with a small hot prompt window.
//!
//! Design (RLM-style retrieval layering):
//! - **Cold store**: `~/.qx/memories/memory.db` holds every original and derived note.
//! - **FTS**: full-text search so long history stays findable.
//! - **Core snapshot**: only active core records are injected into the prompt.
//! - **Episodic recall**: contextual records remain in FTS and load on demand.
//! - Dream/extraction appends derived records with lineage; sources are never deleted.
//!
//! No legacy migration: old MEMORY.md / USER.md / qxai-memory.json are discarded on layout reset.
//! Hot-window mirrors (MEMORY.md / USER.md) are best-effort writes only.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

mod consolidation;
mod context;
mod extraction;
mod retrieval;
#[cfg(test)]
mod tests;

pub use consolidation::run_memory_dream;
use context::{metadata, MemoryContext};

pub const MEMORY_CHAR_LIMIT: usize = 2200;
pub const USER_CHAR_LIMIT: usize = 1375;

static MEMORY_ID_COUNTER: AtomicU64 = AtomicU64::new(0);
static MEMORY_EPOCH: AtomicU64 = AtomicU64::new(0);

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

    fn as_str(self) -> &'static str {
        match self {
            Self::Memory => "memory",
            Self::User => "user",
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

    fn md_name(self) -> &'static str {
        match self {
            Self::Memory => "MEMORY.md",
            Self::User => "USER.md",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MemoryRow {
    id: String,
    target: String,
    content: String,
    tags: String,
    source: String,
    memory_type: String,
    importance: i64,
    supersedes: String,
    created_at: i64,
    updated_at: i64,
}

fn memories_dir() -> PathBuf {
    crate::paths::state_dir().join("memories")
}

fn dreams_dir() -> PathBuf {
    memories_dir().join("dreams")
}

fn db_path() -> PathBuf {
    memories_dir().join("memory.db")
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

fn open_db() -> Result<Connection, String> {
    ensure_dirs()?;
    let conn = Connection::open(db_path()).map_err(|e| format!("open memory.db: {e}"))?;
    conn.busy_timeout(Duration::from_millis(250))
        .map_err(|e| format!("configure memory.db: {e}"))?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS memories (
            id TEXT PRIMARY KEY NOT NULL,
            target TEXT NOT NULL,
            content TEXT NOT NULL,
            tags TEXT NOT NULL DEFAULT '[]',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            source TEXT NOT NULL DEFAULT 'legacy',
            memory_type TEXT NOT NULL DEFAULT 'core',
            importance INTEGER NOT NULL DEFAULT 60,
            supersedes TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_memories_target_updated
            ON memories(target, updated_at DESC);
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
            id UNINDEXED,
            target UNINDEXED,
            content,
            tags,
            tokenize = 'porter unicode61'
        );
        ",
    )
    .map_err(|e| format!("init memory schema: {e}"))?;
    ensure_column(&conn, "source", "TEXT NOT NULL DEFAULT 'legacy'")?;
    ensure_column(&conn, "memory_type", "TEXT NOT NULL DEFAULT 'core'")?;
    ensure_column(&conn, "importance", "INTEGER NOT NULL DEFAULT 60")?;
    ensure_column(&conn, "supersedes", "TEXT NOT NULL DEFAULT '[]'")?;
    Ok(conn)
}

fn ensure_column(conn: &Connection, name: &str, declaration: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(memories)")
        .map_err(|e| format!("inspect memory schema: {e}"))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| format!("query memory schema: {e}"))?;
    for column in columns {
        if column.map_err(|e| format!("read memory schema: {e}"))? == name {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE memories ADD COLUMN {name} {declaration}"),
        [],
    )
    .map_err(|e| format!("migrate memory schema ({name}): {e}"))?;
    Ok(())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn new_id() -> String {
    format!(
        "m-{}-{}",
        now_ms(),
        MEMORY_ID_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn fts_insert(conn: &Connection, row: &MemoryRow) -> Result<(), String> {
    conn.execute(
        "INSERT INTO memories_fts(id, target, content, tags) VALUES (?1, ?2, ?3, ?4)",
        params![row.id, row.target, row.content, row.tags],
    )
    .map_err(|e| format!("fts insert: {e}"))?;
    Ok(())
}

fn fts_delete(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM memories_fts WHERE id = ?1", params![id])
        .map_err(|e| format!("fts delete: {e}"))?;
    Ok(())
}

fn insert_row(conn: &Connection, row: &MemoryRow) -> Result<(), String> {
    conn.execute(
        "INSERT INTO memories(
            id, target, content, tags, created_at, updated_at,
            source, memory_type, importance, supersedes
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            row.id,
            row.target,
            row.content,
            row.tags,
            row.created_at,
            row.updated_at,
            row.source,
            row.memory_type,
            row.importance,
            row.supersedes,
        ],
    )
    .map_err(|e| format!("insert memory: {e}"))?;
    fts_insert(conn, row)
}

fn update_row_content(conn: &Connection, id: &str, content: &str) -> Result<(), String> {
    let updated = now_ms();
    conn.execute(
        "UPDATE memories SET content = ?1, updated_at = ?2 WHERE id = ?3",
        params![content, updated, id],
    )
    .map_err(|e| format!("update memory: {e}"))?;
    fts_delete(conn, id)?;
    let row = load_row(conn, id)?.ok_or_else(|| format!("memory missing after update: {id}"))?;
    fts_insert(conn, &row)
}

fn delete_row(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM memories WHERE id = ?1", params![id])
        .map_err(|e| format!("delete memory: {e}"))?;
    fts_delete(conn, id)
}

fn load_row(conn: &Connection, id: &str) -> Result<Option<MemoryRow>, String> {
    conn.query_row(
        "SELECT id, target, content, tags, created_at, updated_at,
                source, memory_type, importance, supersedes
         FROM memories WHERE id = ?1",
        params![id],
        |row| {
            Ok(MemoryRow {
                id: row.get(0)?,
                target: row.get(1)?,
                content: row.get(2)?,
                tags: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                source: row.get(6)?,
                memory_type: row.get(7)?,
                importance: row.get(8)?,
                supersedes: row.get(9)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("load memory: {e}"))
}

fn list_target(conn: &Connection, target: MemoryTarget) -> Result<Vec<MemoryRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, target, content, tags, created_at, updated_at,
                    source, memory_type, importance, supersedes
             FROM memories WHERE target = ?1
             ORDER BY importance DESC, updated_at DESC",
        )
        .map_err(|e| format!("prepare list: {e}"))?;
    let rows = stmt
        .query_map(params![target.as_str()], |row| {
            Ok(MemoryRow {
                id: row.get(0)?,
                target: row.get(1)?,
                content: row.get(2)?,
                tags: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                source: row.get(6)?,
                memory_type: row.get(7)?,
                importance: row.get(8)?,
                supersedes: row.get(9)?,
            })
        })
        .map_err(|e| format!("query list: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
}

/// Core records stay resident. A source row remains archived/searchable after a
/// derived record supersedes it, but only the newest active projection is packed.
fn list_active_core(conn: &Connection, target: MemoryTarget) -> Result<Vec<MemoryRow>, String> {
    let rows = list_target(conn, target)?;
    let superseded = rows
        .iter()
        .filter(|row| row.memory_type == "core")
        .flat_map(|row| serde_json::from_str::<Vec<String>>(&row.supersedes).unwrap_or_default())
        .collect::<std::collections::HashSet<_>>();
    Ok(rows
        .into_iter()
        .filter(|row| row.memory_type == "core" && !superseded.contains(&row.id))
        .collect())
}

/// Pack newest entries until char budget for the hot prompt window.
fn pack_hot(entries: &[MemoryRow], limit: usize) -> Vec<String> {
    let mut packed = Vec::new();
    let mut used = 0usize;
    for row in entries {
        let piece = row.content.trim();
        if piece.is_empty() {
            continue;
        }
        let add = if packed.is_empty() {
            piece.chars().count()
        } else {
            piece.chars().count() + 3 // "\n§\n"
        };
        if used + add > limit {
            continue;
        }
        packed.push(piece.to_string());
        used += add;
    }
    packed
}

fn join_entries(entries: &[String]) -> String {
    entries.join("\n§\n")
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

fn format_usage(entries: &[String], limit: usize) -> String {
    let (used, limit, pct) = usage(entries, limit);
    format!("{pct}% — {used}/{limit}")
}

fn render_block(target: MemoryTarget, entries: &[String]) -> String {
    let (used, limit, pct) = usage(entries, target.limit());
    if entries.is_empty() {
        return format!(
            "══════════════════════════════════════════════\n{} [0% — 0/{limit} chars hot]\n══════════════════════════════════════════════\n(empty — use memory search for the full SQLite archive)",
            target.header()
        );
    }
    format!(
        "══════════════════════════════════════════════\n{} [{pct}% — {used}/{limit} chars hot]\n══════════════════════════════════════════════\n{}",
        target.header(),
        join_entries(entries)
    )
}

fn mirror_hot_markdown(target: MemoryTarget, entries: &[String]) {
    let path = memories_dir().join(target.md_name());
    let body = join_entries(entries);
    let tmp = path.with_extension("md.tmp");
    if fs::write(&tmp, &body).is_ok() {
        let _ = fs::rename(&tmp, &path);
    }
}

fn count_target(conn: &Connection, target: MemoryTarget) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE target = ?1",
        params![target.as_str()],
        |row| row.get(0),
    )
    .map_err(|e| format!("count: {e}"))
}

fn plugin_entry_json(row: &MemoryRow) -> Value {
    let tags = serde_json::from_str::<Value>(&row.tags).unwrap_or_else(|_| json!([]));
    json!({
        "id": row.id,
        "text": row.content,
        "tags": tags,
        "source": row.source,
        "type": row.memory_type,
        "category": category(row),
        "scope": context::row_scope(row),
        "originConversationId": metadata(row, "origin:"),
        "active": row.memory_type == "core",
        "importance": row.importance,
        "supersedes": serde_json::from_str::<Value>(&row.supersedes).unwrap_or_else(|_| json!([])),
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    })
}

/// Categories are reserved tags so legacy plugin memory inputs remain compatible.
fn category(row: &MemoryRow) -> &str {
    for name in ["user", "feedback", "project", "reference"] {
        if row.tags.contains(&format!("\"category:{name}\"")) {
            return name;
        }
    }
    if row.target == "user" {
        "user"
    } else {
        "project"
    }
}

fn category_tag(name: &str) -> Result<String, String> {
    match name {
        "user" | "feedback" | "project" | "reference" => Ok(format!("category:{name}")),
        _ => Err("memory category must be user|feedback|project|reference".into()),
    }
}

/// Compatibility projection for the plugin/settings memory API. It shares
/// the same SQLite archive as the built-in Agent memory tool instead of
/// maintaining the retired `qxai-memory.json` side store.
pub fn plugin_memory_list() -> Result<Value, String> {
    with_lock(|| {
        with_db(|conn| {
            let mut rows = list_target(conn, MemoryTarget::Memory)?;
            rows.extend(list_target(conn, MemoryTarget::User)?);
            rows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            let superseded = rows
                .iter()
                .filter(|row| row.memory_type == "core")
                .flat_map(|row| {
                    serde_json::from_str::<Vec<String>>(&row.supersedes).unwrap_or_default()
                })
                .collect::<std::collections::HashSet<_>>();
            Ok(Value::Array(
                rows.iter()
                    .map(|row| {
                        let mut value = plugin_entry_json(row);
                        value["active"] =
                            json!(row.memory_type == "core" && !superseded.contains(&row.id));
                        value
                    })
                    .collect(),
            ))
        })
    })
}

pub fn plugin_memory_add(content: String, tags: Vec<String>) -> Result<Value, String> {
    let content = content.trim().to_string();
    if content.is_empty() || content.chars().count() > 24_000 {
        return Err("memory text is empty".to_string());
    }
    let tags = tags
        .into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>();
    if tags.iter().filter(|tag| tag.starts_with("scope:")).count() > 1
        || tags
            .iter()
            .filter(|tag| tag.starts_with("category:"))
            .count()
            > 1
    {
        return Err("memory accepts only one scope and category".into());
    }
    let scope = tags
        .iter()
        .find_map(|tag| tag.strip_prefix("scope:"))
        .unwrap_or("");
    if tags.iter().any(|tag| tag == "scope:") || scope != scope.trim() {
        return Err("memory scope must be a nonempty, trimmed project identity".into());
    }
    MemoryContext {
        scope: Some(scope.into()),
        ..Default::default()
    }
    .validate()?;
    let category_name = tags.iter().find_map(|tag| tag.strip_prefix("category:"));
    if let Some(category_name) = category_name {
        category_tag(category_name)?;
    }
    let target = if tags.iter().any(|tag| {
        tag.eq_ignore_ascii_case("user")
            || tag.eq_ignore_ascii_case("pref")
            || tag == "category:user"
    }) {
        MemoryTarget::User
    } else {
        MemoryTarget::Memory
    };
    with_lock(|| {
        with_db(|conn| {
            let existing = context::scoped_rows(conn, target, scope, false)?
                .into_iter()
                .find(|row| {
                    row.content == content
                        && category(row)
                            == category_name.unwrap_or(if target == MemoryTarget::User {
                                "user"
                            } else {
                                "project"
                            })
                });
            if let Some(row) = existing {
                return Ok(plugin_entry_json(&row));
            }
            let ts = now_ms();
            let row = MemoryRow {
                id: new_id(),
                target: target.as_str().to_string(),
                content,
                tags: serde_json::to_string(&tags).unwrap_or_else(|_| "[]".to_string()),
                source: "plugin".to_string(),
                memory_type: "core".to_string(),
                importance: 70,
                supersedes: "[]".to_string(),
                created_at: ts,
                updated_at: ts,
            };
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            insert_row(&tx, &row)?;
            tx.commit().map_err(|e| e.to_string())?;
            let hot = pack_hot(&list_active_core(conn, target)?, target.limit());
            mirror_hot_markdown(target, &hot);
            Ok(plugin_entry_json(&row))
        })
    })
}

pub fn plugin_memory_delete(id: String) -> Result<(), String> {
    with_lock(|| {
        with_db(|conn| {
            let row = load_row(conn, id.trim())?
                .ok_or_else(|| format!("memory entry not found: {id}"))?;
            let target = MemoryTarget::parse(&row.target)?;
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            delete_row(&tx, &row.id)?;
            tx.commit().map_err(|e| e.to_string())?;
            let hot = pack_hot(&list_active_core(conn, target)?, target.limit());
            mirror_hot_markdown(target, &hot);
            Ok(())
        })
    })
}

fn with_db<T>(f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let conn = open_db()?;
    f(&conn)
}

/// Drop all memory files (SQLite + md/json). Used when session layout resets.
/// Does **not** import or convert legacy stores — start empty.
pub fn wipe_memory_store_for_reset() -> Result<(), String> {
    with_lock(|| {
        MEMORY_EPOCH.fetch_add(1, Ordering::AcqRel);
        let _ = ensure_dirs();
        for name in [
            "memory.db",
            "memory.db-wal",
            "memory.db-shm",
            "MEMORY.md",
            "USER.md",
        ] {
            let path = memories_dir().join(name);
            if path.exists() {
                let _ = fs::remove_file(&path);
            }
        }
        let legacy_json = crate::paths::state_dir().join("qxai-memory.json");
        if legacy_json.exists() {
            let _ = fs::remove_file(&legacy_json);
        }
        // Drop dream diaries too so nothing old is re-read.
        if dreams_dir().is_dir() {
            let _ = fs::remove_dir_all(dreams_dir());
            let _ = fs::create_dir_all(dreams_dir());
        }
        Ok(())
    })
}

/// Frozen dual-store snapshot for system prompt injection.
pub fn memory_prompt_snapshot(scope: &str) -> String {
    with_lock(|| {
        with_db(|conn| {
            // Markdown files are compatibility mirrors, not part of the turn
            // critical path. They are refreshed by mutations/dream; reading a
            // snapshot must remain a bounded SQLite read only.
            context::snapshot(conn, scope)
        })
    })
    .unwrap_or_default()
}

fn status_all() -> Result<Value, String> {
    with_db(|conn| {
        let memory_rows = list_active_core(conn, MemoryTarget::Memory)?;
        let user_rows = list_active_core(conn, MemoryTarget::User)?;
        let memory_hot = pack_hot(&memory_rows, MEMORY_CHAR_LIMIT);
        let user_hot = pack_hot(&user_rows, USER_CHAR_LIMIT);
        let snapshot = format!(
            "{}\n\n{}",
            render_block(MemoryTarget::Memory, &memory_hot),
            render_block(MemoryTarget::User, &user_hot)
        );
        Ok(json!({
            "backend": "sqlite+fts5",
            "dbPath": db_path().to_string_lossy(),
            "memory": {
                "usage": format_usage(&memory_hot, MEMORY_CHAR_LIMIT),
                "hotEntries": memory_hot,
                "archiveCount": count_target(conn, MemoryTarget::Memory)?,
                "limit": MEMORY_CHAR_LIMIT,
            },
            "user": {
                "usage": format_usage(&user_hot, USER_CHAR_LIMIT),
                "hotEntries": user_hot,
                "archiveCount": count_target(conn, MemoryTarget::User)?,
                "limit": USER_CHAR_LIMIT,
            },
            "snapshot": snapshot,
            "activeChars": memory_rows.iter().chain(user_rows.iter()).map(|row| row.content.chars().count()).sum::<usize>(),
            "activeCount": memory_rows.len() + user_rows.len(),
        }))
    })
}

// ── Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn qxai_memory_snapshot(scope: Option<String>) -> Result<String, String> {
    // `memory_prompt_snapshot` owns the storage lock. Do not wrap it in
    // another `with_lock`: std::sync::Mutex is not re-entrant, and the old
    // nested lock deadlocked the command on the first AI turn.
    crate::runtime::blocking(move || memory_prompt_snapshot(scope.as_deref().unwrap_or("").trim()))
        .await
        .map_err(|error| format!("memory snapshot task failed: {error}"))
}

#[tauri::command]
pub async fn qxai_memory_status() -> Result<Value, String> {
    crate::runtime::blocking(|| with_lock(status_all))
        .await
        .map_err(|error| format!("memory status task failed: {error}"))?
}

#[tauri::command]
pub async fn qxai_memory_mutate(
    action: String,
    target: Option<String>,
    content: Option<String>,
    old_text: Option<String>,
    category: Option<String>,
    context: Option<MemoryContext>,
    include_archived: Option<bool>,
) -> Result<Value, String> {
    crate::runtime::blocking(move || {
        with_lock(|| {
            let action = action.trim().to_ascii_lowercase();
            let context = context.unwrap_or_default();
            context.validate()?;
            let target = target
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .map(MemoryTarget::parse)
                .transpose()?;
            with_db(|conn| {
                context::mutate(
                    conn,
                    &action,
                    target,
                    content.as_deref().unwrap_or(""),
                    old_text.as_deref().unwrap_or(""),
                    category.as_deref(),
                    &context,
                    include_archived.unwrap_or(false),
                )
            })
        })
    })
    .await
    .map_err(|error| format!("memory mutation task failed: {error}"))?
}

#[tauri::command]
pub async fn qxai_memory_dream(
    transcript: Option<String>,
    mode: Option<String>,
    context: Option<MemoryContext>,
    boundary: Option<String>,
) -> Result<Value, String> {
    crate::runtime::blocking(move || {
        run_memory_dream(transcript, mode, context.unwrap_or_default(), boundary)
    })
    .await
    .map_err(|e| format!("dream worker failed: {e}"))?
}

#[tauri::command]
pub async fn qxai_session_search(query: String, limit: Option<u32>) -> Result<Value, String> {
    crate::runtime::blocking(move || {
        crate::qx_ai_sessions::session_search(&query, limit.unwrap_or(12).clamp(1, 50) as usize)
    })
    .await
    .map_err(|error| format!("session search task failed: {error}"))?
}

#[tauri::command]
pub async fn qxai_memories_directory() -> Result<String, String> {
    crate::runtime::blocking(|| {
        ensure_dirs()?;
        Ok(memories_dir().to_string_lossy().into_owned())
    })
    .await
    .map_err(|error| format!("memory directory task failed: {error}"))?
}

#[tauri::command]
pub async fn qxai_memory_clear() -> Result<Value, String> {
    crate::runtime::blocking(|| {
        with_lock(|| {
            MEMORY_EPOCH.fetch_add(1, Ordering::AcqRel);
            ensure_dirs()?;
            // Drop DB files (and WAL companions).
            for name in ["memory.db", "memory.db-wal", "memory.db-shm"] {
                let path = memories_dir().join(name);
                if path.exists() {
                    fs::remove_file(&path)
                        .map_err(|e| format!("remove {}: {e}", path.display()))?;
                }
            }
            for name in ["MEMORY.md", "USER.md"] {
                let path = memories_dir().join(name);
                if path.exists() {
                    let _ = fs::remove_file(&path);
                }
            }
            Ok(json!({ "success": true, "message": "memory database cleared" }))
        })
    })
    .await
    .map_err(|error| format!("memory clear task failed: {error}"))?
}

// keep path helper for diagnostics
#[allow(dead_code)]
fn _path_exists(path: &Path) -> bool {
    path.exists()
}
