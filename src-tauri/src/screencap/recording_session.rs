use chrono::Local;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{command, AppHandle, Emitter, Manager};

use super::controls::{
    self, restore_surface as restore_capture_surface,
    set_ui_protected as set_recording_ui_protected, show as show_recording_controls_internal,
    CONTROL_LABEL,
};
use super::picker_window::PICKER_LABEL;
use super::recording_engine::run as recording_loop;
use super::selection;
use super::state;
use super::state::{
    picker as picker_session, recording as recording_state, runtime as runtime_status,
    take_capture_error, CONTROLS_PINNED, FRAME_COUNT,
};
use super::storage::{captures_dir, insert_history};
use super::types::RecordingState;
use super::{RecordArea, RecordingOptions, RecordingStatusSnapshot};
use crate::display::cursor_capture_monitor_id;

fn recording_status_snapshot(app: &AppHandle) -> RecordingStatusSnapshot {
    let controls_visible = app
        .get_webview_window(CONTROL_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    let Ok(status) = runtime_status().lock() else {
        return RecordingStatusSnapshot {
            phase: "error".to_string(),
            is_recording: false,
            elapsed_ms: 0,
            frame_count: FRAME_COUNT.load(Ordering::Relaxed),
            area: None,
            output_path: None,
            error: Some("Recording status is unavailable".to_string()),
            controls_visible,
            controls_pinned: CONTROLS_PINNED.load(Ordering::Relaxed),
        };
    };
    RecordingStatusSnapshot {
        phase: status.phase.to_string(),
        is_recording: recording_state()
            .lock()
            .map(|recording| recording.is_some())
            .unwrap_or_else(|_| matches!(status.phase, "recording" | "processing")),
        elapsed_ms: status
            .started_at
            .map(|started| started.elapsed().as_millis() as u64)
            .unwrap_or(0),
        frame_count: FRAME_COUNT.load(Ordering::Relaxed),
        area: status.area.clone(),
        output_path: status.output_path.clone(),
        error: status.error.clone(),
        controls_visible,
        controls_pinned: CONTROLS_PINNED.load(Ordering::Relaxed),
    }
}

pub(super) fn emit_recording_status(app: &AppHandle) {
    let _ = app.emit("screencap:state", recording_status_snapshot(app));
}

fn abort_recording_start_blocking() {
    let state = recording_state()
        .lock()
        .ok()
        .and_then(|mut recording| recording.take());
    let Some(mut state) = state else {
        return;
    };
    state.stop_flag.store(true, Ordering::Relaxed);
    if let Some(handle) = state.thread_handle.take() {
        if let Ok(Ok(output)) = handle.join() {
            let _ = fs::remove_file(output.path);
        }
    }
    let _ = take_capture_error();
}

#[command]
pub async fn start_recording(
    app: AppHandle,
    area: Option<RecordArea>,
    options: Option<RecordingOptions>,
) -> Result<(), String> {
    selection::ensure_screen_capture_permission()?;

    let started_at;
    {
        let mut guard = recording_state().lock().map_err(|e| format!("lock: {e}"))?;
        if guard.is_some() {
            return Err("Already recording".to_string());
        }
        state::clear_capture_error();
        FRAME_COUNT.store(0, Ordering::Relaxed);

        let options = options.unwrap_or_default().normalize();
        let timestamp = Local::now().format("%Y%m%d_%H%M%S_%3f").to_string();
        let output_path =
            captures_dir().join(format!("recording_{timestamp}.{}", options.extension));
        let stop_flag = std::sync::Arc::new(AtomicBool::new(false));
        let stop_clone = stop_flag.clone();
        let monitor_id = area
            .as_ref()
            .and_then(|value| value.monitor_id)
            .or_else(|| cursor_capture_monitor_id(&app));
        let capture_area = area.clone();
        let handle = std::thread::spawn(move || {
            recording_loop(output_path, capture_area, monitor_id, options, stop_clone)
        });

        started_at = std::time::Instant::now();
        *guard = Some(RecordingState {
            stop_flag,
            thread_handle: Some(handle),
            started_at,
        });
    }

    if let Ok(mut status) = runtime_status().lock() {
        status.phase = "recording";
        status.started_at = Some(started_at);
        status.area = area;
        status.output_path = None;
        status.error = None;
    }
    // All AppKit window work (hide picker, protect surfaces, show island) must
    // run on the main thread. Off-main orderFront/setLevel aborts with SIGTRAP.
    let keep_selection_frame = picker_session()
        .lock()
        .ok()
        .and_then(|session| {
            session
                .as_ref()
                .map(|session| session.logical_area.is_some())
        })
        .unwrap_or(false);

    let ui_app = app.clone();
    let ui_result = crate::main_thread::run_on_main(&ui_app.clone(), move || {
        // Hide the fullscreen picker first. A region recording later reuses the
        // same WebView only after shrinking it to the selected rectangle.
        if let Some(picker) = ui_app.get_webview_window(PICKER_LABEL) {
            let _ = picker.hide();
        }
        if let Some(main) = ui_app.get_webview_window(crate::floating_panel::MAIN_LABEL) {
            let _ = main.set_content_protected(true);
        }
        if let Some(controls) = ui_app.get_webview_window(CONTROL_LABEL) {
            let _ = controls.set_content_protected(true);
        }
        crate::floating_panel::hide(&ui_app);
        if keep_selection_frame {
            selection::show_picker_recording_frame_safely(&ui_app);
        }
        show_recording_controls_internal(&ui_app)?;
        // Re-assert visibility once more (macOS Space / fullscreen races).
        controls::reassert(&ui_app);
        Ok::<(), String>(())
    });

    match ui_result {
        Ok(Ok(())) => {
            emit_recording_status(&app);
            Ok(())
        }
        Ok(Err(error)) | Err(error) => {
            let error = if error.starts_with("recording controls") {
                error
            } else {
                format!("recording controls failed to open: {error}")
            };
            let _ = tauri::async_runtime::spawn_blocking(abort_recording_start_blocking).await;
            if let Ok(mut status) = runtime_status().lock() {
                status.phase = "error";
                status.started_at = None;
                status.error = Some(error.clone());
            }
            emit_recording_status(&app);
            let _ = selection::restore_picker_selection_internal(&app);
            Err(error)
        }
    }
}

/// Open a dedicated transparent fullscreen picker (no main-window glass mask).
fn stop_recording_blocking() -> Result<String, String> {
    let mut guard = recording_state().lock().map_err(|e| format!("lock: {e}"))?;
    let mut state = guard.take().ok_or("Not recording")?;
    drop(guard);

    state.stop_flag.store(true, Ordering::Relaxed);
    let duration_ms = state.started_at.elapsed().as_millis() as u64;
    let output = state
        .thread_handle
        .take()
        .ok_or_else(|| "recording worker is unavailable".to_string())?
        .join()
        .map_err(|_| "recording worker crashed".to_string())??;
    if let Some(error) = take_capture_error() {
        let _ = fs::remove_file(&output.path);
        return Err(error);
    }
    insert_history(
        &output.path,
        output.width,
        output.height,
        output.frame_count,
        duration_ms,
    )
    .map_err(|error| format!("save recording history: {error}"))?;
    Ok(output.path.to_string_lossy().to_string())
}

#[command]
pub async fn stop_recording(app: AppHandle) -> Result<String, String> {
    // Joining the capture thread and finalizing the MP4/MOV container can block
    // briefly. Keep that work off Tauri's async core threads so the launcher and
    // its progress island remain responsive.
    if let Ok(mut status) = runtime_status().lock() {
        status.phase = "processing";
        status.error = None;
    }
    emit_recording_status(&app);
    let result = tauri::async_runtime::spawn_blocking(stop_recording_blocking)
        .await
        .map_err(|e| format!("recording encoder worker failed: {e}"))?;

    match &result {
        Ok(path) => {
            let capture_settings = crate::settings::read_settings().screencap;
            let copy_error = if capture_settings.auto_copy_to_clipboard {
                let path_for_clipboard = std::path::PathBuf::from(path);
                let copy_result = match crate::runtime::ui(&app, move || {
                    crate::clipboard::media::write_file_path_to_clipboard(&path_for_clipboard)
                })
                .await
                {
                    Ok(result) => result,
                    Err(error) => Err(error.to_string()),
                };
                copy_result
                    .err()
                    .map(|error| format!("Recording saved, but automatic copy failed: {error}"))
            } else {
                None
            };
            if let Ok(mut status) = runtime_status().lock() {
                status.phase = "done";
                status.started_at = None;
                status.output_path = Some(path.clone());
                status.error = copy_error;
            }
        }
        Err(error) => {
            if let Ok(mut status) = runtime_status().lock() {
                status.phase = "error";
                status.started_at = None;
                status.error = Some(error.clone());
            }
        }
    }

    set_recording_ui_protected(&app, false);
    // Let the picker frontend leave recording-frame mode before the window is
    // expanded back to the full display for editing.
    emit_recording_status(&app);
    // A region capture returns to the same protected selection frame so the
    // user can move/resize and record again. Captures started without a picker
    // retain the normal main/pinned-island restoration behavior.
    if !selection::restore_picker_selection_internal(&app) {
        restore_capture_surface(&app, 1200)?;
    }
    if crate::settings::read_settings()
        .screencap
        .auto_hide_after_capture
    {
        controls::hide(&app);
    }
    emit_recording_status(&app);
    result
}

/// A capture worker can fail before the user presses Stop (permission backend,
/// display disconnect, encoder startup). Reap it from the status poll so the UI
/// cannot remain forever in a false "recording" state.
fn reap_failed_recording_worker(app: &AppHandle) {
    let state = recording_state().lock().ok().and_then(|mut recording| {
        let finished = recording
            .as_ref()
            .and_then(|state| state.thread_handle.as_ref())
            .is_some_and(std::thread::JoinHandle::is_finished);
        finished.then(|| recording.take()).flatten()
    });
    let Some(mut state) = state else {
        return;
    };
    let worker_error = match state.thread_handle.take().map(|handle| handle.join()) {
        Some(Ok(Ok(output))) => {
            let _ = fs::remove_file(output.path);
            "Recording worker ended unexpectedly".to_string()
        }
        Some(Ok(Err(error))) => error,
        Some(Err(_)) => "Recording worker crashed".to_string(),
        None => "Recording worker is unavailable".to_string(),
    };
    let error = take_capture_error().unwrap_or(worker_error);
    if let Ok(mut status) = runtime_status().lock() {
        status.phase = "error";
        status.started_at = None;
        status.error = Some(error);
    }
    set_recording_ui_protected(app, false);
    if !selection::restore_picker_selection_internal(app) {
        let _ = restore_capture_surface(app, 800);
    }
}

#[command]
pub fn recording_status(app: AppHandle) -> RecordingStatusSnapshot {
    reap_failed_recording_worker(&app);
    recording_status_snapshot(&app)
}
