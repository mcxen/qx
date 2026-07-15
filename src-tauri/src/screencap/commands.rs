use std::sync::atomic::Ordering;

use tauri::{command, AppHandle, Manager};

use super::controls::{
    hide as hide_recording_controls_internal, set_ui_protected as set_recording_ui_protected,
    show as show_recording_controls_internal, CONTROL_LABEL,
};
use super::recording_session;
use super::state::recording;
use super::state::CONTROLS_PINNED;
use super::storage;
use super::storage::insert_history;
use super::types::GifEntry;

#[command]
pub async fn convert_recording_to_gif(
    source_path: String,
    max_width: Option<u32>,
    fps: Option<u32>,
) -> Result<String, String> {
    let output = tauri::async_runtime::spawn_blocking(move || {
        crate::media::gif::convert_recording_to_gif(
            source_path,
            max_width.unwrap_or(960),
            fps.unwrap_or(12),
        )
    })
    .await
    .map_err(|error| format!("GIF conversion worker failed: {error}"))??;
    insert_history(
        &output.path,
        output.width,
        output.height,
        output.frame_count,
        output.duration_ms,
    )
    .map_err(|error| format!("save GIF history: {error}"))?;
    Ok(output.path.to_string_lossy().to_string())
}

#[command]
pub fn save_gif(source_path: String, dest_path: String) -> Result<String, String> {
    storage::save_capture(source_path, dest_path)
}

#[command]
pub fn list_gif_history(limit: Option<u32>) -> Vec<GifEntry> {
    storage::list_history(limit)
}

#[command]
pub fn is_recording() -> bool {
    recording()
        .lock()
        .map(|recording| recording.is_some())
        .unwrap_or(false)
}

#[command]
pub fn get_screencap_history(limit: Option<u32>) -> Vec<GifEntry> {
    list_gif_history(limit)
}

#[command]
pub fn delete_screencap(id: i64) -> Result<(), String> {
    storage::delete_capture(id)
}

#[command]
pub async fn screencap_show_controls(app: AppHandle) -> Result<(), String> {
    set_recording_ui_protected(&app, true);
    show_recording_controls_internal(&app)
}

#[command]
pub fn screencap_toggle_controls(app: AppHandle) -> Result<(), String> {
    let visible = app
        .get_webview_window(CONTROL_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    if visible {
        hide_recording_controls_internal(&app);
        recording_session::emit_recording_status(&app);
        Ok(())
    } else {
        set_recording_ui_protected(&app, true);
        show_recording_controls_internal(&app)
    }
}

#[command]
pub fn screencap_hide_controls(app: AppHandle) {
    hide_recording_controls_internal(&app);
    recording_session::emit_recording_status(&app);
}

#[command]
pub fn screencap_set_controls_pinned(app: AppHandle, pinned: bool) -> Result<(), String> {
    CONTROLS_PINNED.store(pinned, Ordering::Relaxed);
    if pinned {
        show_recording_controls_internal(&app)?;
    } else if recording()
        .lock()
        .map(|recording| recording.is_none())
        .unwrap_or(false)
    {
        hide_recording_controls_internal(&app);
    }
    recording_session::emit_recording_status(&app);
    Ok(())
}

#[command]
pub fn screencap_return_to_main(app: AppHandle) {
    hide_recording_controls_internal(&app);
    set_recording_ui_protected(&app, true);
    crate::floating_panel::suppress_auto_hide(std::time::Duration::from_millis(800));
    crate::floating_panel::show_and_navigate(&app, "screencap");
    recording_session::emit_recording_status(&app);
}
