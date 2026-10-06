//! Desktop browser-default policy, applied to every current and future WebView.
//! Features keep their DOM shortcuts; the embedded browser cannot act on them.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

/// Creation-time defaults matter: WebView2 autofill is shared by the profile,
/// so even a new hidden controller must not briefly re-enable it for old views.
pub(crate) fn window_builder(
    app: &AppHandle,
    label: impl Into<String>,
    url: WebviewUrl,
) -> WebviewWindowBuilder<'_, tauri::Wry, AppHandle> {
    WebviewWindowBuilder::new(app, label, url)
        .general_autofill_enabled(false)
        .zoom_hotkeys_enabled(false)
}

pub(crate) fn init() -> TauriPlugin<tauri::Wry> {
    let script = include_str!("../../src/shell/webviewDefaults.js").replace(
        "/* QX_DEVTOOLS */ false",
        if cfg!(debug_assertions) {
            "true"
        } else {
            "false"
        },
    );
    Builder::new("qx-webview-policy")
        .js_init_script_on_all_frames(script)
        .on_webview_ready(|webview| {
            #[cfg(target_os = "windows")]
            {
                let label = webview.label().to_string();
                if let Err(error) = webview.with_webview(move |native| {
                    if let Err(error) = configure_windows(native) {
                        log_failure(&label, error);
                    }
                }) {
                    log_failure(webview.label(), error);
                }
            }
            #[cfg(not(target_os = "windows"))]
            let _ = webview;
        })
        .build()
}

#[cfg(target_os = "windows")]
fn log_failure(label: &str, error: impl std::fmt::Display) {
    crate::diagnostics::log(
        crate::diagnostics::LogLevel::Warn,
        "webview.policy",
        "failed to apply desktop browser policy",
        serde_json::json!({ "window": label, "error": error.to_string() }),
    );
}

#[cfg(target_os = "windows")]
fn configure_windows(native: tauri::webview::PlatformWebview) -> windows_core::Result<()> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Settings3, ICoreWebView2Settings4, ICoreWebView2Settings5,
        ICoreWebView2Settings6,
    };
    use windows_core::Interface;

    // with_webview dispatches COM access to Tauri's UI thread. Do not mark
    // AcceleratorKeyPressed as handled: doing so also steals DOM/editing keys.
    unsafe {
        let settings = native.controller().CoreWebView2()?.Settings()?;
        settings
            .cast::<ICoreWebView2Settings3>()?
            .SetAreBrowserAcceleratorKeysEnabled(false)?;
        settings.SetIsZoomControlEnabled(false)?;
        settings.SetIsStatusBarEnabled(false)?;
        settings.SetAreDevToolsEnabled(cfg!(debug_assertions))?;
        // Native edit menus remain available; the shared document policy
        // suppresses browser menus outside editors after Qx's menus respond.
        let forms = settings.cast::<ICoreWebView2Settings4>()?;
        forms.SetIsGeneralAutofillEnabled(false)?;
        forms.SetIsPasswordAutosaveEnabled(false)?;
        settings
            .cast::<ICoreWebView2Settings5>()?
            .SetIsPinchZoomEnabled(false)?;
        settings
            .cast::<ICoreWebView2Settings6>()?
            .SetIsSwipeNavigationEnabled(false)?;
    }
    Ok(())
}
