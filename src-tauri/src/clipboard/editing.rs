use chrono::Local;
use rusqlite::params;
use tauri::command;

use super::{
    compute_id, ensure_connection, lock_db, prune_clipboard_storage, ClipboardDb, MAX_TEXT_BYTES,
};

fn validate_text(text: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("Clipboard text cannot be empty".to_string());
    }
    if text.len() > MAX_TEXT_BYTES {
        return Err(format!(
            "Clipboard text exceeds the {} byte limit",
            MAX_TEXT_BYTES
        ));
    }
    Ok(())
}

#[command]
pub fn update_clipboard_text_entry(
    state: tauri::State<'_, ClipboardDb>,
    id: String,
    text: String,
) -> Result<(), String> {
    validate_text(&text)?;
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|error| error.to_string())?;
    let changed = conn
        .execute(
            "UPDATE clipboard_history
             SET text = ?2
             WHERE id = ?1 AND image_path IS NULL AND file_path IS NULL",
            params![id, text],
        )
        .map_err(|error| format!("update clipboard text: {error}"))?;
    if changed == 0 {
        return Err("Clipboard text entry was not found".to_string());
    }
    Ok(())
}

#[command]
pub fn create_clipboard_text_entry(
    state: tauri::State<'_, ClipboardDb>,
    text: String,
) -> Result<String, String> {
    validate_text(&text)?;
    let id = compute_id(&text);
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut guard = lock_db(&state.0);
    let conn = ensure_connection(&mut guard).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO clipboard_history (id, text, timestamp)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET text = excluded.text, timestamp = excluded.timestamp",
        params![id, text, timestamp],
    )
    .map_err(|error| format!("create clipboard text: {error}"))?;
    prune_clipboard_storage(conn);
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::validate_text;

    #[test]
    fn edited_clipboard_text_must_be_nonempty_and_bounded() {
        assert!(validate_text("updated text").is_ok());
        assert!(validate_text("  \n").is_err());
        assert!(validate_text(&"x".repeat(super::MAX_TEXT_BYTES + 1)).is_err());
    }
}
