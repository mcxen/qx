use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{command, AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

static SETTINGS_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralSettings {
    pub launch_at_login: bool,
    pub language: String,
    pub auto_update: bool,
    #[serde(default = "default_auto_hide_on_blur", rename = "autoHideOnBlur")]
    pub auto_hide_on_blur: bool,
    pub data_path: String,
}

fn default_auto_hide_on_blur() -> bool {
    true
}

impl Default for GeneralSettings {
    fn default() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        Self {
            launch_at_login: false,
            language: "en".to_string(),
            auto_update: true,
            auto_hide_on_blur: true,
            data_path: format!("{}/Library/Application Support/qx", home),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_blur_opacity")]
    pub blur_opacity: f64,
    #[serde(default = "default_window_width")]
    pub window_width: u32,
    #[serde(default = "default_window_height")]
    pub window_height: u32,
    #[serde(default = "default_border_radius")]
    pub border_radius: u32,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_home_island_mode")]
    pub home_island_mode: String,
    #[serde(default = "default_true")]
    pub home_island_cpu: bool,
    #[serde(default = "default_true")]
    pub home_island_gpu: bool,
    #[serde(default = "default_true")]
    pub home_island_memory: bool,
}

fn default_theme() -> String {
    "light".to_string()
}

fn default_blur_opacity() -> f64 {
    0.16
}

fn default_window_width() -> u32 {
    0
}

fn default_window_height() -> u32 {
    0
}

fn default_border_radius() -> u32 {
    8
}

fn default_font_size() -> u32 {
    14
}

fn default_home_island_mode() -> String {
    "system".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            blur_opacity: default_blur_opacity(),
            window_width: default_window_width(),
            window_height: default_window_height(),
            border_radius: default_border_radius(),
            font_size: default_font_size(),
            home_island_mode: default_home_island_mode(),
            home_island_cpu: true,
            home_island_gpu: true,
            home_island_memory: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ShortcutBinding {
    pub key: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedSettings {
    pub log_level: String,
    pub dev_mode: bool,
    #[serde(default, rename = "network_proxy_enabled")]
    pub network_proxy_enabled: bool,
    #[serde(default, rename = "network_proxy_url")]
    pub network_proxy_url: String,
    #[serde(default = "default_ocr_enabled", rename = "ocr_enabled")]
    pub ocr_enabled: bool,
    #[serde(default = "default_ocr_engine", rename = "ocr_engine")]
    pub ocr_engine: String,
    #[serde(default = "default_ocr_model_size", rename = "ocr_model_size")]
    pub ocr_model_size: String,
}

fn default_ocr_enabled() -> bool {
    false
}

fn default_ocr_engine() -> String {
    "apple-vision".to_string()
}

fn default_ocr_model_size() -> String {
    "tiny".to_string()
}

impl Default for AdvancedSettings {
    fn default() -> Self {
        Self {
            log_level: "info".to_string(),
            dev_mode: false,
            network_proxy_enabled: false,
            network_proxy_url: String::new(),
            ocr_enabled: false,
            ocr_engine: "apple-vision".to_string(),
            ocr_model_size: "tiny".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSettings {
    #[serde(default, rename = "agent_mode_enabled")]
    pub agent_mode_enabled: bool,
    #[serde(default, rename = "default_provider")]
    pub default_provider: String,
    #[serde(default, rename = "default_model")]
    pub default_model: String,
    #[serde(default, rename = "model_tools_enabled")]
    pub model_tools_enabled: bool,
    #[serde(default, rename = "tools_enabled")]
    pub tools_enabled: bool,
    #[serde(default = "default_true", rename = "memory_tool_enabled")]
    pub memory_tool_enabled: bool,
    #[serde(default = "default_true", rename = "app_search_enabled")]
    pub app_search_enabled: bool,
    #[serde(default = "default_true", rename = "file_search_enabled")]
    pub file_search_enabled: bool,
    #[serde(default, rename = "http_fetch_enabled")]
    pub http_fetch_enabled: bool,
    #[serde(default = "default_true", rename = "notifications_enabled")]
    pub notifications_enabled: bool,
    #[serde(default, rename = "mcp_enabled")]
    pub mcp_enabled: bool,
    #[serde(default, rename = "bash_enabled")]
    pub bash_enabled: bool,
    #[serde(default = "default_agent_bash_timeout_ms", rename = "bash_timeout_ms")]
    pub bash_timeout_ms: u32,
    #[serde(default, rename = "bash_cwd")]
    pub bash_cwd: String,
    #[serde(default, rename = "grep_search_enabled")]
    pub grep_search_enabled: bool,
    #[serde(default = "default_agent_grep_command", rename = "grep_command")]
    pub grep_command: String,
    #[serde(default, rename = "grep_root")]
    pub grep_root: String,
    #[serde(
        default = "default_agent_grep_max_results",
        rename = "grep_max_results"
    )]
    pub grep_max_results: u32,
    #[serde(default, rename = "background_tasks_enabled")]
    pub background_tasks_enabled: bool,
    #[serde(
        default = "default_agent_max_iterations",
        rename = "agent_max_iterations"
    )]
    pub agent_max_iterations: u32,
}

fn default_agent_bash_timeout_ms() -> u32 {
    30_000
}

fn default_agent_grep_command() -> String {
    "rg".to_string()
}

fn default_agent_grep_max_results() -> u32 {
    80
}

fn default_agent_max_iterations() -> u32 {
    12
}

impl Default for AgentSettings {
    fn default() -> Self {
        Self {
            agent_mode_enabled: false,
            default_provider: String::new(),
            default_model: String::new(),
            model_tools_enabled: false,
            tools_enabled: false,
            memory_tool_enabled: true,
            app_search_enabled: true,
            file_search_enabled: true,
            http_fetch_enabled: false,
            notifications_enabled: true,
            mcp_enabled: false,
            bash_enabled: false,
            bash_timeout_ms: default_agent_bash_timeout_ms(),
            bash_cwd: String::new(),
            grep_search_enabled: false,
            grep_command: default_agent_grep_command(),
            grep_root: String::new(),
            grep_max_results: default_agent_grep_max_results(),
            background_tasks_enabled: false,
            agent_max_iterations: default_agent_max_iterations(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssSettings {
    #[serde(
        default = "default_offline_cache_enabled",
        rename = "offline_cache_enabled"
    )]
    pub offline_cache_enabled: bool,
    #[serde(
        default = "default_max_articles_per_feed",
        rename = "max_articles_per_feed"
    )]
    pub max_articles_per_feed: u32,
    #[serde(default = "default_bottom_island_mode", rename = "bottom_island_mode")]
    pub bottom_island_mode: String,
    #[serde(default = "default_image_display_mode", rename = "image_display_mode")]
    pub image_display_mode: String,
    #[serde(default = "default_image_fixed_width", rename = "image_fixed_width")]
    pub image_fixed_width: u32,
    #[serde(default = "default_article_font_size", rename = "article_font_size")]
    pub article_font_size: u32,
    #[serde(
        default = "default_article_font_family",
        rename = "article_font_family"
    )]
    pub article_font_family: String,
    #[serde(default = "default_show_feed_icons", rename = "show_feed_icons")]
    pub show_feed_icons: bool,
    #[serde(default = "default_retention_days", rename = "retention_days")]
    pub retention_days: u32,
}

fn default_offline_cache_enabled() -> bool {
    true
}

fn default_max_articles_per_feed() -> u32 {
    500
}

fn default_bottom_island_mode() -> String {
    "scroll".to_string()
}

fn default_image_display_mode() -> String {
    "full".to_string()
}

fn default_image_fixed_width() -> u32 {
    320
}

fn default_article_font_size() -> u32 {
    14
}

fn default_article_font_family() -> String {
    "system-ui".to_string()
}

fn default_show_feed_icons() -> bool {
    true
}

fn default_retention_days() -> u32 {
    30
}

impl Default for RssSettings {
    fn default() -> Self {
        Self {
            offline_cache_enabled: true,
            max_articles_per_feed: 500,
            bottom_island_mode: "scroll".to_string(),
            image_display_mode: "full".to_string(),
            image_fixed_width: 320,
            article_font_size: 14,
            article_font_family: "system-ui".to_string(),
            show_feed_icons: true,
            retention_days: 30,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginConfig {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginDisplaySettings {
    #[serde(default = "default_true", rename = "raycast_action_panel")]
    pub raycast_action_panel: bool,
}

impl Default for PluginDisplaySettings {
    fn default() -> Self {
        Self {
            raycast_action_panel: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct V2exSettings {
    #[serde(default, rename = "token")]
    pub token: String,
    #[serde(default = "default_v2ex_nodes", rename = "nodes")]
    pub nodes: String,
}

fn default_v2ex_nodes() -> String {
    "programmer create share ideas apple jobs qna".to_string()
}

impl Default for V2exSettings {
    fn default() -> Self {
        Self {
            token: String::new(),
            nodes: default_v2ex_nodes(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherSettings {
    #[serde(default = "default_weather_provider", rename = "provider")]
    pub provider: String,
    #[serde(default, rename = "api_key")]
    pub api_key: String,
    #[serde(default, rename = "location_override")]
    pub location_override: String,
    #[serde(default, rename = "locations")]
    pub locations: Vec<String>,
    #[serde(default = "default_weather_units", rename = "units")]
    pub units: String,
}

fn default_weather_provider() -> String {
    "open-meteo".to_string()
}

fn default_weather_units() -> String {
    "celsius".to_string()
}

impl Default for WeatherSettings {
    fn default() -> Self {
        Self {
            provider: default_weather_provider(),
            api_key: String::new(),
            location_override: String::new(),
            locations: Vec::new(),
            units: default_weather_units(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchMetadataEntry {
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuickEntryConfig {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub target: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_quick_entries() -> Vec<QuickEntryConfig> {
    [
        ("clipboard", "Clipboard History", "Pinned, frequent, links"),
        ("qx-ai", "QxAI", "Chat and agent tasks"),
        ("rss", "RSS Reader", "Feeds and articles"),
        ("screencap", "Screen Recording", "GIF capture"),
        ("v2ex", "V2EX", "Latest and hot topics"),
        ("weather", "Weather", "Current conditions and forecast"),
        ("documents", "Documents", "Text, Markdown, JSON"),
        ("macros", "Macro Recorder", "Record and replay actions"),
        ("settings", "Settings", "Appearance and plugins"),
    ]
    .into_iter()
    .map(|(id, title, subtitle)| QuickEntryConfig {
        id: id.to_string(),
        title: title.to_string(),
        subtitle: subtitle.to_string(),
        target: id.to_string(),
        enabled: true,
    })
    .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrayActionConfig {
    pub id: String,
    pub title: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_tray_actions() -> Vec<TrayActionConfig> {
    [
        ("open_main", "Open Main Window", true),
        ("keep_visible", "Keep Window Visible", true),
        ("settings", "Settings", true),
        ("hide_main", "Hide Main Window", false),
    ]
    .into_iter()
    .map(|(id, title, enabled)| TrayActionConfig {
        id: id.to_string(),
        title: title.to_string(),
        enabled,
    })
    .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub general: GeneralSettings,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub shortcuts: BTreeMap<String, ShortcutBinding>,
    #[serde(default)]
    pub app_shortcuts: BTreeMap<String, ShortcutBinding>,
    #[serde(default)]
    pub plugins: Vec<PluginConfig>,
    #[serde(default)]
    pub plugin_display: PluginDisplaySettings,
    #[serde(default)]
    pub advanced: AdvancedSettings,
    #[serde(default)]
    pub agent: AgentSettings,
    #[serde(default)]
    pub rss: RssSettings,
    #[serde(default)]
    pub v2ex: V2exSettings,
    #[serde(default)]
    pub weather: WeatherSettings,
    #[serde(default)]
    pub search_metadata: BTreeMap<String, SearchMetadataEntry>,
    #[serde(default = "default_quick_entries")]
    pub quick_entries: Vec<QuickEntryConfig>,
    #[serde(default = "default_tray_actions")]
    pub tray_actions: Vec<TrayActionConfig>,
}

impl Default for Settings {
    fn default() -> Self {
        let mut shortcuts = BTreeMap::new();
        shortcuts.insert(
            "toggle_launcher".to_string(),
            ShortcutBinding {
                key: "Alt+Space".to_string(),
                enabled: true,
            },
        );
        shortcuts.insert(
            "clipboard".to_string(),
            ShortcutBinding {
                key: "Alt+V".to_string(),
                enabled: true,
            },
        );
        shortcuts.insert(
            "record_gif".to_string(),
            ShortcutBinding {
                key: "Alt+G".to_string(),
                enabled: true,
            },
        );
        shortcuts.insert(
            "rss".to_string(),
            ShortcutBinding {
                key: "Alt+R".to_string(),
                enabled: true,
            },
        );

        Self {
            general: GeneralSettings::default(),
            appearance: AppearanceSettings::default(),
            shortcuts,
            app_shortcuts: BTreeMap::new(),
            plugins: Vec::new(),
            plugin_display: PluginDisplaySettings::default(),
            advanced: AdvancedSettings::default(),
            agent: AgentSettings::default(),
            rss: RssSettings::default(),
            v2ex: V2exSettings::default(),
            weather: WeatherSettings::default(),
            search_metadata: BTreeMap::new(),
            quick_entries: default_quick_entries(),
            tray_actions: default_tray_actions(),
        }
    }
}

fn settings_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/.qx", home));
    let _ = fs::create_dir_all(&dir);
    dir.join("settings.json")
}

pub(crate) fn read_settings() -> Settings {
    let path = settings_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub(crate) fn write_settings(settings: &Settings) -> Result<(), String> {
    let _guard = SETTINGS_WRITE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = settings_path();
    let json = serde_json::to_string_pretty(settings).map_err(|e| format!("serialize: {e}"))?;
    atomic_write(&path, json.as_bytes()).map_err(|e| format!("write {}: {e}", path.display()))
}

fn atomic_write(path: &PathBuf, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = path.with_extension(format!("tmp.{}", std::process::id()));
    {
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp_path, path)?;
    if let Some(parent) = path.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

async fn settings_io<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|e| format!("settings IO task failed: {e}"))?
}

#[command]
pub async fn get_settings() -> Settings {
    tokio::task::spawn_blocking(read_settings)
        .await
        .unwrap_or_default()
}

#[command]
pub async fn update_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    let settings_for_io = settings.clone();
    let (shortcuts_changed, tray_changed) = settings_io(move || {
        let old = read_settings();
        let shortcuts_changed = old.shortcuts != settings_for_io.shortcuts
            || old.app_shortcuts != settings_for_io.app_shortcuts;
        let tray_changed = old.quick_entries != settings_for_io.quick_entries
            || old.tray_actions != settings_for_io.tray_actions
            || old.general.auto_hide_on_blur != settings_for_io.general.auto_hide_on_blur;
        write_settings(&settings_for_io)?;
        Ok((shortcuts_changed, tray_changed))
    })
    .await?;

    if shortcuts_changed {
        register_shortcuts(&app, &settings)?;
    }
    if tray_changed {
        crate::refresh_tray_menu(&app, &settings)?;
    }
    Ok(settings)
}

#[command]
pub async fn reset_settings(app: AppHandle) -> Result<Settings, String> {
    let default = Settings::default();
    let default_for_io = default.clone();
    settings_io(move || write_settings(&default_for_io)).await?;
    register_shortcuts(&app, &default)?;
    crate::refresh_tray_menu(&app, &default)?;
    Ok(default)
}

#[command]
pub async fn import_settings(app: AppHandle, path: String) -> Result<Settings, String> {
    let settings = settings_io(move || {
        let content = fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path))?;
        let settings: Settings =
            serde_json::from_str(&content).map_err(|e| format!("parse: {e}"))?;
        write_settings(&settings)?;
        Ok(settings)
    })
    .await?;
    register_shortcuts(&app, &settings)?;
    crate::refresh_tray_menu(&app, &settings)?;
    Ok(settings)
}

#[command]
pub async fn export_settings(path: String) -> Result<(), String> {
    settings_io(move || {
        let settings = read_settings();
        let json =
            serde_json::to_string_pretty(&settings).map_err(|e| format!("serialize: {e}"))?;
        let path_buf = PathBuf::from(&path);
        atomic_write(&path_buf, json.as_bytes()).map_err(|e| format!("write {}: {e}", path))
    })
    .await
}

pub fn init() {
    let _ = read_settings();
}

fn shortcut_for(settings: &Settings, id: &str) -> Option<String> {
    settings
        .shortcuts
        .get(id)
        .filter(|binding| binding.enabled && !binding.key.trim().is_empty())
        .map(|binding| binding.key.trim().to_string())
}

fn enabled_shortcut_key(binding: &ShortcutBinding) -> Option<String> {
    if binding.enabled && !binding.key.trim().is_empty() {
        Some(binding.key.trim().to_string())
    } else {
        None
    }
}

fn show_and_navigate(app: &AppHandle, route: &str) {
    if let Some(win) = app.get_webview_window("main") {
        crate::show_on_cursor_monitor(app, &win);
        let _ = win.emit("navigate", route);
    }
}

pub(crate) fn register_shortcuts(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut registered = BTreeSet::new();

    if let Some(key) = shortcut_for(settings, "toggle_launcher") {
        gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.hide();
                    } else {
                        crate::show_on_cursor_monitor(app, &win);
                    }
                }
            }
        })
        .map_err(|e| format!("register toggle_launcher shortcut: {e}"))?;
        registered.insert(key);
    }

    if let Some(key) = shortcut_for(settings, "clipboard") {
        gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                show_and_navigate(app, "clipboard");
            }
        })
        .map_err(|e| format!("register clipboard shortcut: {e}"))?;
        registered.insert(key);
    }

    if let Some(key) = shortcut_for(settings, "rss") {
        gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                show_and_navigate(app, "rss");
            }
        })
        .map_err(|e| format!("register rss shortcut: {e}"))?;
        registered.insert(key);
    }

    if let Some(key) = shortcut_for(settings, "record_gif") {
        gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                show_and_navigate(app, "screencap");
            }
        })
        .map_err(|e| format!("register record_gif shortcut: {e}"))?;
        registered.insert(key);
    }

    for (id, binding) in &settings.app_shortcuts {
        let Some(key) = enabled_shortcut_key(binding) else {
            continue;
        };
        if !registered.insert(key.clone()) {
            eprintln!("skip duplicate app shortcut {key} for {id}");
            continue;
        }
        let Some(path) = id.strip_prefix("app:") else {
            eprintln!("skip invalid app shortcut id {id}");
            continue;
        };
        let app_path = match crate::validate_open_app_path(path) {
            Ok(path) => path,
            Err(error) => {
                eprintln!("skip app shortcut {id}: {error}");
                continue;
            }
        };
        gs.on_shortcut(key.as_str(), move |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = std::process::Command::new("open").arg(&app_path).spawn();
            }
        })
        .map_err(|e| format!("register app shortcut {id}: {e}"))?;
    }

    Ok(())
}
