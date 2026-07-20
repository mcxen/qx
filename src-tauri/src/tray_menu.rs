//! System tray menu: settings actions, live status lines, plugin contributions.
//!
//! Built-in status ids (tray_actions):
//! - `status_memory` / `status_cpu` / `status_network` — live labels, refresh on timer
//!
//! Plugin items: `plugin_tray_set_items` / `plugin_tray_clear` (permission `tray` on host).

use crate::settings::{self, TrayActionConfig};
use crate::system_information;
use crate::system_stats;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    AppHandle, Emitter, Wry,
};

pub const MAIN_TRAY_ID: &str = "qx-main-tray";

/// Platform-specific tray artwork.
///
/// macOS recolors an alpha template for the current menu-bar appearance.
/// Windows does not implement template tinting, so feeding it the dark
/// monochrome asset makes Qx disappear on a dark taskbar. Use the colored
/// application artwork there and scale it once to the notification-area size.
pub fn tray_icon() -> Result<Image<'static>, String> {
    #[cfg(target_os = "windows")]
    let bytes = include_bytes!("../icons/icon.png").as_slice();
    #[cfg(not(target_os = "windows"))]
    let bytes = include_bytes!("../icons/tray-template.png").as_slice();

    let rgba = image::load_from_memory(bytes)
        .map_err(|error| format!("decode tray icon: {error}"))?
        .into_rgba8();
    #[cfg(target_os = "windows")]
    let rgba = image::imageops::resize(&rgba, 32, 32, image::imageops::FilterType::Lanczos3);
    let (width, height) = rgba.dimensions();
    Ok(Image::new_owned(rgba.into_raw(), width, height))
}

#[cfg(target_os = "macos")]
pub const fn tray_icon_is_template() -> bool {
    true
}

#[cfg(not(target_os = "macos"))]
pub const fn tray_icon_is_template() -> bool {
    false
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginTrayItem {
    pub id: String,
    pub title: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Optional command name to run when clicked (plugin manifest command).
    #[serde(default)]
    pub command: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginTrayClickEvent {
    pub plugin_id: String,
    pub item_id: String,
    pub command: Option<String>,
}

struct NetSample {
    at: Instant,
    bytes_in: u64,
    bytes_out: u64,
}

struct TrayRuntime {
    plugin_items: HashMap<String, Vec<PluginTrayItem>>,
    net_sample: Option<NetSample>,
    refresh_started: AtomicBool,
}

fn tray_runtime() -> &'static Mutex<TrayRuntime> {
    static RT: OnceLock<Mutex<TrayRuntime>> = OnceLock::new();
    RT.get_or_init(|| {
        Mutex::new(TrayRuntime {
            plugin_items: HashMap::new(),
            net_sample: None,
            refresh_started: AtomicBool::new(false),
        })
    })
}

fn format_bytes_rate(bps: f64) -> String {
    if !bps.is_finite() || bps < 0.0 {
        return "0 B/s".into();
    }
    if bps < 1024.0 {
        return format!("{:.0} B/s", bps);
    }
    if bps < 1024.0 * 1024.0 {
        return format!("{:.1} KB/s", bps / 1024.0);
    }
    format!("{:.2} MB/s", bps / (1024.0 * 1024.0))
}

fn sample_status_titles(rt: &mut TrayRuntime) -> (String, String, String) {
    let stats = system_stats::platform_cpu_memory_sync();
    let mem = format!(
        "Memory  {:.1}/{:.0} GB  ({:.0}%)",
        stats.memory_used_gb, stats.memory_total_gb, stats.memory
    );
    let cpu = format!("CPU  {:.0}%", stats.cpu);

    let net = match system_information::network_totals_sync() {
        Ok((bytes_in, bytes_out)) => {
            let now = Instant::now();
            let (down, up) = if let Some(prev) = &rt.net_sample {
                let dt = now.duration_since(prev.at).as_secs_f64().max(0.001);
                let d = (bytes_in.saturating_sub(prev.bytes_in)) as f64 / dt;
                let u = (bytes_out.saturating_sub(prev.bytes_out)) as f64 / dt;
                (d, u)
            } else {
                (0.0, 0.0)
            };
            rt.net_sample = Some(NetSample {
                at: now,
                bytes_in,
                bytes_out,
            });
            format!(
                "Net  ↓ {}  ↑ {}",
                format_bytes_rate(down),
                format_bytes_rate(up)
            )
        }
        Err(_) => "Net  —".into(),
    };
    (mem, cpu, net)
}

fn tray_action_title(
    settings: &settings::Settings,
    action: &TrayActionConfig,
    status: &(String, String, String),
) -> String {
    match action.id.as_str() {
        "status_memory" => status.0.clone(),
        "status_cpu" => status.1.clone(),
        "status_network" => status.2.clone(),
        "keep_visible" => {
            let base = if action.title.trim().is_empty() {
                "Keep Window Visible"
            } else {
                action.title.trim()
            };
            let state = if settings.general.auto_hide_on_blur {
                "Off"
            } else {
                "On"
            };
            format!("{base}: {state}")
        }
        _ => {
            if action.title.trim().is_empty() {
                action.id.trim().to_string()
            } else {
                action.title.trim().to_string()
            }
        }
    }
}

fn is_status_action(id: &str) -> bool {
    matches!(id, "status_memory" | "status_cpu" | "status_network")
}

pub fn needs_status_refresh(settings: &settings::Settings) -> bool {
    settings
        .tray_actions
        .iter()
        .any(|a| a.enabled && is_status_action(a.id.trim()))
}

pub fn build_tray_menu(app: &AppHandle, settings: &settings::Settings) -> tauri::Result<Menu<Wry>> {
    let mut rt = tray_runtime()
        .lock()
        .map_err(|_| tauri::Error::FailedToReceiveMessage)?;
    let status = sample_status_titles(&mut rt);
    let plugin_snapshot: Vec<(String, Vec<PluginTrayItem>)> = rt
        .plugin_items
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    drop(rt);

    let menu = Menu::new(app)?;

    // Live status block (memory / net / cpu)
    let mut status_appended = false;
    for action in settings
        .tray_actions
        .iter()
        .filter(|a| a.enabled && is_status_action(a.id.trim()))
    {
        let title = tray_action_title(settings, action, &status);
        let item = MenuItem::with_id(
            app,
            format!("tray_action:{}", action.id.trim()),
            title,
            true,
            None::<&str>,
        )?;
        menu.append(&item)?;
        status_appended = true;
    }
    if status_appended {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    // Quick entries
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

    // Window / settings actions (non-status)
    let mut appended_action = false;
    for action in settings.tray_actions.iter().filter(|action| {
        action.enabled && !action.id.trim().is_empty() && !is_status_action(action.id.trim())
    }) {
        let item = MenuItem::with_id(
            app,
            format!("tray_action:{}", action.id.trim()),
            tray_action_title(settings, action, &status),
            true,
            None::<&str>,
        )?;
        menu.append(&item)?;
        appended_action = true;
    }

    if !appended_action && !status_appended {
        let show = MenuItem::with_id(app, "show", "Show/Hide", true, None::<&str>)?;
        menu.append(&show)?;
        appended_action = true;
    }

    // Plugin contributions
    let mut plugin_appended = false;
    for (plugin_id, items) in plugin_snapshot {
        for item in items
            .into_iter()
            .filter(|i| i.enabled && !i.id.trim().is_empty())
        {
            let menu_id = format!("plugin_tray:{}:{}", plugin_id, item.id.trim());
            let title = if item.title.trim().is_empty() {
                item.id.trim()
            } else {
                item.title.trim()
            };
            let mi = MenuItem::with_id(app, menu_id, title, true, None::<&str>)?;
            menu.append(&mi)?;
            plugin_appended = true;
        }
    }

    if appended_action || plugin_appended || status_appended {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    let quit = MenuItem::with_id(app, "quit", "Quit Qx", true, Some("CmdOrCtrl+Q"))?;
    menu.append(&quit)?;
    Ok(menu)
}

pub fn handle_tray_action(app: &AppHandle, action_id: &str) {
    match action_id {
        "open_main" | "show" => crate::floating_panel::show_floating(app),
        "settings" => crate::floating_panel::show_and_navigate(app, "settings"),
        "hide_main" => crate::floating_panel::hide(app),
        "status_memory" | "status_cpu" | "status_network" => {
            // Refresh labels on click; open main for a closer look.
            let settings = settings::read_settings();
            let _ = refresh_tray_menu(app, &settings);
        }
        "keep_visible" => {
            let mut next = settings::read_settings();
            next.general.auto_hide_on_blur = !next.general.auto_hide_on_blur;
            if let Err(err) = settings::write_settings(&next) {
                crate::diagnostics::log(
                    crate::diagnostics::LogLevel::Error,
                    "main.tray",
                    "update keep_visible tray action failed",
                    serde_json::json!({ "error": err.to_string() }),
                );
                return;
            }
            let _ = refresh_tray_menu(app, &next);
            let _ = app.emit("settings-updated", next.clone());
            if !next.general.auto_hide_on_blur {
                crate::floating_panel::show_floating(app);
            }
        }
        _ => {}
    }
}

pub fn handle_plugin_tray_click(app: &AppHandle, menu_id: &str) {
    // plugin_tray:{pluginId}:{itemId} — tokens are sanitized (no ':').
    let rest = menu_id.strip_prefix("plugin_tray:").unwrap_or("");
    let mut parts = rest.splitn(2, ':');
    let plugin_id = parts.next().unwrap_or("").to_string();
    let item_id = parts.next().unwrap_or("").to_string();
    if plugin_id.is_empty()
        || item_id.is_empty()
        || plugin_id.contains(':')
        || item_id.contains(':')
    {
        return;
    }
    let command = tray_runtime().lock().ok().and_then(|rt| {
        rt.plugin_items.get(&plugin_id).and_then(|items| {
            items
                .iter()
                .find(|i| i.id == item_id)
                .and_then(|i| i.command.clone())
        })
    });
    let _ = app.emit(
        "plugin-tray-action",
        PluginTrayClickEvent {
            plugin_id,
            item_id,
            command,
        },
    );
}

pub fn refresh_tray_menu(app: &AppHandle, settings: &settings::Settings) -> Result<(), String> {
    let menu = build_tray_menu(app, settings).map_err(|e| format!("build tray menu: {e}"))?;
    if let Some(tray) = app.tray_by_id(MAIN_TRAY_ID) {
        tray.set_menu(Some(menu))
            .map_err(|e| format!("refresh tray menu: {e}"))?;
    }
    ensure_status_refresh_loop(app);
    Ok(())
}

/// Refresh tray labels every few seconds when status rows are enabled.
pub fn ensure_status_refresh_loop(app: &AppHandle) {
    let settings = settings::read_settings();
    if !needs_status_refresh(&settings) {
        return;
    }
    let rt = match tray_runtime().lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if rt
        .refresh_started
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    drop(rt);

    let handle = app.clone();
    std::thread::Builder::new()
        .name("qx-tray-status".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(3));
            let settings = settings::read_settings();
            if !needs_status_refresh(&settings) {
                if let Ok(rt) = tray_runtime().lock() {
                    rt.refresh_started.store(false, Ordering::SeqCst);
                }
                break;
            }
            let _ = refresh_tray_menu(&handle, &settings);
        })
        .ok();
}

fn sanitize_tray_token(raw: &str, max: usize) -> Result<String, String> {
    let s: String = raw
        .trim()
        .chars()
        .take(max)
        .filter(|c| *c > ' ' && *c != ':' && *c != '/' && *c != '\\')
        .collect();
    if s.is_empty() {
        return Err("invalid tray id/command token".into());
    }
    Ok(s)
}

#[tauri::command]
pub fn plugin_tray_set_items(
    app: AppHandle,
    plugin_id: String,
    items: Vec<PluginTrayItem>,
) -> Result<(), String> {
    let plugin_id = sanitize_tray_token(&plugin_id, 96)?;
    if items.len() > 12 {
        return Err("at most 12 tray items per plugin".into());
    }
    let mut cleaned: Vec<PluginTrayItem> = Vec::new();
    for i in items.into_iter().take(12) {
        let id = match sanitize_tray_token(&i.id, 48) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let title: String = i
            .title
            .trim()
            .chars()
            .filter(|c| !c.is_control())
            .take(64)
            .collect();
        if title.is_empty() {
            continue;
        }
        let command = match i.command {
            Some(c) => match sanitize_tray_token(&c, 64) {
                Ok(v) => Some(v),
                Err(_) => None,
            },
            None => None,
        };
        cleaned.push(PluginTrayItem {
            id,
            title,
            enabled: i.enabled,
            command,
        });
    }
    {
        let mut rt = tray_runtime()
            .lock()
            .map_err(|_| "tray registry lock poisoned".to_string())?;
        if cleaned.is_empty() {
            rt.plugin_items.remove(&plugin_id);
        } else {
            rt.plugin_items.insert(plugin_id, cleaned);
        }
    }
    let settings = settings::read_settings();
    refresh_tray_menu(&app, &settings)
}

#[tauri::command]
pub fn plugin_tray_clear(app: AppHandle, plugin_id: String) -> Result<(), String> {
    plugin_tray_set_items(app, plugin_id, vec![])
}

/// Read back items this plugin currently contributes (for plugin UI / debugging).
#[tauri::command]
pub fn plugin_tray_list(plugin_id: String) -> Result<Vec<PluginTrayItem>, String> {
    let plugin_id = plugin_id.trim().to_string();
    let rt = tray_runtime()
        .lock()
        .map_err(|_| "tray registry lock poisoned".to_string())?;
    Ok(rt.plugin_items.get(&plugin_id).cloned().unwrap_or_default())
}
