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

use chrono::Local;
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

mod extraction;

use extraction::{extract_candidates, ExtractionCandidate};

pub const MEMORY_CHAR_LIMIT: usize = 2200;
pub const USER_CHAR_LIMIT: usize = 1375;

static MEMORY_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

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

#[derive(Debug, Clone)]
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
            break;
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
        "importance": row.importance,
        "supersedes": serde_json::from_str::<Value>(&row.supersedes).unwrap_or_else(|_| json!([])),
        "createdAt": row.created_at,
        "updatedAt": row.updated_at,
    })
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
            Ok(Value::Array(rows.iter().map(plugin_entry_json).collect()))
        })
    })
}

pub fn plugin_memory_add(content: String, tags: Vec<String>) -> Result<Value, String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("memory text is empty".to_string());
    }
    let tags = tags
        .into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>();
    let target = if tags
        .iter()
        .any(|tag| tag.eq_ignore_ascii_case("user") || tag.eq_ignore_ascii_case("pref"))
    {
        MemoryTarget::User
    } else {
        MemoryTarget::Memory
    };
    with_lock(|| {
        with_db(|conn| {
            let existing: Option<String> = conn
                .query_row(
                    "SELECT id FROM memories WHERE target = ?1 AND content = ?2 LIMIT 1",
                    params![target.as_str(), content],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| format!("dedupe memory: {e}"))?;
            if let Some(id) = existing {
                let row = load_row(conn, &id)?
                    .ok_or_else(|| "memory disappeared after dedupe".to_string())?;
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
            insert_row(conn, &row)?;
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
            delete_row(conn, &row.id)?;
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
pub fn memory_prompt_snapshot() -> String {
    with_lock(|| {
        with_db(|conn| {
            let memory_rows = list_active_core(conn, MemoryTarget::Memory)?;
            let user_rows = list_active_core(conn, MemoryTarget::User)?;
            let memory = pack_hot(&memory_rows, MEMORY_CHAR_LIMIT);
            let user = pack_hot(&user_rows, USER_CHAR_LIMIT);
            // Markdown files are compatibility mirrors, not part of the turn
            // critical path. They are refreshed by mutations/dream; reading a
            // snapshot must remain a bounded SQLite read only.
            Ok(format!(
                "{}\n\n{}\n\n(Full archive is SQLite FTS — use the memory search tool when you need older notes.)",
                render_block(MemoryTarget::Memory, &memory),
                render_block(MemoryTarget::User, &user)
            ))
        })
    })
    .unwrap_or_default()
}

fn add_entry(
    target: MemoryTarget,
    content: String,
    tags: Option<Vec<String>>,
) -> Result<Value, String> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err("memory content is empty".into());
    }
    with_db(|conn| {
        // Dedupe exact content in same target.
        let exists: Option<String> = conn
            .query_row(
                "SELECT id FROM memories WHERE target = ?1 AND content = ?2 LIMIT 1",
                params![target.as_str(), content],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("dedupe: {e}"))?;
        if exists.is_some() {
            let rows = list_active_core(conn, target)?;
            let hot = pack_hot(&rows, target.limit());
            return Ok(json!({
                "success": true,
                "message": "no duplicate added",
                "archiveCount": count_target(conn, target)?,
                "usage": format_usage(&hot, target.limit()),
            }));
        }
        let ts = now_ms();
        let tags_json =
            serde_json::to_string(&tags.unwrap_or_default()).unwrap_or_else(|_| "[]".into());
        let row = MemoryRow {
            id: new_id(),
            target: target.as_str().into(),
            content: content.clone(),
            tags: tags_json,
            source: "manual".to_string(),
            memory_type: "core".to_string(),
            importance: 80,
            supersedes: "[]".to_string(),
            created_at: ts,
            updated_at: ts,
        };
        insert_row(conn, &row)?;
        let rows = list_active_core(conn, target)?;
        let hot = pack_hot(&rows, target.limit());
        mirror_hot_markdown(target, &hot);
        Ok(json!({
            "success": true,
            "message": "added",
            "id": row.id,
            "archiveCount": count_target(conn, target)?,
            "usage": format_usage(&hot, target.limit()),
            "hotEntries": hot,
        }))
    })
}

fn find_matches(
    conn: &Connection,
    target: MemoryTarget,
    needle: &str,
) -> Result<Vec<MemoryRow>, String> {
    let needle = needle.trim();
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    // Prefer exact id match.
    if let Some(row) = load_row(conn, needle)? {
        if row.target == target.as_str() {
            return Ok(vec![row]);
        }
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, target, content, tags, created_at, updated_at,
                    source, memory_type, importance, supersedes
             FROM memories WHERE target = ?1 AND content LIKE ?2
             ORDER BY updated_at DESC LIMIT 20",
        )
        .map_err(|e| format!("prepare match: {e}"))?;
    let pattern = format!("%{needle}%");
    let rows = stmt
        .query_map(params![target.as_str(), pattern], |row| {
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
        .map_err(|e| format!("query match: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
}

fn replace_entry(target: MemoryTarget, old_text: &str, content: String) -> Result<Value, String> {
    let content = content.trim().to_string();
    if old_text.trim().is_empty() || content.is_empty() {
        return Err("replace requires old_text and content".into());
    }
    with_db(|conn| {
        let matches = find_matches(conn, target, old_text)?;
        if matches.is_empty() {
            return Err(format!("no entry matched old_text: {old_text}"));
        }
        if matches.len() > 1 {
            return Err(format!(
                "old_text matched {} entries; use a more specific substring or id",
                matches.len()
            ));
        }
        let id = matches[0].id.clone();
        update_row_content(conn, &id, &content)?;
        let rows = list_active_core(conn, target)?;
        let hot = pack_hot(&rows, target.limit());
        mirror_hot_markdown(target, &hot);
        Ok(json!({
            "success": true,
            "message": "replaced",
            "id": id,
            "archiveCount": count_target(conn, target)?,
            "usage": format_usage(&hot, target.limit()),
            "hotEntries": hot,
        }))
    })
}

fn remove_entry(target: MemoryTarget, old_text: &str) -> Result<Value, String> {
    if old_text.trim().is_empty() {
        return Err("remove requires old_text or id".into());
    }
    with_db(|conn| {
        let matches = find_matches(conn, target, old_text)?;
        if matches.is_empty() {
            return Err(format!("no entry matched: {old_text}"));
        }
        if matches.len() > 1 {
            return Err(format!(
                "matched {} entries; use a more specific substring or id",
                matches.len()
            ));
        }
        let id = matches[0].id.clone();
        delete_row(conn, &id)?;
        let rows = list_active_core(conn, target)?;
        let hot = pack_hot(&rows, target.limit());
        mirror_hot_markdown(target, &hot);
        Ok(json!({
            "success": true,
            "message": "removed",
            "id": id,
            "archiveCount": count_target(conn, target)?,
            "usage": format_usage(&hot, target.limit()),
            "hotEntries": hot,
        }))
    })
}

fn search_entries(
    query: &str,
    target: Option<MemoryTarget>,
    limit: usize,
) -> Result<Value, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("query is empty".into());
    }
    with_db(|conn| {
        // FTS5: quote tokens for prefix-ish matching via simple AND.
        let fts_query = query
            .split_whitespace()
            .map(|t| {
                let clean = t.replace('"', "");
                if clean.is_empty() {
                    String::new()
                } else {
                    format!("\"{clean}\"*")
                }
            })
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        if fts_query.is_empty() {
            return Err("query has no searchable tokens".into());
        }

        let sql = if target.is_some() {
            "SELECT m.id, m.target, m.content, m.tags, m.created_at, m.updated_at,
                    snippet(memories_fts, 2, '«', '»', '…', 18) AS snip,
                    m.source, m.memory_type, m.importance, m.supersedes
             FROM memories_fts
             JOIN memories m ON m.id = memories_fts.id
             WHERE memories_fts MATCH ?1 AND m.target = ?2
             ORDER BY rank
             LIMIT ?3"
        } else {
            "SELECT m.id, m.target, m.content, m.tags, m.created_at, m.updated_at,
                    snippet(memories_fts, 2, '«', '»', '…', 18) AS snip,
                    m.source, m.memory_type, m.importance, m.supersedes
             FROM memories_fts
             JOIN memories m ON m.id = memories_fts.id
             WHERE memories_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2"
        };

        let mut hits = Vec::new();
        if let Some(t) = target {
            let mut stmt = conn.prepare(sql).map_err(|e| format!("prepare fts: {e}"))?;
            let rows = stmt
                .query_map(params![fts_query, t.as_str(), limit as i64], |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "target": row.get::<_, String>(1)?,
                        "content": row.get::<_, String>(2)?,
                        "tags": row.get::<_, String>(3)?,
                        "createdAt": row.get::<_, i64>(4)?,
                        "updatedAt": row.get::<_, i64>(5)?,
                        "snippet": row.get::<_, String>(6)?,
                        "source": row.get::<_, String>(7)?,
                        "type": row.get::<_, String>(8)?,
                        "importance": row.get::<_, i64>(9)?,
                        "supersedes": serde_json::from_str::<Value>(&row.get::<_, String>(10)?).unwrap_or_else(|_| json!([])),
                    }))
                })
                .map_err(|e| format!("fts query: {e}"))?;
            for row in rows {
                hits.push(row.map_err(|e| format!("row: {e}"))?);
            }
        } else {
            let mut stmt = conn.prepare(sql).map_err(|e| format!("prepare fts: {e}"))?;
            let rows = stmt
                .query_map(params![fts_query, limit as i64], |row| {
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "target": row.get::<_, String>(1)?,
                        "content": row.get::<_, String>(2)?,
                        "tags": row.get::<_, String>(3)?,
                        "createdAt": row.get::<_, i64>(4)?,
                        "updatedAt": row.get::<_, i64>(5)?,
                        "snippet": row.get::<_, String>(6)?,
                        "source": row.get::<_, String>(7)?,
                        "type": row.get::<_, String>(8)?,
                        "importance": row.get::<_, i64>(9)?,
                        "supersedes": serde_json::from_str::<Value>(&row.get::<_, String>(10)?).unwrap_or_else(|_| json!([])),
                    }))
                })
                .map_err(|e| format!("fts query: {e}"))?;
            for row in rows {
                hits.push(row.map_err(|e| format!("row: {e}"))?);
            }
        }

        // Fallback LIKE if FTS returned nothing (short tokens / CJK).
        if hits.is_empty() {
            let pattern = format!("%{query}%");
            let mut stmt = conn
                .prepare(
                    "SELECT id, target, content, tags, created_at, updated_at,
                            source, memory_type, importance, supersedes
                     FROM memories
                     WHERE content LIKE ?1
                     ORDER BY updated_at DESC
                     LIMIT ?2",
                )
                .map_err(|e| format!("prepare like: {e}"))?;
            let rows = stmt
                .query_map(params![pattern, limit as i64], |row| {
                    let content: String = row.get(2)?;
                    let snip: String = content.chars().take(160).collect();
                    Ok(json!({
                        "id": row.get::<_, String>(0)?,
                        "target": row.get::<_, String>(1)?,
                        "content": content,
                        "tags": row.get::<_, String>(3)?,
                        "createdAt": row.get::<_, i64>(4)?,
                        "updatedAt": row.get::<_, i64>(5)?,
                        "source": row.get::<_, String>(6)?,
                        "type": row.get::<_, String>(7)?,
                        "importance": row.get::<_, i64>(8)?,
                        "supersedes": serde_json::from_str::<Value>(&row.get::<_, String>(9)?).unwrap_or_else(|_| json!([])),
                        "snippet": snip,
                    }))
                })
                .map_err(|e| format!("like query: {e}"))?;
            for row in rows {
                hits.push(row.map_err(|e| format!("row: {e}"))?);
            }
        }

        Ok(json!({
            "hits": hits,
            "query": query,
            "count": hits.len(),
        }))
    })
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
        }))
    })
}

/// Selectively extract or consolidate memory. Original rows are immutable here:
/// candidates are appended as derived records with explicit supersedes lineage.
pub fn run_memory_dream(transcript: Option<String>, mode: Option<String>) -> Result<Value, String> {
    let mode = match mode.as_deref().unwrap_or("manual").trim() {
        "smart" => "smart",
        _ => "manual",
    };
    let (memory_rows, user_rows) = with_lock(|| {
        with_db(|conn| {
            Ok((
                list_active_core(conn, MemoryTarget::Memory)?,
                list_active_core(conn, MemoryTarget::User)?,
            ))
        })
    })?;
    let transcript = transcript.unwrap_or_default();
    if memory_rows.is_empty() && user_rows.is_empty() && transcript.trim().is_empty() {
        return Ok(json!({
            "ok": true,
            "success": true,
            "message": "no candidates",
            "candidateCount": 0,
        }));
    }

    let settings = crate::settings::read_settings();
    let provider = Some(settings.agent.default_provider.clone()).filter(|s| !s.is_empty());
    let model = Some(settings.agent.default_model.clone()).filter(|s| !s.is_empty());
    let existing = memory_rows
        .iter()
        .chain(user_rows.iter())
        .map(|row| format!("{} | {} | {}", row.id, row.target, row.content))
        .collect::<Vec<_>>()
        .join("\n");
    let transcript = transcript.chars().take(6000).collect::<String>();
    let (candidates, diary) = extract_candidates(provider, model, &existing, &transcript, mode)?;
    let allowed_source_ids = memory_rows
        .iter()
        .chain(user_rows.iter())
        .map(|row| row.id.clone())
        .collect::<std::collections::HashSet<_>>();

    with_lock(|| {
        with_db(|conn| {
            let mut inserted = Vec::new();
            for candidate in candidates.into_iter().take(12) {
                if let Some(row) = derived_row(candidate, mode, &allowed_source_ids)? {
                    let duplicate: Option<String> = conn
                        .query_row(
                            "SELECT id FROM memories WHERE target = ?1 AND content = ?2 LIMIT 1",
                            params![row.target, row.content],
                            |result| result.get(0),
                        )
                        .optional()
                        .map_err(|e| format!("dedupe derived memory: {e}"))?;
                    if duplicate.is_some() {
                        continue;
                    }
                    insert_row(conn, &row)?;
                    inserted.push(row);
                }
            }
            let memory_hot = pack_hot(
                &list_active_core(conn, MemoryTarget::Memory)?,
                MEMORY_CHAR_LIMIT,
            );
            let user_hot = pack_hot(
                &list_active_core(conn, MemoryTarget::User)?,
                USER_CHAR_LIMIT,
            );
            mirror_hot_markdown(MemoryTarget::Memory, &memory_hot);
            mirror_hot_markdown(MemoryTarget::User, &user_hot);

            let dream_path = if inserted.is_empty() {
                None
            } else {
                ensure_dirs()?;
                let stamp = Local::now().format("%Y-%m-%d_%H%M%S").to_string();
                let path = dreams_dir().join(format!("{stamp}.md"));
                let body = format!(
                    "# Memory extraction {stamp}\n\nMode: {mode}\n\n{}\n\n{}\n",
                    if diary.is_empty() {
                        "selected durable candidates"
                    } else {
                        &diary
                    },
                    inserted
                        .iter()
                        .map(|row| format!(
                            "- [{}:{}] {}",
                            row.memory_type, row.importance, row.content
                        ))
                        .collect::<Vec<_>>()
                        .join("\n")
                );
                fs::write(&path, body).map_err(|e| format!("write extraction diary: {e}"))?;
                Some(path)
            };

            Ok(json!({
                "ok": true,
                "success": true,
                "message": if inserted.is_empty() { "no candidates" } else { "derived candidates saved" },
                "candidateCount": inserted.len(),
                "dreamPath": dream_path.map(|path| path.to_string_lossy().into_owned()),
                "memoryUsage": format_usage(&memory_hot, MEMORY_CHAR_LIMIT),
                "userUsage": format_usage(&user_hot, USER_CHAR_LIMIT),
                "memoryArchiveCount": count_target(conn, MemoryTarget::Memory)?,
                "userArchiveCount": count_target(conn, MemoryTarget::User)?,
                "diary": diary,
            }))
        })
    })
}

fn derived_row(
    candidate: ExtractionCandidate,
    mode: &str,
    allowed_source_ids: &std::collections::HashSet<String>,
) -> Result<Option<MemoryRow>, String> {
    let content = candidate.content.trim();
    if content.is_empty() {
        return Ok(None);
    }
    let target = MemoryTarget::parse(&candidate.target)?;
    let memory_type = match candidate.memory_type.trim() {
        "core" => "core",
        _ => "episodic",
    };
    let supersedes = candidate
        .supersedes
        .into_iter()
        .filter(|id| allowed_source_ids.contains(id))
        .collect::<Vec<_>>();
    let ts = now_ms();
    Ok(Some(MemoryRow {
        id: new_id(),
        target: target.as_str().to_string(),
        content: content.chars().take(1200).collect(),
        tags: serde_json::to_string(&vec!["derived", mode]).unwrap_or_else(|_| "[]".into()),
        source: format!("dream.{mode}"),
        memory_type: memory_type.to_string(),
        importance: candidate.importance.clamp(0, 100),
        supersedes: serde_json::to_string(&supersedes).unwrap_or_else(|_| "[]".into()),
        created_at: ts,
        updated_at: ts,
    }))
}

// ── Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn qxai_memory_snapshot() -> Result<String, String> {
    // `memory_prompt_snapshot` owns the storage lock. Do not wrap it in
    // another `with_lock`: std::sync::Mutex is not re-entrant, and the old
    // nested lock deadlocked the command on the first AI turn.
    crate::runtime::blocking(|| memory_prompt_snapshot())
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
) -> Result<Value, String> {
    crate::runtime::blocking(move || {
        with_lock(|| {
            let action = action.trim().to_ascii_lowercase();
            match action.as_str() {
                "status" | "list" => status_all(),
                "add" => {
                    let target = MemoryTarget::parse(target.as_deref().unwrap_or("memory"))?;
                    add_entry(target, content.unwrap_or_default(), None)
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
                "search" => {
                    let target = target
                        .as_deref()
                        .filter(|s| !s.trim().is_empty())
                        .map(MemoryTarget::parse)
                        .transpose()?;
                    search_entries(content.as_deref().unwrap_or(""), target, 20)
                }
                other => Err(format!(
                    "unknown memory action: {other} (use add|replace|remove|status|search)"
                )),
            }
        })
    })
    .await
    .map_err(|error| format!("memory mutation task failed: {error}"))?
}

#[tauri::command]
pub async fn qxai_memory_dream(
    transcript: Option<String>,
    mode: Option<String>,
) -> Result<Value, String> {
    crate::runtime::blocking(move || run_memory_dream(transcript, mode))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("memory db");
        conn.execute_batch(
            "CREATE TABLE memories (
                id TEXT PRIMARY KEY NOT NULL,
                target TEXT NOT NULL,
                content TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                source TEXT NOT NULL,
                memory_type TEXT NOT NULL,
                importance INTEGER NOT NULL,
                supersedes TEXT NOT NULL
             );",
        )
        .expect("schema");
        conn
    }

    fn row(id: &str, memory_type: &str, supersedes: &[&str]) -> MemoryRow {
        MemoryRow {
            id: id.to_string(),
            target: "memory".to_string(),
            content: format!("content {id}"),
            tags: "[]".to_string(),
            source: "test".to_string(),
            memory_type: memory_type.to_string(),
            importance: 70,
            supersedes: serde_json::to_string(supersedes).expect("lineage"),
            created_at: 1,
            updated_at: 1,
        }
    }

    fn insert_without_fts(conn: &Connection, row: &MemoryRow) {
        conn.execute(
            "INSERT INTO memories VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
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
                row.supersedes
            ],
        )
        .expect("insert");
    }

    #[test]
    fn derived_summary_preserves_source_and_replaces_only_core_projection() {
        let conn = test_conn();
        insert_without_fts(&conn, &row("source", "core", &[]));
        insert_without_fts(&conn, &row("episode", "episodic", &[]));
        insert_without_fts(&conn, &row("summary", "core", &["source"]));

        assert_eq!(count_target(&conn, MemoryTarget::Memory).unwrap(), 3);
        let active = list_active_core(&conn, MemoryTarget::Memory).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, "summary");
        assert!(load_row(&conn, "source").unwrap().is_some());
    }

    #[test]
    fn legacy_schema_gains_metadata_without_losing_rows() {
        let conn = Connection::open_in_memory().expect("memory db");
        conn.execute_batch(
            "CREATE TABLE memories (
                id TEXT PRIMARY KEY NOT NULL,
                target TEXT NOT NULL,
                content TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
             );
             INSERT INTO memories VALUES ('legacy', 'memory', 'keep me', '[]', 1, 1);",
        )
        .expect("legacy schema");
        ensure_column(&conn, "source", "TEXT NOT NULL DEFAULT 'legacy'").unwrap();
        ensure_column(&conn, "memory_type", "TEXT NOT NULL DEFAULT 'core'").unwrap();
        ensure_column(&conn, "importance", "INTEGER NOT NULL DEFAULT 60").unwrap();
        ensure_column(&conn, "supersedes", "TEXT NOT NULL DEFAULT '[]'").unwrap();

        let row = load_row(&conn, "legacy").unwrap().expect("preserved row");
        assert_eq!(row.content, "keep me");
        assert_eq!(row.source, "legacy");
        assert_eq!(row.memory_type, "core");
        assert_eq!(row.importance, 60);
        assert_eq!(row.supersedes, "[]");
    }

    #[test]
    fn derived_candidate_allows_empty_supersedes_and_clamps_importance() {
        let allowed = std::collections::HashSet::new();
        let row = derived_row(
            ExtractionCandidate {
                target: "memory".to_string(),
                content: "durable fact".to_string(),
                memory_type: "core".to_string(),
                importance: 140,
                supersedes: vec!["unknown".to_string()],
            },
            "smart",
            &allowed,
        )
        .unwrap()
        .unwrap();
        assert_eq!(row.importance, 100);
        assert_eq!(row.supersedes, "[]");
        assert_eq!(row.source, "dream.smart");
    }
}
