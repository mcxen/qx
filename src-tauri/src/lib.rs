mod apps;
mod clipboard;
mod macro_recorder;
mod marketplace;
mod rss;
mod screencap;
mod screenshot;
mod settings;
mod system_stats;
mod v2ex;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    LogicalSize, Manager, PhysicalSize, WindowEvent,
};

#[tauri::command]
fn get_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| format!("Failed to get file size: {e}"))
}

#[tauri::command]
fn open_app(path: String) {
    let _ = std::process::Command::new("open").arg(path).spawn();
}

#[tauri::command]
fn set_window_size(app: tauri::AppHandle, width: u32, height: u32) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_size(LogicalSize::new(width, height));
    }
}

#[cfg(target_os = "macos")]
fn cursor_monitor_position() -> Option<(f64, f64, f64, f64)> {
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    let source = CGEventSource::new(CGEventSourceStateID::Private).ok()?;
    let event = CGEvent::new(source).ok()?;
    let point = event.location();
    let x = point.x as i32;
    let y = point.y as i32;
    if let Ok(mon) = xcap::Monitor::from_point(x, y) {
        let mx = mon.x().ok()? as f64;
        let my = mon.y().ok()? as f64;
        let mw = mon.width().ok()? as f64;
        let mh = mon.height().ok()? as f64;
        Some((mx, my, mw, mh))
    } else {
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn cursor_monitor_position() -> Option<(f64, f64, f64, f64)> {
    None
}

#[cfg(target_os = "macos")]
pub(crate) fn show_on_cursor_monitor(win: &tauri::WebviewWindow) {
    if let Some((mx, my, mw, mh)) = cursor_monitor_position() {
        let cw = 680.0;
        let ch = 500.0;
        let cx = mx + (mw - cw) / 2.0;
        let cy = my + (mh - ch) / 2.0;
        let _ = win.set_position(tauri::PhysicalPosition::new(cx as i32, cy as i32));
    }
    let _ = win.show();
    let _ = win.set_focus();
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn show_on_cursor_monitor(win: &tauri::WebviewWindow) {
    let _ = win.show();
    let _ = win.set_focus();
}

fn toggle_window(win: &tauri::WebviewWindow) {
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
    } else {
        show_on_cursor_monitor(win);
    }
}

#[cfg(target_os = "macos")]
fn setup_frosted_glass(app: &tauri::App) {
    use tauri::Manager;
    let Some(win) = app.get_webview_window("main") else {
        eprintln!("frosted glass: main window not found");
        return;
    };
    let _ = window_vibrancy::apply_vibrancy(
        &win,
        window_vibrancy::NSVisualEffectMaterial::HudWindow,
        Some(window_vibrancy::NSVisualEffectState::Active),
        Some(12.0),
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|info| {
        let msg = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            format!("{:?}", info.location())
        };
        let loc = info.location().map(|l| l.to_string()).unwrap_or_default();
        eprintln!("[QX PANIC] {loc}: {msg}");
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let Some(win) = app.get_webview_window("main") else {
                eprintln!("main window not found during setup");
                return Ok(());
            };

            // Enable resizing with minimum size.
            let _ = win.set_resizable(true);
            let _ = win.set_min_size(Some(PhysicalSize::new(480, 360)));

            #[cfg(target_os = "macos")]
            setup_frosted_glass(app);

            settings::register_shortcuts(&handle, &settings::read_settings())?;

            // Start clipboard listener
            clipboard::start_listener(&handle);

            // Initialize RSS DB
            rss::init(&handle);

            // Initialize settings file
            settings::init();

            // Pre-convert app icons in background (keeps first search fast)
            apps::preload_icons(&handle);

            let show = MenuItem::with_id(app, "show", "Show/Hide", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Qx", true, Some("Cmd+Q"))?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => {
                        if let Some(flag) = app.try_state::<clipboard::ClipboardShutdown>() {
                            flag.0.store(true, std::sync::atomic::Ordering::SeqCst);
                        }
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            toggle_window(&win);
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            toggle_window(&win);
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_file_size,
            apps::search_apps,
            apps::search_files,
            open_app,
            set_window_size,
            screenshot::take_screenshot,
            screenshot::take_screenshot_area,
            screenshot::get_recent_screenshots,
            clipboard::get_clipboard_history,
            clipboard::clear_clipboard_history,
            clipboard::delete_clipboard_entry,
            clipboard::toggle_clipboard_pin,
            clipboard::record_clipboard_copy,
            rss::rss_list_feeds,
            rss::rss_add_feed,
            rss::rss_update_feed,
            rss::rss_remove_feed,
            rss::rss_list_articles,
            rss::rss_get_article,
            rss::rss_mark_read,
            rss::rss_mark_all_read,
            rss::rss_toggle_star,
            rss::rss_refresh_feed,
            rss::rss_refresh_all,
            rss::rss_import_opml,
            rss::rss_export_opml,
            settings::get_settings,
            settings::update_settings,
            settings::reset_settings,
            settings::import_settings,
            settings::export_settings,
            system_stats::get_system_stats,
            screencap::start_recording,
            screencap::stop_recording,
            screencap::save_gif,
            screencap::list_gif_history,
            screencap::get_screencap_history,
            screencap::delete_screencap,
            screencap::is_recording,
            marketplace::fetch_plugin_index,
            marketplace::download_plugin,
            marketplace::install_plugin,
            marketplace::uninstall_plugin,
            marketplace::list_installed_plugins,
            marketplace::read_plugin_entry,
            marketplace::set_plugin_enabled,
            marketplace::plugin_storage_get,
            marketplace::plugin_storage_set,
            marketplace::plugin_storage_delete,
            marketplace::plugin_preferences_get,
            marketplace::plugin_preferences_set,
            marketplace::sign_plugin,
            marketplace::scaffold_plugin,
            macro_recorder::macro_start_recording,
            macro_recorder::macro_stop_recording,
            macro_recorder::macro_save,
            macro_recorder::macro_list,
            macro_recorder::macro_delete,
            macro_recorder::macro_play,
            v2ex::v2ex_fetch_topics,
            v2ex::v2ex_search_topics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
