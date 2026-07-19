use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{command, AppHandle};

mod entry_config;
pub(crate) mod shortcuts;

use entry_config::{
    default_quick_entries, default_tray_actions, migrate_legacy_default_quick_entries,
};
pub use entry_config::{QuickEntryConfig, TrayActionConfig};
#[cfg(all(test, target_os = "windows"))]
use shortcuts::migrate_windows_factory_host_shortcuts;
#[cfg(test)]
use shortcuts::{
    default_toggle_launcher_shortcut, default_toggle_window_shortcut,
    merge_missing_default_shortcuts, migrate_swapped_window_launcher_defaults,
    portable_shortcut_key,
};
pub(crate) use shortcuts::{global_shortcuts_are_paused, register_shortcuts};

static SETTINGS_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralSettings {
    pub launch_at_login: bool,
    pub language: String,
    pub auto_update: bool,
    #[serde(default = "default_auto_hide_on_blur", rename = "autoHideOnBlur")]
    pub auto_hide_on_blur: bool,
    pub data_path: String,
    #[serde(default)]
    pub has_shown_launcher: bool,
    /// macOS first-launch permission wizard completed (or skipped on non-macOS).
    #[serde(default)]
    pub has_completed_onboarding: bool,
}

fn default_auto_hide_on_blur() -> bool {
    true
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            // "system" | "en" | "zh-CN" — frontend resolves system to zh-CN only for Simplified Chinese OS
            language: "system".to_string(),
            auto_update: true,
            auto_hide_on_blur: true,
            data_path: crate::paths::data_dir().to_string_lossy().to_string(),
            has_shown_launcher: false,
            has_completed_onboarding: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_true")]
    pub glass_enabled: bool,
    #[serde(default = "default_blur_opacity")]
    pub blur_opacity: f64,
    #[serde(default = "default_blur_radius")]
    pub blur_radius: f64,
    #[serde(default = "default_shell_region_opacity")]
    pub shell_region_opacity: f64,
    #[serde(default = "default_surface_opacity")]
    pub surface_opacity: f64,
    #[serde(default = "default_control_opacity")]
    pub control_opacity: f64,
    #[serde(default = "default_bottom_bar_opacity")]
    pub bottom_bar_opacity: f64,
    #[serde(default = "default_window_width")]
    pub window_width: u32,
    #[serde(default = "default_window_height")]
    pub window_height: u32,
    #[serde(default = "default_border_radius")]
    pub border_radius: u32,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    /// `comfortable` (two-line rows) or `compact` (dense single-line).
    #[serde(default = "default_launcher_result_density")]
    pub launcher_result_density: String,
    #[serde(default = "default_home_island_mode")]
    pub home_island_mode: String,
    /// Multi-select home island modes (rotate when length > 1). Empty → use `home_island_mode`.
    #[serde(default)]
    pub home_island_modes: Vec<String>,
    /// Auto-rotate interval in seconds (0 = off). Default 8.
    #[serde(default = "default_home_island_rotate_secs")]
    pub home_island_rotate_secs: u32,
    #[serde(default = "default_true")]
    pub home_island_cpu: bool,
    #[serde(default = "default_true")]
    pub home_island_memory: bool,
    /// Floating QxIsland webview (default false for dogfood rollout).
    #[serde(default)]
    pub island_float_enabled: bool,
    /// Auto-rotate standing module/plugin sessions. Default 8 seconds.
    #[serde(default = "default_island_float_rotate_secs")]
    pub island_float_rotate_secs: u32,
    /// Keep an already manually floated island visible while main is hidden.
    #[serde(default = "default_true")]
    pub island_float_when_main_hidden: bool,
    #[serde(default = "default_true")]
    pub island_float_always_on_top: bool,
    #[serde(default = "default_true")]
    /// Legacy persisted preference; manual float requests now override it.
    pub island_prefer_docked_when_main_visible: bool,
    /// Persisted physical desktop coordinates after the user drags the island.
    #[serde(default)]
    pub island_float_x: Option<i32>,
    #[serde(default)]
    pub island_float_y: Option<i32>,
}

fn default_theme() -> String {
    "light".to_string()
}

fn default_blur_opacity() -> f64 {
    0.16
}

fn default_blur_radius() -> f64 {
    14.0
}

fn default_shell_region_opacity() -> f64 {
    0.10
}

fn default_surface_opacity() -> f64 {
    0.36
}

fn default_control_opacity() -> f64 {
    0.68
}

fn default_bottom_bar_opacity() -> f64 {
    0.08
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

fn default_launcher_result_density() -> String {
    "comfortable".to_string()
}

fn default_home_island_mode() -> String {
    "system".to_string()
}

fn default_home_island_rotate_secs() -> u32 {
    8
}

fn default_island_float_rotate_secs() -> u32 {
    8
}

fn default_true() -> bool {
    true
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            glass_enabled: true,
            blur_opacity: default_blur_opacity(),
            blur_radius: default_blur_radius(),
            shell_region_opacity: default_shell_region_opacity(),
            surface_opacity: default_surface_opacity(),
            control_opacity: default_control_opacity(),
            bottom_bar_opacity: default_bottom_bar_opacity(),
            window_width: default_window_width(),
            window_height: default_window_height(),
            border_radius: default_border_radius(),
            font_size: default_font_size(),
            launcher_result_density: default_launcher_result_density(),
            home_island_mode: default_home_island_mode(),
            home_island_modes: vec![default_home_island_mode()],
            home_island_rotate_secs: default_home_island_rotate_secs(),
            home_island_cpu: true,
            home_island_memory: true,
            island_float_enabled: false,
            island_float_rotate_secs: default_island_float_rotate_secs(),
            island_float_when_main_hidden: true,
            island_float_always_on_top: true,
            island_prefer_docked_when_main_visible: true,
            island_float_x: None,
            island_float_y: None,
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
    #[serde(default)]
    pub logging_enabled: bool,
    pub log_level: String,
    pub dev_mode: bool,
    /// Proxy mode: `"off"` | `"system"` | `"manual"`.
    /// Empty string means “legacy”: derive from `network_proxy_enabled` + URL.
    #[serde(default, rename = "network_proxy_mode")]
    pub network_proxy_mode: String,
    /// Legacy flag kept for older configs / readers. Prefer `network_proxy_mode`.
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
            logging_enabled: false,
            log_level: "info".to_string(),
            dev_mode: false,
            network_proxy_mode: "off".to_string(),
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
            default_provider: "openrouter".to_string(),
            default_model: "openrouter/auto".to_string(),
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileSearchCategory {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub include_folders: bool,
    #[serde(default)]
    pub catch_all: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSearchSettings {
    #[serde(default = "default_file_search_categories")]
    pub categories: Vec<FileSearchCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreencapSettings {
    #[serde(default = "default_screencap_format")]
    pub output_format: String,
    #[serde(default = "default_screencap_fps")]
    pub fps: u32,
    #[serde(default = "default_screencap_quality")]
    pub quality: String,
    #[serde(default = "default_screencap_resolution")]
    pub resolution: String,
    #[serde(default = "default_screencap_confirm_mode")]
    pub capture_confirm_mode: String,
    #[serde(default)]
    pub capture_delay_seconds: u32,
    #[serde(default = "default_true")]
    pub auto_hide_after_capture: bool,
    #[serde(default = "default_true")]
    pub auto_copy_to_clipboard: bool,
    #[serde(default = "default_screencap_history_layout")]
    pub history_layout: String,
    #[serde(default)]
    pub controls_pinned: bool,
}

fn default_screencap_format() -> String {
    "mp4".to_string()
}
fn default_screencap_fps() -> u32 {
    24
}
fn default_screencap_quality() -> String {
    "balanced".to_string()
}
fn default_screencap_resolution() -> String {
    "1080p".to_string()
}
fn default_screencap_confirm_mode() -> String {
    "refine".to_string()
}
fn default_screencap_history_layout() -> String {
    "gallery".to_string()
}

impl Default for ScreencapSettings {
    fn default() -> Self {
        Self {
            output_format: default_screencap_format(),
            fps: default_screencap_fps(),
            quality: default_screencap_quality(),
            resolution: default_screencap_resolution(),
            capture_confirm_mode: default_screencap_confirm_mode(),
            capture_delay_seconds: 0,
            auto_hide_after_capture: true,
            auto_copy_to_clipboard: true,
            history_layout: default_screencap_history_layout(),
            controls_pinned: false,
        }
    }
}

pub fn default_file_search_categories() -> Vec<FileSearchCategory> {
    [
        ("folders", "Folders", "", true, false),
        ("media", "Multimedia", "mp4;mov;m4v;mkv;avi;webm;mp3;m4a;wav;aac;flac;ogg", false, false),
        ("code", "Code", "rs;ts;tsx;js;jsx;mjs;cjs;py;go;java;kt;swift;c;cc;cpp;h;hpp;cs;rb;php;vue;svelte;astro;json;yml;yaml;toml;html;css;scss;sql", false, false),
        ("office", "Office", "doc;docx;dot;dotx;rtf;odt;pages;xls;xlsx;xlsm;xlsb;csv;tsv;ods;numbers;ppt;pptx;pps;ppsx;key;odp;pdf", false, false),
        ("images", "Images", "png;jpg;jpeg;gif;webp;avif;heic;heif;tif;tiff;bmp;svg", false, false),
        ("archives", "Archives", "zip;rar;7z;tar;gz;tgz;bz2;xz;dmg;pkg", false, false),
        ("other", "Other Files", "", false, true),
    ]
    .into_iter()
    .map(|(id, label, extensions, include_folders, catch_all)| FileSearchCategory {
        id: id.to_string(),
        label: label.to_string(),
        extensions: extensions
            .split(';')
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        include_folders,
        catch_all,
    })
    .collect()
}

impl Default for FileSearchSettings {
    fn default() -> Self {
        Self {
            categories: default_file_search_categories(),
        }
    }
}

/// Per-module contribution to the main launcher search (static commands + dynamic surfaces).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleSearchSettings {
    /// Master switch for all module search integration.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// When a key is missing, treat as enabled (true).
    #[serde(default)]
    pub modules: BTreeMap<String, bool>,
}

impl Default for ModuleSearchSettings {
    fn default() -> Self {
        let mut modules = BTreeMap::new();
        for id in [
            "clipboard",
            "qx-ai",
            "rss",
            "screencap",
            "macros",
            "documents",
            "qx-tty",
        ] {
            modules.insert(id.to_string(), true);
        }
        // Prefer marketplace plugins; built-in V2EX / Weather panels are opt-in.
        modules.insert("v2ex".to_string(), false);
        modules.insert("weather".to_string(), false);
        Self {
            enabled: true,
            modules,
        }
    }
}

/// User-controllable built-in modules. Missing keys stay enabled so existing
/// settings files retain their previous behavior after an upgrade.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BuiltinModulesSettings {
    #[serde(default)]
    pub modules: BTreeMap<String, bool>,
}

impl BuiltinModulesSettings {
    pub fn is_enabled(&self, id: &str) -> bool {
        self.modules.get(id).copied().unwrap_or(true)
    }
}

impl Default for BuiltinModulesSettings {
    fn default() -> Self {
        // V2EX / Weather ship as marketplace plugins; built-in panels stay
        // available but off by default so the external plugin is the primary UX.
        let modules = [
            ("screencap", true),
            ("v2ex", false),
            ("weather", false),
            ("macros", true),
        ]
        .into_iter()
        .map(|(id, on)| (id.to_string(), on))
        .collect();
        Self { modules }
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
    /// Spotlight-style pin: float app to the top of the empty launcher.
    #[serde(default)]
    pub pinned: bool,
    /// Lower values rank first among pinned apps.
    #[serde(default)]
    pub pin_order: u64,
    /// Omit from empty home Suggestions; still searchable so the user can unhide.
    #[serde(default)]
    pub hidden: bool,
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
    pub file_search: FileSearchSettings,
    #[serde(default)]
    pub screencap: ScreencapSettings,
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
    #[serde(default)]
    pub module_search: ModuleSearchSettings,
    #[serde(default)]
    pub builtin_modules: BuiltinModulesSettings,
    #[serde(default = "default_quick_entries")]
    pub quick_entries: Vec<QuickEntryConfig>,
    #[serde(default = "default_tray_actions")]
    pub tray_actions: Vec<TrayActionConfig>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            general: GeneralSettings::default(),
            appearance: AppearanceSettings::default(),
            shortcuts: shortcuts::default_shortcut_bindings(),
            app_shortcuts: BTreeMap::new(),
            plugins: Vec::new(),
            plugin_display: PluginDisplaySettings::default(),
            file_search: FileSearchSettings::default(),
            screencap: ScreencapSettings::default(),
            advanced: AdvancedSettings::default(),
            agent: AgentSettings::default(),
            rss: RssSettings::default(),
            v2ex: V2exSettings::default(),
            weather: WeatherSettings::default(),
            search_metadata: BTreeMap::new(),
            module_search: ModuleSearchSettings::default(),
            builtin_modules: BuiltinModulesSettings::default(),
            quick_entries: default_quick_entries(),
            tray_actions: default_tray_actions(),
        }
    }
}

fn settings_path() -> PathBuf {
    let dir = crate::paths::state_dir();
    let _ = fs::create_dir_all(&dir);
    dir.join("settings.json")
}

pub(crate) fn read_settings() -> Settings {
    let path = settings_path();
    let mut settings = match fs::read_to_string(&path) {
        Ok(content) => {
            let mut value: serde_json::Value =
                serde_json::from_str(&content).unwrap_or(serde_json::Value::Null);
            // Soft-migrate onboarding flag: installs that already showed the launcher
            // before this field existed must not re-open the permission wizard.
            if let Some(general) = value.get_mut("general").and_then(|g| g.as_object_mut()) {
                if !general.contains_key("has_completed_onboarding") {
                    let shown = general
                        .get("has_shown_launcher")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    general.insert(
                        "has_completed_onboarding".into(),
                        serde_json::Value::Bool(shown),
                    );
                }
            }
            serde_json::from_value(value).unwrap_or_default()
        }
        Err(_) => Settings::default(),
    };
    shortcuts::merge_missing_default_shortcuts(&mut settings);
    shortcuts::migrate_swapped_window_launcher_defaults(&mut settings);
    shortcuts::migrate_windows_factory_host_shortcuts(&mut settings);
    migrate_legacy_default_quick_entries(&mut settings.quick_entries);
    if settings.agent.default_provider.is_empty() || settings.agent.default_provider == "duckduckgo"
    {
        settings.agent.default_provider = "openrouter".to_string();
        settings.agent.default_model = "openrouter/auto".to_string();
    }
    settings
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

/// Focused persistence port for the standalone capture-controls webview.
/// It cannot depend on the main React settings store being mounted or visible.
pub(crate) fn set_screencap_controls_pinned(pinned: bool) -> Result<(), String> {
    let _guard = SETTINGS_WRITE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut settings = read_settings();
    if settings.screencap.controls_pinned == pinned {
        return Ok(());
    }
    settings.screencap.controls_pinned = pinned;
    let path = settings_path();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| format!("serialize: {e}"))?;
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
            || old.app_shortcuts != settings_for_io.app_shortcuts
            || old.builtin_modules != settings_for_io.builtin_modules;
        let tray_changed = old.quick_entries != settings_for_io.quick_entries
            || old.tray_actions != settings_for_io.tray_actions
            || old.general.auto_hide_on_blur != settings_for_io.general.auto_hide_on_blur;
        write_settings(&settings_for_io)?;
        Ok((shortcuts_changed, tray_changed))
    })
    .await?;

    if shortcuts_changed && !global_shortcuts_are_paused() {
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

#[cfg(test)]
mod tests;
