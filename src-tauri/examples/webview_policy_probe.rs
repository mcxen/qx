//! Isolated real WebView2 probe. No Qx user settings, plugins or data are loaded.
#![allow(dead_code)]

#[path = "../src/webview_policy.rs"]
mod webview_policy;

#[path = "../src/runtime/main_thread.rs"]
mod runtime;
#[path = "../src/window_composition.rs"]
mod window_composition;

#[cfg(target_os = "windows")]
static EXIT_CODE: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(2);

mod diagnostics {
    pub enum LogLevel {
        Warn,
    }
    pub fn log(_: LogLevel, target: &str, message: &str, value: serde_json::Value) {
        eprintln!("{target}: {message} {value}");
    }
}

#[cfg(target_os = "windows")]
fn main() {
    use std::sync::mpsc::channel;
    use std::time::Duration;
    use tauri::{Manager, WebviewUrl};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Settings3, ICoreWebView2Settings4, ICoreWebView2Settings5,
        ICoreWebView2Settings6,
    };
    use windows_core::{Interface, BOOL};

    std::env::set_var("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "00000000");
    runtime::install_async_runtime();
    let (sender, receiver) = channel();
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.mcx.qx.webview-policy-probe".into();
    // The configured main window and later builders must share the same policy.
    context.config_mut().app.windows.truncate(1);
    context.config_mut().app.windows[0].label = "probe-main".into();
    context.config_mut().app.windows[0].url = WebviewUrl::External("about:blank".parse().unwrap());
    tauri::Builder::default()
        .plugin(webview_policy::init())
        .setup(move |app| {
            runtime::install(app.handle());
            for label in ["probe-aux", "probe-pin"] {
                webview_policy::window_builder(
                    app.handle(),
                    label,
                    WebviewUrl::External("about:blank".parse().unwrap()),
                )
                .visible(false)
                .focused(false)
                .build()?;
            }
            for window in app.webview_windows().into_values() {
                let sender = sender.clone();
                let label = window.label().to_string();
                window.with_webview(move |native| {
                    let result = (|| -> windows_core::Result<()> {
                        unsafe {
                            let settings = native.controller().CoreWebView2()?.Settings()?;
                            macro_rules! disabled {
                                ($object:expr, $property:ident) => {{
                                    let mut value = BOOL(1);
                                    $object.$property(&mut value)?;
                                    assert!(!value.as_bool(), "{} leaked", stringify!($property));
                                }};
                            }
                            disabled!(
                                settings.cast::<ICoreWebView2Settings3>()?,
                                AreBrowserAcceleratorKeysEnabled
                            );
                            disabled!(settings, IsZoomControlEnabled);
                            disabled!(settings, IsStatusBarEnabled);
                            let forms = settings.cast::<ICoreWebView2Settings4>()?;
                            disabled!(forms, IsGeneralAutofillEnabled);
                            disabled!(forms, IsPasswordAutosaveEnabled);
                            disabled!(
                                settings.cast::<ICoreWebView2Settings5>()?,
                                IsPinchZoomEnabled
                            );
                            disabled!(
                                settings.cast::<ICoreWebView2Settings6>()?,
                                IsSwipeNavigationEnabled
                            );
                            let mut tools = BOOL(1);
                            settings.AreDevToolsEnabled(&mut tools)?;
                            assert_eq!(tools.as_bool(), cfg!(debug_assertions));
                            let mut editing_menus = BOOL(0);
                            settings.AreDefaultContextMenusEnabled(&mut editing_menus)?;
                            assert!(editing_menus.as_bool(), "native editing menus lost");
                        }
                        Ok(())
                    })();
                    let _ = sender.send((label, result.map_err(|error| error.to_string())));
                })?;
            }
            let app = app.handle().clone();
            std::thread::spawn(move || {
                let mut code = 0;
                for _ in 0..3 {
                    match receiver.recv_timeout(Duration::from_secs(10)) {
                        Ok((label, Ok(()))) => println!("PASS {label}: 9 real WebView2 settings"),
                        result => {
                            eprintln!("FAIL: {result:?}");
                            code = 1;
                            break;
                        }
                    }
                }
                if code == 0 {
                    let ui_app = app.clone();
                    let result = runtime::run_ui(&app, move || -> Result<(), String> {
                        let picker = webview_policy::window_builder(
                            &ui_app,
                            "probe-picker",
                            WebviewUrl::External("about:blank".parse().unwrap()),
                        )
                        .title("Qx Region Picker Probe")
                        .inner_size(360.0, 180.0)
                        .resizable(false)
                        .maximizable(false)
                        .minimizable(false)
                        .decorations(false)
                        .transparent(true)
                        .background_color(tauri::utils::config::Color(0, 0, 0, 0))
                        .shadow(false)
                        .always_on_top(true)
                        .skip_taskbar(true)
                        .focused(true)
                        .accept_first_mouse(true)
                        .content_protected(true)
                        .visible(false)
                        .build()
                        .map_err(|error| format!("create picker: {error}"))?;
                        picker.hwnd().map_err(|error| format!("picker HWND: {error}"))?;
                        window_composition::show(&picker)?;
                        window_composition::hide(&picker)?;
                        window_composition::show(&picker)?;
                        window_composition::hide(&picker)?;
                        let original_hwnd = picker.hwnd().map_err(|error| error.to_string())?.0;
                        let reused = window_composition::ensure_reusable_window(
                            &ui_app,
                            "probe-picker",
                            |_| Err("healthy picker must not be recreated".into()),
                        )?;
                        assert_eq!(reused.hwnd().unwrap().0, original_hwnd);

                        // Destroy the native HWND before Tauri processes its
                        // Destroyed event: the managed label still exists but
                        // cannot be used for another screenshot.
                        let broken = webview_policy::window_builder(
                            &ui_app,
                            "probe-stale-picker",
                            WebviewUrl::External("about:blank".parse().unwrap()),
                        )
                        .visible(false)
                        .build()
                        .map_err(|error| error.to_string())?;
                        let broken_hwnd = broken.hwnd().map_err(|error| error.to_string())?.0;
                        assert_ne!(unsafe {
                            windows_sys::Win32::UI::WindowsAndMessaging::DestroyWindow(broken_hwnd)
                        }, 0);
                        let old_error = window_composition::show(&broken)
                            .expect_err("destroyed native HWND must not show");
                        assert!(ui_app.get_webview_window("probe-stale-picker").is_some());
                        println!("PASS baseline: cached unavailable HWND reproduced: {old_error}");
                        let replacement = window_composition::ensure_reusable_window(
                            &ui_app,
                            "probe-stale-picker",
                            |native_label| {
                                webview_policy::window_builder(
                                    &ui_app,
                                    native_label,
                                    WebviewUrl::External("about:blank".parse().unwrap()),
                                )
                                .transparent(true)
                                .background_color(tauri::utils::config::Color(0, 0, 0, 0))
                                .content_protected(true)
                                .visible(false)
                                .build()
                                .map_err(|error| error.to_string())
                            },
                        )?;
                        assert!(replacement.label().starts_with("probe-stale-picker-recovery-"));
                        for _ in 0..3 {
                            window_composition::show(&replacement)?;
                            window_composition::hide(&replacement)?;
                        }
                        assert_eq!(
                            window_composition::reusable_window(&ui_app, "probe-stale-picker")
                                .unwrap()
                                .label(),
                            replacement.label()
                        );
                        println!("PASS recovery: live replacement resolves by logical label and reuses HWND");
                        Ok(())
                    });
                    match result {
                        Ok(Ok(())) => println!("PASS probe-picker: runtime create/show/hide/reuse"),
                        result => {
                            eprintln!("FAIL runtime picker: {result:?}");
                            code = 1;
                        }
                    }
                }
                EXIT_CODE.store(code, std::sync::atomic::Ordering::SeqCst);
                app.exit(code);
            });
            Ok(())
        })
        .run(context)
        .expect("WebView2 policy probe failed");
    std::process::exit(EXIT_CODE.load(std::sync::atomic::Ordering::SeqCst));
}

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("This native policy probe requires Windows/WebView2.");
}
