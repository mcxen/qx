use super::*;

/// Apply scope and supersession before LIMIT, including the CJK fallback.
pub(super) fn search(
    conn: &Connection,
    query: &str,
    target: Option<MemoryTarget>,
    scope: &str,
    archived: bool,
    limit: usize,
) -> Result<Value, String> {
    let query = query.trim();
    if query.is_empty() || query.len() > 2000 {
        return Err("memory query must contain 1–2000 bytes".into());
    }
    let fts = query
        .split_whitespace()
        .map(|word| word.replace('"', ""))
        .filter(|word| !word.is_empty())
        .map(|word| format!("\"{word}\"*"))
        .collect::<Vec<_>>()
        .join(" ");
    let scope_tag = format!("scope:{scope}");
    let filter = "(?2 IS NULL OR m.target = ?2)
        AND (NOT EXISTS (SELECT 1 FROM json_each(m.tags) WHERE substr(value, 1, 6) = 'scope:')
             OR EXISTS (SELECT 1 FROM json_each(m.tags) WHERE value = ?3))
        AND (?4 OR NOT EXISTS (SELECT 1 FROM memories s, json_each(s.supersedes) refs WHERE refs.value = m.id AND s.memory_type = 'core'))";
    let mut ids = Vec::new();
    for use_fts in [true, false] {
        if use_fts && fts.is_empty() {
            continue;
        }
        let sql = if use_fts {
            format!("SELECT m.id FROM memories_fts JOIN memories m ON m.id = memories_fts.id WHERE memories_fts MATCH ?1 AND {filter} ORDER BY rank LIMIT ?5")
        } else {
            format!("SELECT m.id FROM memories m WHERE m.content LIKE ?1 ESCAPE '\\' AND {filter} ORDER BY m.updated_at DESC LIMIT ?5")
        };
        let pattern = if use_fts {
            fts.clone()
        } else {
            format!(
                "%{}%",
                query
                    .replace('\\', "\\\\")
                    .replace('%', "\\%")
                    .replace('_', "\\_")
            )
        };
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(
                params![
                    pattern,
                    target.map(|t| t.as_str()),
                    scope_tag,
                    archived,
                    limit.min(20) as i64
                ],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| e.to_string())?;
        for row in rows {
            ids.push(row.map_err(|e| e.to_string())?);
        }
        if !ids.is_empty() {
            break;
        }
    }
    let hits = ids
        .iter()
        .map(|id| {
            let row = load_row(conn, id)?.ok_or("memory disappeared")?;
            let mut value = plugin_entry_json(&row);
            value["active"] = json!(list_active_core(conn, MemoryTarget::parse(&row.target)?)?
                .iter()
                .any(|active| active.id == row.id));
            value["snippet"] = json!(row.content.chars().take(160).collect::<String>());
            value["target"] = json!(row.target);
            // Preserve the legacy IPC shape; the Agent adapter projects brief hits.
            value["content"] = json!(row.content);
            value["tags"] = json!(row.tags);
            // Search is an index. Explicit read retrieves complete content.
            value.as_object_mut().unwrap().remove("text");
            Ok(value)
        })
        .collect::<Result<Vec<Value>, String>>()?;
    Ok(json!({"count": hits.len(), "hits": hits, "query": query}))
}
