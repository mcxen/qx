//! Opt-in Windows/WebView2 ablation. Uses blank local windows and production
//! presentation, nonactivation and UI dispatch code; never loads user Qx data.
//! Run from the repo: pwsh -File scripts/test-windows-window-lifecycle.ps1
#![allow(dead_code)]

#[path = "../src/auxiliary_window.rs"]
mod auxiliary_window;
#[path = "../src/runtime/main_thread.rs"]
mod runtime;
#[path = "../src/window_composition.rs"]
mod window_composition;

// Only diagnostics are redirected; native operations are the production code.
mod diagnostics {
    pub enum LogLevel {
        Warn,
    }
    pub fn log(_: LogLevel, target: &str, message: &str, value: serde_json::Value) {
        eprintln!("{target}: {message} {value}");
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use std::sync::atomic::{AtomicI32, Ordering};
    static EXIT_CODE: AtomicI32 = AtomicI32::new(2);
    use crate::{auxiliary_window, runtime, window_composition};
    use std::time::Duration;
    use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
    use windows_sys::Win32::Graphics::Dwm::{DwmFlush, DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetForegroundWindow, GetWindowLongPtrW, GA_ROOT, GWL_EXSTYLE,
        WS_EX_NOACTIVATE, WS_EX_TRANSPARENT,
    };

    fn settle() {
        std::thread::sleep(Duration::from_millis(100));
    }

    fn check(window: &WebviewWindow, visible: bool, cloaked: bool) -> Result<(), String> {
        let hwnd = unsafe { GetAncestor(window.hwnd().map_err(|e| e.to_string())?.0, GA_ROOT) };
        let mut value: u32 = 0;
        let status = unsafe {
            DwmFlush();
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED as u32,
                std::ptr::from_mut(&mut value).cast(),
                4,
            )
        };
        if status < 0
            || window.is_visible().map_err(|e| e.to_string())? != visible
            || (value & 1 != 0) != cloaked
        {
            return Err(format!("{}: expected visible={visible} cloak={cloaked}, got visible={:?} cloak={value} status={status}",
                window.label(), window.is_visible()));
        }
        Ok(())
    }

    fn blank(app: &AppHandle, label: &str) -> Result<WebviewWindow, String> {
        WebviewWindowBuilder::new(
            app,
            label,
            WebviewUrl::External("about:blank".parse().unwrap()),
        )
        .title(format!("Qx Window Probe {label}"))
        .inner_size(360.0, 180.0)
        .position(40.0, 40.0)
        .transparent(true)
        .background_color(tauri::utils::config::Color(0, 0, 0, 0))
        .decorations(false)
        .shadow(false)
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())
    }

    fn run(app: &AppHandle) -> Result<(), String> {
        let main = app.get_webview_window("probe-main").unwrap();
        let aux = app.get_webview_window("probe-aux").unwrap();
        let hwnd = main.hwnd().map_err(|e| e.to_string())?.0 as usize;
        let geometry = main.outer_size().map_err(|e| e.to_string())?;
        // A: native hide alone does not cloak the retained presentation.
        main.show().map_err(|e| e.to_string())?;
        settle();
        main.hide().map_err(|e| e.to_string())?;
        settle();
        check(&main, false, false)?;
        println!("PASS A: plain hide baseline (uncloaked)");

        // B: cloak alone does not implement native hide/input lifecycle.
        main.show().map_err(|e| e.to_string())?;
        settle();
        window_composition::set_cloaked(&main, true);
        check(&main, true, true)?;
        println!("PASS B: cloak-only baseline (still natively visible)");

        // C: production hide + affinity changes + repeated reuse.
        for _ in 0..12 {
            window_composition::hide(&main)?;
            main.set_content_protected(true)
                .map_err(|e| e.to_string())?;
            main.set_content_protected(false)
                .map_err(|e| e.to_string())?;
            settle();
            check(&main, false, true)?;
            window_composition::show(&main)?;
            settle();
            check(&main, true, false)?;
        }
        if main.hwnd().map_err(|e| e.to_string())?.0 as usize != hwnd
            || main.outer_size().map_err(|e| e.to_string())? != geometry
        {
            return Err("reuse changed HWND or geometry".into());
        }
        println!("PASS C: 12 hide/affinity/show cycles preserve HWND and geometry");

        // D: show an interactive auxiliary without stealing main's foreground.
        main.set_focus().map_err(|e| e.to_string())?;
        settle();
        let foreground = unsafe { GetForegroundWindow() } as usize;
        auxiliary_window::make_non_activating(&aux)?;
        window_composition::show(&aux)?;
        settle();
        let aux_hwnd = unsafe { GetAncestor(aux.hwnd().map_err(|e| e.to_string())?.0, GA_ROOT) };
        let style = unsafe { GetWindowLongPtrW(aux_hwnd, GWL_EXSTYLE) };
        if style & WS_EX_NOACTIVATE as isize == 0
            || unsafe { GetForegroundWindow() } as usize != foreground
        {
            return Err(format!("auxiliary show: style={style:#x}, NOACTIVATE={:#x}, foreground before={foreground:#x} after={:#x}, aux={:#x}", WS_EX_NOACTIVATE, unsafe { GetForegroundWindow() } as usize, aux_hwnd as usize));
        }
        check(&aux, true, false)?;
        println!("PASS D: auxiliary show preserves foreground");

        // E: a passive cursor/recording surface keeps pointer passthrough.
        aux.set_ignore_cursor_events(true)
            .map_err(|e| e.to_string())?;
        window_composition::hide(&aux)?;
        window_composition::show(&aux)?;
        settle();
        if unsafe { GetWindowLongPtrW(aux_hwnd, GWL_EXSTYLE) } & WS_EX_TRANSPARENT as isize == 0 {
            return Err("reuse removed pointer passthrough".into());
        }
        window_composition::hide(&aux)?;
        check(&aux, false, true)?;
        println!("PASS E: passive overlay reuse preserves passthrough");

        // F: minimized main must explicitly restore before summon.
        main.minimize().map_err(|e| e.to_string())?;
        settle();
        if !main.is_minimized().map_err(|e| e.to_string())? {
            return Err("minimize did not take effect".into());
        }
        main.unminimize().map_err(|e| e.to_string())?;
        window_composition::show(&main)?;
        settle();
        if main.is_minimized().map_err(|e| e.to_string())? {
            return Err("summon stayed minimized".into());
        }
        check(&main, true, false)?;
        println!("PASS F: minimized window can be summoned");

        // G: native close on a reusable auxiliary is hide; on a pin is destroy.
        aux.close().map_err(|e| e.to_string())?;
        settle();
        check(&aux, false, true)?;
        window_composition::show(&aux)?;
        check(&aux, true, false)?;
        let pin = app.get_webview_window("probe-pin").unwrap();
        pin.close().map_err(|e| e.to_string())?;
        settle();
        if app.get_webview_window("probe-pin").is_some() {
            return Err("ephemeral pin was not destroyed".into());
        }
        println!("PASS G: auxiliary close/reopen and ephemeral destroy");

        // H: copy-and-continue leaves every reusable surface hidden/cloaked.
        window_composition::hide(&main)?;
        window_composition::hide(&aux)?;
        main.set_content_protected(false)
            .map_err(|e| e.to_string())?;
        settle();
        check(&main, false, true)?;
        check(&aux, false, true)?;
        println!("PASS H: combined hidden surfaces survive capture-affinity cleanup");
        Ok(())
    }

    pub fn main() {
        std::env::set_var("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "00000000");
        runtime::install_async_runtime();
        let mut context = tauri::generate_context!();
        context.config_mut().identifier = "com.mcx.qx.window-probe".into();
        context.config_mut().app.windows.clear();
        tauri::Builder::default()
            .on_window_event(|window, event| {
                if window.label() == "probe-aux" {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = window.app_handle().get_webview_window("probe-aux") {
                            let _ = window_composition::hide(&w);
                        }
                    }
                }
            })
            .setup(|app| {
                runtime::install(app.handle());
                for label in ["probe-main", "probe-aux", "probe-pin"] {
                    blank(app.handle(), label)?;
                }
                let app = app.handle().clone();
                std::thread::spawn(move || {
                    settle();
                    let result = run(&app);
                    if let Err(error) = &result {
                        eprintln!("FAIL: {error}");
                    }
                    let code = if result.is_ok() { 0 } else { 1 };
                    EXIT_CODE.store(code, Ordering::SeqCst);
                    app.exit(code);
                });
                Ok(())
            })
            .run(context)
            .expect("window probe runtime failed");
        std::process::exit(EXIT_CODE.load(Ordering::SeqCst));
    }
}

#[cfg(target_os = "windows")]
fn main() {
    windows::main();
}
#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("This native ablation requires Windows/WebView2.");
}
