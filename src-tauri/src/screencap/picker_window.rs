use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

use super::geometry::{covers_full_display, physical_frame};
use super::types::PickerSession;
use crate::display::{capture_monitor, tauri_monitor_for_capture};

pub(super) const PICKER_LABEL: &str = "region-picker";

pub(super) fn hide(app: &AppHandle) {
    // Keep the reusable WebView alive; destroying the final visible surface
    // while main is hidden can make the background app look terminated.
    if let Some(picker) = app.get_webview_window(PICKER_LABEL) {
        let _ = picker.hide();
    }
}

pub(super) fn restore_editable_selection(app: &AppHandle, session: &PickerSession) -> bool {
    let Some(_) = session.logical_area else {
        return false;
    };
    let Some(picker) = app.get_webview_window(PICKER_LABEL) else {
        return false;
    };
    let Ok(capture) = capture_monitor(Some(session.monitor_id)) else {
        return false;
    };
    let Ok(monitor) = tauri_monitor_for_capture(app, &capture) else {
        return false;
    };
    let _ = picker.hide();
    let _ = picker.set_content_protected(true);
    if picker.set_ignore_cursor_events(false).is_err()
        || picker
            .set_position(PhysicalPosition::new(
                monitor.position().x,
                monitor.position().y,
            ))
            .is_err()
        || picker
            .set_size(PhysicalSize::new(
                monitor.size().width,
                monitor.size().height,
            ))
            .is_err()
        || picker.show().is_err()
    {
        let _ = picker.hide();
        return false;
    }
    let _ = picker.set_focus();
    true
}

/// Reuse the protected picker only after shrinking it to the selected region.
/// A transparent fullscreen WebView must never remain above the desktop while
/// recording because a passthrough failure would swallow all user input.
pub(super) fn show_recording_frame(
    app: &AppHandle,
    session: &PickerSession,
) -> Result<bool, String> {
    let area = session
        .logical_area
        .as_ref()
        .ok_or_else(|| "Capture selection area is unavailable".to_string())?;
    let capture = capture_monitor(Some(session.monitor_id))?;
    let monitor = tauri_monitor_for_capture(app, &capture)?;
    let scale = monitor.scale_factor().max(1.0);
    let logical_width = monitor.size().width as f64 / scale;
    let logical_height = monitor.size().height as f64 / scale;
    let picker = app
        .get_webview_window(PICKER_LABEL)
        .ok_or_else(|| "region picker window is unavailable".to_string())?;
    let _ = picker.hide();
    if covers_full_display(area, logical_width, logical_height) {
        return Ok(false);
    }

    let frame = physical_frame(monitor.position().x, monitor.position().y, scale, area);
    picker
        .set_position(PhysicalPosition::new(frame.x, frame.y))
        .map_err(|error| format!("position recording frame: {error}"))?;
    picker
        .set_size(PhysicalSize::new(frame.width, frame.height))
        .map_err(|error| format!("size recording frame: {error}"))?;
    picker
        .set_ignore_cursor_events(true)
        .map_err(|error| format!("enable recording frame mouse passthrough: {error}"))?;
    picker
        .show()
        .map_err(|error| format!("show recording frame: {error}"))?;
    Ok(true)
}
