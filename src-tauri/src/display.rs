//! Shared display inventory and native/capture-backend mapping.
//!
//! Feature modules consume this service instead of independently deciding
//! which monitor is primary, built-in, external, or under the pointer.
//! Public IPC: [`display_list`]. Region still-frame capture: [`capture_region`].

use serde::Serialize;
#[cfg(target_os = "windows")]
use std::collections::HashMap;
#[cfg(target_os = "macos")]
use std::sync::{Mutex, OnceLock};
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};
use tauri::{command, AppHandle};

#[cfg(target_os = "windows")]
mod brightness_windows;

#[cfg(target_os = "macos")]
const DISPLAY_CACHE_TTL: Duration = Duration::from_millis(750);

#[cfg(target_os = "macos")]
struct CaptureMonitorCache {
    refreshed_at: Instant,
    monitors: Vec<xcap::Monitor>,
}

#[cfg(target_os = "macos")]
static CAPTURE_MONITOR_CACHE: OnceLock<Mutex<Option<CaptureMonitorCache>>> = OnceLock::new();

#[cfg(target_os = "macos")]
static DISPLAY_CONTROL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayDescriptor {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub refresh_rate_hz: Option<f32>,
    pub scale_factor: Option<f32>,
    pub rotation_degrees: Option<f32>,
    pub connection: Option<String>,
    pub edid_manufacturer_id: Option<u16>,
    pub edid_product_code: Option<u16>,
    pub is_primary: bool,
    pub is_builtin: bool,
}

/// A brightness target exposed by the shared display-control port.
///
/// `id` is intentionally opaque to callers. macOS uses DisplayServices or its
/// embedded DDC/CI adapter; Windows uses WMI for integrated panels and Win32
/// Monitor Configuration for physical DDC/CI targets. Plugin/UI code never
/// receives an OS display handle or starts a platform utility.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayBrightnessControl {
    pub id: String,
    pub name: String,
    pub backend: String,
    pub current: Option<u8>,
    pub max: u8,
    pub raw_current: Option<u16>,
    pub raw_max: Option<u16>,
    pub is_builtin: bool,
    pub supported: bool,
    pub error: Option<String>,
    pub error_stage: Option<String>,
    pub error_code: Option<i32>,
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct MacDdcDisplay {
    id: u32,
    current: u16,
    max: u16,
    error_code: i32,
    error_stage: u32,
    name: [std::os::raw::c_char; 256],
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn qx_native_display_brightness(display: u32, out: *mut u16) -> i32;
    fn qx_native_set_display_brightness(display: u32, value: u16) -> i32;
    fn qx_ddc_list(out: *mut MacDdcDisplay, capacity: usize) -> usize;
    fn qx_ddc_set(display: u32, value: u16, error_stage: *mut u32) -> i32;
}

#[cfg(target_os = "macos")]
fn mac_string(value: &[std::os::raw::c_char]) -> String {
    let bytes = value
        .iter()
        .take_while(|byte| **byte != 0)
        .map(|byte| *byte as u8)
        .collect::<Vec<_>>();
    String::from_utf8_lossy(&bytes).trim().to_string()
}

#[cfg(target_os = "macos")]
fn native_target_id(display_id: u32) -> String {
    format!("native:{display_id}")
}

#[cfg(target_os = "macos")]
fn ddc_target_id(display_id: u32) -> String {
    format!("ddc:{display_id}")
}

#[cfg(target_os = "macos")]
fn ddc_stage_name(stage: u32) -> &'static str {
    match stage {
        1 => "missing display info",
        2 => "missing IODisplayLocation",
        3 => "missing IOKit display adapter",
        4 => "IOAVService API unavailable",
        5 => "cannot resolve IOKit registry id",
        6 => "cannot create IOKit iterator",
        7 => "no external DCPAVServiceProxy",
        8 => "cannot create IOAVService",
        9 => "DDC VCP read request failed",
        10 => "DDC VCP read response failed",
        11 => "invalid DDC VCP response",
        12 => "DDC VCP write failed",
        _ => "unknown DDC failure",
    }
}

#[cfg(target_os = "macos")]
fn ddc_error(stage: u32, error_code: i32) -> String {
    if error_code == 0 {
        format!("DDC: {}", ddc_stage_name(stage))
    } else {
        format!("DDC: {} (IOReturn {error_code})", ddc_stage_name(stage))
    }
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug)]
struct WindowsDisplayConnection {
    connection: String,
    edid_manufacturer_id: Option<u16>,
    edid_product_code: Option<u16>,
    is_builtin: bool,
}

#[cfg(target_os = "windows")]
fn utf16_buffer(value: &[u16]) -> String {
    let len = value
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..len]).trim().to_string()
}

#[cfg(target_os = "windows")]
fn windows_connection_name(technology: i32) -> &'static str {
    use windows_sys::Win32::Devices::Display as dc;
    match technology {
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HD15 => "VGA",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DVI => "DVI",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI => "HDMI",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_LVDS => "LVDS",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EXTERNAL => "DisplayPort",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED => "eDP",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_USB_TUNNEL => "DisplayPort USB tunnel",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EXTERNAL => "UDI",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED => "Embedded UDI",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_SDTVDONGLE => "TV dongle",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_MIRACAST => "Miracast",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_WIRED => "Indirect wired",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_VIRTUAL => "Virtual display",
        dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL => "Internal",
        _ => "Other",
    }
}

#[cfg(target_os = "windows")]
fn windows_display_connections() -> HashMap<String, WindowsDisplayConnection> {
    use windows_sys::Win32::Devices::Display as dc;

    let mut path_count = 0u32;
    let mut mode_count = 0u32;
    if unsafe {
        dc::GetDisplayConfigBufferSizes(dc::QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
    } != 0
        || path_count == 0
    {
        return HashMap::new();
    }

    let mut paths =
        vec![unsafe { std::mem::zeroed::<dc::DISPLAYCONFIG_PATH_INFO>() }; path_count as usize];
    let mut modes =
        vec![unsafe { std::mem::zeroed::<dc::DISPLAYCONFIG_MODE_INFO>() }; mode_count as usize];
    if unsafe {
        dc::QueryDisplayConfig(
            dc::QDC_ONLY_ACTIVE_PATHS,
            &mut path_count,
            paths.as_mut_ptr(),
            &mut mode_count,
            modes.as_mut_ptr(),
            std::ptr::null_mut(),
        )
    } != 0
    {
        return HashMap::new();
    }

    let mut result = HashMap::new();
    for path in paths.into_iter().take(path_count as usize) {
        let mut target = unsafe { std::mem::zeroed::<dc::DISPLAYCONFIG_TARGET_DEVICE_NAME>() };
        target.header.r#type = dc::DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
        target.header.size = std::mem::size_of::<dc::DISPLAYCONFIG_TARGET_DEVICE_NAME>() as u32;
        target.header.adapterId = path.targetInfo.adapterId;
        target.header.id = path.targetInfo.id;
        if unsafe { dc::DisplayConfigGetDeviceInfo(&mut target.header) } != 0 {
            continue;
        }
        let name = utf16_buffer(&target.monitorFriendlyDeviceName);
        if name.is_empty() {
            continue;
        }
        let output_technology = target.outputTechnology;
        let edid_ids_valid = unsafe { target.flags.Anonymous.value } & 0x4 != 0;
        result.insert(
            name.to_lowercase(),
            WindowsDisplayConnection {
                connection: windows_connection_name(output_technology).to_string(),
                edid_manufacturer_id: (edid_ids_valid && target.edidManufactureId != 0)
                    .then_some(target.edidManufactureId),
                edid_product_code: (edid_ids_valid && target.edidProductCodeId != 0)
                    .then_some(target.edidProductCodeId),
                is_builtin: matches!(
                    output_technology,
                    dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_DISPLAYPORT_EMBEDDED
                        | dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_LVDS
                        | dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_UDI_EMBEDDED
                        | dc::DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INTERNAL
                ),
            },
        );
    }
    result
}

#[cfg(target_os = "windows")]
fn windows_display_connection(
    name: &str,
    connections: &HashMap<String, WindowsDisplayConnection>,
) -> Option<WindowsDisplayConnection> {
    let name = name.to_lowercase();
    connections.get(&name).cloned().or_else(|| {
        connections
            .iter()
            .find(|(candidate, _)| candidate.contains(&name) || name.contains(candidate.as_str()))
            .map(|(_, value)| value.clone())
    })
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DisplayArea {
    pub(crate) scale_factor: f64,
    pub(crate) frame_x: i32,
    pub(crate) frame_y: i32,
    pub(crate) frame_width: u32,
    pub(crate) frame_height: u32,
    pub(crate) work_x: i32,
    pub(crate) work_y: i32,
    pub(crate) work_width: u32,
    pub(crate) work_height: u32,
}

fn display_area_from_monitor(monitor: &tauri::Monitor) -> DisplayArea {
    let frame = monitor.position();
    let frame_size = monitor.size();
    let work = monitor.work_area();
    DisplayArea {
        scale_factor: monitor.scale_factor(),
        frame_x: frame.x,
        frame_y: frame.y,
        frame_width: frame_size.width,
        frame_height: frame_size.height,
        work_x: work.position.x,
        work_y: work.position.y,
        work_width: work.size.width,
        work_height: work.size.height,
    }
}

pub(crate) fn contains_point(area: DisplayArea, x: f64, y: f64) -> bool {
    let left = area.frame_x as f64;
    let top = area.frame_y as f64;
    let right = left + area.frame_width as f64;
    let bottom = top + area.frame_height as f64;
    x >= left && x < right && y >= top && y < bottom
}

fn distance_to_area(area: DisplayArea, x: f64, y: f64) -> f64 {
    let left = area.frame_x as f64;
    let top = area.frame_y as f64;
    let right = left + area.frame_width as f64;
    let bottom = top + area.frame_height as f64;
    let dx = if x < left {
        left - x
    } else if x > right {
        x - right
    } else {
        0.0
    };
    let dy = if y < top {
        top - y
    } else if y > bottom {
        y - bottom
    } else {
        0.0
    };
    (dx * dx) + (dy * dy)
}

pub(crate) fn select_display_area_for_cursor(
    areas: &[DisplayArea],
    x: f64,
    y: f64,
) -> Option<DisplayArea> {
    areas
        .iter()
        .copied()
        .find(|area| contains_point(*area, x, y))
        .or_else(|| {
            areas.iter().copied().min_by(|left, right| {
                distance_to_area(*left, x, y)
                    .partial_cmp(&distance_to_area(*right, x, y))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        })
}

pub(crate) fn select_display_area_for_raw_cursor(
    areas: &[DisplayArea],
    x: f64,
    y: f64,
) -> Option<DisplayArea> {
    areas
        .iter()
        .copied()
        .find(|area| contains_point(*area, x * area.scale_factor, y * area.scale_factor))
        .or_else(|| {
            areas.iter().copied().min_by(|left, right| {
                distance_to_area(*left, x * left.scale_factor, y * left.scale_factor)
                    .partial_cmp(&distance_to_area(
                        *right,
                        x * right.scale_factor,
                        y * right.scale_factor,
                    ))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
        })
}

fn available_display_areas(app: &AppHandle) -> Vec<DisplayArea> {
    app.available_monitors()
        .ok()
        .map(|monitors| monitors.iter().map(display_area_from_monitor).collect())
        .unwrap_or_default()
}

fn select_display_area_for_cursor_sources(
    areas: &[DisplayArea],
    normalized_cursor: Option<(f64, f64)>,
    raw_cursor: Option<(f64, f64)>,
) -> Option<DisplayArea> {
    normalized_cursor
        .and_then(|(x, y)| select_display_area_for_cursor(areas, x, y))
        .or_else(|| raw_cursor.and_then(|(x, y)| select_display_area_for_raw_cursor(areas, x, y)))
}

/// Platform-native pointer sample used when Tauri's physical cursor is noisy
/// across mixed-DPI menu bars. On macOS this is `NSEvent.mouseLocation`
/// converted to a top-left oriented point; other platforms return `None`.
pub(crate) fn raw_cursor_position_for_display_lookup() -> Option<(f64, f64)> {
    #[cfg(target_os = "macos")]
    {
        use std::ffi::CStr;

        use objc2::msg_send;
        use objc2::runtime::AnyClass;

        unsafe {
            let event_cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSEvent\0").ok()?)?;
            let point: objc2_foundation::NSPoint = msg_send![event_cls, mouseLocation];
            let y = core_graphics::display::CGDisplay::main().pixels_high() as f64 - point.y;
            Some((point.x, y))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

fn tauri_monitor_for_display_area(
    app: &AppHandle,
    area: DisplayArea,
) -> Option<tauri::Monitor> {
    app.available_monitors().ok()?.into_iter().find(|monitor| {
        let candidate = display_area_from_monitor(monitor);
        candidate.frame_x == area.frame_x && candidate.frame_y == area.frame_y
    })
}

/// Shared pointer → display resolution for launcher, tray, and capture.
///
/// Resolution order:
/// 1. Tauri physical cursor (`app.cursor_position`)
/// 2. Optional physical event hint (tray-icon click, etc.)
/// 3. Platform raw cursor (`NSEvent.mouseLocation` on macOS)
/// 4. `monitor_from_point` / window monitor / primary
pub(crate) fn resolve_pointer_display(
    app: &AppHandle,
    window: Option<&tauri::WebviewWindow>,
    physical_hint: Option<(f64, f64)>,
) -> Option<DisplayArea> {
    let areas = available_display_areas(app);
    let normalized_cursor = app
        .cursor_position()
        .ok()
        .map(|cursor| (cursor.x, cursor.y));
    let raw_cursor = raw_cursor_position_for_display_lookup();
    select_display_area_for_cursor_sources(&areas, normalized_cursor, raw_cursor)
        .or_else(|| {
            physical_hint.and_then(|(x, y)| select_display_area_for_cursor(&areas, x, y))
        })
        .or_else(|| {
            physical_hint.and_then(|(x, y)| select_display_area_for_raw_cursor(&areas, x, y))
        })
        .or_else(|| {
            app.cursor_position().ok().and_then(|cursor| {
                app.monitor_from_point(cursor.x, cursor.y)
                    .ok()
                    .flatten()
                    .map(|monitor| display_area_from_monitor(&monitor))
            })
        })
        .or_else(|| {
            window.and_then(|window| {
                window
                    .current_monitor()
                    .ok()
                    .flatten()
                    .map(|monitor| display_area_from_monitor(&monitor))
            })
        })
        .or_else(|| {
            app.primary_monitor()
                .ok()
                .flatten()
                .map(|monitor| display_area_from_monitor(&monitor))
        })
}

/// Prefer a physical pointer sample that already lies on `area`, then fall back
/// to the work-area top-center (menu-bar / tray zone).
pub(crate) fn pointer_anchor_on_display(
    app: &AppHandle,
    area: DisplayArea,
    physical_hint: Option<(f64, f64)>,
) -> (f64, f64) {
    if let Ok(cursor) = app.cursor_position() {
        if contains_point(area, cursor.x, cursor.y) {
            return (cursor.x, cursor.y);
        }
    }
    if let Some((x, y)) = physical_hint {
        if contains_point(area, x, y) {
            return (x, y);
        }
        let scale = area.scale_factor.max(1.0);
        let scaled = (x * scale, y * scale);
        if contains_point(area, scaled.0, scaled.1) {
            return scaled;
        }
    }
    if let Some((x, y)) = raw_cursor_position_for_display_lookup() {
        let scale = area.scale_factor.max(1.0);
        let scaled = (x * scale, y * scale);
        if contains_point(area, scaled.0, scaled.1) {
            return scaled;
        }
        if contains_point(area, x, y) {
            return (x, y);
        }
    }
    let scale = area.scale_factor.max(1.0);
    (
        area.work_x as f64 + area.work_width as f64 * 0.5,
        area.work_y as f64 + 4.0 * scale,
    )
}

pub(crate) fn capture_monitor_id_for_display_area(
    app: &AppHandle,
    area: DisplayArea,
) -> Option<u32> {
    let monitor = tauri_monitor_for_display_area(app, area)?;
    capture_monitor_for_tauri(app, &monitor).ok()?.id().ok()
}

pub(crate) fn display_area_for_window(window: &tauri::WebviewWindow) -> Option<DisplayArea> {
    window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| display_area_from_monitor(&monitor))
}

pub(crate) fn display_area_for_current_cursor(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    raw_cursor: Option<(f64, f64)>,
) -> Option<DisplayArea> {
    let areas = available_display_areas(app);
    let normalized_cursor = app
        .cursor_position()
        .ok()
        .map(|cursor| (cursor.x, cursor.y));
    let raw_cursor = raw_cursor.or_else(raw_cursor_position_for_display_lookup);
    select_display_area_for_cursor_sources(&areas, normalized_cursor, raw_cursor)
        .or_else(|| resolve_pointer_display(app, Some(window), None))
}

pub(crate) fn cursor_monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    let area = resolve_pointer_display(app, None, None)?;
    tauri_monitor_for_display_area(app, area)
}

pub(crate) fn capture_monitor_for_tauri(
    app: &AppHandle,
    target: &tauri::Monitor,
) -> Result<xcap::Monitor, String> {
    let monitors = all_capture_monitors()?;
    if let Some(target_name) = target.name() {
        if let Some(monitor) = monitors.iter().find(|monitor| {
            monitor.friendly_name().ok().as_ref() == Some(target_name)
                || monitor.name().ok().as_ref() == Some(target_name)
        }) {
            return Ok(monitor.clone());
        }
    }
    let position = target.position();
    let scale = target.scale_factor().max(1.0);
    if let Some(monitor) = monitors.iter().find(|monitor| {
        let Ok(x) = monitor.x() else { return false };
        let Ok(y) = monitor.y() else { return false };
        ((x - position.x).abs() <= 2 && (y - position.y).abs() <= 2)
            || ((x as f64 - position.x as f64 / scale).abs() <= 2.0
                && (y as f64 - position.y as f64 / scale).abs() <= 2.0)
    }) {
        return Ok(monitor.clone());
    }
    let target_is_primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .is_some_and(|primary| primary.position() == target.position());
    monitors
        .into_iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false) == target_is_primary)
        .ok_or_else(|| "Cannot match the selected display to a capture source".to_string())
}

pub(crate) fn tauri_monitor_for_capture(
    app: &AppHandle,
    capture: &xcap::Monitor,
) -> Result<tauri::Monitor, String> {
    let monitors = app
        .available_monitors()
        .map_err(|error| format!("Cannot list window displays: {error}"))?;
    let capture_name = capture
        .friendly_name()
        .or_else(|_| capture.name())
        .unwrap_or_default();
    if let Some(monitor) = monitors.iter().find(|monitor| {
        monitor
            .name()
            .is_some_and(|name| name.as_str() == capture_name.as_str())
    }) {
        return Ok(monitor.clone());
    }
    let capture_x = capture.x().unwrap_or_default();
    let capture_y = capture.y().unwrap_or_default();
    if let Some(monitor) = monitors.iter().find(|monitor| {
        let position = monitor.position();
        let scale = monitor.scale_factor().max(1.0);
        ((position.x - capture_x).abs() <= 2 && (position.y - capture_y).abs() <= 2)
            || ((position.x as f64 / scale - capture_x as f64).abs() <= 2.0
                && (position.y as f64 / scale - capture_y as f64).abs() <= 2.0)
    }) {
        return Ok(monitor.clone());
    }
    let capture_is_primary = capture.is_primary().unwrap_or(false);
    monitors
        .into_iter()
        .find(|monitor| {
            capture_is_primary
                && app
                    .primary_monitor()
                    .ok()
                    .flatten()
                    .is_some_and(|primary| primary.position() == monitor.position())
        })
        .ok_or_else(|| "Cannot place a window on the selected display".to_string())
}

pub(crate) fn all_capture_monitors() -> Result<Vec<xcap::Monitor>, String> {
    // xcap's Windows monitor handle contains a raw HMONITOR and is deliberately
    // !Send. Keeping it in a process-global Mutex makes the whole static fail
    // Sync and prevents the Windows target from compiling. Cache native monitor
    // objects only on macOS; Windows re-enumerates them on the calling thread.
    #[cfg(not(target_os = "macos"))]
    {
        return xcap::Monitor::all().map_err(|error| format!("Cannot list displays: {error}"));
    }

    #[cfg(target_os = "macos")]
    {
        let cache = CAPTURE_MONITOR_CACHE.get_or_init(|| Mutex::new(None));
        if let Ok(snapshot) = cache.lock() {
            if let Some(snapshot) = snapshot.as_ref() {
                if snapshot.refreshed_at.elapsed() < DISPLAY_CACHE_TTL {
                    return Ok(snapshot.monitors.clone());
                }
            }
        }
        refresh_capture_monitor_cache()
    }
}

/// Refresh the native display inventory before a capture action is requested.
/// The next picker transition can then reuse the already-resolved xcap objects.
pub(crate) fn refresh_capture_monitor_cache() -> Result<Vec<xcap::Monitor>, String> {
    let monitors =
        xcap::Monitor::all().map_err(|error| format!("Cannot list displays: {error}"))?;
    #[cfg(target_os = "macos")]
    if let Ok(mut cache) = CAPTURE_MONITOR_CACHE
        .get_or_init(|| Mutex::new(None))
        .lock()
    {
        *cache = Some(CaptureMonitorCache {
            refreshed_at: Instant::now(),
            monitors: monitors.clone(),
        });
    }
    Ok(monitors)
}

pub(crate) fn capture_monitor(id: Option<u32>) -> Result<xcap::Monitor, String> {
    let monitors = all_capture_monitors()?;
    if let Some(id) = id {
        return monitors
            .into_iter()
            .find(|monitor| monitor.id().ok() == Some(id))
            .ok_or_else(|| "The selected display is no longer available".to_string());
    }
    monitors
        .into_iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .ok_or_else(|| "No primary display found".to_string())
}

pub(crate) fn cursor_capture_monitor_id(app: &AppHandle) -> Option<u32> {
    capture_monitor_for_tauri(app, &cursor_monitor(app)?)
        .ok()?
        .id()
        .ok()
}

#[cfg(target_os = "macos")]
fn is_builtin_display(id: u32) -> bool {
    core_graphics::display::CGDisplay::new(id).is_builtin()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn is_builtin_display(_id: u32) -> bool {
    false
}

pub(crate) fn displays() -> Result<Vec<DisplayDescriptor>, String> {
    #[cfg(target_os = "windows")]
    let connections = windows_display_connections();
    all_capture_monitors()?
        .into_iter()
        .map(|monitor| {
            let id = monitor
                .id()
                .map_err(|error| format!("display id: {error}"))?;
            let name = monitor
                .friendly_name()
                .or_else(|_| monitor.name())
                .unwrap_or_else(|_| format!("Display {id}"));
            #[cfg(target_os = "windows")]
            let connection = windows_display_connection(&name, &connections);
            Ok(DisplayDescriptor {
                id,
                name,
                width: monitor.width().unwrap_or_default(),
                height: monitor.height().unwrap_or_default(),
                refresh_rate_hz: monitor.frequency().ok().filter(|value| *value > 0.0),
                scale_factor: monitor.scale_factor().ok().filter(|value| *value > 0.0),
                rotation_degrees: monitor.rotation().ok(),
                #[cfg(target_os = "windows")]
                connection: connection.as_ref().map(|value| value.connection.clone()),
                #[cfg(not(target_os = "windows"))]
                connection: None,
                #[cfg(target_os = "windows")]
                edid_manufacturer_id: connection
                    .as_ref()
                    .and_then(|value| value.edid_manufacturer_id),
                #[cfg(not(target_os = "windows"))]
                edid_manufacturer_id: None,
                #[cfg(target_os = "windows")]
                edid_product_code: connection
                    .as_ref()
                    .and_then(|value| value.edid_product_code),
                #[cfg(not(target_os = "windows"))]
                edid_product_code: None,
                is_primary: monitor.is_primary().unwrap_or(false),
                #[cfg(target_os = "windows")]
                is_builtin: connection.as_ref().is_some_and(|value| value.is_builtin),
                #[cfg(not(target_os = "windows"))]
                is_builtin: is_builtin_display(id),
            })
        })
        .collect()
}

/// Public IPC: enumerate displays for any feature (capture, windows, layout).
#[command]
pub async fn display_list() -> Result<Vec<DisplayDescriptor>, String> {
    crate::runtime::blocking(displays)
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(target_os = "macos")]
fn brightness_controls() -> Result<Vec<DisplayBrightnessControl>, String> {
    let _guard = DISPLAY_CONTROL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "display control lock poisoned".to_string())?;
    let inventory = displays()?;
    let mut controls = Vec::with_capacity(inventory.len());

    // Built-in panels use the same private DisplayServices channel as Apple's
    // brightness UI. This is hardware/native brightness, not a WebView shade.
    for display in inventory.iter().filter(|display| display.is_builtin) {
        let mut current = 0_u16;
        let status = unsafe { qx_native_display_brightness(display.id, &mut current) };
        controls.push(DisplayBrightnessControl {
            id: native_target_id(display.id),
            name: display.name.clone(),
            backend: "native".to_string(),
            current: (status == 0).then_some(current.min(100) as u8),
            max: 100,
            raw_current: (status == 0).then_some(current.min(100)),
            raw_max: (status == 0).then_some(100),
            is_builtin: true,
            supported: status == 0,
            error: (status != 0)
                .then(|| format!("macOS native brightness is unavailable (status {status})")),
            error_stage: (status != 0).then(|| "native DisplayServices".to_string()),
            error_code: (status != 0).then_some(status),
        });
    }

    // Qx embeds the small DDC/CI transport and returns display IDs matching
    // the shared xcap/CoreGraphics inventory. No m1ddc/ddcctl process or
    // Homebrew installation is involved.
    let mut ddc_displays = (0..32)
        .map(|_| MacDdcDisplay {
            id: 0,
            current: 0,
            max: 0,
            error_code: 0,
            error_stage: 0,
            name: [0; 256],
        })
        .collect::<Vec<_>>();
    let ddc_count = unsafe { qx_ddc_list(ddc_displays.as_mut_ptr(), ddc_displays.len()) };
    for display in inventory.iter().filter(|display| !display.is_builtin) {
        if let Some(ddc) = ddc_displays
            .iter()
            .take(ddc_count.min(ddc_displays.len()))
            .find(|ddc| ddc.id == display.id)
        {
            let max = ddc.max.max(1);
            let supported = ddc.error_stage == 0 && ddc.max > 0;
            controls.push(DisplayBrightnessControl {
                id: if supported {
                    ddc_target_id(display.id)
                } else {
                    format!("unavailable:{}", display.id)
                },
                name: if mac_string(&ddc.name).is_empty() {
                    display.name.clone()
                } else {
                    mac_string(&ddc.name)
                },
                backend: "ddc".to_string(),
                current: supported
                    .then_some(((ddc.current as f32 / max as f32) * 100.0).round() as u8),
                max: 100,
                raw_current: supported.then_some(ddc.current),
                raw_max: supported.then_some(ddc.max),
                is_builtin: false,
                supported,
                error: (!supported).then(|| ddc_error(ddc.error_stage, ddc.error_code)),
                error_stage: (!supported).then(|| ddc_stage_name(ddc.error_stage).to_string()),
                error_code: (!supported).then_some(ddc.error_code),
            });
        } else {
            controls.push(DisplayBrightnessControl {
                id: format!("unavailable:{}", display.id),
                name: display.name.clone(),
                backend: "ddc".to_string(),
                current: None,
                max: 100,
                raw_current: None,
                raw_max: None,
                is_builtin: false,
                supported: false,
                error: Some(
                    "DDC: display was not returned by the macOS display adapter".to_string(),
                ),
                error_stage: Some("display adapter mismatch".to_string()),
                error_code: None,
            });
        }
    }

    Ok(controls)
}

#[cfg(target_os = "windows")]
fn brightness_controls() -> Result<Vec<DisplayBrightnessControl>, String> {
    brightness_windows::brightness_controls()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn brightness_controls() -> Result<Vec<DisplayBrightnessControl>, String> {
    Ok(Vec::new())
}

#[tauri::command]
pub async fn display_brightness_list() -> Result<Vec<DisplayBrightnessControl>, String> {
    crate::runtime::blocking(brightness_controls)
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(target_os = "macos")]
fn set_brightness(display_id: String, value: u8) -> Result<(), String> {
    let _guard = DISPLAY_CONTROL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "display control lock poisoned".to_string())?;
    let value = value.min(100);
    if let Some(raw_id) = display_id.strip_prefix("native:") {
        let id = raw_id
            .parse::<u32>()
            .map_err(|_| "Invalid native display target".to_string())?;
        let display = displays()?
            .into_iter()
            .find(|display| display.id == id && display.is_builtin)
            .ok_or_else(|| "The selected native display is no longer available".to_string())?;
        let status = unsafe { qx_native_set_display_brightness(display.id, value as u16) };
        if status != 0 {
            return Err(format!(
                "macOS native brightness write failed (status {status})"
            ));
        }
        return Ok(());
    }

    if let Some(raw_id) = display_id.strip_prefix("ddc:") {
        let id = raw_id
            .parse::<u32>()
            .map_err(|_| "Invalid DDC display target".to_string())?;
        let display = displays()?
            .into_iter()
            .find(|display| display.id == id && !display.is_builtin)
            .ok_or_else(|| "The selected DDC display is no longer available".to_string())?;
        let mut ddc_displays = (0..32)
            .map(|_| MacDdcDisplay {
                id: 0,
                current: 0,
                max: 0,
                error_code: 0,
                error_stage: 0,
                name: [0; 256],
            })
            .collect::<Vec<_>>();
        let count = unsafe { qx_ddc_list(ddc_displays.as_mut_ptr(), ddc_displays.len()) };
        let ddc = ddc_displays
            .iter()
            .take(count.min(ddc_displays.len()))
            .find(|ddc| ddc.id == display.id)
            .ok_or_else(|| "The selected display does not expose DDC/CI brightness".to_string())?;
        if ddc.error_stage != 0 || ddc.max == 0 {
            return Err(ddc_error(ddc.error_stage.max(11), ddc.error_code));
        }
        let raw_value = ((value as u32 * ddc.max.max(1) as u32 + 50) / 100) as u16;
        let mut error_stage = 0_u32;
        let status = unsafe { qx_ddc_set(display.id, raw_value, &mut error_stage) };
        if status != 0 {
            return Err(ddc_error(error_stage.max(12), status));
        }
        return Ok(());
    }

    Err("Unknown display brightness target".to_string())
}

#[cfg(target_os = "windows")]
fn set_brightness(display_id: String, value: u8) -> Result<(), String> {
    brightness_windows::set_brightness(&display_id, value)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn set_brightness(_display_id: String, _value: u8) -> Result<(), String> {
    Err("Display brightness control is unavailable on this platform".to_string())
}

#[tauri::command]
pub async fn display_brightness_set(display_id: String, value: u8) -> Result<(), String> {
    crate::runtime::blocking(move || set_brightness(display_id, value))
        .await
        .map_err(|error| error.to_string())?
}

/// Capture a rectangular region from a capture-backend monitor (physical pixels).
/// System foundation for screenshot, OCR region, clipboard grab, etc.
#[allow(dead_code)]
pub fn capture_region(
    monitor_id: Option<u32>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<image::RgbaImage, String> {
    let monitor = capture_monitor(monitor_id)?;
    capture_region_from_monitor(&monitor, x, y, width, height)
}

/// Capture from an already-resolved monitor so high-frequency consumers do not
/// re-enumerate native display handles for every frame.
pub(crate) fn capture_region_from_monitor(
    monitor: &xcap::Monitor,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<image::RgbaImage, String> {
    #[cfg(target_os = "windows")]
    {
        let monitor_x = monitor.x().map_err(|error| format!("display x: {error}"))?;
        let monitor_y = monitor.y().map_err(|error| format!("display y: {error}"))?;
        if crate::display_windows::should_try_wgc() {
            let modern = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                monitor.capture_region(x, y, width, height)
            }));
            match modern {
                Ok(Ok(image)) if !frame_is_effectively_black(&image) => return Ok(image),
                Ok(Ok(_)) => {
                    crate::diagnostics::log(
                        crate::diagnostics::LogLevel::Warn,
                        "display.capture.windows",
                        "Windows Graphics Capture returned an effectively black frame; using GDI fallback",
                        serde_json::json!({ "monitorId": monitor.id().ok() }),
                    );
                }
                Ok(Err(error)) => {
                    crate::display_windows::disable_wgc();
                    crate::diagnostics::log(
                        crate::diagnostics::LogLevel::Warn,
                        "display.capture.windows",
                        "Windows Graphics Capture failed; using GDI fallback",
                        serde_json::json!({ "error": error.to_string(), "monitorId": monitor.id().ok() }),
                    );
                }
                Err(_) => {
                    crate::display_windows::disable_wgc();
                    crate::diagnostics::log(
                        crate::diagnostics::LogLevel::Warn,
                        "display.capture.windows",
                        "Windows Graphics Capture panicked; using GDI fallback",
                        serde_json::json!({ "monitorId": monitor.id().ok() }),
                    );
                }
            }
        }
        return crate::display_windows::capture_region_gdi(
            monitor_x.saturating_add(x as i32),
            monitor_y.saturating_add(y as i32),
            width,
            height,
        );
    }

    #[cfg(not(target_os = "windows"))]
    {
        monitor
            .capture_region(x, y, width, height)
            .map_err(|error| format!("capture region: {error}"))
    }
}

/// Sample the frame rather than scanning every pixel. A legitimate dark region
/// may also take the fallback, which is harmless; the important distinction is
/// that a successful-but-empty WGC frame must never be persisted as a screenshot.
#[cfg(any(target_os = "windows", test))]
pub(crate) fn frame_is_effectively_black(image: &image::RgbaImage) -> bool {
    if image.is_empty() {
        return true;
    }
    let stride = (image.len() / 4 / 1024).max(1);
    let mut sampled = 0usize;
    let mut near_black = 0usize;
    for pixel in image.pixels().step_by(stride) {
        sampled += 1;
        if pixel[0] <= 3 && pixel[1] <= 3 && pixel[2] <= 3 {
            near_black += 1;
        }
    }
    near_black * 1000 >= sampled * 998
}

/// Reusable fallback after the native continuous stream proved unavailable.
/// Windows holds one GDI DC/bitmap/RGBA buffer for the recording rather than
/// rebuilding those resources for every frame. Other platforms retain their
/// native still-frame path behind the same session contract.
pub(crate) struct PollingCaptureSession {
    #[cfg(target_os = "windows")]
    native: crate::display_windows::GdiCaptureSession,
    #[cfg(not(target_os = "windows"))]
    monitor: xcap::Monitor,
    #[cfg(not(target_os = "windows"))]
    x: u32,
    #[cfg(not(target_os = "windows"))]
    y: u32,
    #[cfg(not(target_os = "windows"))]
    width: u32,
    #[cfg(not(target_os = "windows"))]
    height: u32,
}

impl PollingCaptureSession {
    pub(crate) fn new(
        monitor: &xcap::Monitor,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        #[cfg(target_os = "windows")]
        {
            let monitor_x = monitor.x().map_err(|error| format!("display x: {error}"))?;
            let monitor_y = monitor.y().map_err(|error| format!("display y: {error}"))?;
            return Ok(Self {
                native: crate::display_windows::GdiCaptureSession::new(
                    monitor_x.saturating_add(x as i32),
                    monitor_y.saturating_add(y as i32),
                    width,
                    height,
                )?,
            });
        }

        #[cfg(not(target_os = "windows"))]
        {
            Ok(Self {
                monitor: monitor.clone(),
                x,
                y,
                width,
                height,
            })
        }
    }

    pub(crate) fn capture(&mut self) -> Result<std::borrow::Cow<'_, image::RgbaImage>, String> {
        #[cfg(target_os = "windows")]
        {
            return self.native.capture().map(std::borrow::Cow::Borrowed);
        }

        #[cfg(not(target_os = "windows"))]
        {
            capture_region_from_monitor(&self.monitor, self.x, self.y, self.width, self.height)
                .map(std::borrow::Cow::Owned)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        contains_point, frame_is_effectively_black, select_display_area_for_cursor,
        select_display_area_for_cursor_sources, select_display_area_for_raw_cursor, DisplayArea,
    };

    fn area(x: i32, y: i32, width: u32, height: u32) -> DisplayArea {
        DisplayArea {
            scale_factor: 1.0,
            frame_x: x,
            frame_y: y,
            frame_width: width,
            frame_height: height,
            work_x: x,
            work_y: y + 24,
            work_width: width,
            work_height: height - 24,
        }
    }

    fn scaled_area(scale_factor: f64, frame_x: i32, frame_width: u32) -> DisplayArea {
        DisplayArea {
            scale_factor,
            frame_x,
            frame_y: 0,
            frame_width,
            frame_height: 2000,
            work_x: frame_x,
            work_y: 0,
            work_width: frame_width,
            work_height: 1900,
        }
    }

    #[test]
    fn selects_external_display_left_of_builtin() {
        let external = area(-1920, 0, 1920, 1080);
        let builtin = area(0, 0, 3024, 1964);
        assert_eq!(
            select_display_area_for_cursor(&[builtin, external], -100.0, 500.0),
            Some(external)
        );
    }

    #[test]
    fn selects_external_display_right_of_builtin() {
        let builtin = area(0, 0, 3024, 1964);
        let external = area(3024, 120, 2560, 1440);
        assert_eq!(
            select_display_area_for_cursor(&[builtin, external], 4000.0, 800.0),
            Some(external)
        );
    }

    #[test]
    fn full_frame_contains_menu_bar_area() {
        assert!(contains_point(area(0, 0, 3024, 1964), 1200.0, 10.0));
    }

    #[test]
    fn falls_back_to_nearest_display_when_cursor_is_between_frames() {
        let left = area(0, 0, 1000, 800);
        let right = area(1200, 0, 1000, 800);
        assert_eq!(
            select_display_area_for_cursor(&[left, right], 1120.0, 300.0),
            Some(right)
        );
    }

    #[test]
    fn raw_cursor_selection_uses_each_display_scale() {
        let built_in = scaled_area(2.0, 0, 3024);
        let external = scaled_area(1.0, 3024, 1920);
        let displays = [built_in, external];
        assert_eq!(
            select_display_area_for_raw_cursor(&displays, 500.0, 500.0),
            Some(built_in)
        );
        assert_eq!(
            select_display_area_for_raw_cursor(&displays, 3300.0, 500.0),
            Some(external)
        );
    }

    #[test]
    fn normalized_cursor_wins_over_legacy_raw_cursor_fallback() {
        let builtin = scaled_area(2.0, 0, 3024);
        let external = scaled_area(1.0, 3024, 1920);
        let displays = [builtin, external];

        assert_eq!(
            select_display_area_for_cursor_sources(
                &displays,
                Some((3500.0, 500.0)),
                Some((500.0, 500.0)),
            ),
            Some(external)
        );
    }

    #[test]
    fn detects_empty_windows_capture_frame_without_rejecting_real_content() {
        let black = image::RgbaImage::from_pixel(64, 64, image::Rgba([0, 0, 0, 255]));
        assert!(frame_is_effectively_black(&black));

        let mut content = black;
        for y in 0..16 {
            for x in 0..16 {
                content.put_pixel(x, y, image::Rgba([40, 80, 120, 255]));
            }
        }
        assert!(!frame_is_effectively_black(&content));
    }
}
