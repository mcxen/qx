//! Floating, non-activating window shell (macOS-first).
//!
//! Converts the `main` Tauri window into a Raycast/Alfred-style accessory
//! panel: the app is hidden from the dock entirely (`ActivationPolicy::
//! Accessory`), and the window is promoted into a non-activating NSPanel so
//! invoking it from a global shortcut never steals focus from the user's
//! current foreground app. Inputs that need keyboard focus explicitly
//! request key-window status through `floating_request_key`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

use crate::display::{display_area_for_current_cursor, DisplayArea};

pub(crate) const MAIN_LABEL: &str = "main";
static PREVIOUS_FOREGROUND_PID: OnceLock<Mutex<Option<i32>>> = OnceLock::new();
/// Frontend tab / route last known to Rust (for global-shortcut toggle-to-close).
static ACTIVE_ROUTE: OnceLock<Mutex<String>> = OnceLock::new();
/// Our own open flag — more reliable than `is_visible()` alone for NSPanel /
/// blur-hide races with global hotkeys.
static PANEL_OPEN: AtomicBool = AtomicBool::new(false);
/// When the panel was last hidden (blur-hide can race ahead of the hotkey).
static LAST_HIDE_AT: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
/// Ignore re-open for this long after a hide so the same keypress that caused
/// blur→hide does not immediately re-show the panel. Keep short — longer grace
/// made deliberate double-tap summon feel unresponsive (~0.3s+ dead).
const HIDE_TOGGLE_GRACE: Duration = Duration::from_millis(160);
/// Ignore Focused(false) auto-hide until this instant (e.g. after screencap
/// stop: show main then focus flickers and would look like Qx "quit").
static SUPPRESS_AUTO_HIDE_UNTIL: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
/// Sticky suppress while the macOS first-launch permission wizard is open
/// (user spends time in System Settings without hiding Qx).
static ONBOARDING_ACTIVE: AtomicBool = AtomicBool::new(false);

fn previous_foreground_pid() -> &'static Mutex<Option<i32>> {
    PREVIOUS_FOREGROUND_PID.get_or_init(|| Mutex::new(None))
}

fn active_route_lock() -> &'static Mutex<String> {
    ACTIVE_ROUTE.get_or_init(|| Mutex::new("launcher".to_string()))
}

fn last_hide_lock() -> &'static Mutex<Option<Instant>> {
    LAST_HIDE_AT.get_or_init(|| Mutex::new(None))
}

pub fn remember_active_route(route: &str) {
    let route = if route.trim().is_empty() {
        "launcher"
    } else {
        route.trim()
    };
    if let Ok(mut guard) = active_route_lock().lock() {
        *guard = route.to_string();
    }
}

pub fn active_route() -> String {
    active_route_lock()
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|_| "launcher".to_string())
}

fn routes_match(current: &str, target: &str) -> bool {
    let c = if current.is_empty() {
        "launcher"
    } else {
        current
    };
    let t = if target.is_empty() {
        "launcher"
    } else {
        target
    };
    c == t
}

fn mark_panel_open() {
    PANEL_OPEN.store(true, Ordering::SeqCst);
    if let Ok(mut guard) = last_hide_lock().lock() {
        *guard = None;
    }
}

fn mark_panel_closed() {
    PANEL_OPEN.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = last_hide_lock().lock() {
        *guard = Some(Instant::now());
    }
}

fn recently_closed() -> bool {
    last_hide_lock()
        .lock()
        .ok()
        .and_then(|guard| *guard)
        .map(|at| at.elapsed() < HIDE_TOGGLE_GRACE)
        .unwrap_or(false)
}

fn suppress_auto_hide_lock() -> &'static Mutex<Option<Instant>> {
    SUPPRESS_AUTO_HIDE_UNTIL.get_or_init(|| Mutex::new(None))
}

/// Block auto-hide-on-blur for a short period after programmatically showing
/// the panel (recording stop, region cancel, etc.).
pub fn suppress_auto_hide(duration: Duration) {
    if let Ok(mut guard) = suppress_auto_hide_lock().lock() {
        *guard = Some(Instant::now() + duration);
    }
}

/// Whether Focused(false) should skip auto-hide right now.
pub fn auto_hide_suppressed() -> bool {
    if ONBOARDING_ACTIVE.load(Ordering::SeqCst) {
        return true;
    }
    suppress_auto_hide_lock()
        .lock()
        .ok()
        .and_then(|guard| *guard)
        .map(|until| Instant::now() < until)
        .unwrap_or(false)
}

/// Keep the main panel visible while the user grants macOS permissions.
pub fn set_onboarding_active(active: bool) {
    ONBOARDING_ACTIVE.store(active, Ordering::SeqCst);
    if active {
        // Also refresh the timed suppress as a safety net.
        suppress_auto_hide(Duration::from_secs(120));
    }
}

#[tauri::command]
pub fn floating_set_onboarding_active(active: bool) {
    set_onboarding_active(active);
}

/// Prefer our open flag; fall back to OS visibility for paths that only called
/// `Window::hide` without going through this module.
fn panel_appears_open(win: &WebviewWindow) -> bool {
    PANEL_OPEN.load(Ordering::SeqCst) || win.is_visible().unwrap_or(false)
}

fn accepts_key_window_request(panel_open: bool, native_visible: bool) -> bool {
    panel_open && native_visible
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

    /// Space / fullscreen behavior for a Raycast-style launcher panel.
    ///
    /// `MoveToActiveSpace` makes the panel follow the desktop where it is
    /// summoned instead of switching the user back to Qx's creation Space.
    /// `Transient` keeps it out of Mission Control, while
    /// `FullScreenAuxiliary` allows the launcher above a fullscreen app.
    /// Do not set `Stationary`, which pins the panel to its creation Space.
    fn panel_collection_behavior() -> NSWindowCollectionBehavior {
        NSWindowCollectionBehavior::MoveToActiveSpace
            | NSWindowCollectionBehavior::Transient
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle
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

            // Let AppKit draw the shadow outside the transparent borderless
            // window. CSS shadows cannot escape the WebView bounds, so they
            // cannot provide the same launcher-style separation from the
            // desktop. Recompute once after changing the window style.
            let _: () = msg_send![ns_window, setHasShadow: true];
            let _: () = msg_send![ns_window, invalidateShadow];

            // Keep the panel visible when the user switches to another app.
            let _: () = msg_send![ns_window, setHidesOnDeactivate: false];

            // Float above regular windows. 3 == NSFloatingWindowLevel.
            // FullScreenAuxiliary is what lets us layer over fullscreen apps;
            // level alone is not enough.
            let _: () = msg_send![ns_window, setLevel: 3isize];

            let _: () = msg_send![ns_window, setCollectionBehavior: panel_collection_behavior()];
        }
    }

    /// Re-assert Space membership right before showing.
    ///
    /// AppKit can lose the transient active-Space behavior after the window has
    /// lived on another Space, so re-apply it before every summon.
    pub(super) fn reassert_space_behavior(app: &AppHandle) {
        let Some(ns_window) = ns_window(app) else {
            return;
        };
        unsafe {
            let _: () = msg_send![ns_window, setLevel: 3isize];
            let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
            let _: () = msg_send![ns_window, setCollectionBehavior: panel_collection_behavior()];
        }
    }

    /// Show the window in its current position without activating the app
    /// or stealing key-window status from the frontmost application.
    pub(super) fn order_front_without_activating(app: &AppHandle) {
        let Some(ns_window) = ns_window(app) else {
            return;
        };
        unsafe {
            // Re-apply before orderFront so the window is eligible for the
            // active Space / fullscreen session at the moment of show.
            let _: () = msg_send![ns_window, setCollectionBehavior: panel_collection_behavior()];
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
    let area =
        display_area_for_current_cursor(app, &win, platform::cursor_position_for_display_lookup())?;
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
///
/// Safe from tokio async command workers: AppKit ordering is dispatched to the
/// main thread (macOS aborts with SIGTRAP if orderFront runs off-main).
pub fn show_floating(app: &AppHandle) {
    let app = app.clone();
    let _ = crate::main_thread::run_on_main(&app.clone(), move || show_floating_now(&app));
}

pub(crate) fn show_floating_now(app: &AppHandle) {
    mark_panel_open();
    #[cfg(target_os = "macos")]
    {
        // Must run *before* show/orderFront so AppKit places the window on the
        // active Space (including another app's fullscreen), not the Space
        // where the window last lived.
        macos::reassert_space_behavior(app);
        macos::remember_foreground_application();
    }
    let _ = center_on_cursor(app);
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        let _ = win.show();
    }
    // A hidden window can report its creation display's DPI during the very
    // first summon. Re-resolve after `show` so the initial placement uses the
    // actual cursor display without waiting for a second shortcut invocation.
    let _ = center_on_cursor(app);
    #[cfg(target_os = "macos")]
    {
        // orderFront re-applies collection behavior again, then fronts.
        macos::order_front_without_activating(app);
        // With only NSWindow-safe flags (no NonactivatingPanel mask), the
        // accessory-policy app must be explicitly activated before the panel
        // can become key window. Focus is restored to the previous foreground
        // app when the panel is hidden via hide_and_restore_focus.
        // MoveToActiveSpace takes effect when the window is activated.
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
    let app = app.clone();
    let _ = crate::main_thread::run_on_main(&app.clone(), move || {
        mark_panel_closed();
        if let Some(win) = app.get_webview_window(MAIN_LABEL) {
            let _ = win.hide();
        }
    });
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

/// Toggle visibility without changing the active route.
/// Hidden panels reopen exactly where the user left them; visible panels hide
/// and restore focus to the previously active application.
pub fn toggle(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        // Open → close. Also absorb blur-hide races: hotkey fires after the
        // window already hid, so "toggle" must stay closed, not re-open.
        if panel_appears_open(&win) {
            hide_and_restore_focus(app);
            return;
        }
        if recently_closed() {
            return;
        }
        show_floating(app);
    }
}

/// Toggle the launcher shortcut:
/// - visible -> hide and restore focus
/// - hidden -> show on Launcher and focus search
pub fn toggle_launcher(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        if panel_appears_open(&win) {
            hide_and_restore_focus(app);
            return;
        }
        if recently_closed() {
            return;
        }

        show_floating(app);
        let need_nav = !routes_match(&active_route(), "launcher");
        remember_active_route("launcher");
        if need_nav {
            let _ = tauri::Emitter::emit(&win, "navigate", "launcher");
        }
    }
}

/// Show + navigate to a route by emitting the existing `navigate` event.
/// Mirrors the old `show_and_navigate` behavior but never steals focus.
pub fn show_and_navigate(app: &AppHandle, route: &str) {
    let app = app.clone();
    let route = route.to_string();
    let _ = crate::main_thread::run_on_main(&app.clone(), move || {
        show_and_navigate_now(&app, &route);
    });
}

/// Direct path when the caller is already on the main thread.
pub(crate) fn show_and_navigate_now(app: &AppHandle, route: &str) {
    show_floating_now(app);
    remember_active_route(route);
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        let _ = tauri::Emitter::emit(&win, "navigate", route);
    }
}

/// Global module shortcut behavior (true toggle):
/// - hidden → show and open `route`
/// - open on `route` → hide panel (same shortcut dismisses)
/// - open on another tab → switch to `route`
/// - blur already hid on same route (hotkey race) → stay hidden
pub fn toggle_route(app: &AppHandle, route: &str) {
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        let same_route = routes_match(&active_route(), route);
        if panel_appears_open(&win) && same_route {
            hide_and_restore_focus(app);
            return;
        }
        // Hotkey often blurs the panel first (auto-hide-on-blur). That hide
        // wins the race; without this guard we would re-open on the same press.
        if !panel_appears_open(&win) && same_route && recently_closed() {
            return;
        }
    }
    show_and_navigate(app, route);
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

#[tauri::command]
pub fn set_active_route(route: String) {
    remember_active_route(&route);
}

/// Promote the panel to key window so keyboard input reaches the webview.
/// The frontend calls this when an input/textarea inside the panel is
/// focused; otherwise the panel stays non-activating and the user's
/// foreground app keeps key-window status.
#[tauri::command]
pub fn floating_request_key(app: AppHandle) {
    // A debounced frontend focus request may arrive just after an outside click
    // has hidden the panel. Never let `makeKeyAndOrderFront` resurrect a closed
    // launcher; re-check both our lifecycle flag and native visibility on the
    // UI thread immediately before touching the window.
    let app_for_ui = app.clone();
    let _ = crate::main_thread::run_on_main(&app, move || {
        let Some(win) = app_for_ui.get_webview_window(MAIN_LABEL) else {
            return;
        };
        if !accepts_key_window_request(
            PANEL_OPEN.load(Ordering::SeqCst),
            win.is_visible().unwrap_or(false),
        ) {
            return;
        }
        #[cfg(target_os = "macos")]
        macos::make_key_window(&app_for_ui);
        #[cfg(not(target_os = "macos"))]
        let _ = win.set_focus();
    });
}

#[cfg(test)]
mod tests {
    use super::{accepts_key_window_request, destination_geometry};
    use crate::display::DisplayArea;

    #[test]
    fn key_window_request_never_resurrects_closed_or_hidden_panel() {
        assert!(accepts_key_window_request(true, true));
        assert!(!accepts_key_window_request(false, true));
        assert!(!accepts_key_window_request(true, false));
        assert!(!accepts_key_window_request(false, false));
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
