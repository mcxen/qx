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
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
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
    /// Optional host-locale titles (`en` / `zh-CN`); `title` remains fallback.
    #[serde(default)]
    pub titles: HashMap<String, String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Optional command name to run when clicked (plugin manifest command).
    #[serde(default)]
    pub command: Option<String>,
    /// `status` is an informational, non-clickable native menu row.
    #[serde(default = "default_plugin_tray_presentation")]
    pub presentation: String,
    /// Optional native submenu label shared by related plugin items.
    #[serde(default)]
    pub group: Option<String>,
    /// Optional localized label for the native submenu identified by `group`.
    #[serde(default)]
    pub group_titles: HashMap<String, String>,
}

fn default_true() -> bool {
    true
}

fn default_plugin_tray_presentation() -> String {
    "action".into()
}

fn plugin_tray_item_is_status(item: &PluginTrayItem) -> bool {
    item.presentation == "status"
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TrayLocale {
    En,
    ZhCn,
}

fn is_simplified_chinese_locale(tag: &str) -> bool {
    let normalized = tag.trim().to_ascii_lowercase().replace('_', "-");
    let base = normalized.split('.').next().unwrap_or(&normalized);
    if !base.starts_with("zh")
        || base.contains("hant")
        || matches!(base, "zh-tw" | "zh-hk" | "zh-mo")
        || base.starts_with("zh-tw-")
        || base.starts_with("zh-hk-")
        || base.starts_with("zh-mo-")
    {
        return false;
    }
    base == "zh"
        || base.contains("hans")
        || matches!(base, "zh-cn" | "zh-sg" | "zh-my")
        || base.starts_with("zh-cn-")
        || base.starts_with("zh-sg-")
        || base.starts_with("zh-my-")
}

fn tray_locale(settings: &settings::Settings) -> TrayLocale {
    match settings.general.language.as_str() {
        "zh-CN" => TrayLocale::ZhCn,
        "en" => TrayLocale::En,
        _ => {
            if sys_locale::get_locale()
                .as_deref()
                .is_some_and(is_simplified_chinese_locale)
            {
                TrayLocale::ZhCn
            } else {
                TrayLocale::En
            }
        }
    }
}

fn tr(locale: TrayLocale, en: &str, zh_cn: &str) -> String {
    match locale {
        TrayLocale::En => en.to_string(),
        TrayLocale::ZhCn => zh_cn.to_string(),
    }
}

fn localized_map_value(
    values: &HashMap<String, String>,
    fallback: &str,
    locale: TrayLocale,
) -> String {
    let key = match locale {
        TrayLocale::En => "en",
        TrayLocale::ZhCn => "zh-CN",
    };
    values
        .get(key)
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn sample_status_titles(rt: &mut TrayRuntime, locale: TrayLocale) -> (String, String, String) {
    let stats = system_stats::platform_cpu_memory_sync();
    let mem = format!(
        "{}  {:.1}/{:.0} GB  ({:.0}%)",
        tr(locale, "Memory", "内存"),
        stats.memory_used_gb,
        stats.memory_total_gb,
        stats.memory
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
                "{}  ↓ {}  ↑ {}",
                tr(locale, "Net", "网络"),
                format_bytes_rate(down),
                format_bytes_rate(up)
            )
        }
        Err(_) => format!("{}  —", tr(locale, "Net", "网络")),
    };
    (mem, cpu, net)
}

fn builtin_action_title(id: &str, locale: TrayLocale) -> Option<String> {
    Some(match id {
        "open_main" => tr(locale, "Open Main Window", "打开主窗口"),
        "keep_visible" => tr(locale, "Window Display Mode", "窗口显示方式"),
        "settings" => tr(locale, "Settings", "设置"),
        "hide_main" => tr(locale, "Hide Main Window", "隐藏主窗口"),
        _ => return None,
    })
}

fn is_default_action_title(id: &str, title: &str) -> bool {
    matches!(
        (id, title.trim()),
        ("open_main", "Open Main Window")
            | ("keep_visible", "Keep Window Visible")
            | ("keep_visible", "Window Display Mode")
            | ("settings", "Settings")
            | ("hide_main", "Hide Main Window")
    )
}

fn tray_action_title(
    settings: &settings::Settings,
    action: &TrayActionConfig,
    status: &(String, String, String),
    locale: TrayLocale,
) -> String {
    match action.id.as_str() {
        "status_memory" => status.0.clone(),
        "status_cpu" => status.1.clone(),
        "status_network" => status.2.clone(),
        "keep_visible" => {
            let base = if action.title.trim().is_empty()
                || is_default_action_title(&action.id, &action.title)
            {
                builtin_action_title(&action.id, locale)
                    .unwrap_or_else(|| action.id.trim().to_string())
            } else {
                action.title.trim().to_string()
            };
            let state = match settings.appearance.window_behavior.as_str() {
                "always-on-top" => tr(locale, "Always on top", "始终置顶"),
                "normal" => tr(locale, "Normal window", "普通窗口"),
                _ => tr(locale, "Hide on blur", "失焦隐藏"),
            };
            format!("{base}: {state}")
        }
        _ => {
            if action.title.trim().is_empty() || is_default_action_title(&action.id, &action.title)
            {
                builtin_action_title(&action.id, locale)
                    .unwrap_or_else(|| action.id.trim().to_string())
            } else {
                action.title.trim().to_string()
            }
        }
    }
}

fn quick_entry_title(entry: &settings::QuickEntryConfig, locale: TrayLocale) -> String {
    let title = entry.title.trim();
    let localized = match entry.target.trim() {
        "clipboard" if matches!(title, "" | "Clipboard History") => {
            Some(tr(locale, "Clipboard History", "剪贴板历史"))
        }
        "screencap" if matches!(title, "" | "Screenshot Module" | "Screen Capture") => {
            Some(tr(locale, "Screenshot Module", "截图与录屏"))
        }
        "documents" if matches!(title, "" | "Text Tools" | "Documents") => {
            Some(tr(locale, "Text Tools", "文本工具"))
        }
        "settings:plugins"
            if matches!(
                title,
                "" | "Extensions" | "Plugins" | "Plugin Store" | "扩展" | "插件"
            ) =>
        {
            Some(tr(locale, "Extensions", "扩展 / 插件"))
        }
        "settings" if matches!(title, "" | "Qx Settings" | "Settings") => {
            Some(tr(locale, "Qx Settings", "Qx 设置"))
        }
        "rss" if matches!(title, "" | "RSS Reader") => Some(tr(locale, "RSS Reader", "RSS 阅读器")),
        "file-search" if matches!(title, "" | "File Search") => {
            Some(tr(locale, "File Search", "文件搜索"))
        }
        "weather" if matches!(title, "" | "Weather") => Some(tr(locale, "Weather", "天气")),
        "macros" if matches!(title, "" | "Macro Recorder") => {
            Some(tr(locale, "Macro Recorder", "宏录制"))
        }
        _ => None,
    };
    localized.unwrap_or_else(|| {
        if title.is_empty() {
            entry.target.trim().to_string()
        } else {
            title.to_string()
        }
    })
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
    let locale = tray_locale(settings);
    let mut rt = tray_runtime()
        .lock()
        .map_err(|_| tauri::Error::FailedToReceiveMessage)?;
    let status = sample_status_titles(&mut rt, locale);
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
        let title = tray_action_title(settings, action, &status, locale);
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
        let title = quick_entry_title(entry, locale);
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
            tray_action_title(settings, action, &status, locale),
            true,
            None::<&str>,
        )?;
        menu.append(&item)?;
        appended_action = true;
    }

    if !appended_action && !status_appended {
        let show = MenuItem::with_id(
            app,
            "show",
            tr(locale, "Show/Hide", "显示/隐藏"),
            true,
            None::<&str>,
        )?;
        menu.append(&show)?;
        appended_action = true;
    }

    // Plugin contributions
    let mut plugin_appended = false;
    for (plugin_id, items) in plugin_snapshot {
        let visible: Vec<PluginTrayItem> = items
            .into_iter()
            .filter(|i| i.enabled && !i.id.trim().is_empty())
            .collect();

        // Legacy contributions stay flat. A group opts into an OS-native
        // submenu, which keeps dense status blocks (for example a deployment)
        // readable without attempting unsupported CSS in system menus.
        for item in visible.iter().filter(|item| item.group.is_none()) {
            let menu_id = format!("plugin_tray:{}:{}", plugin_id, item.id.trim());
            let fallback = if item.title.trim().is_empty() {
                item.id.trim()
            } else {
                item.title.trim()
            };
            let title = localized_map_value(&item.titles, fallback, locale);
            let mi = MenuItem::with_id(
                app,
                menu_id,
                title,
                !plugin_tray_item_is_status(item),
                None::<&str>,
            )?;
            menu.append(&mi)?;
            plugin_appended = true;
        }

        let mut groups: Vec<String> = Vec::new();
        for item in &visible {
            let Some(group) = item
                .group
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            if !groups.iter().any(|known| known == group) {
                groups.push(group.to_string());
            }
        }
        for (group_index, group) in groups.iter().enumerate() {
            let group_title = visible
                .iter()
                .find(|item| item.group.as_deref().map(str::trim) == Some(group.as_str()))
                .map(|item| localized_map_value(&item.group_titles, group, locale))
                .unwrap_or_else(|| group.clone());
            let submenu = Submenu::with_id(
                app,
                format!("plugin_tray_group:{}:{}", plugin_id, group_index),
                group_title,
                true,
            )?;
            for item in visible
                .iter()
                .filter(|item| item.group.as_deref().map(str::trim) == Some(group.as_str()))
            {
                let menu_id = format!("plugin_tray:{}:{}", plugin_id, item.id.trim());
                let fallback = if item.title.trim().is_empty() {
                    item.id.trim()
                } else {
                    item.title.trim()
                };
                let title = localized_map_value(&item.titles, fallback, locale);
                let mi = MenuItem::with_id(
                    app,
                    menu_id,
                    title,
                    !plugin_tray_item_is_status(item),
                    None::<&str>,
                )?;
                submenu.append(&mi)?;
            }
            menu.append(&submenu)?;
            plugin_appended = true;
        }
    }

    if appended_action || plugin_appended || status_appended {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    // macOS: accelerator still ⌘Q, but app_quit requires two presses within ~2.5s.
    // Windows: single Ctrl+Q / menu click quits immediately.
    let quit = MenuItem::with_id(
        app,
        "quit",
        tr(locale, "Quit Qx", "退出 Qx"),
        true,
        Some("CmdOrCtrl+Q"),
    )?;
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
            next.appearance.window_behavior = match next.appearance.window_behavior.as_str() {
                "auto-hide" => "normal".to_string(),
                "normal" => "always-on-top".to_string(),
                _ => "auto-hide".to_string(),
            };
            next.general.auto_hide_on_blur = next.appearance.window_behavior == "auto-hide";
            if let Err(err) = settings::write_settings(&next) {
                crate::diagnostics::log(
                    crate::diagnostics::LogLevel::Error,
                    "main.tray",
                    "update keep_visible tray action failed",
                    serde_json::json!({ "error": err.to_string() }),
                );
                return;
            }
            crate::floating_panel::apply_window_behavior(app, &next.appearance.window_behavior);
            let _ = refresh_tray_menu(app, &next);
            let _ = app.emit("settings-updated", next.clone());
            crate::floating_panel::show_floating(app);
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

fn sanitize_localizations(values: HashMap<String, String>, max: usize) -> HashMap<String, String> {
    values
        .into_iter()
        .filter_map(|(locale, value)| {
            if locale != "en" && locale != "zh-CN" {
                return None;
            }
            let clean = value
                .trim()
                .chars()
                .filter(|character| !character.is_control())
                .take(max)
                .collect::<String>();
            (!clean.is_empty()).then_some((locale, clean))
        })
        .collect()
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
        let presentation = if i.presentation.trim() == "status" {
            "status".to_string()
        } else {
            "action".to_string()
        };
        let command = if presentation == "status" {
            None
        } else {
            match i.command {
                Some(c) => sanitize_tray_token(&c, 64).ok(),
                None => None,
            }
        };
        let group = i
            .group
            .as_deref()
            .map(|value| {
                value
                    .trim()
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(48)
                    .collect::<String>()
            })
            .filter(|value| !value.is_empty());
        cleaned.push(PluginTrayItem {
            id,
            title,
            titles: sanitize_localizations(i.titles, 64),
            enabled: i.enabled,
            command,
            presentation,
            group,
            group_titles: sanitize_localizations(i.group_titles, 48),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simplified_chinese_detection_matches_frontend_policy() {
        for locale in ["zh", "zh-CN", "zh_Hans_CN", "zh-SG.UTF-8"] {
            assert!(is_simplified_chinese_locale(locale), "{locale}");
        }
        for locale in ["en-US", "zh-TW", "zh_Hant", "zh-HK", "C"] {
            assert!(!is_simplified_chinese_locale(locale), "{locale}");
        }
    }

    #[test]
    fn built_in_titles_localize_but_custom_titles_are_preserved() {
        let mut settings = settings::Settings::default();
        settings.general.language = "zh-CN".into();
        let status = ("内存".into(), "CPU".into(), "网络".into());
        let mut action = TrayActionConfig {
            id: "open_main".into(),
            title: "Open Main Window".into(),
            enabled: true,
        };
        assert_eq!(
            tray_action_title(&settings, &action, &status, TrayLocale::ZhCn),
            "打开主窗口"
        );
        action.title = "Open Workbench".into();
        assert_eq!(
            tray_action_title(&settings, &action, &status, TrayLocale::ZhCn),
            "Open Workbench"
        );
    }

    #[test]
    fn plugin_localization_uses_title_as_fallback() {
        let values = HashMap::from([("zh-CN".into(), "刷新部署".into())]);
        assert_eq!(
            localized_map_value(&values, "Refresh deployments", TrayLocale::ZhCn),
            "刷新部署"
        );
        assert_eq!(
            localized_map_value(&values, "Refresh deployments", TrayLocale::En),
            "Refresh deployments"
        );
    }
}
