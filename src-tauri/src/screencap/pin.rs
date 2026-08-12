//! Desktop pin surfaces for screenshots (Snipaste-style 贴图).
//!
//! Each pin is an always-on-top undecorated webview showing one PNG. Pins are
//! independent of the main panel and region picker; closing a pin destroys it.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

const PIN_PREFIX: &str = "capture-pin-";
const MAX_PINS: usize = 16;
/// Cap initial on-screen size so a full-display shot does not cover everything.
const MAX_INITIAL_WORK_RATIO: f64 = 0.72;
const MIN_LOGICAL_EDGE: f64 = 80.0;

static PIN_SEQ: AtomicU64 = AtomicU64::new(1);
static PIN_LABELS: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinSurface {
    pub id: String,
    pub label: String,
    pub path: String,
}

pub(crate) fn is_pin_surface(label: &str) -> bool {
    label.starts_with(PIN_PREFIX)
}

fn remember_label(label: String) {
    if let Ok(mut labels) = PIN_LABELS.lock() {
        if !labels.iter().any(|existing| existing == &label) {
            labels.push(label);
        }
        // Drop closed labels that no longer exist.
        labels.retain(|entry| {
            // Keep for now; prune happens in close / close_all with AppHandle.
            !entry.is_empty()
        });
        if labels.len() > MAX_PINS * 2 {
            labels.truncate(MAX_PINS * 2);
        }
    }
}

fn forget_label(label: &str) {
    if let Ok(mut labels) = PIN_LABELS.lock() {
        labels.retain(|entry| entry != label);
    }
}

fn prune_labels(app: &AppHandle) {
    if let Ok(mut labels) = PIN_LABELS.lock() {
        labels.retain(|label| app.get_webview_window(label).is_some());
    }
}

fn active_pin_count(app: &AppHandle) -> usize {
    prune_labels(app);
    PIN_LABELS.lock().map(|labels| labels.len()).unwrap_or(0)
}

fn encode_path_query(path: &Path) -> String {
    // percent-encode so Windows drive letters and spaces survive the URL.
    let raw = path.to_string_lossy();
    let mut out = String::with_capacity(raw.len() * 2);
    for byte in raw.as_bytes() {
        match *byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'~'
            | b'/'
            | b'\\'
            | b':' => out.push(*byte as char),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

fn image_pixel_size(path: &Path) -> Result<(u32, u32), String> {
    let (width, height) =
        image::image_dimensions(path).map_err(|error| format!("read pin image size: {error}"))?;
    if width == 0 || height == 0 {
        return Err("Pin image has empty dimensions".to_string());
    }
    Ok((width, height))
}

#[cfg(target_os = "macos")]
fn promote_pin(window: &tauri::WebviewWindow) {
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
        // Floating panel level — above normal windows, below screen saver.
        let _: () = msg_send![ns_window, setLevel: 3isize];
        let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle;
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
        let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
        let _: () = msg_send![ns_window, orderFrontRegardless];
    }
}

#[derive(Debug, Clone, Copy)]
struct PinPlacement {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    zoom: f64,
}

fn pin_placement(
    app: &AppHandle,
    pixel_w: u32,
    pixel_h: u32,
    monitor_id: Option<u32>,
) -> Option<PinPlacement> {
    let monitor = monitor_id
        .and_then(|id| {
            crate::display::capture_monitor(Some(id))
                .ok()
                .and_then(|capture| crate::display::tauri_monitor_for_capture(app, &capture).ok())
        })
        .or_else(|| crate::display::cursor_monitor(app))
        .or_else(|| app.primary_monitor().ok().flatten());
    let monitor = monitor?;
    let work = monitor.work_area();
    let scale = monitor.scale_factor().max(1.0);
    // work_area size is physical pixels. Prefer 1:1 capture pixels, then fit.
    let max_w = (work.size.width as f64 * MAX_INITIAL_WORK_RATIO).max(MIN_LOGICAL_EDGE * scale);
    let max_h = (work.size.height as f64 * MAX_INITIAL_WORK_RATIO).max(MIN_LOGICAL_EDGE * scale);
    let fit = (max_w / pixel_w as f64)
        .min(max_h / pixel_h as f64)
        .min(1.0)
        .max(0.08);
    let width = ((pixel_w as f64) * fit)
        .round()
        .max(MIN_LOGICAL_EDGE * scale * 0.5) as i32;
    let height = ((pixel_h as f64) * fit)
        .round()
        .max(MIN_LOGICAL_EDGE * scale * 0.5) as i32;
    let x = work.position.x + (work.size.width as i32 - width).max(0) / 2;
    let y = work.position.y + (work.size.height as i32 - height).max(0) / 2;
    Some(PinPlacement {
        position: PhysicalPosition::new(x, y),
        size: PhysicalSize::new(width.max(1) as u32, height.max(1) as u32),
        zoom: fit,
    })
}

fn place_pin(window: &tauri::WebviewWindow, placement: Option<PinPlacement>) {
    let Some(placement) = placement else {
        return;
    };
    let _ = window.set_size(placement.size);
    let _ = window.set_position(placement.position);
}

fn open_pin_now(
    app: &AppHandle,
    path: PathBuf,
    pixel_w: u32,
    pixel_h: u32,
    monitor_id: Option<u32>,
) -> Result<PinSurface, String> {
    if !path.is_file() {
        return Err(format!("Pin image not found: {}", path.display()));
    }
    prune_labels(app);
    if active_pin_count(app) >= MAX_PINS {
        return Err(format!("At most {MAX_PINS} pinned screenshots at once"));
    }
    let id = PIN_SEQ.fetch_add(1, Ordering::Relaxed);
    let label = format!("{PIN_PREFIX}{id}");
    let encoded = encode_path_query(&path);
    let placement = pin_placement(app, pixel_w, pixel_h, monitor_id);
    // The frontend must start from the exact fit chosen here. Otherwise its
    // first image-load effect resizes the window while a native drag may
    // already be active, losing the pointer's relative position in the pin.
    let initial_zoom = placement.map(|value| value.zoom).unwrap_or(1.0);
    let url =
        format!("index.html?view=capture-pin&id={id}&path={encoded}&initialZoom={initial_zoom:.8}");
    // Seamless pin: undecorated + transparent; the WebView *is* the image.
    // Soft OS shadow stays so the floating photo still lifts off the desktop.
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("Qx Pin")
        .inner_size(320.0, 240.0)
        .min_inner_size(MIN_LOGICAL_EDGE, MIN_LOGICAL_EDGE)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(true)
        .accept_first_mouse(true)
        .visible(false)
        .build()
        .map_err(|error| format!("open pin window: {error}"))?;
    // Pins should accept activation so keyboard shortcuts (Esc, copy) work.
    let _ = window.set_always_on_top(true);
    place_pin(&window, placement);
    window
        .show()
        .map_err(|error| format!("show pin window: {error}"))?;
    #[cfg(target_os = "macos")]
    promote_pin(&window);
    remember_label(label.clone());
    Ok(PinSurface {
        id: id.to_string(),
        label,
        path: path.to_string_lossy().to_string(),
    })
}

async fn run_pin_creation<F, T>(app: &AppHandle, operation: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(operation)
            .await
            .map_err(|error| format!("pin window worker failed: {error}"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        crate::runtime::ui(app, operation)
            .await
            .map_err(String::from)?
    }
}

/// Pin a screenshot PNG to the desktop as a floating always-on-top window.
#[tauri::command]
pub async fn screencap_pin_image(
    app: AppHandle,
    path: String,
    width: Option<u32>,
    height: Option<u32>,
    monitor_id: Option<u32>,
) -> Result<PinSurface, String> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err("Pin path is empty".to_string());
    }
    let (pixel_w, pixel_h) = match (width, height) {
        (Some(w), Some(h)) if w > 0 && h > 0 => (w, h),
        _ => {
            let path_for_size = path.clone();
            crate::runtime::blocking(move || image_pixel_size(&path_for_size))
                .await
                .map_err(|error| format!("pin size worker failed: {error}"))??
        }
    };
    let worker_app = app.clone();
    run_pin_creation(&app, move || {
        open_pin_now(&worker_app, path, pixel_w, pixel_h, monitor_id)
    })
    .await
}

#[tauri::command]
pub async fn screencap_pin_close(app: AppHandle, label: String) -> Result<(), String> {
    if !is_pin_surface(&label) {
        return Err("Not a pin surface".to_string());
    }
    let worker_app = app.clone();
    run_pin_creation(&app, move || {
        if let Some(window) = worker_app.get_webview_window(&label) {
            let _ = window.close();
        }
        forget_label(&label);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn screencap_pin_close_all(app: AppHandle) -> Result<(), String> {
    let worker_app = app.clone();
    run_pin_creation(&app, move || {
        prune_labels(&worker_app);
        let labels = PIN_LABELS
            .lock()
            .map(|list| list.clone())
            .unwrap_or_default();
        for label in labels {
            if let Some(window) = worker_app.get_webview_window(&label) {
                let _ = window.close();
            }
            forget_label(&label);
        }
        Ok(())
    })
    .await
}

/// Best-effort pin after a successful capture (main-thread friendly wrapper).
pub(super) fn pin_after_capture(
    app: &AppHandle,
    path: &Path,
    width: u32,
    height: u32,
    monitor_id: Option<u32>,
) -> Result<PinSurface, String> {
    open_pin_now(app, path.to_path_buf(), width, height, monitor_id)
}

/// Close every pin before process exit.
pub(crate) fn close_all_for_shutdown(app: &AppHandle) {
    let labels = PIN_LABELS
        .lock()
        .map(|list| list.clone())
        .unwrap_or_default();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
        forget_label(&label);
    }
}
