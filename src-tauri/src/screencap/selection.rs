use tauri::{
    command, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder,
};

use super::controls::{
    hide as hide_recording_controls_internal, restore_surface as restore_capture_surface,
    set_ui_protected as set_recording_ui_protected,
};
use super::geometry::capture_coordinate_scale;
use super::picker_window::{self, PICKER_LABEL};
use super::recording_session;
use super::screenshot::capture as take_screenshot_blocking;
use super::state::{
    begin_picker_session, end_picker_session, picker as picker_session, picker_pointer_following,
    picker_session_is_current, recording as recording_state, runtime as runtime_status,
    set_picker_pointer_follow,
};
use super::types::{CaptureMode, PickerSession};
use super::{CaptureDisplay, PickerStatus, RecordArea, RecordingOptions};
use crate::desktop_windows::{self, DesktopWindow};
use crate::display::{
    capture_monitor, capture_monitor_for_tauri, cursor_monitor, displays, tauri_monitor_for_capture,
};

pub(super) fn ensure_screen_capture_permission() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if !crate::permissions::screen_recording_granted() {
            let _ = crate::permissions::qx_permissions_request("screen-recording".to_string());
            if !crate::permissions::screen_recording_granted() {
                return Err(
                    "Screen Recording permission required. Enable Qx in System Settings → Privacy & Security → Screen Recording, then fully quit and reopen Qx."
                        .to_string(),
                );
            }
        }
    }
    Ok(())
}

pub(super) fn restore_picker_selection_internal(app: &AppHandle) -> bool {
    let session = picker_session()
        .lock()
        .ok()
        .and_then(|session| session.clone());
    let Some(session) = session else {
        return false;
    };
    crate::floating_panel::hide(app);
    hide_recording_controls_internal(app);
    if !picker_window::restore_editable_selection(app, &session) {
        return false;
    }
    // Push session geometry back to the picker webview so a remount or
    // recording-frame shrink cannot leave an empty overlay.
    if let Some(status) = screencap_region_select_status_with_restore(true) {
        let _ = app.emit("screencap:picker", status);
    }
    true
}

fn picker_status_from_session(session: &PickerSession, restore_selection: bool) -> PickerStatus {
    PickerStatus {
        mode: session.mode.as_str().to_string(),
        monitor_id: session.monitor_id,
        monitor_name: session.monitor_name.clone(),
        coordinate_scale: session.coordinate_scale,
        logical_area: session.logical_area.clone(),
        restore_selection,
    }
}

fn screencap_region_select_status_with_restore(restore_selection: bool) -> Option<PickerStatus> {
    picker_session()
        .lock()
        .ok()
        .and_then(|session| session.clone())
        .map(|session| picker_status_from_session(&session, restore_selection))
}

pub(super) fn show_picker_recording_frame_safely(app: &AppHandle) {
    let session = picker_session()
        .lock()
        .ok()
        .and_then(|session| session.clone());
    let result = session
        .as_ref()
        .ok_or_else(|| "Capture selection session is unavailable".to_string())
        .and_then(|session| picker_window::show_recording_frame(app, session));
    if let Err(error) = result {
        hide_region_picker_internal(app);
        crate::diagnostics::log(
            crate::diagnostics::LogLevel::Warn,
            "screencap.recording_frame",
            "recording frame disabled to preserve desktop input",
            serde_json::json!({ "error": error }),
        );
    }
}

pub(super) fn hide_region_picker_internal(app: &AppHandle) {
    picker_window::hide(app);
}

fn show_region_picker_internal(
    app: &AppHandle,
    mode: CaptureMode,
    selected_monitor_id: Option<u32>,
) -> Result<(), String> {
    let capture_monitor = match selected_monitor_id {
        Some(monitor_id) => capture_monitor(Some(monitor_id))?,
        None => {
            let monitor = cursor_monitor(app)
                .or_else(|| app.primary_monitor().ok().flatten())
                .ok_or_else(|| "No display found".to_string())?;
            capture_monitor_for_tauri(app, &monitor)?
        }
    };
    let monitor = tauri_monitor_for_capture(app, &capture_monitor)?;
    let position = monitor.position();
    let size = monitor.size();
    let scale = monitor.scale_factor().max(1.0);
    // Logical size of the selected display (matches CSS clientX/Y in the picker).
    let logical_w = size.width as f64 / scale;
    let logical_h = size.height as f64 / scale;
    let logical_x = position.x as f64 / scale;
    let logical_y = position.y as f64 / scale;
    let monitor_id = capture_monitor
        .id()
        .map_err(|error| format!("display id: {error}"))?;
    let monitor_name = capture_monitor
        .friendly_name()
        .or_else(|_| capture_monitor.name())
        .unwrap_or_else(|_| "Display".to_string());
    let capture_width = capture_monitor
        .width()
        .map_err(|error| format!("display width: {error}"))?;
    let coordinate_scale = capture_coordinate_scale(capture_width, logical_w);
    if let Ok(mut session) = picker_session().lock() {
        *session = Some(PickerSession {
            mode,
            monitor_id,
            monitor_name,
            coordinate_scale,
            logical_area: None,
            frame_x: position.x,
            frame_y: position.y,
        });
    }
    // Window create/show/focus are AppKit main-thread only when reached from async commands.
    let app_for_ui = app.clone();
    let pos_x = position.x;
    let pos_y = position.y;
    let size_w = size.width;
    let size_h = size.height;
    crate::main_thread::run_on_main(&app_for_ui.clone(), move || {
        if app_for_ui.get_webview_window(PICKER_LABEL).is_none() {
            WebviewWindowBuilder::new(
                &app_for_ui,
                PICKER_LABEL,
                WebviewUrl::App("index.html?view=region-picker".into()),
            )
            .title("Qx Region Picker")
            .inner_size(logical_w, logical_h)
            .position(logical_x, logical_y)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(true)
            .accept_first_mouse(true)
            // Picker must never end up in the recording itself.
            .content_protected(true)
            .build()
            .map_err(|error| format!("open region picker: {error}"))?;
        }

        let picker = app_for_ui
            .get_webview_window(PICKER_LABEL)
            .ok_or_else(|| "region picker window is unavailable".to_string())?;
        let _ = picker.set_content_protected(true);
        let _ = picker.set_always_on_top(true);
        // Cover the selected display exactly. Physical size/position matches the
        // monitor framebuffer; CSS clientX/Y stay in logical points (DPR scaled).
        let _ = picker.set_position(PhysicalPosition::new(pos_x, pos_y));
        let _ = picker.set_size(PhysicalSize::new(size_w, size_h));
        picker
            .show()
            .map_err(|error| format!("show region picker: {error}"))?;
        let _ = picker.set_ignore_cursor_events(false);
        let _ = picker.set_focus();
        Ok::<(), String>(())
    })??;
    if let Some(status) = screencap_region_select_status_with_restore(false) {
        let _ = app.emit("screencap:picker", status);
    }
    Ok(())
}

fn start_pointer_display_tracker(app: AppHandle, generation: u64) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(120)).await;
            if !picker_session_is_current(generation) {
                break;
            }
            if !picker_pointer_following(generation) {
                continue;
            }
            let Some(cursor_display) = cursor_monitor(&app) else {
                continue;
            };
            let cursor_position = cursor_display.position();
            let current = picker_session().lock().ok().and_then(|session| {
                session
                    .as_ref()
                    .map(|session| (session.mode, session.frame_x, session.frame_y))
            });
            let Some((mode, frame_x, frame_y)) = current else {
                break;
            };
            if cursor_position.x == frame_x && cursor_position.y == frame_y {
                continue;
            }
            let Ok(capture) = capture_monitor_for_tauri(&app, &cursor_display) else {
                continue;
            };
            let Ok(monitor_id) = capture.id() else {
                continue;
            };
            if !picker_pointer_following(generation) {
                continue;
            }
            if let Err(error) = show_region_picker_internal(&app, mode, Some(monitor_id)) {
                crate::diagnostics::log(
                    crate::diagnostics::LogLevel::Warn,
                    "screencap.pointer_follow",
                    "failed to move capture picker to pointer display",
                    serde_json::json!({ "error": error, "monitorId": monitor_id }),
                );
            }
        }
    });
}

#[command]
pub async fn screencap_begin_region_select(app: AppHandle) -> Result<(), String> {
    screencap_begin_capture_select(app, "recording".to_string()).await
}

/// Start region selection on the display under the pointer.
#[command]
pub async fn screencap_begin_capture_select(app: AppHandle, mode: String) -> Result<(), String> {
    if recording_state()
        .lock()
        .map(|recording| recording.is_some())
        .unwrap_or(false)
    {
        return Err("A screen recording is already in progress".to_string());
    }
    ensure_screen_capture_permission()?;
    let mode = CaptureMode::parse(&mode)?;
    // Invalidate any stale picker tracker before replacing its session.
    let generation = begin_picker_session();
    // Map/show the picker before hiding every existing Qx surface. If display
    // matching or window creation fails, the user must never be left with an
    // apparently terminated app and no way to recover.
    show_region_picker_internal(&app, mode, None).map_err(|error| {
        crate::diagnostics::log(
            crate::diagnostics::LogLevel::Error,
            "screencap.picker",
            "failed to open capture picker",
            serde_json::json!({ "error": error, "mode": mode.as_str() }),
        );
        end_picker_session();
        error
    })?;
    start_pointer_display_tracker(app.clone(), generation);
    hide_recording_controls_internal(&app);
    crate::floating_panel::hide(&app);
    Ok(())
}

/// Compatibility facade — prefer system command `display_list`.
#[command]
pub fn screencap_list_displays() -> Result<Vec<CaptureDisplay>, String> {
    displays()
}

/// Capture workflow facade over the system desktop-window inventory.
/// Prefer `desktop_windows_list` for non-capture features.
#[command]
pub fn screencap_list_windows() -> Result<Vec<DesktopWindow>, String> {
    let session = picker_session()
        .lock()
        .ok()
        .and_then(|session| session.clone())
        .ok_or_else(|| "Capture selection session is unavailable".to_string())?;
    desktop_windows::list_windows_for_capture(session.monitor_id, session.coordinate_scale)
}

/// Allow desktop interaction under the picker during countdown delays.
#[command]
pub fn screencap_set_picker_passthrough(app: AppHandle, enabled: bool) -> Result<(), String> {
    let picker = app
        .get_webview_window(PICKER_LABEL)
        .ok_or_else(|| "region picker window is unavailable".to_string())?;
    picker
        .set_ignore_cursor_events(enabled)
        .map_err(|error| format!("picker passthrough: {error}"))?;
    if !enabled {
        let _ = picker.set_focus();
    }
    Ok(())
}

/// Follow the display under the pointer only while the picker is still idle.
#[command]
pub fn screencap_set_pointer_follow(enabled: bool) {
    set_picker_pointer_follow(enabled);
}

#[command]
pub fn screencap_select_display(app: AppHandle, monitor_id: u32) -> Result<(), String> {
    // An explicit monitor choice is sticky until the user clears/restarts the
    // selection; otherwise the pointer left on the old screen would snap back.
    set_picker_pointer_follow(false);
    let mode = picker_session()
        .lock()
        .ok()
        .and_then(|session| session.as_ref().map(|session| session.mode))
        .ok_or_else(|| "Capture selection session is unavailable".to_string())?;
    show_region_picker_internal(&app, mode, Some(monitor_id))
}

#[command]
pub fn screencap_region_select_status() -> Option<PickerStatus> {
    screencap_region_select_status_with_restore(false)
}

#[command]
pub async fn screencap_cancel_region_select(app: AppHandle) -> Result<(), String> {
    end_picker_session();
    hide_region_picker_internal(&app);
    if let Ok(mut session) = picker_session().lock() {
        *session = None;
    }
    restore_capture_surface(&app, 800)
}

/// Confirm a logical-point crop from the picker and start recording immediately.
#[command]
pub async fn screencap_confirm_region_select(
    app: AppHandle,
    area: RecordArea,
    options: Option<RecordingOptions>,
    action: Option<String>,
    annotation_overlay_base64: Option<String>,
    copy_to_clipboard: Option<bool>,
) -> Result<(), String> {
    let session = picker_session()
        .lock()
        .ok()
        .and_then(|session| session.clone())
        .ok_or_else(|| "Capture selection session is unavailable".to_string())?;
    end_picker_session();
    let logical_area = RecordArea {
        monitor_id: Some(session.monitor_id),
        ..area.clone()
    };
    if let Ok(mut current) = picker_session().lock() {
        if let Some(current) = current.as_mut() {
            current.logical_area = Some(logical_area);
        }
    }
    let scale = session.coordinate_scale;
    let area = RecordArea {
        x: (area.x as f64 * scale).round().max(0.0) as u32,
        y: (area.y as f64 * scale).round().max(0.0) as u32,
        w: (area.w as f64 * scale).round().max(2.0) as u32,
        h: (area.h as f64 * scale).round().max(2.0) as u32,
        monitor_id: Some(session.monitor_id),
    };
    if area.w < 16 || area.h < 16 {
        return Err("Selection too small — drag a larger region".to_string());
    }
    let action = action
        .as_deref()
        .map(CaptureMode::parse)
        .transpose()?
        .unwrap_or(session.mode);
    if action == CaptureMode::Recording && annotation_overlay_base64.is_some() {
        return Err("Annotations can only be applied to screenshots".to_string());
    }
    if action == CaptureMode::Screenshot {
        let copy_to_clipboard = copy_to_clipboard.unwrap_or(false);
        hide_region_picker_internal(&app);
        // Convert a worker panic into the same recoverable error path as capture
        // and filesystem failures. Returning early here would leave every Qx
        // surface hidden and look indistinguishable from a process crash.
        //
        // Pattern: runtime::blocking (capture) → runtime::ui (clipboard + restore).
        let result = crate::runtime::blocking(move || {
            take_screenshot_blocking(area, annotation_overlay_base64)
        })
        .await
        .map_err(|error| format!("screenshot worker failed: {error}"))
        .and_then(|inner| inner);
        match result {
            Ok(output) => {
                let output_path = output.path.to_string_lossy().to_string();
                let path_for_clip = output.path.clone();
                let path_for_event = output_path.clone();
                let app_ui = app.clone();
                let auto_hide_after_capture = crate::settings::read_settings()
                    .screencap
                    .auto_hide_after_capture;
                let clipboard_error = crate::runtime::ui(&app, move || {
                    let clipboard_error = if copy_to_clipboard {
                        crate::clipboard::write_image_file_to_clipboard(&app_ui, &path_for_clip)
                            .err()
                            .map(|error| {
                                format!("Screenshot saved, but automatic copy failed: {error}")
                            })
                    } else {
                        None
                    };
                    if let Ok(mut status) = runtime_status().lock() {
                        status.phase = "done";
                        status.started_at = None;
                        status.area = None;
                        status.output_path = Some(path_for_event.clone());
                        status.error = clipboard_error.clone();
                    }
                    if let Ok(mut session) = picker_session().lock() {
                        *session = None;
                    }
                    set_recording_ui_protected(&app_ui, false);
                    restore_capture_surface(&app_ui, 800)?;
                    if auto_hide_after_capture {
                        hide_recording_controls_internal(&app_ui);
                    }
                    recording_session::emit_recording_status(&app_ui);
                    Ok::<Option<String>, String>(clipboard_error)
                })
                .await
                .map_err(|error| error.to_string())??;
                let _ = clipboard_error;
                // Delay so the main screencap surface can mount listeners first.
                let emit_app = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                    let _ = emit_app.emit(
                        "screencap:captured",
                        serde_json::json!({
                            "kind": "screenshot",
                            "path": output_path,
                        }),
                    );
                });
                return Ok(());
            }
            Err(error) => {
                crate::diagnostics::log(
                    crate::diagnostics::LogLevel::Error,
                    "screencap.screenshot",
                    "screenshot capture failed; restoring selection surface",
                    serde_json::json!({ "error": error }),
                );
                if let Ok(mut status) = runtime_status().lock() {
                    status.phase = "error";
                    status.started_at = None;
                    status.error = Some(error.clone());
                }
                recording_session::emit_recording_status(&app);
                if !restore_picker_selection_internal(&app) {
                    let _ = restore_capture_surface(&app, 800);
                }
                return Err(error);
            }
        }
    }
    // Area is CSS client points on a picker that covers the chosen display.
    match recording_session::start_recording(app.clone(), Some(area), options).await {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = restore_picker_selection_internal(&app);
            recording_session::emit_recording_status(&app);
            Err(error)
        }
    }
}
