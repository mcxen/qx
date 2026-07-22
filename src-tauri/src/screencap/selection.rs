use tauri::utils::config::Color;
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
    set_picker_interaction_lock, set_picker_pointer_follow,
};
use super::storage::{load_last_region, save_last_region};
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
        multi_display: session.multi_display,
    }
}

/// True when the host has two or more capture displays.
/// `force_refresh` bypasses the macOS inventory TTL so hot-plug is visible.
fn host_is_multi_display(force_refresh: bool) -> bool {
    let monitors = if force_refresh {
        crate::display::refresh_capture_monitor_cache()
    } else {
        crate::display::all_capture_monitors()
    };
    monitors.map(|list| list.len() > 1).unwrap_or(false)
}

/// Apply a multi-display flag change to the live picker session (shades + follow
/// + frontend). No-op when the picker is closed or the flag is unchanged.
///
/// Called from the display-monitor poll (hot-plug) and the picker topology
/// revalidation loop so a newly attached external monitor is never stuck in the
/// single-display fast path.
///
/// `force_refresh` should be true when the caller has not just refreshed the
/// display inventory; false when `refresh_capture_monitor_cache` already ran.
pub(crate) fn on_display_topology_changed(app: &AppHandle, force_refresh: bool) {
    let multi = host_is_multi_display(force_refresh);
    let monitor_id = {
        let Ok(mut guard) = picker_session().lock() else {
            return;
        };
        let Some(session) = guard.as_mut() else {
            return;
        };
        if session.multi_display == multi {
            return;
        }
        session.multi_display = multi;
        session.monitor_id
    };

    if multi {
        // Do not force follow=true here — an in-progress drag must keep the
        // picker pinned. Frontend re-arms follow when idle after multiDisplay
        // flips true; outer shade clicks still hand off immediately.
        let app_ui = app.clone();
        let mid = monitor_id;
        let _ = crate::main_thread::run_on_main(&app_ui.clone(), move || {
            let _ = picker_window::show_shades(&app_ui, mid);
        });
    } else {
        set_picker_pointer_follow(false);
        let app_ui = app.clone();
        let _ = crate::main_thread::run_on_main(&app_ui.clone(), move || {
            picker_window::hide_shades(&app_ui);
        });
    }

    // Lightweight event — do not re-emit screencap:picker (that clears drafts).
    let _ = app.emit(
        "screencap:multi-display",
        serde_json::json!({ "multiDisplay": multi }),
    );
    crate::diagnostics::log(
        crate::diagnostics::LogLevel::Info,
        "screencap.display_topology",
        if multi {
            "picker upgraded to multi-display mode after topology change"
        } else {
            "picker demoted to single-display mode after topology change"
        },
        serde_json::json!({ "multiDisplay": multi, "monitorId": monitor_id }),
    );
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
    let selected_capture = match selected_monitor_id {
        Some(monitor_id) => capture_monitor(Some(monitor_id))?,
        None => {
            let monitor = cursor_monitor(app)
                .or_else(|| app.primary_monitor().ok().flatten())
                .ok_or_else(|| "No display found".to_string())?;
            capture_monitor_for_tauri(app, &monitor)?
        }
    };
    let monitor = tauri_monitor_for_capture(app, &selected_capture)?;
    let position = monitor.position();
    let size = monitor.size();
    let scale = monitor.scale_factor().max(1.0);
    // Logical size of the selected display (matches CSS clientX/Y in the picker).
    let logical_w = size.width as f64 / scale;
    let logical_h = size.height as f64 / scale;
    let logical_x = position.x as f64 / scale;
    let logical_y = position.y as f64 / scale;
    let monitor_id = selected_capture
        .id()
        .map_err(|error| format!("display id: {error}"))?;
    let monitor_name = selected_capture
        .friendly_name()
        .or_else(|_| selected_capture.name())
        .unwrap_or_else(|_| "Display".to_string());
    let capture_width = selected_capture
        .width()
        .map_err(|error| format!("display width: {error}"))?;
    let coordinate_scale = capture_coordinate_scale(capture_width, logical_w);
    // Fresh open always force-refreshes inventory (hot-plug since last open).
    // Relocations reuse the session flag; topology revalidation / display
    // monitor may flip it while the picker stays open.
    let multi_display = if selected_monitor_id.is_none() {
        host_is_multi_display(true)
    } else {
        picker_session()
            .lock()
            .ok()
            .and_then(|session| session.as_ref().map(|session| session.multi_display))
            .unwrap_or_else(|| host_is_multi_display(false))
    };
    if let Ok(mut session) = picker_session().lock() {
        *session = Some(PickerSession {
            mode,
            monitor_id,
            monitor_name,
            coordinate_scale,
            logical_area: None,
            frame_x: position.x,
            frame_y: position.y,
            multi_display,
        });
    }
    // Window create/show/focus are AppKit main-thread only when reached from async commands.
    let app_for_ui = app.clone();
    let pos_x = position.x;
    let pos_y = position.y;
    let size_w = size.width;
    let size_h = size.height;
    crate::main_thread::run_on_main(&app_for_ui.clone(), move || {
        // Multi-display only: outer shades on non-active screens. Single-display
        // skips this entirely (no shade windows, no extra monitor enumeration
        // beyond the early count already cached on macOS).
        if multi_display {
            picker_window::show_shades(&app_for_ui, monitor_id)?;
        } else {
            picker_window::hide_shades(&app_for_ui);
        }

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
            // WebView2 defaults to an opaque black controller background even
            // when the native window is transparent. Alpha=0 is the explicit
            // Windows 8+ transparent WebView contract in Tauri.
            .background_color(Color(0, 0, 0, 0))
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

fn session_is_multi_display() -> bool {
    picker_session()
        .lock()
        .ok()
        .and_then(|session| session.as_ref().map(|session| session.multi_display))
        .unwrap_or(false)
}

fn start_pointer_display_tracker(app: AppHandle, generation: u64) {
    // Always spawn: single-display stays on a slow topology watch so plugging
    // an external monitor mid-session can promote into multi-display mode.
    // Multi-display uses the fast 12ms cursor handoff loop.
    if !session_is_multi_display() {
        set_picker_pointer_follow(false);
    }
    tauri::async_runtime::spawn(async move {
        let mut fast = tokio::time::interval(std::time::Duration::from_millis(12));
        fast.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut last_topology = std::time::Instant::now()
            .checked_sub(std::time::Duration::from_secs(1))
            .unwrap_or_else(std::time::Instant::now);

        loop {
            if !picker_session_is_current(generation) {
                break;
            }

            // Hot-plug revalidation (~2Hz while open). display_monitor also
            // calls on_display_topology_changed; this covers the case where
            // the picker opened single-display and a monitor appears before
            // the next 2s poll, or the OS report lags the first attach.
            if last_topology.elapsed() >= std::time::Duration::from_millis(500) {
                last_topology = std::time::Instant::now();
                // Force refresh so attach between display_monitor's 2s polls is seen.
                on_display_topology_changed(&app, true);
            }

            if !session_is_multi_display() {
                // Single-display: no cursor handoff work — just wait for topology.
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                continue;
            }

            fast.tick().await;
            if !picker_session_is_current(generation) {
                break;
            }
            if !picker_pointer_following(generation) {
                continue;
            }
            // Light path: only cursor position + monitor geometry (no xcap).
            let Some(cursor_display) = cursor_monitor(&app) else {
                continue;
            };
            let cursor_position = cursor_display.position();
            let current = picker_session().lock().ok().and_then(|session| {
                session.as_ref().map(|session| {
                    (
                        session.mode,
                        session.monitor_id,
                        session.frame_x,
                        session.frame_y,
                    )
                })
            });
            let Some((mode, current_monitor_id, frame_x, frame_y)) = current else {
                break;
            };
            // Same physical origin ⇒ still on the active display (cheap reject).
            if cursor_position.x == frame_x && cursor_position.y == frame_y {
                continue;
            }
            let Ok(capture) = capture_monitor_for_tauri(&app, &cursor_display) else {
                continue;
            };
            let Ok(monitor_id) = capture.id() else {
                continue;
            };
            // Matching capture id is authoritative when origins differ slightly
            // across DPI / origin rounding (common on Windows mixed-DPI).
            if monitor_id == current_monitor_id {
                continue;
            }
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
    // Only multi-display sessions pay for the pointer-follow task.
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

/// Pin the picker to the current display for the duration of a drag/resize.
/// Must be set true on pointerdown *before* the first move (Windows WebView2
/// can otherwise lose the draft when a late handoff emits screencap:picker).
#[command]
pub fn screencap_set_picker_interaction_lock(locked: bool) {
    set_picker_interaction_lock(locked);
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
    // After a screenshot: "clipboard" copies OCR text; "editor" opens Text Toolbox.
    ocr_destination: Option<String>,
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
    // Persist for silent recapture (global shortcut) even if the picker webview dies.
    let _ = save_last_region(&logical_area);
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
        let ocr_destination = ocr_destination
            .as_deref()
            .map(|value| value.trim().to_ascii_lowercase())
            .filter(|value| value == "clipboard" || value == "editor");
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

                // OCR off the UI thread after the shot is on disk.
                let ocr_result = if let Some(dest) = ocr_destination.clone() {
                    let path = output.path.clone();
                    match crate::runtime::blocking(move || {
                        crate::ocr::recognize_image_path(&path, "screenshot")
                    })
                    .await
                    {
                        Ok(Ok(result)) => Some(Ok((dest, result))),
                        Ok(Err(error)) => Some(Err(error)),
                        Err(error) => Some(Err(format!("OCR worker: {error}"))),
                    }
                } else {
                    None
                };

                let clipboard_error = crate::runtime::ui(&app, move || {
                    use tauri_plugin_clipboard_manager::ClipboardExt;
                    let mut clipboard_error = if copy_to_clipboard {
                        crate::clipboard::write_image_file_to_clipboard(&app_ui, &path_for_clip)
                            .err()
                            .map(|error| {
                                format!("Screenshot saved, but automatic copy failed: {error}")
                            })
                    } else {
                        None
                    };

                    if let Some(outcome) = ocr_result {
                        match outcome {
                            Ok((dest, result)) => {
                                if dest == "clipboard" {
                                    if let Err(error) =
                                        app_ui.clipboard().write_text(result.text.clone())
                                    {
                                        clipboard_error = Some(format!(
                                            "Screenshot saved, but OCR copy failed: {error}"
                                        ));
                                    }
                                }
                                let _ = app_ui.emit(
                                    "screencap:ocr",
                                    serde_json::json!({
                                        "destination": dest,
                                        "text": result.text,
                                        "engine": result.engine,
                                        "path": path_for_event,
                                        "charCount": result.char_count,
                                        "id": result.id,
                                    }),
                                );
                            }
                            Err(error) => {
                                clipboard_error =
                                    Some(format!("Screenshot saved, but OCR failed: {error}"));
                                let _ = app_ui.emit(
                                    "screencap:ocr",
                                    serde_json::json!({
                                        "destination": ocr_destination.clone(),
                                        "error": error,
                                        "path": path_for_event,
                                    }),
                                );
                            }
                        }
                    }

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

/// Scale picker-logical points on a monitor into capture-backend pixels.
fn physical_area_from_logical(
    app: &AppHandle,
    logical: &RecordArea,
) -> Result<RecordArea, String> {
    let monitor = capture_monitor(logical.monitor_id)?;
    let tauri_monitor = tauri_monitor_for_capture(app, &monitor)?;
    let size = tauri_monitor.size();
    let scale_factor = tauri_monitor.scale_factor().max(1.0);
    let logical_w = size.width as f64 / scale_factor;
    let capture_width = monitor
        .width()
        .map_err(|error| format!("display width: {error}"))?;
    let scale = capture_coordinate_scale(capture_width, logical_w);
    let monitor_id = monitor
        .id()
        .map_err(|error| format!("display id: {error}"))?;
    Ok(RecordArea {
        x: (logical.x as f64 * scale).round().max(0.0) as u32,
        y: (logical.y as f64 * scale).round().max(0.0) as u32,
        w: (logical.w as f64 * scale).round().max(2.0) as u32,
        h: (logical.h as f64 * scale).round().max(2.0) as u32,
        monitor_id: Some(monitor_id),
    })
}

/// Silent re-shot of the last confirmed region — no picker UI.
#[command]
pub async fn screencap_recapture_last_region(app: AppHandle) -> Result<(), String> {
    if recording_state()
        .lock()
        .map(|recording| recording.is_some())
        .unwrap_or(false)
    {
        return Err("A screen recording is already in progress".to_string());
    }
    ensure_screen_capture_permission()?;
    let logical = load_last_region().ok_or_else(|| {
        "No previous capture region. Take a screenshot first.".to_string()
    })?;
    let physical = physical_area_from_logical(&app, &logical)?;
    if physical.w < 16 || physical.h < 16 {
        return Err("Selection too small — drag a larger region".to_string());
    }

    // Leave the desktop clear so Qx chrome is not in the frame.
    hide_recording_controls_internal(&app);
    crate::floating_panel::hide(&app);
    hide_region_picker_internal(&app);
    // Brief compositor grace (same order of magnitude as screenshot::capture).
    tokio::time::sleep(std::time::Duration::from_millis(40)).await;

    let copy_to_clipboard = crate::settings::read_settings()
        .screencap
        .auto_copy_to_clipboard;
    let auto_hide_after_capture = crate::settings::read_settings()
        .screencap
        .auto_hide_after_capture;

    let result = crate::runtime::blocking(move || take_screenshot_blocking(physical, None))
        .await
        .map_err(|error| format!("screenshot worker failed: {error}"))
        .and_then(|inner| inner);

    match result {
        Ok(output) => {
            let output_path = output.path.to_string_lossy().to_string();
            let path_for_clip = output.path.clone();
            let path_for_event = output_path.clone();
            let app_ui = app.clone();
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
            Ok(())
        }
        Err(error) => {
            crate::diagnostics::log(
                crate::diagnostics::LogLevel::Error,
                "screencap.screenshot",
                "silent recapture failed; restoring capture surface",
                serde_json::json!({ "error": error }),
            );
            if let Ok(mut status) = runtime_status().lock() {
                status.phase = "error";
                status.started_at = None;
                status.error = Some(error.clone());
            }
            recording_session::emit_recording_status(&app);
            let _ = restore_capture_surface(&app, 800);
            Err(error)
        }
    }
}
