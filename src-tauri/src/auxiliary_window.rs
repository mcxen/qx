//! Shared native behavior for small interactive auxiliary windows.
//!
//! These surfaces accept pointer actions but must not become the foreground
//! application merely because they were shown or clicked.

use tauri::WebviewWindow;

#[cfg(target_os = "windows")]
pub(crate) fn make_non_activating(window: &WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GA_ROOT, GWL_EXSTYLE,
        SWP_FRAMECHANGED, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_NOACTIVATE,
    };

    let webview_hwnd = window
        .hwnd()
        .map_err(|error| format!("get auxiliary window handle: {error}"))?
        .0;
    // Tauri/WebView2 can return the child controller HWND here. Applying
    // WS_EX_NOACTIVATE to that child corrupts WebView2 pointer activation and
    // can stall rendering/resource requests after the island is clicked.
    // Window activation is a top-level concern, so always style the root HWND.
    let hwnd = unsafe { GetAncestor(webview_hwnd, GA_ROOT) };
    if hwnd.is_null() {
        return Err("get auxiliary root window handle: unavailable".to_string());
    }
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_NOACTIVATE as isize);
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
        );
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn make_non_activating(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}
