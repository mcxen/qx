//! Lightweight floating QxIsland webview.
//! Blueprint: screencap `recording-controls` flags (NOT main floating_panel NSPanel).
//! Label: `island`. URL: `index.html?surface=island`.
//! v1: host-only show/hide; float flag defaults off in appearance settings.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

const ISLAND_LABEL: &str = "island";
const ISLAND_WIDTH: f64 = 400.0;
const ISLAND_HEIGHT: f64 = 34.0;
const BOTTOM_MARGIN: i32 = 24;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IslandWindowSnapshot {
    pub sessions_json: Option<String>,
    pub always_on_top: bool,
}

use std::sync::Mutex;

static SNAPSHOT: Mutex<IslandWindowSnapshot> = Mutex::new(IslandWindowSnapshot {
    sessions_json: None,
    always_on_top: true,
});

fn position_island(app: &AppHandle) {
    let Some(island) = app.get_webview_window(ISLAND_LABEL) else {
        return;
    };
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let pos = monitor.position();
    let logical_w = (size.width as f64) / scale;
    let logical_h = (size.height as f64) / scale;
    let x_logical = (logical_w - ISLAND_WIDTH) / 2.0;
    let y_logical = logical_h - ISLAND_HEIGHT - f64::from(BOTTOM_MARGIN);
    let x = pos.x + (x_logical * scale).round() as i32;
    let y = pos.y + (y_logical * scale).round() as i32;
    let _ = island.set_position(PhysicalPosition::new(x, y));
}

fn ensure_island_window(app: &AppHandle, always_on_top: bool) -> Result<(), String> {
    if app.get_webview_window(ISLAND_LABEL).is_some() {
        return Ok(());
    }
    WebviewWindowBuilder::new(
        app,
        ISLAND_LABEL,
        WebviewUrl::App("index.html?surface=island".into()),
    )
    .title("Qx Island")
    .inner_size(ISLAND_WIDTH, ISLAND_HEIGHT)
    .min_inner_size(ISLAND_WIDTH, ISLAND_HEIGHT)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(always_on_top)
    .skip_taskbar(true)
    .focused(false)
    .accept_first_mouse(true)
    .build()
    .map_err(|error| format!("open island window: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn island_window_ensure(app: AppHandle, always_on_top: Option<bool>) -> Result<(), String> {
    let aot = always_on_top.unwrap_or(true);
    if let Ok(mut snap) = SNAPSHOT.lock() {
        snap.always_on_top = aot;
    }
    crate::runtime::run_ui(&app.clone(), move || {
        ensure_island_window(&app, aot)?;
        if let Some(win) = app.get_webview_window(ISLAND_LABEL) {
            let _ = win.set_always_on_top(aot);
            let _ = win.set_size(LogicalSize::new(ISLAND_WIDTH, ISLAND_HEIGHT));
            position_island(&app);
            let _ = win.hide();
        }
        Ok::<(), String>(())
    })?
}

#[tauri::command]
pub fn island_window_show(app: AppHandle, always_on_top: Option<bool>) -> Result<(), String> {
    let aot =
        always_on_top.unwrap_or_else(|| SNAPSHOT.lock().map(|s| s.always_on_top).unwrap_or(true));
    crate::runtime::run_ui(&app.clone(), move || {
        ensure_island_window(&app, aot)?;
        let win = app
            .get_webview_window(ISLAND_LABEL)
            .ok_or_else(|| "island window unavailable".to_string())?;
        let _ = win.set_always_on_top(aot);
        position_island(&app);
        win.show()
            .map_err(|error| format!("show island window: {error}"))?;
        Ok::<(), String>(())
    })?
}

#[tauri::command]
pub fn island_window_hide(app: AppHandle) -> Result<(), String> {
    crate::runtime::run_ui(&app.clone(), move || {
        if let Some(win) = app.get_webview_window(ISLAND_LABEL) {
            let _ = win.hide();
        }
        Ok::<(), String>(())
    })?
}

#[tauri::command]
pub fn island_window_set_always_on_top(app: AppHandle, always_on_top: bool) -> Result<(), String> {
    if let Ok(mut snap) = SNAPSHOT.lock() {
        snap.always_on_top = always_on_top;
    }
    crate::runtime::run_ui(&app.clone(), move || {
        if let Some(win) = app.get_webview_window(ISLAND_LABEL) {
            let _ = win.set_always_on_top(always_on_top);
        }
        Ok::<(), String>(())
    })?
}

#[tauri::command]
pub fn island_window_get_snapshot() -> IslandWindowSnapshot {
    SNAPSHOT.lock().map(|s| s.clone()).unwrap_or_default()
}

#[tauri::command]
pub fn island_sessions_publish(sessions_json: String) -> Result<(), String> {
    if let Ok(mut snap) = SNAPSHOT.lock() {
        snap.sessions_json = Some(sessions_json);
    }
    Ok(())
}
