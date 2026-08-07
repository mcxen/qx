//! Lightweight host-rendered Tray panel.
//!
//! The panel consumes declarative manifest providers and native Rust services;
//! it never starts a plugin iframe/runtime merely to show live controls.

use std::sync::{Mutex, OnceLock};

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder,
};

const LABEL: &str = "tray-panel";
const WIDTH: f64 = 360.0;
const HEIGHT: f64 = 420.0;

fn focused_display_id() -> &'static Mutex<Option<u32>> {
    static FOCUSED_DISPLAY_ID: OnceLock<Mutex<Option<u32>>> = OnceLock::new();
    FOCUSED_DISPLAY_ID.get_or_init(|| Mutex::new(None))
}

fn set_focused_display_id(display_id: Option<u32>) {
    if let Ok(mut focused) = focused_display_id().lock() {
        *focused = display_id;
    }
}

fn current_focused_display_id() -> Option<u32> {
    focused_display_id()
        .lock()
        .ok()
        .and_then(|focused| *focused)
}

#[cfg(target_os = "macos")]
fn ensure_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?surface=tray".into()),
    )
    .title("Qx Tray")
    .inner_size(WIDTH, HEIGHT)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .accept_first_mouse(true)
    .build()
    .map_err(|error| format!("open tray panel: {error}"))
}

#[cfg(target_os = "macos")]
pub fn toggle_at(app: &AppHandle, click_x: f64, click_y: f64) -> Result<(), String> {
    // TrayIconEvent also carries a position, but on macOS its status-item
    // coordinate can be scaled using the menu bar's backing scale factor.
    // The runtime cursor position is the canonical physical screen coordinate
    // used by Tauri's monitor APIs and remains correct when the menu bar is on
    // an external display.
    let cursor = app
        .cursor_position()
        .unwrap_or_else(|_| PhysicalPosition::new(click_x, click_y));
    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let display_id = monitor.as_ref().and_then(|monitor| {
        crate::display::capture_monitor_for_tauri(app, monitor)
            .ok()
            .and_then(|capture| capture.id().ok())
    });
    set_focused_display_id(display_id);
    let _ = app.emit("tray-focus-display", display_id);

    let window = ensure_window(app)?;
    if window.is_visible().unwrap_or(false) {
        return window
            .hide()
            .map_err(|error| format!("hide tray panel: {error}"));
    }
    if let Some(monitor) = monitor {
        let work = monitor.work_area();
        let scale = monitor.scale_factor().max(1.0);
        let width = (WIDTH * scale).round() as i32;
        let height = (HEIGHT * scale).round() as i32;
        let right = work.position.x.saturating_add(work.size.width as i32);
        let bottom = work.position.y.saturating_add(work.size.height as i32);
        let cursor_x = cursor.x.round() as i32;
        let cursor_y = cursor.y.round() as i32;
        let x = (cursor_x - width / 2).clamp(work.position.x, (right - width).max(work.position.x));
        let y = (cursor_y + (8.0 * scale) as i32)
            .clamp(work.position.y, (bottom - height).max(work.position.y));
        let _ = window.set_size(PhysicalSize::new(width.max(1) as u32, height.max(1) as u32));
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    // Keep the transient Tray surface independent from the reusable launcher.
    // Otherwise hiding this panel can reveal a main window that was already
    // underneath and look like a second "open Qx" action.
    if let Some(main) = app.get_webview_window(crate::floating_panel::MAIN_LABEL) {
        if main.is_visible().unwrap_or(false) {
            let _ = main.hide();
        }
    }
    window
        .show()
        .map_err(|error| format!("show tray panel: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("focus tray panel: {error}"))
}

#[cfg(not(target_os = "macos"))]
pub fn toggle_at(app: &AppHandle, _click_x: f64, _click_y: f64) -> Result<(), String> {
    set_focused_display_id(crate::display::cursor_capture_monitor_id(app));
    let _ = app.emit("tray-focus-display", current_focused_display_id());
    crate::floating_panel::show_floating(app);
    Ok(())
}

#[tauri::command]
pub fn tray_panel_get_focus_display() -> Option<u32> {
    current_focused_display_id()
}

#[tauri::command]
pub fn tray_panel_hide(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window
            .hide()
            .map_err(|error| format!("hide tray panel: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn tray_panel_open_settings(app: AppHandle) -> Result<(), String> {
    tray_panel_hide(app.clone())?;
    crate::floating_panel::show_and_navigate(&app, "settings");
    Ok(())
}

#[tauri::command]
pub fn tray_panel_run_action(app: AppHandle, action_id: String) -> Result<(), String> {
    tray_panel_hide(app.clone())?;
    crate::tray_menu::handle_tray_action(&app, &action_id);
    Ok(())
}

#[tauri::command]
pub fn tray_panel_resize(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    window
        .set_size(LogicalSize::new(
            width.clamp(280.0, 480.0),
            height.clamp(150.0, 520.0),
        ))
        .map_err(|error| format!("resize tray panel: {error}"))
}
