use super::{
    default_toggle_launcher_shortcut, default_toggle_window_shortcut, portable_shortcut_key,
    AdvancedSettings, AgentSettings, BuiltinModulesSettings, Settings,
};

#[test]
fn legacy_advanced_settings_keep_diagnostic_logging_disabled() {
    let advanced: AdvancedSettings =
        serde_json::from_str(r#"{"log_level":"debug","dev_mode":false}"#)
            .expect("legacy advanced settings");
    assert!(!advanced.logging_enabled);
    assert_eq!(advanced.log_level, "debug");
}

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
fn default_global_shortcuts_only_enable_window_toggle() {
    let settings = Settings::default();
    let enabled = settings
        .shortcuts
        .iter()
        .filter_map(|(id, binding)| binding.enabled.then_some(id.as_str()))
        .collect::<Vec<_>>();
    assert_eq!(enabled, vec!["toggle_window"]);
    assert_eq!(
        settings.shortcuts.get("toggle_launcher"),
        Some(&super::ShortcutBinding {
            key: default_toggle_launcher_shortcut().to_string(),
            enabled: false,
        })
    );
    assert_eq!(
        settings.shortcuts.get("toggle_window"),
        Some(&super::ShortcutBinding {
            key: default_toggle_window_shortcut().to_string(),
            enabled: true,
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
            key: default_toggle_window_shortcut().to_string(),
            enabled: true,
        })
    );
}

#[test]
fn migrates_pre_swap_window_launcher_factory_defaults() {
    let mut settings = Settings::default();
    settings.shortcuts.insert(
        "toggle_launcher".to_string(),
        super::ShortcutBinding {
            key: "Alt+Space".to_string(),
            enabled: true,
        },
    );
    settings.shortcuts.insert(
        "toggle_window".to_string(),
        super::ShortcutBinding {
            key: "Alt+Shift+Space".to_string(),
            enabled: false,
        },
    );

    super::migrate_swapped_window_launcher_defaults(&mut settings);

    assert_eq!(
        settings.shortcuts.get("toggle_window"),
        Some(&super::ShortcutBinding {
            key: default_toggle_window_shortcut().to_string(),
            enabled: true,
        })
    );
    assert_eq!(
        settings.shortcuts.get("toggle_launcher"),
        Some(&super::ShortcutBinding {
            key: default_toggle_launcher_shortcut().to_string(),
            enabled: false,
        })
    );
}

#[test]
fn does_not_migrate_customized_window_launcher_shortcuts() {
    let mut settings = Settings::default();
    settings.shortcuts.insert(
        "toggle_launcher".to_string(),
        super::ShortcutBinding {
            key: "Alt+L".to_string(),
            enabled: true,
        },
    );
    settings.shortcuts.insert(
        "toggle_window".to_string(),
        super::ShortcutBinding {
            key: "Alt+Shift+Space".to_string(),
            enabled: false,
        },
    );

    super::migrate_swapped_window_launcher_defaults(&mut settings);

    assert_eq!(settings.shortcuts["toggle_launcher"].key, "Alt+L");
}

#[cfg(target_os = "windows")]
#[test]
fn migrates_untouched_windows_alt_space_factory_bindings() {
    let mut settings = Settings::default();
    settings.shortcuts.insert(
        "toggle_launcher".to_string(),
        super::ShortcutBinding {
            key: "Alt+Shift+Space".to_string(),
            enabled: false,
        },
    );
    settings.shortcuts.insert(
        "toggle_window".to_string(),
        super::ShortcutBinding {
            key: "Alt+Space".to_string(),
            enabled: true,
        },
    );

    super::migrate_windows_factory_host_shortcuts(&mut settings);

    assert_eq!(
        settings.shortcuts["toggle_launcher"].key,
        "Ctrl+Alt+Shift+Space"
    );
    assert_eq!(settings.shortcuts["toggle_window"].key, "Ctrl+Alt+Space");
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
    // Empty {} uses Default for builtin_modules.
    let defaults = BuiltinModulesSettings::default();
    assert!(defaults.is_enabled("screencap"));
    assert!(defaults.is_enabled("macros"));
    // Marketplace-first: V2EX + Weather built-ins off by default.
    assert!(!defaults.is_enabled("v2ex"));
    assert!(!defaults.is_enabled("weather"));
    // Explicit opt-in still works.
    settings
        .builtin_modules
        .modules
        .insert("weather".to_string(), true);
    assert!(settings.builtin_modules.is_enabled("weather"));
}
