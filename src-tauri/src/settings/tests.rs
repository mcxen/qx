use super::{portable_shortcut_key, AgentSettings, BuiltinModulesSettings, Settings};

#[test]
fn canonicalizes_primary_modifier_for_both_desktop_platforms() {
    assert_eq!(portable_shortcut_key("Cmd+K"), "CmdOrCtrl+K");
    assert_eq!(
        portable_shortcut_key("Primary + Shift + P"),
        "CmdOrCtrl+Shift+P"
    );
    assert_eq!(portable_shortcut_key("Super+K"), "Super+K");
    assert_eq!(portable_shortcut_key("Ctrl+K"), "Ctrl+K");
}

#[test]
fn default_global_shortcuts_only_enable_launcher_recall() {
    let settings = Settings::default();
    let enabled = settings
        .shortcuts
        .iter()
        .filter_map(|(id, binding)| binding.enabled.then_some(id.as_str()))
        .collect::<Vec<_>>();
    assert_eq!(enabled, vec!["toggle_launcher"]);
    assert_eq!(
        settings.shortcuts.get("toggle_window"),
        Some(&super::ShortcutBinding {
            key: "Alt+Shift+Space".to_string(),
            enabled: false,
        })
    );
}

#[test]
fn legacy_settings_gain_new_shortcuts_without_overwriting_user_bindings() {
    let mut settings = Settings::default();
    settings.shortcuts.remove("toggle_window");
    settings.shortcuts.insert(
        "toggle_launcher".to_string(),
        super::ShortcutBinding {
            key: "Alt+L".to_string(),
            enabled: true,
        },
    );

    super::merge_missing_default_shortcuts(&mut settings);

    assert_eq!(settings.shortcuts["toggle_launcher"].key, "Alt+L");
    assert_eq!(
        settings.shortcuts.get("toggle_window"),
        Some(&super::ShortcutBinding {
            key: "Alt+Shift+Space".to_string(),
            enabled: false,
        })
    );
}

#[test]
fn default_agent_uses_openrouter_auto() {
    let agent = AgentSettings::default();
    assert_eq!(agent.default_provider, "openrouter");
    assert_eq!(agent.default_model, "openrouter/auto");
}

#[test]
fn default_quick_entries_stay_focused_on_core_navigation() {
    let targets = super::default_quick_entries()
        .into_iter()
        .map(|entry| entry.target)
        .collect::<Vec<_>>();
    assert_eq!(targets, ["clipboard", "rss", "settings", "file-search"]);
    assert_ne!(
        super::entry_config::legacy_default_quick_entries(),
        super::default_quick_entries()
    );
}

#[test]
fn quick_entry_migration_preserves_user_customization() {
    let mut legacy = super::entry_config::legacy_default_quick_entries();
    super::entry_config::migrate_legacy_default_quick_entries(&mut legacy);
    assert_eq!(legacy, super::default_quick_entries());

    let mut customized = super::entry_config::legacy_default_quick_entries();
    customized.reverse();
    let expected = customized.clone();
    super::entry_config::migrate_legacy_default_quick_entries(&mut customized);
    assert_eq!(customized, expected);
}

#[test]
fn beta_modules_default_and_legacy_keys() {
    let mut settings: Settings = serde_json::from_str("{}").expect("legacy settings");
    // Missing keys stay enabled (legacy upgrade safety).
    assert!(settings.builtin_modules.is_enabled("screencap"));
    assert!(settings.builtin_modules.is_enabled("weather"));
    assert!(settings.builtin_modules.is_enabled("macros"));
    // Empty {} uses Default for builtin_modules → v2ex off (marketplace plugin).
    let defaults = BuiltinModulesSettings::default();
    assert!(!defaults.is_enabled("v2ex"));
    assert!(defaults.is_enabled("weather"));
    settings
        .builtin_modules
        .modules
        .insert("weather".to_string(), false);
    assert!(!settings.builtin_modules.is_enabled("weather"));
}
