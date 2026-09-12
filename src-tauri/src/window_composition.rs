//! Presentation control for reusable native windows. Call on the UI thread.
//! Cloaking supplements hide; it does not change visibility, focus or geometry.

use tauri::Manager;

/// All reusable surfaces share one ordered show/hide transaction. Dispatching
/// here also keeps worker callers from racing a queued Tauri Show with cloak.
pub(crate) fn show(window: &tauri::WebviewWindow) -> Result<(), String> {
    let app = window.app_handle().clone();
    let window = window.clone();
    crate::runtime::run_ui(&app, move || {
        window.show().map_err(|error| error.to_string())?;
        if let Err(error) = set_cloaked_native(&window, false) {
            // A visible but cloaked window cannot receive useful interaction.
            let _ = window.hide();
            return Err(error);
        }
        Ok(())
    })?
}

pub(crate) fn hide(window: &tauri::WebviewWindow) -> Result<(), String> {
    let app = window.app_handle().clone();
    let window = window.clone();
    crate::runtime::run_ui(&app, move || {
        let cloak = set_cloaked_native(&window, true);
        // Always attempt native hide, even if DWM is unavailable.
        let hidden = window.hide().map_err(|error| error.to_string());
        if hidden.is_err() {
            // Failed hide must not leave a visible HWND permanently cloaked.
            let _ = set_cloaked_native(&window, false);
        }
        hidden.and(cloak)
    })?
}

pub(crate) fn set_cloaked(window: &tauri::WebviewWindow, cloaked: bool) {
    if let Err(error) = set_cloaked_native(window, cloaked) {
        crate::diagnostics::log(
            crate::diagnostics::LogLevel::Warn,
            "window.composition",
            "failed to update window cloak",
            serde_json::json!({ "window": window.label(), "cloaked": cloaked, "error": error }),
        );
    }
}

#[cfg(target_os = "windows")]
fn set_cloaked_native(window: &tauri::WebviewWindow, cloaked: bool) -> Result<(), String> {
    use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CLOAK};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetAncestor, GA_ROOT};

    let webview_hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let hwnd = unsafe { GetAncestor(webview_hwnd.0, GA_ROOT) };
    if hwnd.is_null() {
        return Err("root window handle is unavailable".to_string());
    }
    let value: i32 = i32::from(cloaked);
    let status = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_CLOAK as u32,
            std::ptr::from_ref(&value).cast(),
            std::mem::size_of_val(&value) as u32,
        )
    };
    if status < 0 {
        return Err(format!(
            "DwmSetWindowAttribute(DWMWA_CLOAK): 0x{:08X}",
            status as u32
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn set_cloaked_native(_window: &tauri::WebviewWindow, _cloaked: bool) -> Result<(), String> {
    Ok(())
}
