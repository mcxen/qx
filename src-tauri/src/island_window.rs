//! Lightweight floating QxIsland webview.
//! Blueprint: screencap `recording-controls` flags (NOT main floating_panel NSPanel).
//! Label: `island`. URL: `index.html?surface=island`.
//! v1: host-only show/hide; float flag defaults off in appearance settings.

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder,
};

const ISLAND_LABEL: &str = "island";
const ISLAND_WIDTH: f64 = 400.0;
const ISLAND_COMPACT_WIDTH: f64 = 240.0;
const ISLAND_HEIGHT: f64 = 34.0;
const TOP_MARGIN: f64 = 16.0;
const RIGHT_MARGIN: f64 = 20.0;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct IslandWindowSnapshot {
    pub sessions_json: Option<String>,
    pub always_on_top: bool,
    pub compact: bool,
}

use std::sync::Mutex;

static SNAPSHOT: Mutex<IslandWindowSnapshot> = Mutex::new(IslandWindowSnapshot {
    sessions_json: None,
    always_on_top: true,
    compact: false,
});

fn position_island(app: &AppHandle, compact: bool) {
    let Some(island) = app.get_webview_window(ISLAND_LABEL) else {
        return;
    };
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let work = monitor.work_area();
    let scale = monitor.scale_factor().max(1.0);
    let logical_width = if compact {
        ISLAND_COMPACT_WIDTH
    } else {
        ISLAND_WIDTH
    };
    let width = (logical_width * scale).round() as i32;
    let height = (ISLAND_HEIGHT * scale).round() as i32;
    let right_margin = (RIGHT_MARGIN * scale).round() as i32;
    let top_margin = (TOP_MARGIN * scale).round() as i32;
    let x = (work.position.x + work.size.width as i32 - width - right_margin).max(work.position.x);
    let y = work.position.y + top_margin;
    let _ = island.set_size(PhysicalSize::new(width.max(1) as u32, height.max(1) as u32));
    let _ = island.set_position(PhysicalPosition::new(x, y));
}

#[cfg(target_os = "macos")]
fn promote_without_focus(island: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::NSWindowCollectionBehavior;
    let Ok(ptr) = island.ns_window() else {
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
    .min_inner_size(ISLAND_COMPACT_WIDTH, ISLAND_HEIGHT)
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
    .visible(false)
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
            let compact = SNAPSHOT.lock().map(|snap| snap.compact).unwrap_or(false);
            let _ = win.set_always_on_top(aot);
            let width = if compact {
                ISLAND_COMPACT_WIDTH
            } else {
                ISLAND_WIDTH
            };
            let _ = win.set_size(LogicalSize::new(width, ISLAND_HEIGHT));
            position_island(&app, compact);
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
        let compact = SNAPSHOT.lock().map(|snap| snap.compact).unwrap_or(false);
        position_island(&app, compact);
        win.show()
            .map_err(|error| format!("show island window: {error}"))?;
        #[cfg(target_os = "macos")]
        promote_without_focus(&win);
        Ok::<(), String>(())
    })?
}

#[tauri::command]
pub fn island_window_set_compact(app: AppHandle, compact: bool) -> Result<(), String> {
    if let Ok(mut snap) = SNAPSHOT.lock() {
        snap.compact = compact;
    }
    crate::runtime::run_ui(&app.clone(), move || {
        if app.get_webview_window(ISLAND_LABEL).is_some() {
            position_island(&app, compact);
        }
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
