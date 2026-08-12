//! QxAI long-term memory — **SQLite + FTS5** with a small hot prompt window.
//!
//! Design (RLM-style retrieval layering):
//! - **Cold store**: `~/.qx/memories/memory.db` holds every note (memory|user).
//! - **FTS**: full-text search so long history stays findable.
//! - **Hot snapshot**: only a char-capped recent pack is injected into the system
//!   prompt (Hermes dual-store shape), so context never blows up.
//! - Dream consolidates hot notes; search always hits the full SQLite archive.
//!
//! Markdown files MEMORY.md / USER.md are migrated once, then treated as export
//! mirrors of the hot window (best-effort).

use chrono::Local;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::g4f::{self, ChatMessage};

pub const MEMORY_CHAR_LIMIT: usize = 2200;
pub const USER_CHAR_LIMIT: usize = 1375;

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
            updated_at INTEGER NOT NULL
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
    Ok(conn)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn new_id() -> String {
    format!("m-{}", now_ms())
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
        "INSERT INTO memories(id, target, content, tags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            row.id,
            row.target,
            row.content,
            row.tags,
            row.created_at,
            row.updated_at
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
        "SELECT id, target, content, tags, created_at, updated_at FROM memories WHERE id = ?1",
        params![id],
        |row| {
            Ok(MemoryRow {
                id: row.get(0)?,
                target: row.get(1)?,
                content: row.get(2)?,
                tags: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("load memory: {e}"))
}

fn list_target(conn: &Connection, target: MemoryTarget) -> Result<Vec<MemoryRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, target, content, tags, created_at, updated_at
             FROM memories WHERE target = ?1
             ORDER BY updated_at DESC",
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
            })
        })
        .map_err(|e| format!("query list: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| format!("row: {e}"))?);
    }
    Ok(out)
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

/// Migrate legacy MEMORY.md / USER.md / qxai-memory.json once into SQLite.
fn migrate_legacy_into_db(conn: &Connection) -> Result<(), String> {
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM memories", [], |row| row.get(0))
        .map_err(|e| format!("count memories: {e}"))?;
    if total > 0 {
        return Ok(());
    }

    // Markdown dual store
    for target in [MemoryTarget::Memory, MemoryTarget::User] {
        let path = memories_dir().join(target.md_name());
        if !path.is_file() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(&path) else {
            continue;
        };
        for piece in raw.split("\n§\n") {
            let content = piece.trim();
            if content.is_empty() {
                continue;
            }
            let ts = now_ms();
            let row = MemoryRow {
                id: new_id(),
                target: target.as_str().into(),
                content: content.into(),
                tags: "[]".into(),
                created_at: ts,
                updated_at: ts,
            };
            // Sleep 1ms worth of uniqueness for ids.
            std::thread::sleep(std::time::Duration::from_millis(1));
            insert_row(conn, &row)?;
        }
    }

    // Very old JSON list
    let legacy = crate::paths::state_dir().join("qxai-memory.json");
    if legacy.is_file() {
        if let Ok(raw) = fs::read_to_string(&legacy) {
            if let Ok(entries) = serde_json::from_str::<Vec<Value>>(&raw) {
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
                    let target = if tags
                        .iter()
                        .any(|t| t.contains("user") || t.contains("pref"))
                    {
                        MemoryTarget::User
                    } else {
                        MemoryTarget::Memory
                    };
                    let ts = entry
                        .get("updatedAt")
                        .and_then(|v| v.as_i64())
                        .or_else(|| entry.get("createdAt").and_then(|v| v.as_i64()))
                        .unwrap_or_else(now_ms);
                    let row = MemoryRow {
                        id: entry
                            .get("id")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string())
                            .unwrap_or_else(new_id),
                        target: target.as_str().into(),
                        content: text,
                        tags: serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into()),
                        created_at: ts,
                        updated_at: ts,
                    };
                    let _ = insert_row(conn, &row);
                }
            }
        }
    }
    Ok(())
}

fn with_db<T>(f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let conn = open_db()?;
    migrate_legacy_into_db(&conn)?;
    f(&conn)
}

/// Frozen dual-store snapshot for system prompt injection.
pub fn memory_prompt_snapshot() -> String {
    with_lock(|| {
        with_db(|conn| {
            let memory_rows = list_target(conn, MemoryTarget::Memory)?;
            let user_rows = list_target(conn, MemoryTarget::User)?;
            let memory = pack_hot(&memory_rows, MEMORY_CHAR_LIMIT);
            let user = pack_hot(&user_rows, USER_CHAR_LIMIT);
            mirror_hot_markdown(MemoryTarget::Memory, &memory);
            mirror_hot_markdown(MemoryTarget::User, &user);
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
            let rows = list_target(conn, target)?;
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
            created_at: ts,
            updated_at: ts,
        };
        insert_row(conn, &row)?;
        let rows = list_target(conn, target)?;
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
            "SELECT id, target, content, tags, created_at, updated_at
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
        let rows = list_target(conn, target)?;
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
        let rows = list_target(conn, target)?;
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
                    snippet(memories_fts, 2, '«', '»', '…', 18) AS snip
             FROM memories_fts
             JOIN memories m ON m.id = memories_fts.id
             WHERE memories_fts MATCH ?1 AND m.target = ?2
             ORDER BY rank
             LIMIT ?3"
        } else {
            "SELECT m.id, m.target, m.content, m.tags, m.created_at, m.updated_at,
                    snippet(memories_fts, 2, '«', '»', '…', 18) AS snip
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
                    "SELECT id, target, content, tags, created_at, updated_at
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
        let memory_rows = list_target(conn, MemoryTarget::Memory)?;
        let user_rows = list_target(conn, MemoryTarget::User)?;
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

/// Dream / sleep: consolidate hot notes with the default model, rewrite SQLite rows.
pub fn run_memory_dream(transcript: Option<String>) -> Result<Value, String> {
    let (memory_rows, user_rows) = with_lock(|| {
        with_db(|conn| {
            Ok((
                list_target(conn, MemoryTarget::Memory)?,
                list_target(conn, MemoryTarget::User)?,
            ))
        })
    })?;
    let memory = pack_hot(&memory_rows, MEMORY_CHAR_LIMIT * 2);
    let user = pack_hot(&user_rows, USER_CHAR_LIMIT * 2);
    if memory.is_empty()
        && user.is_empty()
        && transcript
            .as_ref()
            .map(|s| s.trim().is_empty())
            .unwrap_or(true)
    {
        return Ok(json!({
            "ok": true,
            "success": true,
            "message": "nothing to consolidate",
        }));
    }

    let memory_blob = if memory.is_empty() {
        "(empty)".to_string()
    } else {
        memory.join("\n---\n")
    };
    let user_blob = if user.is_empty() {
        "(empty)".to_string()
    } else {
        user.join("\n---\n")
    };
    let transcript_for_prompt = {
        let t = transcript
            .as_deref()
            .unwrap_or("")
            .chars()
            .take(6000)
            .collect::<String>();
        if t.trim().is_empty() {
            "(none)".to_string()
        } else {
            t
        }
    };

    let settings = crate::settings::read_settings();
    let provider = Some(settings.agent.default_provider.clone()).filter(|s| !s.is_empty());
    let model = Some(settings.agent.default_model.clone()).filter(|s| !s.is_empty());

    let prompt = format!(
        r#"You are the QxAI dream / sleep consolidator (Hermes + RLM archive).

Compress into TWO tight hot stores with hard character caps:
- MEMORY notes (environment, projects, lessons): max {mem_limit} characters total
- USER profile (preferences, style): max {user_limit} characters total

Rules:
- Dense bullet-like sentences (array of entry strings).
- Drop ephemera, secrets, raw logs, and duplicates.
- Prefer durable facts the agent should always know.
- Reply with ONLY valid JSON:
{{"memory":["entry1","entry2"],"user":["entry1"],"diary":"short paragraph of what changed"}}

Current MEMORY (hot pack + recent):
{memory_blob}

Current USER (hot pack + recent):
{user_blob}

Optional recent session transcript (for distillation):
{transcript_for_prompt}
"#,
        mem_limit = MEMORY_CHAR_LIMIT,
        user_limit = USER_CHAR_LIMIT,
        memory_blob = memory_blob,
        user_blob = user_blob,
        transcript_for_prompt = transcript_for_prompt,
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
    let extracted = extract_json_object(&raw).unwrap_or(raw);
    let parsed: Value = serde_json::from_str(&extracted)
        .map_err(|e| format!("dream model returned non-JSON: {e}; raw={extracted}"))?;

    let mut next_memory = value_string_list(parsed.get("memory"));
    let mut next_user = value_string_list(parsed.get("user"));
    while join_entries(&next_memory).chars().count() > MEMORY_CHAR_LIMIT {
        next_memory.pop();
    }
    while join_entries(&next_user).chars().count() > USER_CHAR_LIMIT {
        next_user.pop();
    }

    with_lock(|| {
        with_db(|conn| {
            rewrite_hot_set(conn, MemoryTarget::Memory, &memory_rows, &next_memory)?;
            rewrite_hot_set(conn, MemoryTarget::User, &user_rows, &next_user)?;
            mirror_hot_markdown(MemoryTarget::Memory, &next_memory);
            mirror_hot_markdown(MemoryTarget::User, &next_user);

            let diary = parsed
                .get("diary")
                .and_then(|v| v.as_str())
                .unwrap_or("consolidated")
                .trim()
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
                "success": true,
                "message": "consolidated",
                "dreamPath": dream_path.to_string_lossy(),
                "memoryUsage": format_usage(&next_memory, MEMORY_CHAR_LIMIT),
                "userUsage": format_usage(&next_user, USER_CHAR_LIMIT),
                "memoryArchiveCount": count_target(conn, MemoryTarget::Memory)?,
                "userArchiveCount": count_target(conn, MemoryTarget::User)?,
                "diary": diary,
            }))
        })
    })
}

/// Remove previous hot-pack rows and insert consolidated entries.
fn rewrite_hot_set(
    conn: &Connection,
    target: MemoryTarget,
    previous_hot_source: &[MemoryRow],
    next: &[String],
) -> Result<(), String> {
    let hot_ids: Vec<String> = pack_hot(previous_hot_source, target.limit() * 2)
        .iter()
        .filter_map(|content| {
            previous_hot_source
                .iter()
                .find(|r| r.content == *content)
                .map(|r| r.id.clone())
        })
        .collect();
    for id in hot_ids {
        delete_row(conn, &id)?;
    }
    for content in next {
        let content = content.trim();
        if content.is_empty() {
            continue;
        }
        let ts = now_ms();
        let row = MemoryRow {
            id: new_id(),
            target: target.as_str().into(),
            content: content.into(),
            tags: r#"["dream"]"#.into(),
            created_at: ts,
            updated_at: ts,
        };
        std::thread::sleep(std::time::Duration::from_millis(1));
        insert_row(conn, &row)?;
    }
    Ok(())
}

fn value_string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn extract_json_object(raw: &str) -> Option<String> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end < start {
        return None;
    }
    Some(raw[start..=end].to_string())
}

// ── Commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn qxai_memory_snapshot() -> Result<String, String> {
    with_lock(|| Ok(memory_prompt_snapshot()))
}

#[tauri::command]
pub fn qxai_memory_status() -> Result<Value, String> {
    with_lock(status_all)
}

#[tauri::command]
pub fn qxai_memory_mutate(
    action: String,
    target: Option<String>,
    content: Option<String>,
    old_text: Option<String>,
) -> Result<Value, String> {
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
}

#[tauri::command]
pub async fn qxai_memory_dream(transcript: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_memory_dream(transcript))
        .await
        .map_err(|e| format!("dream worker failed: {e}"))?
}

#[tauri::command]
pub fn qxai_session_search(query: String, limit: Option<u32>) -> Result<Value, String> {
    crate::qx_ai_sessions::session_search(&query, limit.unwrap_or(12).clamp(1, 50) as usize)
}

#[tauri::command]
pub fn qxai_memories_directory() -> Result<String, String> {
    ensure_dirs()?;
    Ok(memories_dir().to_string_lossy().into_owned())
}

#[tauri::command]
pub fn qxai_memory_clear() -> Result<Value, String> {
    with_lock(|| {
        ensure_dirs()?;
        // Drop DB files (and WAL companions).
        for name in ["memory.db", "memory.db-wal", "memory.db-shm"] {
            let path = memories_dir().join(name);
            if path.exists() {
                fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
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
}

// keep path helper for diagnostics
#[allow(dead_code)]
fn _path_exists(path: &Path) -> bool {
    path.exists()
}
