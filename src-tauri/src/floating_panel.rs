//! Floating, non-activating window shell (macOS-first).
//!
//! Converts the `main` Tauri window into a Raycast/Alfred-style accessory
//! panel: the app is hidden from the dock entirely (`ActivationPolicy::
//! Accessory`), and the window is promoted into a non-activating NSPanel so
//! invoking it from a global shortcut never steals focus from the user's
//! current foreground app. Inputs that need keyboard focus explicitly
//! request key-window status through `floating_request_key`.

use tauri::{AppHandle, Manager, PhysicalPosition};

pub(crate) const MAIN_LABEL: &str = "main";

#[cfg(target_os = "macos")]
mod macos {
    use super::MAIN_LABEL;
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSWindowCollectionBehavior, NSWindowStyleMask};
    use tauri::AppHandle;
    use tauri::Manager;

    fn ns_window(app: &AppHandle) -> Option<*mut AnyObject> {
        let win = app.get_webview_window(MAIN_LABEL)?;
        let ptr = win.ns_window().ok()? as *mut AnyObject;
        if ptr.is_null() {
            None
        } else {
            Some(ptr)
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
}

fn center_on_cursor(app: &AppHandle) -> Option<()> {
    let win = app.get_webview_window(MAIN_LABEL)?;
    let cursor = app.cursor_position().ok()?;
    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| win.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())?;
    let area = monitor.work_area();
    let size = win.outer_size().or_else(|_| win.inner_size()).ok()?;
    let x = area.position.x + ((area.size.width as i32 - size.width as i32) / 2);
    let y = area.position.y + ((area.size.height as i32 - size.height as i32) / 3);
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
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        let _ = win.show();
    }
    #[cfg(target_os = "macos")]
    {
        macos::promote_main_to_panel(app);
        macos::order_front_without_activating(app);
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
