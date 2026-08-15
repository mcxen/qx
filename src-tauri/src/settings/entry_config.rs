use serde::{Deserialize, Serialize};

use super::default_true;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuickEntryConfig {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub target: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrayActionConfig {
    pub id: String,
    pub title: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub plugin_id: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrayProviderConfig {
    /// Stable `<plugin-id>:<provider-id>` key from manifest.surfaceProviders.
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

pub(super) fn default_quick_entries() -> Vec<QuickEntryConfig> {
    [
        ("clipboard", "Clipboard History", "Pinned, frequent, links"),
        (
            "screencap",
            "Screenshot Module",
            "Screenshots and MP4/MOV recording",
        ),
        ("documents", "Text Tools", "Text, Markdown, JSON"),
        (
            "settings:plugins",
            "Extensions",
            "Install, update, and manage plugins",
        ),
        (
            "settings",
            "Qx Settings",
            "Appearance, shortcuts, and preferences",
        ),
    ]
    .into_iter()
    .map(quick_entry)
    .collect()
}

/// Defaults shipped before the Extensions quick entry (settings:plugins).
pub(super) fn previous_default_quick_entries() -> Vec<QuickEntryConfig> {
    [
        ("clipboard", "Clipboard History", "Pinned, frequent, links"),
        (
            "screencap",
            "Screenshot Module",
            "Screenshots and MP4/MOV recording",
        ),
        ("documents", "Text Tools", "Text, Markdown, JSON"),
        ("settings", "Qx Settings", "Appearance and plugins"),
    ]
    .into_iter()
    .map(quick_entry)
    .collect()
}

/// Older short defaults (pre-screencap/documents set).
pub(super) fn previous_short_default_quick_entries() -> Vec<QuickEntryConfig> {
    [
        ("clipboard", "Clipboard History", "Pinned, frequent, links"),
        ("rss", "RSS Reader", "Feeds and articles"),
        ("settings", "Settings", "Appearance and plugins"),
        (
            "file-search",
            "File Search",
            "Find recent files and folders",
        ),
    ]
    .into_iter()
    .map(quick_entry)
    .collect()
}

pub(super) fn legacy_default_quick_entries() -> Vec<QuickEntryConfig> {
    [
        ("clipboard", "Clipboard History", "Pinned, frequent, links"),
        ("qx-ai", "QxAI", "Chat and agent tasks"),
        ("rss", "RSS Reader", "Feeds and articles"),
        (
            "screencap",
            "Screen Capture",
            "Screenshots and MP4/MOV capture with optional GIF conversion",
        ),
        ("v2ex", "V2EX", "Latest and hot topics"),
        ("weather", "Weather", "Current conditions and forecast"),
        ("documents", "Documents", "Text, Markdown, JSON"),
        ("macros", "Macro Recorder", "Record and replay actions"),
        ("qx-tty", "QxTTY", "Persistent local terminal sessions"),
        ("settings", "Settings", "Appearance and plugins"),
    ]
    .into_iter()
    .map(quick_entry)
    .collect()
}

pub(super) fn migrate_legacy_default_quick_entries(entries: &mut Vec<QuickEntryConfig>) {
    // Only rewrite when the list still matches a known stock default so user
    // customizations (reorder / add / remove) are never clobbered.
    if *entries == legacy_default_quick_entries()
        || *entries == previous_default_quick_entries()
        || *entries == previous_short_default_quick_entries()
    {
        *entries = default_quick_entries();
    }
}

pub(super) fn default_tray_actions() -> Vec<TrayActionConfig> {
    [
        ("status_memory", "Memory", true),
        ("status_network", "Network", true),
        ("open_main", "Open Main Window", true),
        ("keep_visible", "Keep Window Visible", true),
        ("settings", "Settings", true),
    ]
    .into_iter()
    .map(|(id, title, enabled)| TrayActionConfig {
        id: id.to_string(),
        title: title.to_string(),
        enabled,
        kind: None,
        target: None,
        plugin_id: None,
        command: None,
    })
    .collect()
}

pub(super) fn legacy_default_tray_actions() -> Vec<TrayActionConfig> {
    [
        ("status_memory", "Memory", true),
        ("status_network", "Network", true),
        ("status_cpu", "CPU", false),
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
        kind: None,
        target: None,
        plugin_id: None,
        command: None,
    })
    .collect()
}

pub(super) fn migrate_legacy_default_tray_actions(entries: &mut Vec<TrayActionConfig>) {
    if *entries == legacy_default_tray_actions() {
        *entries = default_tray_actions();
    }
}

fn quick_entry((target, title, subtitle): (&str, &str, &str)) -> QuickEntryConfig {
    // Stable id without ':' so tray menu ids stay easy to parse.
    let id = target.replace(':', "-");
    QuickEntryConfig {
        id,
        title: title.to_string(),
        subtitle: subtitle.to_string(),
        target: target.to_string(),
        enabled: true,
    }
}
