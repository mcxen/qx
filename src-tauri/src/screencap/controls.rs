use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use super::state::{picker, CONTROLS_PINNED};
use crate::display::{capture_monitor, cursor_monitor, tauri_monitor_for_capture};

pub(super) const CONTROL_LABEL: &str = "recording-controls";
const CONTROLS_LOGICAL_W: f64 = 340.0;
const CONTROLS_LOGICAL_H: f64 = 36.0;

pub(super) fn set_ui_protected(app: &AppHandle, protected: bool) {
    if let Some(main) = app.get_webview_window(crate::floating_panel::MAIN_LABEL) {
        let _ = main.set_content_protected(protected);
    }
    if let Some(controls) = app.get_webview_window(CONTROL_LABEL) {
        // The standalone controller must never appear in captured output.
        let _ = controls.set_content_protected(true);
    }
}

/// Place the recording island beneath the selected region when possible.
/// Full-screen/no-selection capture falls back to the display's bottom center.
pub(super) fn position(app: &AppHandle) {
    let Some(controls) = app.get_webview_window(CONTROL_LABEL) else {
        return;
    };
    let session = picker().lock().ok().and_then(|session| session.clone());
    let session_monitor = session
        .as_ref()
        .and_then(|session| capture_monitor(Some(session.monitor_id)).ok())
        .and_then(|monitor| tauri_monitor_for_capture(app, &monitor).ok());
    let monitor = session_monitor
        .or_else(|| cursor_monitor(app))
        .or_else(|| {
            app.get_webview_window(crate::floating_panel::MAIN_LABEL)
                .and_then(|main| main.current_monitor().ok().flatten())
        })
        .or_else(|| controls.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let work = monitor.work_area();
    let scale = monitor.scale_factor().max(1.0);
    let width = (CONTROLS_LOGICAL_W * scale).round() as i32;
    let height = (CONTROLS_LOGICAL_H * scale).round() as i32;
    let margin = (10.0 * scale).round() as i32;
    let logical_monitor_width = monitor.size().width as f64 / scale;
    let logical_monitor_height = monitor.size().height as f64 / scale;
    let selected_area = session
        .and_then(|session| session.logical_area)
        .filter(|area| {
            area.w as f64 + 1.0 < logical_monitor_width
                || area.h as f64 + 1.0 < logical_monitor_height
        });
    let (x, y) = if let Some(area) = selected_area {
        let desired_x = monitor.position().x
            + ((area.x as f64 + area.w as f64 / 2.0) * scale).round() as i32
            - width / 2;
        let below =
            monitor.position().y + ((area.y + area.h) as f64 * scale).round() as i32 + margin;
        let above = monitor.position().y + (area.y as f64 * scale).round() as i32 - height - margin;
        let max_x = work.position.x + work.size.width as i32 - width;
        let x = desired_x.clamp(work.position.x, max_x.max(work.position.x));
        let max_y = work.position.y + work.size.height as i32 - height;
        let y = if below <= max_y {
            below
        } else {
            above.max(work.position.y)
        };
        (x, y)
    } else {
        (
            work.position.x + (work.size.width as i32 - width) / 2,
            work.position.y + work.size.height as i32 - height - (20.0 * scale) as i32,
        )
    };
    let _ = controls.set_size(PhysicalSize::new(width.max(1) as u32, height.max(1) as u32));
    let _ = controls.set_position(PhysicalPosition::new(x, y));
}

#[cfg(target_os = "macos")]
fn promote(controls: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::NSWindowCollectionBehavior;
    let Ok(ptr) = controls.ns_window() else {
        return;
    };
    let ns_window = ptr as *mut AnyObject;
    if ns_window.is_null() {
        return;
    }
    unsafe {
        let _: () = msg_send![ns_window, setLevel: 3isize];
        let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle;
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
        let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
        let _: () = msg_send![ns_window, orderFrontRegardless];
    }
}

pub(super) fn show(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(CONTROL_LABEL).is_none() {
        WebviewWindowBuilder::new(
            app,
            CONTROL_LABEL,
            WebviewUrl::App("index.html?view=recording-controls".into()),
        )
        .title("Qx Recording Controls")
        .inner_size(CONTROLS_LOGICAL_W, CONTROLS_LOGICAL_H)
        .min_inner_size(CONTROLS_LOGICAL_W, CONTROLS_LOGICAL_H)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .accept_first_mouse(true)
        .content_protected(true)
        .visible(true)
        .build()
        .map_err(|error| format!("open recording controls: {error}"))?;
    }
    let controls = app
        .get_webview_window(CONTROL_LABEL)
        .ok_or_else(|| "recording controls window is unavailable".to_string())?;
    let _ = controls.set_content_protected(true);
    let _ = controls.set_always_on_top(true);
    let _ = controls.set_ignore_cursor_events(false);
    position(app);
    controls
        .show()
        .map_err(|error| format!("show recording controls: {error}"))?;
    #[cfg(target_os = "macos")]
    promote(&controls);
    #[cfg(not(target_os = "macos"))]
    let _ = controls.set_focus();
    super::recording_session::emit_recording_status(app);
    Ok(())
}

pub(super) fn hide(app: &AppHandle) {
    if let Some(controls) = app.get_webview_window(CONTROL_LABEL) {
        let _ = controls.hide();
    }
}

pub(super) fn reassert(app: &AppHandle) {
    let Some(controls) = app.get_webview_window(CONTROL_LABEL) else {
        return;
    };
    position(app);
    let _ = controls.show();
    #[cfg(target_os = "macos")]
    promote(&controls);
}

pub(super) fn restore_surface(app: &AppHandle, suppress_ms: u64) -> Result<(), String> {
    if CONTROLS_PINNED.load(Ordering::Relaxed) {
        show(app)
    } else {
        hide(app);
        crate::floating_panel::suppress_auto_hide(std::time::Duration::from_millis(suppress_ms));
        crate::floating_panel::show_and_navigate(app, "screencap");
        Ok(())
    }
}
