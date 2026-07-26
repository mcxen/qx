//! Shared native behavior for small interactive auxiliary windows.
//!
//! These surfaces accept pointer actions but must not become the foreground
//! application merely because they were shown or clicked.

use tauri::WebviewWindow;

#[cfg(target_os = "windows")]
pub(crate) fn make_non_activating(window: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("get auxiliary window handle: {error}"))?
        .0;
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_NOACTIVATE as isize);
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn make_non_activating(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}
