//! Shared display inventory and native/capture-backend mapping.
//!
//! Feature modules consume this service instead of independently deciding
//! which monitor is primary, built-in, external, or under the pointer.
//! Public IPC: [`display_list`]. Region still-frame capture: [`capture_region`].

use serde::Serialize;
#[cfg(target_os = "macos")]
use std::sync::{Mutex, OnceLock};
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};
use tauri::{command, AppHandle};

#[cfg(target_os = "macos")]
const DISPLAY_CACHE_TTL: Duration = Duration::from_millis(750);

#[cfg(target_os = "macos")]
struct CaptureMonitorCache {
    refreshed_at: Instant,
    monitors: Vec<xcap::Monitor>,
}

#[cfg(target_os = "macos")]
static CAPTURE_MONITOR_CACHE: OnceLock<Mutex<Option<CaptureMonitorCache>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayDescriptor {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
    pub is_builtin: bool,
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
    select_display_area_for_cursor_sources(&areas, normalized_cursor, raw_cursor)
        .or_else(|| {
            app.cursor_position().ok().and_then(|cursor| {
                app.monitor_from_point(cursor.x, cursor.y)
                    .ok()
                    .flatten()
                    .map(|monitor| display_area_from_monitor(&monitor))
            })
        })
        .or_else(|| {
            window
                .current_monitor()
                .ok()
                .flatten()
                .map(|monitor| display_area_from_monitor(&monitor))
        })
        .or_else(|| {
            app.primary_monitor()
                .ok()
                .flatten()
                .map(|monitor| display_area_from_monitor(&monitor))
        })
}

pub(crate) fn cursor_monitor(app: &AppHandle) -> Option<tauri::Monitor> {
    let cursor = app.cursor_position().ok()?;
    app.monitor_from_point(cursor.x, cursor.y).ok().flatten()
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

#[cfg(not(target_os = "macos"))]
fn is_builtin_display(_id: u32) -> bool {
    false
}

pub(crate) fn displays() -> Result<Vec<DisplayDescriptor>, String> {
    all_capture_monitors()?
        .into_iter()
        .map(|monitor| {
            let id = monitor
                .id()
                .map_err(|error| format!("display id: {error}"))?;
            Ok(DisplayDescriptor {
                id,
                name: monitor
                    .friendly_name()
                    .or_else(|_| monitor.name())
                    .unwrap_or_else(|_| format!("Display {id}")),
                width: monitor.width().unwrap_or_default(),
                height: monitor.height().unwrap_or_default(),
                is_primary: monitor.is_primary().unwrap_or(false),
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

/// Capture a rectangular region from a capture-backend monitor (physical pixels).
/// System foundation for screenshot, OCR region, clipboard grab, etc.
pub fn capture_region(
    monitor_id: Option<u32>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<image::RgbaImage, String> {
    let monitor = capture_monitor(monitor_id)?;
    monitor
        .capture_region(x, y, width, height)
        .map_err(|error| format!("capture region: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        contains_point, select_display_area_for_cursor, select_display_area_for_cursor_sources,
        select_display_area_for_raw_cursor, DisplayArea,
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
}
