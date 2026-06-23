mod apps;
mod clipboard;
mod macro_recorder;
mod marketplace;
mod rss;
mod screencap;
mod screenshot;
mod settings;
mod system_stats;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    LogicalSize, Manager, PhysicalSize, WindowEvent,
};

#[tauri::command]
fn open_app(path: String) {
    let _ = std::process::Command::new("open").arg(path).spawn();
}

fn toggle_window(win: &tauri::WebviewWindow) {
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
    } else {
        let _ = win.show();
        let _ = win.center();
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let win = app.get_webview_window("main").unwrap();

            // Enable resizing and enforce a minimum size + 17:10 aspect ratio.
            let _ = win.set_resizable(true);
            let _ = win.set_min_size(Some(PhysicalSize::new(480, 360)));

            // Maintain 17:10 aspect ratio during interactive resize.
            // We compute the ideal height from the new width and re-set the size
            // when it drifts beyond a 1px tolerance (which also breaks the
            // recursive Resized event loop).
            let win_for_resize = win.clone();
            win.on_window_event(move |event| {
                if let WindowEvent::Resized(size) = event {
                    let target_w = size.width;
                    let ideal_h = ((target_w as f64) * 10.0 / 17.0).round() as u32;
                    let ideal_h = ideal_h.max(360);
                    if ideal_h.abs_diff(size.height) > 1 {
                        let _ = win_for_resize
                            .set_size(LogicalSize::new(target_w as f64, ideal_h as f64));
                    }
                }
            });

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
            apps::search_apps,
            apps::search_files,
            open_app,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
