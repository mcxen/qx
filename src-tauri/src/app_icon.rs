//! Runtime application-icon selection.
//!
//! This service deliberately owns only the process/window application icon.
//! The menu-bar / system-tray icon remains managed by `tray_menu` and must not
//! follow this preference.

use tauri::{image::Image, AppHandle, Manager};

pub const ORIGINAL_ICON_ID: &str = "original";
pub const CLOUD_ICON_ID: &str = "cloud";

const ORIGINAL_ICON_PNG: &[u8] = include_bytes!("../icons/logo-1024.png");
const CLOUD_ICON_PNG: &[u8] = include_bytes!("../icons/app-icon-cloud.png");

pub fn normalize_id(icon_id: &str) -> &'static str {
    match icon_id {
        ORIGINAL_ICON_ID => ORIGINAL_ICON_ID,
        _ => CLOUD_ICON_ID,
    }
}

fn icon_bytes(icon_id: &str) -> &'static [u8] {
    match normalize_id(icon_id) {
        CLOUD_ICON_ID => CLOUD_ICON_PNG,
        _ => ORIGINAL_ICON_PNG,
    }
}

fn decode_window_icon(bytes: &[u8]) -> Result<Image<'static>, String> {
    let rgba = image::load_from_memory(bytes)
        .map_err(|error| format!("decode application icon: {error}"))?
        .into_rgba8();
    let (width, height) = rgba.dimensions();
    Ok(Image::new_owned(rgba.into_raw(), width, height))
}

#[cfg(target_os = "macos")]
fn set_process_icon(bytes: &[u8]) -> Result<(), String> {
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    let marker = MainThreadMarker::new()
        .ok_or_else(|| "application icon must be changed on the UI thread".to_string())?;
    let application = NSApplication::sharedApplication(marker);
    let data = NSData::with_bytes(bytes);
    let image = NSImage::initWithData(NSImage::alloc(), &data)
        .ok_or_else(|| "decode macOS application icon".to_string())?;
    unsafe { application.setApplicationIconImage(Some(&image)) };
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn set_process_icon(_bytes: &[u8]) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn sync_windows_taskbar_icon(window: &tauri::WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{LPARAM, WPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageW, ICON_BIG, ICON_SMALL, WM_GETICON, WM_SETICON,
    };

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("get native window handle: {error}"))?
        .0;

    // Tauri/tao's `set_icon` currently applies only ICON_SMALL on Windows.
    // Explorer, the taskbar, Alt+Tab and task switchers request ICON_BIG via
    // WM_GETICON and otherwise fall back to the executable's compiled icon.
    // Reuse tao's owned HICON so its lifetime remains tied to the window.
    let small_icon = unsafe { SendMessageW(hwnd, WM_GETICON, ICON_SMALL as WPARAM, 0 as LPARAM) };
    if small_icon == 0 {
        return Err("Tauri did not install the Windows small application icon".to_string());
    }

    unsafe {
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as WPARAM, small_icon as LPARAM);
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn sync_windows_taskbar_icon(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

/// Apply the persisted icon to the running application.
///
/// Callers must enter through `runtime::ui` unless already inside Tauri setup.
pub fn apply(app: &AppHandle, icon_id: &str) -> Result<(), String> {
    let bytes = icon_bytes(icon_id);
    set_process_icon(bytes)?;

    let icon = decode_window_icon(bytes)?;
    for window in app.webview_windows().values() {
        window
            .set_icon(icon.clone())
            .map_err(|error| format!("set window application icon: {error}"))?;
        sync_windows_taskbar_icon(window)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_icon_variants_decode() {
        assert!(decode_window_icon(icon_bytes(ORIGINAL_ICON_ID)).is_ok());
        assert!(decode_window_icon(icon_bytes(CLOUD_ICON_ID)).is_ok());
    }

    #[test]
    fn unknown_icon_ids_fall_back_to_cloud() {
        assert_eq!(normalize_id("future-or-corrupt-value"), CLOUD_ICON_ID);
        assert_eq!(icon_bytes("future-or-corrupt-value"), CLOUD_ICON_PNG);
    }
}
