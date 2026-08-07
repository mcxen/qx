//! Lightweight host-rendered Tray panel.
//!
//! The panel consumes declarative manifest providers and native Rust services;
//! it never starts a plugin iframe/runtime merely to show live controls.

use std::sync::{Mutex, OnceLock};

use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder,
};

use crate::display::{
    capture_monitor_id_for_display_area, display_area_for_window, pointer_anchor_on_display,
    resolve_pointer_display, DisplayArea,
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

fn place_panel_on_display(
    window: &tauri::WebviewWindow,
    app: &AppHandle,
    area: DisplayArea,
    physical_hint: Option<(f64, f64)>,
) {
    let scale = area.scale_factor.max(1.0);
    let width = (WIDTH * scale).round() as i32;
    let height = (HEIGHT * scale).round() as i32;
    let right = area.work_x.saturating_add(area.work_width as i32);
    let bottom = area.work_y.saturating_add(area.work_height as i32);
    let (cursor_x, cursor_y) = pointer_anchor_on_display(app, area, physical_hint);
    let x = (cursor_x.round() as i32 - width / 2)
        .clamp(area.work_x, (right - width).max(area.work_x));
    let y = (cursor_y.round() as i32 + (8.0 * scale) as i32)
        .clamp(area.work_y, (bottom - height).max(area.work_y));
    let _ = window.set_size(PhysicalSize::new(width.max(1) as u32, height.max(1) as u32));
    let _ = window.set_position(PhysicalPosition::new(x, y));
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
    // TrayIconEvent carries a position, but on macOS the status-item coordinate
    // can be scaled with the menu bar's backing factor. Placement always goes
    // through the shared display port (Tauri physical cursor, NSEvent raw
    // sample, then the tray-click hint) so an external-display menu bar opens
    // the panel on that same display.
    let window = ensure_window(app)?;
    if window.is_visible().unwrap_or(false) {
        return window
            .hide()
            .map_err(|error| format!("hide tray panel: {error}"));
    }

    let physical_hint = Some((click_x, click_y));
    let area = resolve_pointer_display(app, Some(&window), physical_hint).ok_or_else(|| {
        "Cannot resolve the display under the pointer for the tray panel".to_string()
    })?;
    let display_id = capture_monitor_id_for_display_area(app, area);
    set_focused_display_id(display_id);
    let _ = app.emit("tray-focus-display", display_id);

    place_panel_on_display(&window, app, area, physical_hint);

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
pub fn toggle_at(app: &AppHandle, click_x: f64, click_y: f64) -> Result<(), String> {
    let area = resolve_pointer_display(app, None, Some((click_x, click_y)));
    let display_id = area.and_then(|area| capture_monitor_id_for_display_area(app, area));
    set_focused_display_id(display_id.or_else(|| crate::display::cursor_capture_monitor_id(app)));
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
    let logical_width = width.clamp(280.0, 480.0);
    let logical_height = height.clamp(150.0, 520.0);
    window
        .set_size(LogicalSize::new(logical_width, logical_height))
        .map_err(|error| format!("resize tray panel: {error}"))?;

    // Clamp inside the monitor the panel already occupies — do not re-resolve
    // the live pointer, or a mid-resize mouse move would teleport the panel.
    if let Some(area) = display_area_for_window(&window) {
        if let Ok(position) = window.outer_position() {
            let scale = area.scale_factor.max(1.0);
            let physical_width = (logical_width * scale).round() as i32;
            let physical_height = (logical_height * scale).round() as i32;
            let right = area.work_x.saturating_add(area.work_width as i32);
            let bottom = area.work_y.saturating_add(area.work_height as i32);
            let x = position
                .x
                .clamp(area.work_x, (right - physical_width).max(area.work_x));
            let y = position
                .y
                .clamp(area.work_y, (bottom - physical_height).max(area.work_y));
            if x != position.x || y != position.y {
                let _ = window.set_position(PhysicalPosition::new(x, y));
            }
        }
    }
    let _ = app;
    Ok(())
}
