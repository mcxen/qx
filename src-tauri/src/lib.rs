mod apps;
mod apps_zh_dict;
mod clipboard;
mod diagnostics;
mod display_monitor;
mod external_displays;
mod file_search;
mod floating_panel;
mod island_window;
mod g4f;
mod github_calendar;
mod history;
mod http_client;
mod macro_recorder;
mod marketplace;
mod ocr;
mod paths;
mod permissions;
mod plugin_api;
mod rss;
mod screencap;
mod settings;
mod storage;
mod system_information;
mod system_stats;
mod terminal;
mod text_toolbox;
mod updater;
mod v2ex;
mod weather;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager,
};

const MAIN_TRAY_ID: &str = "qx-main-tray";

#[tauri::command]
fn get_file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| format!("Failed to get file size: {e}"))
}

#[tauri::command]
fn open_app(path: String) -> Result<(), String> {
    let app_path = validate_open_app_path(&path)?;
    launch_app_path(&app_path)
}

#[cfg(target_os = "macos")]
pub(crate) fn launch_app_path(app_path: &std::path::Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(app_path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open app: {e}"))
}

#[cfg(target_os = "windows")]
pub(crate) fn launch_app_path(app_path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let path = app_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            std::ptr::null(),
            path.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;
    if result <= 32 {
        Err(format!(
            "Failed to open Windows app (ShellExecuteW code {result})"
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn launch_app_path(app_path: &std::path::Path) -> Result<(), String> {
    std::process::Command::new(app_path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open app: {e}"))
}

#[cfg(target_os = "macos")]
pub(crate) fn validate_open_app_path(path: &str) -> Result<std::path::PathBuf, String> {
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

#[cfg(target_os = "windows")]
pub(crate) fn validate_open_app_path(path: &str) -> Result<std::path::PathBuf, String> {
    let raw_path = std::path::Path::new(path);
    let extension = raw_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("lnk") && !extension.eq_ignore_ascii_case("exe") {
        return Err("open_app only accepts Windows shortcuts or executables".to_string());
    }
    let app_path = raw_path
        .canonicalize()
        .map_err(|e| format!("Invalid app path: {e}"))?;
    let allowed = [
        "APPDATA",
        "PROGRAMDATA",
        "LOCALAPPDATA",
        "ProgramFiles",
        "ProgramFiles(x86)",
    ]
    .into_iter()
    .filter_map(|name| std::env::var_os(name))
    .map(std::path::PathBuf::from)
    .filter_map(|root| root.canonicalize().ok())
    .any(|root| app_path.starts_with(root));
    if !allowed {
        return Err("open_app path must be inside a Windows application directory".to_string());
    }
    Ok(app_path)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn validate_open_app_path(path: &str) -> Result<std::path::PathBuf, String> {
    std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("Invalid app path: {e}"))
}

#[tauri::command]
fn set_window_size(app: tauri::AppHandle, width: u32, height: u32) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_size(LogicalSize::new(width, height));
    }
}

pub(crate) fn show_on_cursor_monitor(app: &AppHandle, _win: &tauri::WebviewWindow) {
    floating_panel::show_floating(app);
}

fn toggle_window(app: &AppHandle, _win: &tauri::WebviewWindow) {
    floating_panel::toggle(app);
}

fn show_and_navigate(app: &AppHandle, route: &str) {
    floating_panel::show_and_navigate(app, route);
}

fn tray_action_title(settings: &settings::Settings, action: &settings::TrayActionConfig) -> String {
    let title = if action.title.trim().is_empty() {
        action.id.trim()
    } else {
        action.title.trim()
    };
    if action.id == "keep_visible" {
        let state = if settings.general.auto_hide_on_blur {
            "Off"
        } else {
            "On"
        };
        return format!("{title}: {state}");
    }
    title.to_string()
}

fn build_tray_menu(
    app: &AppHandle,
    settings: &settings::Settings,
) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    for (index, entry) in settings
        .quick_entries
        .iter()
        .filter(|entry| entry.enabled && !entry.target.trim().is_empty())
        .enumerate()
    {
        let title = if entry.title.trim().is_empty() {
            entry.target.trim()
        } else {
            entry.title.trim()
        };
        let item = MenuItem::with_id(
            app,
            format!("quick:{index}:{}", entry.target.trim()),
            title,
            true,
            None::<&str>,
        )?;
        menu.append(&item)?;
    }

    if settings.quick_entries.iter().any(|entry| entry.enabled) {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    let mut appended_action = false;
    for action in settings
        .tray_actions
        .iter()
        .filter(|action| action.enabled && !action.id.trim().is_empty())
    {
        let item = MenuItem::with_id(
            app,
            format!("tray_action:{}", action.id.trim()),
            tray_action_title(settings, action),
            true,
            None::<&str>,
        )?;
        menu.append(&item)?;
        appended_action = true;
    }

    if !appended_action {
        let show = MenuItem::with_id(app, "show", "Show/Hide", true, None::<&str>)?;
        menu.append(&show)?;
        appended_action = true;
    }

    if appended_action {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    let quit = MenuItem::with_id(app, "quit", "Quit Qx", true, Some("CmdOrCtrl+Q"))?;
    menu.append(&quit)?;
    Ok(menu)
}

fn handle_tray_action(app: &AppHandle, action_id: &str) {
    match action_id {
        "open_main" => floating_panel::show_floating(app),
        "settings" => show_and_navigate(app, "settings"),
        "hide_main" => floating_panel::hide(app),
        "keep_visible" => {
            let mut next = settings::read_settings();
            next.general.auto_hide_on_blur = !next.general.auto_hide_on_blur;
            if let Err(err) = settings::write_settings(&next) {
                diagnostics::log(
                    diagnostics::LogLevel::Error,
                    "main.tray",
                    "update keep_visible tray action failed",
                    serde_json::json!({ "error": err.to_string() }),
                );
                return;
            }
            if let Err(err) = refresh_tray_menu(app, &next) {
                diagnostics::log(
                    diagnostics::LogLevel::Error,
                    "main.tray",
                    "refresh tray menu after keep_visible failed",
                    serde_json::json!({ "error": err.to_string() }),
                );
            }
            let _ = app.emit("settings-updated", next.clone());
            if !next.general.auto_hide_on_blur {
                floating_panel::show_floating(app);
            }
        }
        _ => {}
    }
}

pub(crate) fn refresh_tray_menu(
    app: &AppHandle,
    settings: &settings::Settings,
) -> Result<(), String> {
    let menu = build_tray_menu(app, settings).map_err(|e| format!("build tray menu: {e}"))?;
    if let Some(tray) = app.tray_by_id(MAIN_TRAY_ID) {
        tray.set_menu(Some(menu))
            .map_err(|e| format!("refresh tray menu: {e}"))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn setup_frosted_glass(app: &tauri::App) {
    use tauri::Manager;
    let Some(win) = app.get_webview_window("main") else {
        diagnostics::log(
            diagnostics::LogLevel::Warn,
            "main.window",
            "frosted glass skipped because main window was not found",
            serde_json::json!({}),
        );
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

#[cfg(target_os = "windows")]
fn setup_frosted_glass(app: &tauri::App) {
    use tauri::Manager;
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    // Acrylic is the Windows counterpart to the macOS vibrancy material.
    // Remote Desktop and older Windows builds may reject it; the stronger CSS
    // surface opacity remains the deliberate fallback in that case.
    let _ = window_vibrancy::apply_acrylic(&win, None);
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
        crate::diagnostics::log(
            crate::diagnostics::LogLevel::Error,
            "main.panic",
            "panic captured",
            serde_json::json!({ "location": loc, "panic": msg }),
        );
        eprintln!("[QX PANIC] {loc}: {msg}");
    }));

    if updater::maybe_run_update_helper_from_args() {
        return;
    }

    tauri::Builder::default()
        .manage(terminal::TerminalManager::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .on_window_event(|window, event| {
            let label = window.label();
            // Secondary surfaces: hide instead of destroy (main may be hidden).
            if label == "region-picker" || label == "recording-controls" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
                return;
            }
            if label != floating_panel::MAIN_LABEL {
                return;
            }
            // Hide on focus loss when auto-hide is enabled.
            // - Windows: WebView2 outside-click focus can race; native event is required.
            // - macOS: accessory NSWindow focus notifications are not always delivered
            //   reliably to the webview `onFocusChanged` listener, so hide here too.
            // Suppress right after screencap stop / programmatic show — otherwise
            // a focus flicker hides the panel and feels like Qx quit.
            if matches!(event, tauri::WindowEvent::Focused(false))
                && settings::read_settings().general.auto_hide_on_blur
                && !floating_panel::auto_hide_suppressed()
            {
                floating_panel::hide_and_restore_focus(&window.app_handle());
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Qx is a background helper. Closing the launcher must only
                // hide its reusable WebView; destroying it leaves the Rust
                // tray process alive but makes later global shortcuts unable
                // to surface the launcher again.
                api.prevent_close();
                floating_panel::hide(&window.app_handle());
            }
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let Some(win) = app.get_webview_window("main") else {
                diagnostics::log(
                    diagnostics::LogLevel::Error,
                    "main.setup",
                    "main window not found during setup",
                    serde_json::json!({}),
                );
                return Ok(());
            };

            let startup_settings = settings::read_settings();
            diagnostics::log(
                diagnostics::LogLevel::Info,
                "main.setup",
                "Qx setup started",
                serde_json::json!({
                    "devMode": startup_settings.advanced.dev_mode,
                    "logLevel": startup_settings.advanced.log_level,
                }),
            );

            // Keep the configured resizable window behavior and enforce minimum size.
            // Product dimensions are logical pixels. Using PhysicalSize here
            // made the minimum shrink on Windows displays above 100% scaling.
            let _ = win.set_min_size(Some(LogicalSize::new(480, 360)));

            #[cfg(any(target_os = "macos", target_os = "windows"))]
            setup_frosted_glass(app);

            // Hide from dock and promote the main window into a
            // non-activating NSPanel so global shortcuts never steal focus.
            floating_panel::install(&handle);

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
                    diagnostics::log(
                        diagnostics::LogLevel::Error,
                        "main.setup",
                        format!("{name} initializer panicked"),
                        serde_json::json!({ "panic": msg }),
                    );
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

            // File search backends: deferred. Icons are filled after the app
            // scan inside `apps::ensure_cache` (avoids scan wiping empty icons).
            let file_search_handle = handle.clone();
            let _ = std::thread::Builder::new()
                .name("qx-deferred-startup".to_string())
                .spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        file_search::init(&file_search_handle);
                    }));
                });

            // Start external display monitor (polls every 2s, auto-shows on connect)
            display_monitor::start_display_monitor(handle.clone());

            let current_settings = settings::read_settings();
            let menu = build_tray_menu(&handle, &current_settings)?;
            let tray_rgba =
                image::load_from_memory(include_bytes!("../icons/tray-template.png"))?.into_rgba8();
            let (tray_width, tray_height) = tray_rgba.dimensions();
            let tray_icon = Image::new_owned(tray_rgba.into_raw(), tray_width, tray_height);

            TrayIconBuilder::with_id(MAIN_TRAY_ID)
                .menu(&menu)
                .icon(tray_icon)
                .icon_as_template(true)
                .on_menu_event(|app, event| {
                    let id = event.id().as_ref();
                    if let Some(route) = id
                        .strip_prefix("quick:")
                        .and_then(|value| value.split_once(':').map(|(_, route)| route))
                    {
                        show_and_navigate(app, route);
                        return;
                    }
                    if let Some(action_id) = id.strip_prefix("tray_action:") {
                        handle_tray_action(app, action_id);
                        return;
                    }
                    match id {
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
                    }
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

            diagnostics::log(
                diagnostics::LogLevel::Info,
                "main.setup",
                "Qx setup completed",
                serde_json::json!({}),
            );

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_file_size,
            diagnostics::qx_log_event,
            diagnostics::qx_log_path,
            apps::search_apps,
            apps::search_files,
            open_app,
            set_window_size,
            clipboard::get_clipboard_history,
            clipboard::read_clipboard_image_now,
            clipboard::write_clipboard_image_entry,
            clipboard::write_clipboard_file_entry,
            clipboard::clipboard_file_metadata,
            clipboard::clipboard_compress_image,
            clipboard::clipboard_video_to_gif,
            clipboard::clear_clipboard_history,
            clipboard::delete_clipboard_entry,
            clipboard::toggle_clipboard_pin,
            clipboard::record_clipboard_copy,
            clipboard::read_image_file,
            floating_panel::floating_show,
            floating_panel::floating_hide,
            floating_panel::floating_hide_restore_focus,
            floating_panel::floating_toggle,
            floating_panel::floating_request_key,
            floating_panel::set_active_route,
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
            rss::rss_list_folders,
            rss::rss_create_folder,
            rss::rss_rename_folder,
            rss::rss_delete_folder,
            rss::rss_set_feed_folder,
            rss::rss_clear_read_articles,
            rss::rss_clear_all_articles,
            rss::rss_fetch_original_content,
            settings::get_settings,
            settings::update_settings,
            settings::reset_settings,
            settings::import_settings,
            settings::export_settings,
            storage::qx_storage_overview,
            storage::qx_storage_clear_cache,
            storage::qx_storage_clear_files,
            storage::qx_storage_clear_clipboard,
            storage::qx_storage_clear_clipboard_history,
            storage::qx_storage_clear_launcher_history,
            storage::qx_storage_clear_rss_cache,
            storage::qx_storage_clear_reclaimable,
            text_toolbox::docs_workspace_path,
            text_toolbox::docs_open_workspace,
            text_toolbox::docs_list_files,
            text_toolbox::docs_read_file,
            text_toolbox::docs_write_file,
            text_toolbox::docs_create_file,
            text_toolbox::docs_rename_file,
            text_toolbox::docs_delete_file,
            text_toolbox::docs_set_language,
            text_toolbox::docs_inspect_text,
            system_information::qx_system_information_check_system_info,
            system_information::qx_system_information_check_storage,
            system_information::qx_system_information_check_network,
            system_information::qx_system_information_list_processes,
            system_information::qx_system_information_kill_process,
            system_information::qx_system_monitor_network_counters,
            system_information::qx_system_monitor_power,
            system_stats::get_system_stats,
            terminal::terminal_create_session,
            terminal::terminal_list_sessions,
            terminal::terminal_snapshot,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close_session,
            terminal::terminal_clear_buffer,
            external_displays::qx_external_displays_driver,
            external_displays::qx_external_displays_install_driver,
            external_displays::qx_external_displays_list,
            external_displays::qx_external_displays_set_control,
            screencap::start_recording,
            screencap::stop_recording,
            screencap::recording_status,
            screencap::screencap_begin_region_select,
            screencap::screencap_cancel_region_select,
            screencap::screencap_confirm_region_select,
            screencap::screencap_show_controls,
            screencap::screencap_hide_controls,
            screencap::screencap_return_to_main,
            screencap::convert_recording_to_gif,
            screencap::save_gif,
            screencap::list_gif_history,
            screencap::get_screencap_history,
            screencap::delete_screencap,
            screencap::is_recording,
            island_window::island_window_ensure,
            island_window::island_window_show,
            island_window::island_window_hide,
            island_window::island_window_set_always_on_top,
            island_window::island_window_get_snapshot,
            island_window::island_sessions_publish,
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
            plugin_api::plugin_run_applescript,
            plugin_api::plugin_file_read_base64,
            plugin_api::plugin_file_exists,
            plugin_api::plugin_file_ensure_dir,
            plugin_api::plugin_file_write_base64,
            plugin_api::plugin_file_empty_dir,
            plugin_api::plugin_file_list,
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
            updater::qx_update_check,
            updater::qx_update_download_and_install,
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
            weather::fetch_weather_for_location,
            weather::get_cached_weather,
            weather::get_cached_weather_for_location,
            weather::detect_location,
            g4f::g4f_chat,
            g4f::g4f_stream_chat,
            g4f::g4f_chat_custom,
            g4f::g4f_list_providers,
            g4f::qxai_stream_chat,
            g4f::qxai_stream_chat_events,
            g4f::qxai_chat_with_tools,
            g4f::qxai_list_providers,
            g4f::qxai_fetch_models,
            g4f::qxai_get_builtin_provider_credentials,
            g4f::qxai_save_builtin_provider_credentials,
            g4f::qxai_get_custom_providers,
            g4f::qxai_save_custom_providers,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS sends Reopen when the helper is activated (for example by
            // Login Items or `open -a Qx`). Qx is shortcut-first: activation
            // keeps the helper alive but must never surface a hidden launcher.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                floating_panel::hide(app);
            }
        });
}
