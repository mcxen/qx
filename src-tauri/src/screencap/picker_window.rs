use tauri::utils::config::Color;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl};

use super::geometry::{capture_coordinate_scale, covers_full_display};
use super::selection::{
    host_is_multi_display, on_display_topology_changed, screencap_region_select_status_with_restore,
};
use super::state::{
    picker as picker_session, picker_pointer_following, picker_session_is_current,
    set_picker_pointer_follow,
};
use super::types::{CaptureMode, PickerSession};
use crate::display::{
    all_capture_monitors, capture_monitor, capture_monitor_for_tauri, cursor_monitor,
    tauri_monitor_for_capture,
};
use crate::window_composition::set_cloaked as set_windows_cloaked;

pub(super) const PICKER_LABEL: &str = "region-picker";
const SHADE_PREFIX: &str = "region-picker-shade-";

pub(super) fn picker(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    crate::window_composition::reusable_window(app, PICKER_LABEL)
}

pub(super) fn show(
    app: &AppHandle,
    mode: CaptureMode,
    selected_monitor_id: Option<u32>,
    main_was_visible: bool,
) -> Result<(), String> {
    let selected_capture = match selected_monitor_id {
        Some(monitor_id) => capture_monitor(Some(monitor_id))?,
        None => {
            let monitor = cursor_monitor(app)
                .or_else(|| app.primary_monitor().ok().flatten())
                .ok_or_else(|| "No display found".to_string())?;
            capture_monitor_for_tauri(app, &monitor)?
        }
    };
    let monitor = tauri_monitor_for_capture(app, &selected_capture)?;
    let position = monitor.position();
    let size = monitor.size();
    let scale = monitor.scale_factor().max(1.0);
    // Logical size of the selected display (matches CSS clientX/Y in the picker).
    let logical_w = size.width as f64 / scale;
    let logical_h = size.height as f64 / scale;
    let logical_x = position.x as f64 / scale;
    let logical_y = position.y as f64 / scale;
    let monitor_id = selected_capture
        .id()
        .map_err(|error| format!("display id: {error}"))?;
    if super::snapshot::descriptor(monitor_id).is_none() {
        return Err("Selected display is not part of the frozen desktop frame".to_string());
    }
    let monitor_name = selected_capture
        .friendly_name()
        .or_else(|_| selected_capture.name())
        .unwrap_or_else(|_| "Display".to_string());
    let capture_width = selected_capture
        .width()
        .map_err(|error| format!("display width: {error}"))?;
    let coordinate_scale = capture_coordinate_scale(capture_width, logical_w);
    // Fresh open always force-refreshes inventory (hot-plug since last open).
    // Relocations reuse the session flag; topology revalidation / display
    // monitor may flip it while the picker stays open.
    let multi_display = if selected_monitor_id.is_none() {
        host_is_multi_display(true)
    } else {
        picker_session()
            .lock()
            .ok()
            .and_then(|session| session.as_ref().map(|session| session.multi_display))
            .unwrap_or_else(|| host_is_multi_display(false))
    };
    if let Ok(mut session) = picker_session().lock() {
        *session = Some(PickerSession {
            mode,
            monitor_id,
            monitor_name,
            coordinate_scale,
            logical_area: None,
            frame_x: position.x,
            frame_y: position.y,
            multi_display,
            main_was_visible,
        });
    }
    // Window create/show/focus are AppKit main-thread only when reached from async commands.
    let app_for_ui = app.clone();
    let pos_x = position.x;
    let pos_y = position.y;
    let size_w = size.width;
    let size_h = size.height;
    crate::main_thread::run_on_main(&app_for_ui.clone(), move || {
        // Multi-display only: outer shades on non-active screens. Single-display
        // skips this entirely (no shade windows, no extra monitor enumeration
        // beyond the early count already cached on macOS).
        if multi_display {
            show_shades(&app_for_ui, monitor_id)?;
        } else {
            hide_shades(&app_for_ui);
        }

        let picker = crate::window_composition::ensure_reusable_window(
            &app_for_ui,
            PICKER_LABEL,
            |native_label| {
                crate::webview_policy::window_builder(
                    &app_for_ui,
                    native_label,
                    WebviewUrl::App("index.html?view=region-picker".into()),
                )
                .title("Qx Region Picker")
                .inner_size(logical_w, logical_h)
                .position(logical_x, logical_y)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .decorations(false)
                .transparent(true)
                // WebView2 defaults to an opaque black controller background even
                // when the native window is transparent. Alpha=0 is the explicit
                // Windows 8+ transparent WebView contract in Tauri.
                .background_color(Color(0, 0, 0, 0))
                .shadow(false)
                // AppKit capture surfaces use a native IME-safe level. Tauri's
                // generic macOS floating state would overwrite that level.
                .always_on_top(!cfg!(target_os = "macos"))
                .skip_taskbar(true)
                .focused(true)
                .accept_first_mouse(true)
                // Picker must never end up in the recording itself.
                .content_protected(true)
                .visible(false)
                .build()
                .map_err(|error| format!("open region picker: {error}"))
            },
        )?;
        let _ = picker.set_content_protected(true);
        #[cfg(not(target_os = "macos"))]
        let _ = picker.set_always_on_top(true);
        prepare_for_show(&picker);
        // Cover the selected display exactly. Physical size/position matches the
        // monitor framebuffer; CSS clientX/Y stay in logical points (DPR scaled).
        let _ = picker.set_position(PhysicalPosition::new(pos_x, pos_y));
        let _ = picker.set_size(PhysicalSize::new(size_w, size_h));
        crate::window_composition::show(&picker)
            .map_err(|error| format!("show region picker: {error}"))?;
        prepare_for_show(&picker);
        let _ = picker.set_ignore_cursor_events(false);
        let _ = picker.set_focus();
        prepare_for_show(&picker);
        Ok::<(), String>(())
    })??;
    if let Some(status) = screencap_region_select_status_with_restore(false) {
        let _ = app.emit("screencap:picker", status);
    }
    Ok(())
}

fn session_is_multi_display() -> bool {
    picker_session()
        .lock()
        .ok()
        .and_then(|session| session.as_ref().map(|session| session.multi_display))
        .unwrap_or(false)
}

pub(super) fn start_pointer_display_tracker(app: AppHandle, generation: u64) {
    // Always spawn: single-display stays on a slow topology watch so plugging
    // an external monitor mid-session can promote into multi-display mode.
    // Multi-display uses the fast 12ms cursor handoff loop.
    if !session_is_multi_display() {
        set_picker_pointer_follow(false);
    }
    tauri::async_runtime::spawn(async move {
        let mut fast = tokio::time::interval(std::time::Duration::from_millis(12));
        fast.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut last_topology = std::time::Instant::now()
            .checked_sub(std::time::Duration::from_secs(1))
            .unwrap_or_else(std::time::Instant::now);

        loop {
            if !picker_session_is_current(generation) {
                break;
            }

            // Hot-plug revalidation (~2Hz while open). display_monitor also
            // calls on_display_topology_changed; this covers the case where
            // the picker opened single-display and a monitor appears before
            // the next 2s poll, or the OS report lags the first attach.
            if last_topology.elapsed() >= std::time::Duration::from_millis(500) {
                last_topology = std::time::Instant::now();
                // Force refresh so attach between display_monitor's 2s polls is seen.
                on_display_topology_changed(&app, true);
            }

            if !session_is_multi_display() {
                // Single-display: no cursor handoff work — just wait for topology.
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                continue;
            }

            fast.tick().await;
            if !picker_session_is_current(generation) {
                break;
            }
            if !picker_pointer_following(generation) {
                continue;
            }
            // Light path: only cursor position + monitor geometry (no xcap).
            let Some(cursor_display) = cursor_monitor(&app) else {
                continue;
            };
            let cursor_position = cursor_display.position();
            let current = picker_session().lock().ok().and_then(|session| {
                session.as_ref().map(|session| {
                    (
                        session.mode,
                        session.monitor_id,
                        session.frame_x,
                        session.frame_y,
                        session.main_was_visible,
                    )
                })
            });
            let Some((mode, current_monitor_id, frame_x, frame_y, main_was_visible)) = current
            else {
                break;
            };
            // Same physical origin ⇒ still on the active display (cheap reject).
            if cursor_position.x == frame_x && cursor_position.y == frame_y {
                continue;
            }
            let Ok(capture) = capture_monitor_for_tauri(&app, &cursor_display) else {
                continue;
            };
            let Ok(monitor_id) = capture.id() else {
                continue;
            };
            // Matching capture id is authoritative when origins differ slightly
            // across DPI / origin rounding (common on Windows mixed-DPI).
            if monitor_id == current_monitor_id {
                continue;
            }
            if !picker_pointer_following(generation) {
                continue;
            }
            if let Err(error) = show(&app, mode, Some(monitor_id), main_was_visible) {
                crate::diagnostics::log(
                    crate::diagnostics::LogLevel::Warn,
                    "screencap.pointer_follow",
                    "failed to move capture picker to pointer display",
                    serde_json::json!({ "error": error, "monitorId": monitor_id }),
                );
            }
        }
    });
}

pub(super) fn shade_label(monitor_id: u32) -> String {
    format!("{SHADE_PREFIX}{monitor_id}")
}

/// Late WebView readiness must never revive a cancelled picker or turn a
/// passive recording frame back into a fullscreen keyboard/pointer trap.
pub(super) fn screencap_region_picker_ready(
    app: AppHandle,
) -> Result<Option<super::PickerStatus>, String> {
    let ui_app = app.clone();
    crate::runtime::run_ui(&app, move || {
        let Some(picker) = picker(&ui_app) else {
            return Ok(None);
        };
        if !picker.is_visible().unwrap_or(false) || super::commands::is_recording() {
            return Ok(None);
        }
        let status = super::selection::screencap_region_select_status_with_restore(false);
        if let Some(payload) = status.as_ref() {
            reassert_interactive(&ui_app)?;
            let _ = ui_app.emit("screencap:picker", payload);
        }
        Ok(status)
    })?
}

pub(crate) fn is_picker_surface(label: &str) -> bool {
    label == PICKER_LABEL
        || label.starts_with("region-picker-recovery-")
        || label.starts_with(SHADE_PREFIX)
}

#[cfg(target_os = "macos")]
fn promote_macos_capture_surface(window: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::NSWindowCollectionBehavior;

    const CG_POP_UP_MENU_WINDOW_LEVEL_KEY: i32 = 11;
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowLevelForKey(key: i32) -> i32;
    }

    let Ok(ptr) = window.ns_window() else {
        return;
    };
    let ns_window = ptr as *mut AnyObject;
    if ns_window.is_null() {
        return;
    }

    unsafe {
        // Stay above the menu/status bar and Dock, but below system popups
        // such as IME candidates. Screen Saver level covers the candidate
        // window even when the WebView correctly maintains marked text.
        // Apply this to both picker and shades, including cross-display reuse.
        let level = (CGWindowLevelForKey(CG_POP_UP_MENU_WINDOW_LEVEL_KEY) - 1) as isize;
        let current: NSWindowCollectionBehavior = msg_send![ns_window, collectionBehavior];
        let behavior = current
            | NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary;
        let _: () = msg_send![ns_window, setLevel: level];
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
        let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
    }
}

#[cfg(not(target_os = "macos"))]
fn promote_macos_capture_surface(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "macos")]
fn demote_macos_recording_surface(window: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    let Ok(ptr) = window.ns_window() else {
        return;
    };
    let ns_window = ptr as *mut AnyObject;
    if ns_window.is_null() {
        return;
    }
    unsafe {
        // Once recording starts this surface is passive decoration. Keep the
        // dedicated level-3 recording controls above it and clickable.
        let _: () = msg_send![ns_window, setLevel: 3isize];
    }
}

#[cfg(not(target_os = "macos"))]
fn demote_macos_recording_surface(_window: &tauri::WebviewWindow) {}

/// Prepare a reusable transparent picker surface before restoring its geometry.
/// Windows reveal is owned by window_composition::show, after geometry/input.
pub(super) fn prepare_for_show(window: &tauri::WebviewWindow) {
    promote_macos_capture_surface(window);
}

fn hide_surface(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        let _ = window.set_ignore_cursor_events(true);
        // Cloak first so DWM stops presenting the old transparent WebView2
        // swapchain before Tauri hides the reusable HWND.
        set_windows_cloaked(window, true);
        let _ = window.set_size(PhysicalSize::new(1, 1));
        let _ = window.set_position(PhysicalPosition::new(-32_000, -32_000));
    }
    let _ = crate::window_composition::hide(window);
}

/// Hide every outer multi-display shade surface (kept alive for reuse).
pub(super) fn hide_shades(app: &AppHandle) {
    for window in app.webview_windows().into_values() {
        if window.label().starts_with(SHADE_PREFIX) {
            hide_surface(&window);
        }
    }
}

/// Show outer shades on every non-active display. No-op on a single-display
/// machine (the expensive path multi-monitor capture must not pay). Callers
/// invoke this from the AppKit/Tauri main-thread hop.
pub(super) fn show_shades(app: &AppHandle, active_monitor_id: u32) -> Result<(), String> {
    let shade_displays = all_capture_monitors()?
        .into_iter()
        .filter_map(|capture| {
            let id = capture.id().ok()?;
            let monitor = tauri_monitor_for_capture(app, &capture).ok()?;
            let scale = monitor.scale_factor().max(1.0);
            Some((
                id,
                monitor.position().x,
                monitor.position().y,
                monitor.size().width,
                monitor.size().height,
                scale,
            ))
        })
        .collect::<Vec<_>>();
    // Single display: nothing to shade, nothing to follow. Drop any leftover
    // outer webs from a previous multi-display session and return immediately.
    if shade_displays.len() <= 1 {
        hide_shades(app);
        return Ok(());
    }
    let desired_shades = shade_displays
        .iter()
        .filter(|(id, ..)| *id != active_monitor_id)
        .map(|(id, ..)| shade_label(*id))
        .collect::<std::collections::HashSet<_>>();

    for window in app.webview_windows().into_values() {
        let desired = desired_shades.iter().any(|label| {
            window.label() == label || window.label().starts_with(&format!("{label}-recovery-"))
        });
        if window.label().starts_with(SHADE_PREFIX) && !desired {
            hide_surface(&window);
        }
    }

    for (shade_id, shade_x, shade_y, shade_w, shade_h, shade_scale) in &shade_displays {
        let label = shade_label(*shade_id);
        if *shade_id == active_monitor_id {
            if let Some(active_shade) = crate::window_composition::reusable_window(app, &label) {
                hide_surface(&active_shade);
            }
            continue;
        }
        let logical_width = *shade_w as f64 / *shade_scale;
        let logical_height = *shade_h as f64 / *shade_scale;
        let logical_x = *shade_x as f64 / *shade_scale;
        let logical_y = *shade_y as f64 / *shade_scale;
        let shade =
            crate::window_composition::ensure_reusable_window(app, &label, |native_label| {
                crate::webview_policy::window_builder(
                    app,
                    native_label,
                    // monitorId lets the shade webview request a handoff without a
                    // second IPC to discover which display it covers.
                    WebviewUrl::App(
                        format!("index.html?view=region-picker-shade&monitorId={shade_id}").into(),
                    ),
                )
                .title("Qx Capture Shade")
                .inner_size(logical_width, logical_height)
                .position(logical_x, logical_y)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .decorations(false)
                .transparent(true)
                .background_color(Color(0, 0, 0, 0))
                .shadow(false)
                // macOS uses a native capture level below; keeping Tauri's
                // generic floating state enabled would continuously reset it.
                .always_on_top(!cfg!(target_os = "macos"))
                .skip_taskbar(true)
                .focused(false)
                // First click on an outer display must activate that picker surface.
                .accept_first_mouse(true)
                .content_protected(true)
                .visible(false)
                .build()
                .map_err(|error| format!("open capture shade: {error}"))
            })?;
        let _ = shade.set_content_protected(true);
        #[cfg(not(target_os = "macos"))]
        let _ = shade.set_always_on_top(true);
        prepare_for_show(&shade);
        shade
            .set_position(PhysicalPosition::new(*shade_x, *shade_y))
            .map_err(|error| format!("position capture shade: {error}"))?;
        shade
            .set_size(PhysicalSize::new(*shade_w, *shade_h))
            .map_err(|error| format!("size capture shade: {error}"))?;
        // Outer shades own the pointer so desktop apps underneath cannot steal
        // the first click while multi-display capture is active.
        shade
            .set_ignore_cursor_events(false)
            .map_err(|error| format!("capture shade input: {error}"))?;
        if !shade.is_visible().unwrap_or(false) {
            crate::window_composition::show(&shade)
                .map_err(|error| format!("show capture shade: {error}"))?;
        }
        // AppKit/Tauri may restore the builder's floating level while ordering
        // a hidden window front; assert the capture level after Show as well.
        prepare_for_show(&shade);
    }
    Ok(())
}

pub(super) fn hide(app: &AppHandle) {
    // Keep the reusable WebView alive; destroying the final visible surface
    // while main is hidden can make the background app look terminated.
    let app = app.clone();
    let _ = crate::main_thread::run_on_main(&app.clone(), move || {
        for window in app.webview_windows().into_values() {
            if is_picker_surface(window.label()) {
                // WebView2 can retain the last compositor surface for a
                // transparent window after Hide(). If that surface is still
                // full-screen, Windows paints it as a white rectangle over
                // the desktop. Move the reusable surface off-screen and
                // shrink it before hiding; show_shades/show_region_picker
                // restore the real geometry on the next capture.
                hide_surface(&window);
            }
        }
        // Establish a compositor boundary before the caller restores another
        // Qx WebView. Without this, WebView2 can leave its last full-screen
        // transparent swapchain visible as an opaque white rectangle.
        #[cfg(target_os = "windows")]
        let _ = unsafe { windows_sys::Win32::Graphics::Dwm::DwmFlush() };
    });
}

/// Reassert the picker after any operation on the still-visible main window.
/// On Windows, changing the main WebView's capture affinity can move focus/z
/// order back to main even though the picker was shown first. Ignoring that
/// leaves a fullscreen input surface above the desktop with no Esc receiver.
pub(super) fn reassert_interactive(app: &AppHandle) -> Result<(), String> {
    let app = app.clone();
    crate::main_thread::run_on_main(&app.clone(), move || {
        let picker =
            picker(&app).ok_or_else(|| "region picker window is unavailable".to_string())?;
        picker
            .set_ignore_cursor_events(false)
            .map_err(|error| format!("picker input: {error}"))?;
        #[cfg(not(target_os = "macos"))]
        picker
            .set_always_on_top(true)
            .map_err(|error| format!("picker z-order: {error}"))?;
        prepare_for_show(&picker);
        crate::window_composition::show(&picker)
            .map_err(|error| format!("show region picker: {error}"))?;
        prepare_for_show(&picker);
        picker
            .set_focus()
            .map_err(|error| format!("focus region picker: {error}"))?;
        // AppKit can normalize an ordered/focused Tauri window back to the
        // floating level. The capture level must be the final window mutation.
        prepare_for_show(&picker);
        Ok::<(), String>(())
    })?
}

pub(super) fn restore_editable_selection(app: &AppHandle, session: &PickerSession) -> bool {
    let Some(area) = session.logical_area.clone() else {
        return false;
    };
    let monitor_id = session.monitor_id;
    let app = app.clone();
    crate::main_thread::run_on_main(&app.clone(), move || {
        let Some(picker) = picker(&app) else {
            return false;
        };
        let Ok(capture) = capture_monitor(Some(monitor_id)) else {
            return false;
        };
        let Ok(monitor) = tauri_monitor_for_capture(&app, &capture) else {
            return false;
        };
        let _ = area; // presence already validated before hop
        if show_shades(&app, monitor_id).is_err() {
            return false;
        }
        hide_surface(&picker);
        let _ = picker.set_content_protected(true);
        prepare_for_show(&picker);
        if picker.set_ignore_cursor_events(false).is_err()
            || picker
                .set_position(PhysicalPosition::new(
                    monitor.position().x,
                    monitor.position().y,
                ))
                .is_err()
            || picker
                .set_size(PhysicalSize::new(
                    monitor.size().width,
                    monitor.size().height,
                ))
                .is_err()
            || crate::window_composition::show(&picker).is_err()
        {
            hide_surface(&picker);
            return false;
        }
        prepare_for_show(&picker);
        let _ = picker.set_focus();
        prepare_for_show(&picker);
        true
    })
    .unwrap_or(false)
}

/// Keep the picker on the full active display while recording so the cutout
/// shade remains: recording region stays bright, everything outside is dimmed.
///
/// The WebView is fully mouse-passthrough so desktop input is never blocked.
/// Content protection keeps Qx chrome out of the capture stream. Full-display
/// region recordings skip the overlay (nothing outside to dim).
pub(super) fn show_recording_frame(
    app: &AppHandle,
    session: &PickerSession,
) -> Result<bool, String> {
    let area = session
        .logical_area
        .clone()
        .ok_or_else(|| "Capture selection area is unavailable".to_string())?;
    let monitor_id = session.monitor_id;
    let app = app.clone();
    crate::main_thread::run_on_main(&app.clone(), move || {
        let capture = capture_monitor(Some(monitor_id))?;
        let monitor = tauri_monitor_for_capture(&app, &capture)?;
        let scale = monitor.scale_factor().max(1.0);
        let logical_width = monitor.size().width as f64 / scale;
        let logical_height = monitor.size().height as f64 / scale;
        let picker =
            picker(&app).ok_or_else(|| "region picker window is unavailable".to_string())?;
        hide_surface(&picker);
        // Full-screen capture has no exterior to dim.
        if covers_full_display(&area, logical_width, logical_height) {
            return Ok(false);
        }

        // Cover the whole display so the React cutout shades (outside the
        // selection hole) stay correct. Shrinking to the selection frame made
        // the exterior dim disappear and looked like "no recording region".
        let _ = show_shades(&app, monitor_id);
        // macOS: exclude the overlay HWND from capture (desktop shows through).
        // Windows: WDA_EXCLUDEFROMCAPTURE paints black for the whole HWND, so
        // leave protection off — the selection hole is fully transparent CSS and
        // only the exterior dim paints; region capture samples the hole only.
        #[cfg(target_os = "macos")]
        let _ = picker.set_content_protected(true);
        #[cfg(target_os = "windows")]
        let _ = picker.set_content_protected(false);
        prepare_for_show(&picker);
        demote_macos_recording_surface(&picker);
        picker
            .set_position(PhysicalPosition::new(
                monitor.position().x,
                monitor.position().y,
            ))
            .map_err(|error| format!("position recording frame: {error}"))?;
        picker
            .set_size(PhysicalSize::new(
                monitor.size().width,
                monitor.size().height,
            ))
            .map_err(|error| format!("size recording frame: {error}"))?;
        picker
            .set_ignore_cursor_events(true)
            .map_err(|error| format!("enable recording frame mouse passthrough: {error}"))?;
        crate::window_composition::show(&picker)
            .map_err(|error| format!("show recording frame: {error}"))?;
        Ok(true)
    })?
}
