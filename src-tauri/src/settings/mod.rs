use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use tauri::{command, AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralSettings {
    pub launch_at_login: bool,
    pub language: String,
    pub auto_update: bool,
    pub data_path: String,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        Self {
            launch_at_login: false,
            language: "en".to_string(),
            auto_update: true,
            data_path: format!("{}/Library/Application Support/qx", home),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettings {
    pub theme: String,
    pub blur_opacity: f64,
    pub window_width: u32,
    pub window_height: u32,
    pub border_radius: u32,
    pub font_size: u32,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: "light".to_string(),
            blur_opacity: 0.85,
            window_width: 680,
            window_height: 500,
            border_radius: 12,
            font_size: 14,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutBinding {
    pub key: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdvancedSettings {
    pub log_level: String,
    pub dev_mode: bool,
}

impl Default for AdvancedSettings {
    fn default() -> Self {
        Self {
            log_level: "info".to_string(),
            dev_mode: false,
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
pub struct Settings {
    #[serde(default)]
    pub general: GeneralSettings,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub shortcuts: BTreeMap<String, ShortcutBinding>,
    #[serde(default)]
    pub plugins: Vec<PluginConfig>,
    #[serde(default)]
    pub advanced: AdvancedSettings,
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
            "screenshot".to_string(),
            ShortcutBinding {
                key: "Alt+S".to_string(),
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
        shortcuts.insert(
            "settings".to_string(),
            ShortcutBinding {
                key: "Cmd+,".to_string(),
                enabled: true,
            },
        );

        Self {
            general: GeneralSettings::default(),
            appearance: AppearanceSettings::default(),
            shortcuts,
            plugins: Vec::new(),
            advanced: AdvancedSettings::default(),
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

fn write_settings(settings: &Settings) -> Result<(), String> {
    let path = settings_path();
    let json = serde_json::to_string_pretty(settings).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))
}

#[command]
pub fn get_settings() -> Settings {
    read_settings()
}

#[command]
pub fn update_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    write_settings(&settings)?;
    register_shortcuts(&app, &settings)?;
    Ok(settings)
}

#[command]
pub fn reset_settings() -> Result<Settings, String> {
    let default = Settings::default();
    write_settings(&default)?;
    Ok(default)
}

#[command]
pub fn import_settings(path: String) -> Result<Settings, String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path))?;
    let settings: Settings = serde_json::from_str(&content).map_err(|e| format!("parse: {e}"))?;
    write_settings(&settings)?;
    Ok(settings)
}

#[command]
pub fn export_settings(path: String) -> Result<(), String> {
    let settings = read_settings();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write {}: {e}", path))
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

fn show_and_navigate(app: &AppHandle, route: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("navigate", route);
    }
}

pub(crate) fn register_shortcuts(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    if let Some(key) = shortcut_for(settings, "toggle_launcher") {
        gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
        })
        .map_err(|e| format!("register toggle_launcher shortcut: {e}"))?;
    }

    if let Some(key) = shortcut_for(settings, "clipboard") {
        gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                show_and_navigate(app, "clipboard");
            }
        })
        .map_err(|e| format!("register clipboard shortcut: {e}"))?;
    }

    if let Some(key) = shortcut_for(settings, "screenshot") {
        gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                show_and_navigate(app, "screenshot");
            }
        })
        .map_err(|e| format!("register screenshot shortcut: {e}"))?;
    }

    if let Some(key) = shortcut_for(settings, "rss") {
        gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                show_and_navigate(app, "rss");
            }
        })
        .map_err(|e| format!("register rss shortcut: {e}"))?;
    }

    if let Some(key) = shortcut_for(settings, "record_gif") {
        gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                show_and_navigate(app, "screencap");
            }
        })
        .map_err(|e| format!("register record_gif shortcut: {e}"))?;
    }

    if let Some(key) = shortcut_for(settings, "settings") {
        gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                show_and_navigate(app, "settings");
            }
        })
        .map_err(|e| format!("register settings shortcut: {e}"))?;
    }

    Ok(())
}
