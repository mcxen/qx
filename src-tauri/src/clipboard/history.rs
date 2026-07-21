use super::*;

#[command]
pub fn get_clipboard_history(
    state: tauri::State<'_, ClipboardDb>,
    limit: Option<u32>,
) -> Result<Vec<ClipboardEntry>, String> {
    let limit = limit.unwrap_or(50);
    let mut results = Vec::new();
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, text, timestamp, pinned, copy_count, image_path, file_path, file_paths, file_kind, ocr_text
             FROM clipboard_history
             ORDER BY pinned DESC, timestamp DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("{e}"))?;
    let rows = stmt
        .query_map(params![limit], |row| {
            let file_path: Option<String> = row.get(6)?;
            let file_paths_json: Option<String> = row.get(7)?;
            Ok(ClipboardEntry {
                id: row.get(0)?,
                text: row.get(1)?,
                timestamp: row.get(2)?,
                pinned: row.get::<_, i64>(3)? != 0,
                copy_count: row.get(4)?,
                image_path: row.get(5)?,
                file_paths: decode_stored_file_paths(
                    file_paths_json.as_deref(),
                    file_path.as_deref(),
                ),
                file_path,
                file_kind: row.get(8)?,
                ocr_text: row.get(9)?,
            })
        })
        .map_err(|e| format!("{e}"))?;
    for row in rows {
        results.push(row.map_err(|e| format!("{e}"))?);
    }
    Ok(results)
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
