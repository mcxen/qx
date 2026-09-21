//! Bounded model work and atomic, source-preserving consolidation.
use super::extraction::{extract_candidates, ExtractionCandidate};
use super::*;
use std::collections::HashSet;
use std::sync::atomic::AtomicBool;

const INPUT_CHAR_LIMIT: usize = 24_000;
const INPUT_ROW_LIMIT: usize = 64;
static RUNNING: AtomicBool = AtomicBool::new(false);

struct RunGuard;
impl Drop for RunGuard {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::Release);
    }
}

fn active_rows(conn: &Connection) -> Result<Vec<MemoryRow>, String> {
    let mut rows = list_active_core(conn, MemoryTarget::Memory)?;
    rows.extend(list_active_core(conn, MemoryTarget::User)?);
    Ok(rows)
}

fn char_count(rows: &[MemoryRow]) -> usize {
    rows.iter().map(|row| row.content.chars().count()).sum()
}

fn bounded_sources(rows: Vec<MemoryRow>) -> Vec<MemoryRow> {
    let mut used = 0;
    rows.into_iter()
        .filter(|row| {
            let cost = row.content.chars().count() + row.id.chars().count() + 100;
            if used + cost > INPUT_CHAR_LIMIT {
                return false;
            }
            used += cost;
            true
        })
        .take(INPUT_ROW_LIMIT)
        .collect()
}

/// No storage lock spans the network request.
pub fn run_memory_dream(
    transcript: Option<String>,
    mode: Option<String>,
    context: MemoryContext,
    boundary: Option<String>,
) -> Result<Value, String> {
    context.validate()?;
    let mode = match mode.as_deref().unwrap_or("manual").trim() {
        "manual" => "manual",
        "smart" => "smart",
        "compress" => "compress",
        _ => return Err("memory mode must be manual|smart|compress".into()),
    };
    let epoch = MEMORY_EPOCH.load(Ordering::Acquire);
    let smart_enabled = || {
        let settings = crate::settings::read_settings();
        settings.agent.memory_tool_enabled && settings.agent.memory_policy == "smart"
    };
    if mode == "smart" && !smart_enabled() {
        return Err("automatic memory is disabled".into());
    }
    if RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("memory consolidation is already running".into());
    }
    let _guard = RunGuard;
    let receipt = boundary
        .as_deref()
        .filter(|_| mode == "smart")
        .map(|boundary| {
            use sha2::{Digest, Sha256};
            format!(
                "{:x}",
                Sha256::digest(format!(
                    "{}\0{}\0{boundary}",
                    context.scope(),
                    context.conversation_id.as_deref().unwrap_or("")
                ))
            )
        });
    if with_lock(|| with_db(|conn| processed(conn, receipt.as_deref())))? {
        return Ok(
            json!({"candidateCount":0,"beforeChars":0,"afterChars":0,"savedChars":0,"processedCount":0,"hasMore":false,"alreadyProcessed":true}),
        );
    }
    let all = with_lock(|| with_db(|conn| scoped_active(conn, context.scope())))?;
    let sources = bounded_sources(all.clone());
    let transcript = transcript.unwrap_or_default();
    let transcript = if mode == "compress" {
        String::new()
    } else {
        if transcript.chars().count() > 6000 {
            return Err("memory transcript exceeds 6000 characters; split into batches".into());
        }
        transcript
    };
    if sources.is_empty() && transcript.trim().is_empty() {
        return Ok(json!({
            "ok": true, "success": true, "candidateCount": 0,
            "message": "no candidates",
            "beforeChars": char_count(&all), "afterChars": char_count(&all), "savedChars": 0,
            "processedCount": sources.len(), "hasMore": all.len() > sources.len(),
        }));
    }
    let settings = crate::settings::read_settings();
    let provider = context
        .provider
        .clone()
        .or_else(|| Some(settings.agent.default_provider.clone()))
        .filter(|s| !s.is_empty());
    let model = context
        .model
        .clone()
        .or_else(|| Some(settings.agent.default_model.clone()))
        .filter(|s| !s.is_empty());
    let existing = serde_json::to_string(
        &sources
            .iter()
            .map(|row| {
                json!({
                    "id": row.id, "target": row.target, "category": category(row),
                    "content": row.content, "importance": row.importance,
                })
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|e| e.to_string())?;
    let (candidates, diary) = extract_candidates(provider, model, &existing, &transcript, mode)?;
    with_lock(|| {
        if epoch != MEMORY_EPOCH.load(Ordering::Acquire) {
            return Err("memory was cleared during extraction".into());
        }
        if mode == "smart" && !smart_enabled() {
            return Err("automatic memory is disabled".into());
        }
        with_db(|conn| {
            let before = scoped_active(conn, context.scope())?;
            let inserted = commit_with_context(
                conn,
                &sources,
                candidates,
                mode,
                &context,
                receipt.as_deref(),
            )?;
            let after = scoped_active(conn, context.scope())?;
            for target in [MemoryTarget::Memory, MemoryTarget::User] {
                mirror_hot_markdown(
                    target,
                    &pack_hot(&list_active_core(conn, target)?, target.limit()),
                );
            }
            // A failed best-effort diary must not make a committed operation appear failed.
            let dream_path = if inserted.is_empty() {
                None
            } else {
                let path = dreams_dir().join(format!("{}.md", new_id()));
                let body = format!(
                    "# Memory {mode}\n\n{diary}\n\n{}\n",
                    inserted
                        .iter()
                        .map(|row| format!("- [{}] {}", category(row), row.content))
                        .collect::<Vec<_>>()
                        .join("\n")
                );
                fs::write(&path, body)
                    .ok()
                    .map(|_| path.to_string_lossy().into_owned())
            };
            let before_chars = char_count(&before);
            let after_chars = char_count(&after);
            Ok(json!({
            "ok": true, "success": true, "candidateCount": inserted.len(),
            "message": if inserted.is_empty() { "no candidates" } else { "derived candidates saved" },
                "beforeChars": before_chars, "afterChars": after_chars,
                "savedChars": before_chars.saturating_sub(after_chars),
                "processedCount": sources.len(), "hasMore": all.len() > sources.len(),
                "activeCount": after.len(), "dreamPath": dream_path, "diary": diary,
                "memoryUsage": format_usage(&pack_hot(&list_active_core(conn, MemoryTarget::Memory)?, MEMORY_CHAR_LIMIT), MEMORY_CHAR_LIMIT),
                "userUsage": format_usage(&pack_hot(&list_active_core(conn, MemoryTarget::User)?, USER_CHAR_LIMIT), USER_CHAR_LIMIT),
                "memoryArchiveCount": count_target(conn, MemoryTarget::Memory)?,
                "userArchiveCount": count_target(conn, MemoryTarget::User)?,
            }))
        })
    })
}

/// Validate every candidate before one transaction writes summaries and FTS.
#[cfg(test)]
pub(super) fn commit_candidates(
    conn: &Connection,
    sources: &[MemoryRow],
    candidates: Vec<ExtractionCandidate>,
    mode: &str,
) -> Result<Vec<MemoryRow>, String> {
    commit_with_context(
        conn,
        sources,
        candidates,
        mode,
        &MemoryContext::default(),
        None,
    )
}

fn scoped_active(conn: &Connection, scope: &str) -> Result<Vec<MemoryRow>, String> {
    Ok(active_rows(conn)?
        .into_iter()
        .filter(|row| context::row_scope(row) == scope)
        .collect())
}

fn processed(conn: &Connection, receipt: Option<&str>) -> Result<bool, String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS memory_receipts (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)").map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM memory_receipts WHERE id = ?1)",
        params![receipt],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

pub(super) fn commit_with_context(
    conn: &Connection,
    sources: &[MemoryRow],
    candidates: Vec<ExtractionCandidate>,
    mode: &str,
    context: &MemoryContext,
    receipt: Option<&str>,
) -> Result<Vec<MemoryRow>, String> {
    if processed(conn, receipt)? {
        return Ok(Vec::new());
    }
    if candidates.len()
        > if mode == "compress" {
            INPUT_ROW_LIMIT
        } else {
            12
        }
    {
        return Err("too many memory candidates".into());
    }
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("begin memory transaction: {e}"))?;
    let active = scoped_active(&tx, context.scope())?;
    let mut consumed = HashSet::new();
    let mut derived = Vec::new();
    for candidate in candidates {
        let content = candidate.content.trim();
        let output_limit = if mode == "compress" {
            INPUT_CHAR_LIMIT
        } else {
            1200
        };
        if content.is_empty() || content.chars().count() > output_limit {
            return Err("memory candidate is empty or exceeds the output budget".into());
        }
        let target = MemoryTarget::parse(&candidate.target)?;
        if !matches!(candidate.memory_type.as_str(), "core" | "episodic") {
            return Err("invalid memory type".into());
        }
        let mut represented = Vec::new();
        for id in &candidate.supersedes {
            let source = sources
                .iter()
                .find(|row| &row.id == id)
                .ok_or("memory candidate references an unknown source")?;
            if source.target != target.as_str() || candidate.memory_type != "core" {
                return Err("memory lineage must stay within the same core target".into());
            }
            if context::row_scope(source) != context.scope() {
                return Err("memory lineage cannot cross scopes".into());
            }
            if !active.iter().any(|current| current == source) {
                return Err(
                    "memory changed during consolidation; retry with current records".into(),
                );
            }
            if !consumed.insert(id.clone()) {
                return Err("memory candidates contain overlapping sources".into());
            }
            represented.push(source);
        }
        let fallback_category = represented.first().map(|row| category(row)).unwrap_or(
            if target == MemoryTarget::User {
                "user"
            } else {
                "project"
            },
        );
        let category_name = candidate.category.as_deref().unwrap_or(fallback_category);
        let tag = category_tag(category_name)?;
        if represented.iter().any(|row| category(row) != category_name) {
            return Err("memory consolidation cannot merge different categories".into());
        }
        if mode == "compress" {
            if represented.is_empty() || candidate.memory_type != "core" {
                return Err("compression requires existing core source records".into());
            }
            let previous: usize = represented
                .iter()
                .map(|row| row.content.chars().count())
                .sum();
            if content.chars().count() >= previous || content.chars().count() > target.limit() {
                continue;
            }
        }
        // Lineage-bearing summaries remain valid even when archived text is identical.
        if represented.is_empty()
            && active.iter().chain(derived.iter()).any(|row: &MemoryRow| {
                row.target == target.as_str()
                    && row.content == content
                    && category(row) == category_name
            })
        {
            continue;
        }
        let ts = now_ms();
        let importance = if mode == "compress" {
            represented
                .iter()
                .map(|row| row.importance)
                .max()
                .unwrap_or(60)
        } else {
            candidate.importance.clamp(0, 100)
        };
        derived.push(MemoryRow {
            id: new_id(),
            target: target.as_str().to_string(),
            content: content.to_string(),
            tags: serde_json::to_string(&{
                let mut tags = context.tags();
                tags.extend(["derived".to_string(), mode.to_string(), tag]);
                tags
            })
            .map_err(|e| e.to_string())?,
            source: format!("dream.{mode}"),
            memory_type: candidate.memory_type,
            importance,
            supersedes: serde_json::to_string(&candidate.supersedes).map_err(|e| e.to_string())?,
            created_at: ts,
            updated_at: ts,
        });
    }
    for row in &derived {
        insert_row(&tx, row)?;
    }
    if let Some(receipt) = receipt {
        tx.execute(
            "INSERT INTO memory_receipts(id, created_at) VALUES (?1, ?2)",
            params![receipt, now_ms()],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit()
        .map_err(|e| format!("commit memory transaction: {e}"))?;
    Ok(derived)
}
