use tauri::utils::config::Color;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use super::geometry::{covers_full_display, physical_frame};
use super::types::PickerSession;
use crate::display::{all_capture_monitors, capture_monitor, tauri_monitor_for_capture};

pub(super) const PICKER_LABEL: &str = "region-picker";
const SHADE_PREFIX: &str = "region-picker-shade-";

pub(super) fn shade_label(monitor_id: u32) -> String {
    format!("{SHADE_PREFIX}{monitor_id}")
}

pub(crate) fn is_picker_surface(label: &str) -> bool {
    label == PICKER_LABEL || label.starts_with(SHADE_PREFIX)
}

/// Hide every outer multi-display shade surface (kept alive for reuse).
pub(super) fn hide_shades(app: &AppHandle) {
    for window in app.webview_windows().into_values() {
        if window.label().starts_with(SHADE_PREFIX) {
            let _ = window.hide();
        }
    }
}

/// Show outer shades on every non-active display. No-op on a single-display
/// machine (the expensive path multi-monitor capture must not pay). Callers
/// invoke this from the AppKit/Tauri main-thread hop.
pub(super) fn show_shades(app: &AppHandle, active_monitor_id: u32) -> Result<(), String> {
    let shade_displays = all_capture_monitors()?
        .into_iter()
        .filter_map(|capture| {
            let id = capture.id().ok()?;
            let monitor = tauri_monitor_for_capture(app, &capture).ok()?;
            let scale = monitor.scale_factor().max(1.0);
            Some((
                id,
                monitor.position().x,
                monitor.position().y,
                monitor.size().width,
                monitor.size().height,
                scale,
            ))
        })
        .collect::<Vec<_>>();
    // Single display: nothing to shade, nothing to follow. Drop any leftover
    // outer webs from a previous multi-display session and return immediately.
    if shade_displays.len() <= 1 {
        hide_shades(app);
        return Ok(());
    }
    let desired_shades = shade_displays
        .iter()
        .filter(|(id, ..)| *id != active_monitor_id)
        .map(|(id, ..)| shade_label(*id))
        .collect::<std::collections::HashSet<_>>();

    for window in app.webview_windows().into_values() {
        if window.label().starts_with(SHADE_PREFIX) && !desired_shades.contains(window.label()) {
            let _ = window.hide();
        }
    }

    for (shade_id, shade_x, shade_y, shade_w, shade_h, shade_scale) in &shade_displays {
        let label = shade_label(*shade_id);
        if *shade_id == active_monitor_id {
            if let Some(active_shade) = app.get_webview_window(&label) {
                let _ = active_shade.hide();
            }
            continue;
        }
        let logical_width = *shade_w as f64 / *shade_scale;
        let logical_height = *shade_h as f64 / *shade_scale;
        let logical_x = *shade_x as f64 / *shade_scale;
        let logical_y = *shade_y as f64 / *shade_scale;
        let shade = if let Some(existing) = app.get_webview_window(&label) {
            existing
        } else {
            WebviewWindowBuilder::new(
                app,
                &label,
                // monitorId lets the shade webview request a handoff without a
                // second IPC to discover which display it covers.
                WebviewUrl::App(
                    format!("index.html?view=region-picker-shade&monitorId={shade_id}").into(),
                ),
            )
            .title("Qx Capture Shade")
            .inner_size(logical_width, logical_height)
            .position(logical_x, logical_y)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .transparent(true)
            .background_color(Color(0, 0, 0, 0))
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            // First click on an outer display must activate that picker surface.
            .accept_first_mouse(true)
            .content_protected(true)
            .build()
            .map_err(|error| format!("open capture shade: {error}"))?
        };
        let _ = shade.set_content_protected(true);
        let _ = shade.set_always_on_top(true);
        shade
            .set_position(PhysicalPosition::new(*shade_x, *shade_y))
            .map_err(|error| format!("position capture shade: {error}"))?;
        shade
            .set_size(PhysicalSize::new(*shade_w, *shade_h))
            .map_err(|error| format!("size capture shade: {error}"))?;
        // Outer shades own the pointer so desktop apps underneath cannot steal
        // the first click while multi-display capture is active.
        shade
            .set_ignore_cursor_events(false)
            .map_err(|error| format!("capture shade input: {error}"))?;
        if !shade.is_visible().unwrap_or(false) {
            shade
                .show()
                .map_err(|error| format!("show capture shade: {error}"))?;
        }
    }
    Ok(())
}

pub(super) fn hide(app: &AppHandle) {
    // Keep the reusable WebView alive; destroying the final visible surface
    // while main is hidden can make the background app look terminated.
    let app = app.clone();
    let _ = crate::main_thread::run_on_main(&app.clone(), move || {
        for window in app.webview_windows().into_values() {
            if is_picker_surface(window.label()) {
                let _ = window.hide();
            }
        }
    });
}

pub(super) fn restore_editable_selection(app: &AppHandle, session: &PickerSession) -> bool {
    let Some(area) = session.logical_area.clone() else {
        return false;
    };
    let monitor_id = session.monitor_id;
    let app = app.clone();
    crate::main_thread::run_on_main(&app.clone(), move || {
        let Some(picker) = app.get_webview_window(PICKER_LABEL) else {
            return false;
        };
        let Ok(capture) = capture_monitor(Some(monitor_id)) else {
            return false;
        };
        let Ok(monitor) = tauri_monitor_for_capture(&app, &capture) else {
            return false;
        };
        let _ = area; // presence already validated before hop
        if show_shades(&app, monitor_id).is_err() {
            return false;
        }
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
    })
    .unwrap_or(false)
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
        .clone()
        .ok_or_else(|| "Capture selection area is unavailable".to_string())?;
    let monitor_id = session.monitor_id;
    let app = app.clone();
    crate::main_thread::run_on_main(&app.clone(), move || {
        let capture = capture_monitor(Some(monitor_id))?;
        let monitor = tauri_monitor_for_capture(&app, &capture)?;
        let scale = monitor.scale_factor().max(1.0);
        let logical_width = monitor.size().width as f64 / scale;
        let logical_height = monitor.size().height as f64 / scale;
        let picker = app
            .get_webview_window(PICKER_LABEL)
            .ok_or_else(|| "region picker window is unavailable".to_string())?;
        let _ = picker.hide();
        if covers_full_display(&area, logical_width, logical_height) {
            return Ok(false);
        }

        let frame = physical_frame(monitor.position().x, monitor.position().y, scale, &area);
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
    })?
}
