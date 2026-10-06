//! Isolated real WebView2 probe. No Qx user settings, plugins or data are loaded.
#![allow(dead_code)]

#[path = "../src/webview_policy.rs"]
mod webview_policy;

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
                app.exit(code);
            });
            Ok(())
        })
        .run(context)
        .expect("WebView2 policy probe failed");
}

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("This native policy probe requires Windows/WebView2.");
}
