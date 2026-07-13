//! Floating, non-activating window shell (macOS-first).
//!
//! Converts the `main` Tauri window into a Raycast/Alfred-style accessory
//! panel: the app is hidden from the dock entirely (`ActivationPolicy::
//! Accessory`), and the window is promoted into a non-activating NSPanel so
//! invoking it from a global shortcut never steals focus from the user's
//! current foreground app. Inputs that need keyboard focus explicitly
//! request key-window status through `floating_request_key`.

use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition};

pub(crate) const MAIN_LABEL: &str = "main";
static PREVIOUS_FOREGROUND_PID: OnceLock<Mutex<Option<i32>>> = OnceLock::new();

fn previous_foreground_pid() -> &'static Mutex<Option<i32>> {
    PREVIOUS_FOREGROUND_PID.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "macos")]
mod macos {
    use super::previous_foreground_pid;
    use super::MAIN_LABEL;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_app_kit::{NSWindowCollectionBehavior, NSWindowStyleMask};
    use std::ffi::CStr;
    use tauri::AppHandle;
    use tauri::Manager;

    const NS_APPLICATION_ACTIVATE_IGNORING_OTHER_APPS: usize = 1 << 1;

    fn ns_window(app: &AppHandle) -> Option<*mut AnyObject> {
        let win = app.get_webview_window(MAIN_LABEL)?;
        let ptr = win.ns_window().ok()? as *mut AnyObject;
        if ptr.is_null() {
            None
        } else {
            Some(ptr)
        }
    }

    fn frontmost_application_pid() -> Option<i32> {
        unsafe {
            let workspace_cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSWorkspace\0").ok()?)?;
            let workspace: *mut AnyObject = msg_send![workspace_cls, sharedWorkspace];
            if workspace.is_null() {
                return None;
            }
            let app: *mut AnyObject = msg_send![workspace, frontmostApplication];
            if app.is_null() {
                return None;
            }
            let pid: i32 = msg_send![app, processIdentifier];
            Some(pid)
        }
    }

    pub(super) fn remember_foreground_application() {
        let Some(pid) = frontmost_application_pid() else {
            return;
        };
        if pid == std::process::id() as i32 {
            return;
        }
        if let Ok(mut previous) = previous_foreground_pid().lock() {
            *previous = Some(pid);
        }
    }

    pub(super) fn restore_foreground_application() {
        let pid = previous_foreground_pid()
            .lock()
            .ok()
            .and_then(|previous| *previous);
        let Some(pid) = pid else {
            return;
        };
        unsafe {
            let app_cls = match AnyClass::get(
                CStr::from_bytes_with_nul(b"NSRunningApplication\0").unwrap(),
            ) {
                Some(cls) => cls,
                None => return,
            };
            let running_app: *mut AnyObject =
                msg_send![app_cls, runningApplicationWithProcessIdentifier: pid];
            if running_app.is_null() {
                return;
            }
            let _: bool = msg_send![
                running_app,
                activateWithOptions: NS_APPLICATION_ACTIVATE_IGNORING_OTHER_APPS
            ];
        }
    }

    pub(super) fn is_previous_foreground_application_frontmost() -> bool {
        let previous_pid = previous_foreground_pid()
            .lock()
            .ok()
            .and_then(|previous| *previous);
        match (previous_pid, frontmost_application_pid()) {
            (Some(previous), Some(frontmost)) => previous == frontmost,
            _ => false,
        }
    }

    /// Apply panel-like semantics to the main NSWindow.
    ///
    /// Tauri creates a plain NSWindow. NSPanel-specific bits such as
    /// NonactivatingPanel (0x80) and setBecomesKeyOnlyIfNeeded: are not valid
    /// on NSWindow and throw at runtime, so we only set NSWindow-safe
    /// properties here. The app stays hidden from the dock via
    /// ActivationPolicy::Accessory, and we explicitly request key status when
    /// the user interacts with an input.
    pub(super) fn promote_main_to_panel(app: &AppHandle) {
        let Some(ns_window) = ns_window(app) else {
            return;
        };
        unsafe {
            let current: usize = msg_send![ns_window, styleMask];
            // Keep the window borderless (required for the transparent shell)
            // and resizable. Do NOT OR in NonactivatingPanel (0x80) — that
            // mask is NSPanel-only and aborts on an NSWindow.
            let next: usize = current
                | NSWindowStyleMask::Borderless.0 as usize
                | NSWindowStyleMask::Resizable.0 as usize;
            let _: () = msg_send![ns_window, setStyleMask: next];

            // Native shadows on transparent borderless windows create a
            // larger AppKit hit-test region around the visual shell. Qx draws
            // its own CSS shadows, so keep the platform shadow disabled to
            // let outside clicks leave the panel cleanly.
            let _: () = msg_send![ns_window, setHasShadow: false];

            // Keep the panel visible when the user switches to another app.
            let _: () = msg_send![ns_window, setHidesOnDeactivate: false];

            // Float above regular windows. 3 == NSFloatingWindowLevel.
            let _: () = msg_send![ns_window, setLevel: 3isize];

            // Visible on every Space and inside other apps' fullscreen.
            let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::IgnoresCycle;
            let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
        }
    }

    /// Show the window in its current position without activating the app
    /// or stealing key-window status from the frontmost application.
    pub(super) fn order_front_without_activating(app: &AppHandle) {
        let Some(ns_window) = ns_window(app) else {
            return;
        };
        unsafe {
            let _: () = msg_send![ns_window, orderFrontRegardless];
        }
    }

    /// Promote the window to key window — needed when the user clicks into a
    /// text input or otherwise needs keyboard focus inside the panel.
    pub(super) fn make_key_window(app: &AppHandle) {
        let Some(ns_window) = ns_window(app) else {
            return;
        };
        unsafe {
            let _: () = msg_send![ns_window, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
        }
    }

    /// Activate the Qx app itself.
    ///
    /// With `ActivationPolicy::Accessory` and no `NonactivatingPanel` mask,
    /// `makeKeyAndOrderFront:` alone is not enough for the window to receive
    /// key status. We briefly activate our own app so typing reaches the
    /// search field; focus is restored to the previous foreground app on hide.
    pub(super) fn activate_app() {
        unsafe {
            let app_cls =
                match AnyClass::get(CStr::from_bytes_with_nul(b"NSApplication\0").unwrap()) {
                    Some(cls) => cls,
                    None => return,
                };
            let app: *mut AnyObject = msg_send![app_cls, sharedApplication];
            if app.is_null() {
                return;
            }
            let _: () = msg_send![app, activateIgnoringOtherApps: true];
        }
    }

    pub(super) fn cursor_position_for_display_lookup() -> Option<(f64, f64)> {
        unsafe {
            let event_cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSEvent\0").ok()?)?;
            let point: objc2_foundation::NSPoint = msg_send![event_cls, mouseLocation];
            let y = core_graphics::display::CGDisplay::main().pixels_high() as f64 - point.y;
            Some((point.x, y))
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    pub(super) fn cursor_position_for_display_lookup() -> Option<(f64, f64)> {
        None
    }
}

#[cfg(target_os = "macos")]
use macos as platform;

#[derive(Clone, Copy, Debug, PartialEq)]
struct DisplayArea {
    scale_factor: f64,
    frame_x: i32,
    frame_y: i32,
    frame_width: u32,
    frame_height: u32,
    work_x: i32,
    work_y: i32,
    work_width: u32,
    work_height: u32,
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

fn contains_point(area: DisplayArea, x: f64, y: f64) -> bool {
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

fn select_display_area_for_cursor(areas: &[DisplayArea], x: f64, y: f64) -> Option<DisplayArea> {
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

fn select_display_area_for_raw_cursor(
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
        .map(|monitors| {
            monitors
                .iter()
                .map(display_area_from_monitor)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn display_area_for_raw_cursor(app: &AppHandle, x: f64, y: f64) -> Option<DisplayArea> {
    select_display_area_for_raw_cursor(&available_display_areas(app), x, y)
}

fn display_area_for_cursor(app: &AppHandle, x: f64, y: f64) -> Option<DisplayArea> {
    let areas = available_display_areas(app);
    select_display_area_for_cursor(&areas, x, y).or_else(|| {
        app.monitor_from_point(x, y)
            .ok()
            .flatten()
            .map(|monitor| display_area_from_monitor(&monitor))
    })
}

fn fallback_display_area(app: &AppHandle, win: &tauri::WebviewWindow) -> Option<DisplayArea> {
    win.current_monitor()
        .ok()
        .flatten()
        .map(|monitor| display_area_from_monitor(&monitor))
        .or_else(|| {
            app.primary_monitor()
                .ok()
                .flatten()
                .map(|monitor| display_area_from_monitor(&monitor))
        })
}

fn display_area_for_current_cursor(
    app: &AppHandle,
    win: &tauri::WebviewWindow,
) -> Option<DisplayArea> {
    platform::cursor_position_for_display_lookup()
        .and_then(|(x, y)| display_area_for_raw_cursor(app, x, y))
        .or_else(|| {
            app.cursor_position()
                .ok()
                .and_then(|cursor| display_area_for_cursor(app, cursor.x, cursor.y))
        })
        .or_else(|| fallback_display_area(app, win))
}

fn destination_geometry(
    area: DisplayArea,
    current_scale: f64,
    current_width: u32,
    current_height: u32,
) -> (f64, f64, i32, i32) {
    let current_scale = if current_scale > 0.0 {
        current_scale
    } else {
        1.0
    };
    let target_scale = if area.scale_factor > 0.0 {
        area.scale_factor
    } else {
        1.0
    };
    let logical_width = current_width as f64 / current_scale;
    let logical_height = current_height as f64 / current_scale;
    let max_logical_width = area.work_width as f64 / target_scale * 0.9;
    let max_logical_height = area.work_height as f64 / target_scale * 0.9;
    let target_logical_width = logical_width.min(max_logical_width).max(1.0);
    let target_logical_height = logical_height.min(max_logical_height).max(1.0);
    let target_width = (target_logical_width * target_scale).round() as i32;
    let target_height = (target_logical_height * target_scale).round() as i32;
    let x = area.work_x + ((area.work_width as i32 - target_width) / 2);
    let y = area.work_y + ((area.work_height as i32 - target_height) / 3);
    (target_logical_width, target_logical_height, x, y)
}

fn center_on_cursor(app: &AppHandle) -> Option<()> {
    let win = app.get_webview_window(MAIN_LABEL)?;
    let area = display_area_for_current_cursor(app, &win)?;
    let size = win.outer_size().or_else(|_| win.inner_size()).ok()?;
    let current_scale = win
        .scale_factor()
        .ok()
        .filter(|scale| *scale > 0.0)
        .unwrap_or(1.0);

    // Tauri/Wry is per-monitor-DPI-aware on Windows. Preserve the launcher's
    // logical size when crossing displays and predict its physical size using
    // the destination scale factor; centering with the old monitor's physical
    // pixels otherwise shifts the window after WM_DPICHANGED is applied.
    let logical_width = size.width as f64 / current_scale;
    let logical_height = size.height as f64 / current_scale;
    let (target_logical_width, target_logical_height, x, y) =
        destination_geometry(area, current_scale, size.width, size.height);
    if target_logical_width < logical_width || target_logical_height < logical_height {
        let _ = win.set_size(LogicalSize::new(
            target_logical_width,
            target_logical_height,
        ));
    }
    let _ = win.set_position(PhysicalPosition::new(x, y));
    Some(())
}

/// One-time installation during app setup: hide the dock icon and promote
/// the main window into an NSPanel.
pub fn install(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
        macos::promote_main_to_panel(app);
    }
    let _ = app; // suppress unused on non-macos
}

/// Show the main window as a floating, non-activating panel.
pub fn show_floating(app: &AppHandle) {
    let _ = center_on_cursor(app);
    #[cfg(target_os = "macos")]
    macos::remember_foreground_application();
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        let _ = win.show();
    }
    #[cfg(target_os = "macos")]
    {
        macos::promote_main_to_panel(app);
        macos::order_front_without_activating(app);
        // With only NSWindow-safe flags (no NonactivatingPanel mask), the
        // accessory-policy app must be explicitly activated before the panel
        // can become key window. Focus is restored to the previous foreground
        // app when the panel is hidden via hide_and_restore_focus.
        macos::activate_app();
        // Make the panel key window on every show. Without this, the panel
        // loses key status after hide and keyboard events (Esc especially)
        // stop reaching the webview — SearchBar's mount effect only fires
        // once, so it can't restore key on subsequent shows.
        macos::make_key_window(app);
    }
    #[cfg(not(target_os = "macos"))]
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        let _ = win.set_focus();
    }
}

/// Hide the main window. No-op if already hidden.
pub fn hide(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        let _ = win.hide();
    }
}

/// Hide the main window and restore the app that was frontmost before Qx
/// floated above it. Use this for paste-at-cursor flows; plain hide remains
/// available for launch/open actions where another app may intentionally take
/// focus next.
pub fn hide_and_restore_focus(app: &AppHandle) {
    hide(app);
    #[cfg(target_os = "macos")]
    macos::restore_foreground_application();
}

pub fn hide_restore_focus_and_wait(app: &AppHandle, timeout: Duration) {
    hide_and_restore_focus(app);
    #[cfg(target_os = "macos")]
    {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            if macos::is_previous_foreground_application_frontmost() {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        // Let the restored app finish re-establishing first responder state.
        thread::sleep(Duration::from_millis(120));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = timeout;
}

/// Toggle visibility — used by the toggle_launcher global shortcut.
pub fn toggle(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            show_floating(app);
        }
    }
}

/// Show + navigate to a route by emitting the existing `navigate` event.
/// Mirrors the old `show_and_navigate` behavior but never steals focus.
pub fn show_and_navigate(app: &AppHandle, route: &str) {
    show_floating(app);
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        let _ = tauri::Emitter::emit(&win, "navigate", route);
    }
}

#[tauri::command]
pub fn floating_show(app: AppHandle) {
    show_floating(&app);
}

#[tauri::command]
pub fn floating_hide(app: AppHandle) {
    hide(&app);
}

#[tauri::command]
pub fn floating_hide_restore_focus(app: AppHandle) {
    hide_and_restore_focus(&app);
}

#[tauri::command]
pub fn floating_toggle(app: AppHandle) {
    toggle(&app);
}

/// Promote the panel to key window so keyboard input reaches the webview.
/// The frontend calls this when an input/textarea inside the panel is
/// focused; otherwise the panel stays non-activating and the user's
/// foreground app keeps key-window status.
#[tauri::command]
pub fn floating_request_key(app: AppHandle) {
    #[cfg(target_os = "macos")]
    macos::make_key_window(&app);
    #[cfg(not(target_os = "macos"))]
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        let _ = win.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        contains_point, destination_geometry, select_display_area_for_cursor,
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
        let selected = select_display_area_for_cursor(&[builtin, external], -100.0, 500.0);
        assert_eq!(selected, Some(external));
    }

    #[test]
    fn selects_external_display_right_of_builtin() {
        let builtin = area(0, 0, 3024, 1964);
        let external = area(3024, 120, 2560, 1440);
        let selected = select_display_area_for_cursor(&[builtin, external], 4000.0, 800.0);
        assert_eq!(selected, Some(external));
    }

    #[test]
    fn full_frame_contains_menu_bar_area() {
        let builtin = area(0, 0, 3024, 1964);
        assert!(contains_point(builtin, 1200.0, 10.0));
    }

    #[test]
    fn falls_back_to_nearest_display_when_cursor_is_between_frames() {
        let left = area(0, 0, 1000, 800);
        let right = area(1200, 0, 1000, 800);
        let selected = select_display_area_for_cursor(&[left, right], 1120.0, 300.0);
        assert_eq!(selected, Some(right));
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
    fn destination_geometry_preserves_logical_size_across_windows_dpi_changes() {
        let destination = DisplayArea {
            scale_factor: 2.0,
            frame_x: 0,
            frame_y: 0,
            frame_width: 3840,
            frame_height: 2160,
            work_x: 0,
            work_y: 0,
            work_width: 3840,
            work_height: 2080,
        };
        let (width, height, x, y) = destination_geometry(destination, 1.25, 1225, 720);
        assert_eq!((width, height), (980.0, 576.0));
        assert_eq!(x, 940);
        assert_eq!(y, 309);
    }

    #[test]
    fn destination_geometry_fits_oversized_window_to_smaller_work_area() {
        let destination = scaled_area(1.0, 0, 1280);
        let (width, height, x, _) = destination_geometry(destination, 2.0, 3000, 1800);
        assert_eq!(width, 1152.0);
        assert_eq!(height, 900.0);
        assert_eq!(x, 64);
    }
}
