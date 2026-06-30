mod apps;
mod clipboard;
mod display_monitor;
mod file_search;
mod g4f;
mod github_calendar;
mod history;
mod http_client;
mod macro_recorder;
mod marketplace;
mod ocr;
mod permissions;
mod plugin_api;
mod rss;
mod screencap;
mod settings;
mod storage;
mod system_information;
mod system_stats;
mod v2ex;
mod weather;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
};

#[tauri::command]
fn get_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| format!("Failed to get file size: {e}"))
}

#[tauri::command]
fn open_app(path: String) -> Result<(), String> {
    let app_path = validate_open_app_path(&path)?;
    std::process::Command::new("open")
        .arg(app_path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open app: {e}"))
}

fn validate_open_app_path(path: &str) -> Result<std::path::PathBuf, String> {
    let raw_path = std::path::Path::new(path);
    if raw_path.extension().and_then(|value| value.to_str()) != Some("app") {
        return Err("open_app only accepts .app bundles".to_string());
    }

    let app_path = raw_path
        .canonicalize()
        .map_err(|e| format!("Invalid app path: {e}"))?;
    if app_path.extension().and_then(|value| value.to_str()) != Some("app") {
        return Err("open_app only accepts .app bundles".to_string());
    }

    let home_applications = std::env::var("HOME")
        .ok()
        .map(|home| std::path::PathBuf::from(home).join("Applications"));
    let allowed_roots = [
        Some(std::path::PathBuf::from("/Applications")),
        Some(std::path::PathBuf::from("/System/Applications")),
        home_applications,
    ];

    let allowed = allowed_roots
        .iter()
        .flatten()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| app_path.starts_with(root));
    if !allowed {
        return Err("open_app path must be inside /Applications or ~/Applications".to_string());
    }

    Ok(app_path)
}

#[tauri::command]
fn set_window_size(app: tauri::AppHandle, width: u32, height: u32) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_size(LogicalSize::new(width, height));
    }
}

fn center_on_cursor_monitor(app: &AppHandle, win: &tauri::WebviewWindow) -> tauri::Result<()> {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|cursor| app.monitor_from_point(cursor.x, cursor.y).ok().flatten())
        .or_else(|| win.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return Ok(());
    };

    let area = monitor.work_area();
    let win_size = win.outer_size().or_else(|_| win.inner_size())?;
    let x = area.position.x + ((area.size.width as i32 - win_size.width as i32) / 2);
    let y = area.position.y + ((area.size.height as i32 - win_size.height as i32) / 2);
    win.set_position(PhysicalPosition::new(x, y))
}

pub(crate) fn show_on_cursor_monitor(app: &AppHandle, win: &tauri::WebviewWindow) {
    let _ = center_on_cursor_monitor(app, win);
    let _ = win.show();
    let _ = win.set_focus();
}

fn toggle_window(app: &AppHandle, win: &tauri::WebviewWindow) {
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
    } else {
        show_on_cursor_monitor(app, win);
    }
}

#[cfg(target_os = "macos")]
fn setup_frosted_glass(app: &tauri::App) {
    use tauri::Manager;
    let Some(win) = app.get_webview_window("main") else {
        eprintln!("frosted glass: main window not found");
        return;
    };
    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
    let _ = apply_vibrancy(
        &win,
        NSVisualEffectMaterial::HudWindow,
        Some(NSVisualEffectState::Active),
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
            app.set_activation_policy(tauri::ActivationPolicy::Regular);

            let handle = app.handle().clone();
            let Some(win) = app.get_webview_window("main") else {
                eprintln!("main window not found during setup");
                return Ok(());
            };

            // Keep the configured resizable window behavior and enforce minimum size.
            let _ = win.set_min_size(Some(PhysicalSize::new(480, 360)));

            #[cfg(target_os = "macos")]
            setup_frosted_glass(app);

            settings::register_shortcuts(&handle, &settings::read_settings())?;

            // Subsystems that touch FFI / external state are panic-guarded so
            // a panic in one initializer does not abort the whole app.
            let safe_init = |name: &'static str, f: &dyn Fn()| {
                if let Err(payload) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
                    let msg = payload
                        .downcast_ref::<&str>()
                        .map(|s| (*s).to_string())
                        .or_else(|| payload.downcast_ref::<String>().map(|s| s.clone()))
                        .unwrap_or_else(|| "<unknown panic>".to_string());
                    eprintln!("[setup] {name} panicked: {msg}");
                }
            };

            // Start clipboard listener
            safe_init("clipboard", &|| clipboard::start_listener(&handle));

            // Initialize RSS DB
            safe_init("rss", &|| rss::init(&handle));

            // Initialize settings file
            safe_init("settings::init", &|| settings::init());

            // Initialize app cache from DB (instant), then background re-scan
            safe_init("apps::ensure_cache", &|| apps::ensure_cache(Some(&handle)));

            // Initialize fast platform file search backends.
            safe_init("file_search::init", &|| file_search::init(&handle));

            // Pre-convert app icons in background (keeps first search fast)
            safe_init("apps::preload_icons", &|| apps::preload_icons(&handle));

            // Start external display monitor (polls every 2s, auto-shows on connect)
            display_monitor::start_display_monitor(handle.clone());

            let show = MenuItem::with_id(app, "show", "Show/Hide", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Qx", true, Some("Cmd+Q"))?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let tray_rgba =
                image::load_from_memory(include_bytes!("../icons/tray-template.png"))?.into_rgba8();
            let (tray_width, tray_height) = tray_rgba.dimensions();
            let tray_icon = Image::new_owned(tray_rgba.into_raw(), tray_width, tray_height);

            TrayIconBuilder::new()
                .menu(&menu)
                .icon(tray_icon)
                .icon_as_template(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => {
                        if let Some(flag) = app.try_state::<clipboard::ClipboardShutdown>() {
                            flag.0.store(true, std::sync::atomic::Ordering::SeqCst);
                        }
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            toggle_window(app, &win);
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
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            toggle_window(app, &win);
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
            clipboard::get_clipboard_history,
            clipboard::read_clipboard_image_now,
            clipboard::write_clipboard_image_entry,
            clipboard::clear_clipboard_history,
            clipboard::delete_clipboard_entry,
            clipboard::toggle_clipboard_pin,
            clipboard::record_clipboard_copy,
            clipboard::read_image_file,
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
            storage::qx_storage_overview,
            storage::qx_storage_clear_cache,
            storage::qx_storage_clear_files,
            system_information::qx_system_information_check_system_info,
            system_information::qx_system_information_check_storage,
            system_information::qx_system_information_check_network,
            system_information::qx_system_information_list_processes,
            system_information::qx_system_information_kill_process,
            system_information::qx_system_monitor_network_counters,
            system_information::qx_system_monitor_power,
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
            marketplace::install_plugin_from_url,
            marketplace::install_raycast_extension_from_url,
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
            plugin_api::plugin_clipboard_read,
            plugin_api::plugin_clipboard_write,
            plugin_api::plugin_perform_paste,
            plugin_api::plugin_perform_paste_at_cursor,
            plugin_api::plugin_ai_list_providers,
            plugin_api::plugin_ai_default_model,
            plugin_api::plugin_ai_agent_settings,
            plugin_api::plugin_ai_chat,
            plugin_api::plugin_ai_stream_chat,
            plugin_api::plugin_ai_run_bash,
            plugin_api::plugin_ai_grep_search,
            plugin_api::plugin_ai_memory_list,
            plugin_api::plugin_ai_memory_add,
            plugin_api::plugin_ai_memory_delete,
            plugin_api::plugin_http_fetch,
            plugin_api::plugin_notification_show,
            plugin_api::plugin_resolve_asset,
            permissions::qx_permissions_status,
            permissions::qx_permissions_request,
            permissions::qx_permissions_open_settings,
            ocr::download_ocr_model,
            ocr::check_ocr_models,
            macro_recorder::macro_start_recording,
            macro_recorder::macro_stop_recording,
            macro_recorder::macro_save,
            macro_recorder::macro_list,
            macro_recorder::macro_delete,
            macro_recorder::macro_play,
            history::record_launch,
            history::get_launch_history,
            history::clear_launch_history,
            history::record_search,
            history::get_search_history,
            history::clear_search_history,
            history::delete_search_entry,
            v2ex::v2ex_fetch_topics,
            v2ex::v2ex_search_topics,
            v2ex::v2ex_fetch_node_topics,
            v2ex::v2ex_fetch_topic_replies,
            v2ex::v2ex_fetch_token_info,
            v2ex::v2ex_fetch_notifications,
            github_calendar::github_contributions,
            github_calendar::github_contributions_raw,
            weather::fetch_weather,
            weather::detect_location,
            g4f::g4f_chat,
            g4f::g4f_stream_chat,
            g4f::g4f_chat_custom,
            g4f::g4f_list_providers,
            g4f::qxai_stream_chat,
            g4f::qxai_stream_chat_events,
            g4f::qxai_list_providers,
            g4f::qxai_fetch_models,
            g4f::qxai_get_custom_providers,
            g4f::qxai_save_custom_providers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
