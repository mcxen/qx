use super::*;

/// Max rows a single history page IPC may return (hot open or cold load-more).
const CLIPBOARD_PAGE_MAX: u32 = 200;

#[derive(Debug, Serialize, Clone)]
pub struct ClipboardHistoryPage {
    pub items: Vec<ClipboardEntry>,
    pub has_more: bool,
    /// Cursor fields for the next cold page (last item of this page).
    pub next_before_timestamp: Option<String>,
    pub next_before_id: Option<String>,
    pub next_before_pinned: Option<i64>,
}

fn map_history_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ClipboardEntry> {
    let file_path: Option<String> = row.get(6)?;
    let file_paths_json: Option<String> = row.get(7)?;
    Ok(ClipboardEntry {
        id: row.get(0)?,
        text: row.get(1)?,
        timestamp: row.get(2)?,
        pinned: row.get::<_, i64>(3)? != 0,
        copy_count: row.get(4)?,
        image_path: row.get(5)?,
        file_paths: decode_stored_file_paths(file_paths_json.as_deref(), file_path.as_deref()),
        file_path,
        file_kind: row.get(8)?,
        ocr_text: row.get(9)?,
    })
}

/// First-page / launcher-style history read. Defaults to a hot window of 80.
/// Prefer `get_clipboard_history_page` for cold load-more and search pagination.
#[command]
pub fn get_clipboard_history(
    state: tauri::State<'_, ClipboardDb>,
    limit: Option<u32>,
) -> Result<Vec<ClipboardEntry>, String> {
    let page = get_clipboard_history_page(state, limit, None, None, None, None)?;
    Ok(page.items)
}

/// Cursor-paginated history (Raycast-style hot open + cold load-more).
///
/// - Omit `before_*` for the hot window (newest + pinned first).
/// - Pass the previous page's `next_before_*` to load older cold rows.
/// - Optional `query` searches text / OCR / file path across the full retained store.
#[command]
pub fn get_clipboard_history_page(
    state: tauri::State<'_, ClipboardDb>,
    limit: Option<u32>,
    before_timestamp: Option<String>,
    before_id: Option<String>,
    before_pinned: Option<i64>,
    query: Option<String>,
) -> Result<ClipboardHistoryPage, String> {
    let limit = limit.unwrap_or(80).clamp(1, CLIPBOARD_PAGE_MAX);
    let fetch_limit = (limit as i64) + 1;
    // Multi-token AND, same spirit as frontend matchesQuery (whitespace-split).
    let tokens: Vec<String> = query
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.split_whitespace()
                .filter(|t| !t.is_empty())
                .map(|t| format!("%{t}%"))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let use_cursor = before_timestamp
        .as_ref()
        .filter(|s| !s.is_empty())
        .zip(before_id.as_ref().filter(|s| !s.is_empty()));
    let cursor_pinned = before_pinned.unwrap_or(0);

    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;

    // Build dynamic WHERE for optional cursor + token filters.
    let mut sql = String::from(
        "SELECT id, text, timestamp, pinned, copy_count, image_path, file_path, file_paths, file_kind, ocr_text
         FROM clipboard_history
         WHERE 1=1",
    );
    let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some((before_ts, before_id)) = use_cursor {
        sql.push_str(
            " AND (
               pinned < ?1
               OR (pinned = ?1 AND timestamp < ?2)
               OR (pinned = ?1 AND timestamp = ?2 AND id < ?3)
             )",
        );
        binds.push(Box::new(cursor_pinned));
        binds.push(Box::new(before_ts.to_string()));
        binds.push(Box::new(before_id.to_string()));
    }

    for token in &tokens {
        let idx = binds.len() + 1;
        sql.push_str(&format!(
            " AND (
               lower(text) LIKE ?{idx}
               OR lower(COALESCE(ocr_text, '')) LIKE ?{idx}
               OR lower(COALESCE(file_path, '')) LIKE ?{idx}
               OR lower(COALESCE(file_paths, '')) LIKE ?{idx}
             )"
        ));
        binds.push(Box::new(token.clone()));
    }

    let limit_idx = binds.len() + 1;
    sql.push_str(&format!(
        " ORDER BY pinned DESC, timestamp DESC, id DESC LIMIT ?{limit_idx}"
    ));
    binds.push(Box::new(fetch_limit));

    let mut results = Vec::new();
    {
        let mut stmt = conn.prepare(&sql).map_err(|e| format!("{e}"))?;
        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            binds.iter().map(|b| b.as_ref()).collect();
        let rows = stmt
            .query_map(params_refs.as_slice(), map_history_row)
            .map_err(|e| format!("{e}"))?;
        for row in rows {
            results.push(row.map_err(|e| format!("{e}"))?);
        }
    }

    let has_more = results.len() as u32 > limit;
    if has_more {
        results.truncate(limit as usize);
    }

    let (next_before_timestamp, next_before_id, next_before_pinned) =
        if let Some(last) = results.last() {
            (
                Some(last.timestamp.clone()),
                Some(last.id.clone()),
                Some(if last.pinned { 1 } else { 0 }),
            )
        } else {
            (None, None, None)
        };

    Ok(ClipboardHistoryPage {
        items: results,
        has_more,
        next_before_timestamp,
        next_before_id,
        next_before_pinned,
    })
}

/// Fetch a single history row by id (hot or cold). Used for deep-link paste.
#[command]
pub fn get_clipboard_entry(
    state: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<Option<ClipboardEntry>, String> {
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, text, timestamp, pinned, copy_count, image_path, file_path, file_paths, file_kind, ocr_text
             FROM clipboard_history
             WHERE id = ?1
             LIMIT 1",
        )
        .map_err(|e| format!("{e}"))?;
    let mut rows = stmt
        .query_map(params![id], map_history_row)
        .map_err(|e| format!("{e}"))?;
    match rows.next() {
        Some(Ok(entry)) => Ok(Some(entry)),
        Some(Err(e)) => Err(format!("{e}")),
        None => Ok(None),
    }
}

#[command]
pub fn read_clipboard_image_now(
    app: tauri::AppHandle,
    db: tauri::State<'_, ClipboardDb>,
) -> Result<Option<String>, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    match native::read_file_paths() {
        Ok(paths) if !paths.is_empty() => return Ok(None),
        Err(_) => return Ok(None),
        Ok(_) => {}
    }
    match app.clipboard().read_image() {
        Ok(image) => {
            let width = image.width();
            let height = image.height();
            if width > MAX_IMAGE_DIMENSION
                || height > MAX_IMAGE_DIMENSION
                || (width as u64).saturating_mul(height as u64) > MAX_IMAGE_PIXELS
            {
                return Ok(None);
            }
            let rgba = image.rgba();
            let hash = blake3::hash(rgba);
            let hash_hex = hash.to_hex()[..16].to_string();
            if rgba.is_empty() {
                return Ok(None);
            }
            let filename = format!("{}.png", hash_hex);
            let image_dir = get_image_dir();
            let image_path = image_dir.join(&filename);
            if ensure_clipboard_png_file(&image_path, rgba, width, height).is_err() {
                return Ok(None);
            }
            let path_str = image_path.to_string_lossy().to_string();
            let pasteboard_path = snapshot_current_pasteboard(&hash_hex);
            let mut guard = lock_db(&db.0);
            let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let _ = conn.execute(
                "INSERT INTO clipboard_history (id, text, timestamp, image_path, image_pasteboard_path)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    timestamp = excluded.timestamp,
                    image_path = COALESCE(excluded.image_path, clipboard_history.image_path),
                    image_pasteboard_path = COALESCE(excluded.image_pasteboard_path, clipboard_history.image_pasteboard_path)",
                rusqlite::params![hash_hex, "", ts, path_str, pasteboard_path],
            );
            prune_clipboard_storage(conn);
            drop(guard);
            queue_auto_ocr_for_entry(&app, hash_hex.clone(), path_str.clone());
            let _ = app.emit("clipboard-updated", ());
            Ok(Some(path_str))
        }
        Err(e) => {
            eprintln!("clipboard read_clipboard_image_now: {e}");
            Ok(None)
        }
    }
}

#[command]
pub fn write_clipboard_image_entry(
    app: tauri::AppHandle,
    db: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<(), String> {
    let (image_path, image_pasteboard_path): (String, Option<String>) = {
        let mut guard = lock_db(&db.0);
        let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
        conn.query_row(
            "SELECT image_path, image_pasteboard_path
             FROM clipboard_history
             WHERE id = ?1 AND image_path IS NOT NULL",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("clipboard image entry not found: {e}"))?
    };

    if let Some(manifest_path) = image_pasteboard_path.as_deref() {
        if pasteboard_snapshot_has_file_reference(manifest_path)
            && restore_pasteboard_snapshot(manifest_path).is_ok()
        {
            return Ok(());
        }
    }

    write_image_file_to_clipboard(&app, std::path::Path::new(&image_path))
}

#[command]
pub fn clear_clipboard_history(state: tauri::State<'_, ClipboardDb>) -> Result<(), String> {
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    let paths = collect_artifact_paths(
        conn,
        "SELECT image_path, image_pasteboard_path FROM clipboard_history",
    );
    conn.execute("DELETE FROM clipboard_history", [])
        .map_err(|e| format!("{e}"))?;
    remove_unreferenced_artifacts(conn, paths);
    Ok(())
}

#[command]
pub fn delete_clipboard_entry(
    state: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<(), String> {
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    let paths = {
        let mut paths = Vec::new();
        if let Ok((image_path, image_pasteboard_path)) = conn.query_row(
            "SELECT image_path, image_pasteboard_path
             FROM clipboard_history
             WHERE id = ?1",
            params![id.as_str()],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            },
        ) {
            if let Some(path) = image_path {
                paths.push(path);
            }
            if let Some(path) = image_pasteboard_path {
                paths.push(path);
            }
        }
        paths
    };
    conn.execute("DELETE FROM clipboard_history WHERE id = ?1", params![id])
        .map_err(|e| format!("{e}"))?;
    remove_unreferenced_artifacts(conn, paths);
    Ok(())
}

#[command]
pub fn toggle_clipboard_pin(
    state: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<(), String> {
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    conn.execute(
        "UPDATE clipboard_history
         SET pinned = CASE pinned WHEN 1 THEN 0 ELSE 1 END
         WHERE id = ?1",
        params![id],
    )
    .map_err(|e| format!("{e}"))?;
    prune_clipboard_storage(conn);
    Ok(())
}

#[command]
pub fn record_clipboard_copy(
    state: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<(), String> {
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    conn.execute(
        "UPDATE clipboard_history
         SET copy_count = copy_count + 1,
             timestamp = ?2
         WHERE id = ?1",
        params![id, ts],
    )
    .map_err(|e| format!("{e}"))?;
    prune_clipboard_storage(conn);
    Ok(())
}
