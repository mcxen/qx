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
}

pub(super) fn default_quick_entries() -> Vec<QuickEntryConfig> {
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
    if *entries == legacy_default_quick_entries() {
        *entries = default_quick_entries();
    }
}

pub(super) fn default_tray_actions() -> Vec<TrayActionConfig> {
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
    })
    .collect()
}

fn quick_entry((id, title, subtitle): (&str, &str, &str)) -> QuickEntryConfig {
    QuickEntryConfig {
        id: id.to_string(),
        title: title.to_string(),
        subtitle: subtitle.to_string(),
        target: id.to_string(),
        enabled: true,
    }
}
