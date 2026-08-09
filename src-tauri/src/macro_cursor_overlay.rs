//! Desktop cursor visualizer used only while a macro capture session is active.
//!
//! The capture hook never touches this window. The recording worker emits a
//! throttled `macro:recording` position event and each transparent overlay
//! renders the marker locally. One surface is created per display so the
//! marker remains visible when the pointer crosses monitors.

use std::collections::HashSet;

use tauri::utils::config::Color;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

const SURFACE_PREFIX: &str = "macro-cursor-overlay-";

pub(crate) fn is_surface(label: &str) -> bool {
    label.starts_with(SURFACE_PREFIX)
}

fn surface_label(index: usize) -> String {
    format!("{SURFACE_PREFIX}{index}")
}

#[cfg(target_os = "macos")]
fn promote_without_focus(window: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::NSWindowCollectionBehavior;

    let Ok(ptr) = window.ns_window() else {
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

fn monitor_origin_for_events(monitor: &tauri::Monitor) -> (i32, i32) {
    let position = monitor.position();
    let scale = monitor.scale_factor().max(1.0);
    // CGEvent coordinates are point-based on macOS; Windows low-level mouse
    // hooks report physical desktop pixels. The overlay webview applies the
    // corresponding local scale when it receives the event.
    #[cfg(target_os = "macos")]
    {
        (
            (position.x as f64 / scale).round() as i32,
            (position.y as f64 / scale).round() as i32,
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        (position.x, position.y)
    }
}

fn show_now(app: &AppHandle) -> Result<(), String> {
    let monitors = app
        .available_monitors()
        .map_err(|error| format!("list macro cursor monitors: {error}"))?;
    let desired = monitors
        .iter()
        .enumerate()
        .map(|(index, _)| surface_label(index))
        .collect::<HashSet<_>>();

    for window in app.webview_windows().into_values() {
        if is_surface(window.label()) && !desired.contains(window.label()) {
            let _ = window.hide();
        }
    }

    for (index, monitor) in monitors.iter().enumerate() {
        let label = surface_label(index);
        let scale = monitor.scale_factor().max(1.0);
        let logical_width = monitor.size().width as f64 / scale;
        let logical_height = monitor.size().height as f64 / scale;
        let (event_x, event_y) = monitor_origin_for_events(monitor);
        let url = format!(
            "index.html?view=macro-cursor-overlay&monitorX={event_x}&monitorY={event_y}&scale={scale}"
        );
        let window = if let Some(existing) = app.get_webview_window(&label) {
            existing
        } else {
            WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
                .title("Qx Macro Cursor")
                .inner_size(logical_width, logical_height)
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
                .accept_first_mouse(false)
                .visible(false)
                .build()
                .map_err(|error| format!("open macro cursor overlay: {error}"))?
        };

        crate::auxiliary_window::make_non_activating(&window)?;
        window
            .set_always_on_top(true)
            .map_err(|error| format!("pin macro cursor overlay: {error}"))?;
        window
            .set_ignore_cursor_events(true)
            .map_err(|error| format!("make macro cursor overlay click-through: {error}"))?;
        window
            .set_position(PhysicalPosition::new(
                monitor.position().x,
                monitor.position().y,
            ))
            .map_err(|error| format!("position macro cursor overlay: {error}"))?;
        window
            .set_size(PhysicalSize::new(
                monitor.size().width,
                monitor.size().height,
            ))
            .map_err(|error| format!("size macro cursor overlay: {error}"))?;
        if !window.is_visible().unwrap_or(false) {
            window
                .show()
                .map_err(|error| format!("show macro cursor overlay: {error}"))?;
        }
        #[cfg(target_os = "macos")]
        promote_without_focus(&window);
    }

    Ok(())
}

/// Show all display overlays from the Tauri UI thread. Window creation is kept
/// out of the hook and recording worker so WebView2/AppKit stay on their
/// supported thread.
pub(crate) async fn show(app: AppHandle) -> Result<(), String> {
    let ui_app = app.clone();
    crate::runtime::ui(&app, move || show_now(&ui_app))
        .await
        .map_err(String::from)?
}

#[tauri::command]
pub async fn macro_cursor_overlay_show(app: AppHandle) -> Result<(), String> {
    show(app).await
}

/// Hide, but keep the WebViews reusable for the next recording.
pub(crate) fn hide(app: &AppHandle) -> Result<(), String> {
    let ui_app = app.clone();
    crate::runtime::run_ui(app, move || {
        for window in ui_app.webview_windows().into_values() {
            if is_surface(window.label()) {
                let _ = window.hide();
            }
        }
        Ok::<(), String>(())
    })?
}

#[tauri::command]
pub fn macro_cursor_overlay_hide(app: AppHandle) -> Result<(), String> {
    hide(&app)
}
