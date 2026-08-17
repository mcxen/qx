use super::{
    default_toggle_launcher_shortcut, default_toggle_window_shortcut, portable_shortcut_key,
    AdvancedSettings, AgentSettings, BuiltinModulesSettings, ScreencapSettings, Settings,
};

#[test]
fn legacy_screencap_settings_keep_three_second_delay_and_gain_new_defaults() {
    let settings: ScreencapSettings = serde_json::from_str(
        r#"{
        "output_format":"mp4",
        "fps":24,
        "quality":"balanced",
        "resolution":"1080p",
        "capture_confirm_mode":"refine",
        "capture_delay_seconds":3,
        "auto_hide_after_capture":true,
        "auto_copy_to_clipboard":true,
        "history_layout":"gallery",
        "controls_pinned":false
    }"#,
    )
    .expect("legacy screencap settings");
    assert_eq!(settings.capture_delay_seconds, 3);
    assert!(settings.screenshot_sound_enabled);
    assert!(settings.show_floating_thumbnail);
    // New field defaults to true when absent from older settings files.
    assert!(settings.show_main_after_screenshot);
    assert_eq!(settings.screenshot_destination, "library");
    assert_eq!(settings.recording_open_after, "none");
}

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
fn default_global_shortcuts_enable_capture_file_actions_and_window_toggle() {
    let settings = Settings::default();
    let enabled = settings
        .shortcuts
        .iter()
        .filter_map(|(id, binding)| binding.enabled.then_some(id.as_str()))
        .collect::<Vec<_>>();
    assert_eq!(
        enabled,
        vec!["capture_screenshot", "open:file-actions", "toggle_window"]
    );
    assert_eq!(
        settings.shortcuts.get("open:file-actions"),
        Some(&super::ShortcutBinding {
            key: "Alt+F".to_string(),
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
    let mut agent = AgentSettings::default();
    assert_eq!(agent.default_provider, "openrouter");
    assert_eq!(agent.default_model, "openrouter/auto");
    assert!(agent.agent_mode_enabled);
    assert!(agent.tools_enabled);
    assert!(agent.model_tools_enabled);
    assert!(agent.memory_tool_enabled);
    assert_eq!(agent.memory_policy, "smart");
    assert!(agent.app_search_enabled);
    assert!(agent.file_search_enabled);
    assert!(agent.http_fetch_enabled);
    assert!(agent.notifications_enabled);
    assert!(agent.mcp_enabled);
    assert!(agent.bash_enabled);
    assert!(agent.grep_search_enabled);
    assert!(agent.background_tasks_enabled);
    assert!(agent.qx_host_actions_enabled);
    assert!(agent.qx_system_tools_enabled);
    assert!(agent.dangerous_tools_guard_enabled);
    assert!(!agent.solo_mode);
    assert_eq!(agent.defaults_version, 2);

    agent.bash_enabled = false;
    super::migrate_agent_defaults(&mut agent);
    assert!(
        !agent.bash_enabled,
        "completed migration must preserve later user choices"
    );
}

#[test]
fn legacy_agent_settings_enable_complete_tool_surface_once() {
    let mut agent: AgentSettings = serde_json::from_str(
        r#"{
            "agent_mode_enabled": false,
            "tools_enabled": false,
            "http_fetch_enabled": false,
            "mcp_enabled": false,
            "bash_enabled": false,
            "grep_search_enabled": false,
            "background_tasks_enabled": false
        }"#,
    )
    .expect("legacy agent settings");
    super::migrate_agent_defaults(&mut agent);
    assert!(agent.agent_mode_enabled);
    assert!(agent.tools_enabled);
    assert!(agent.model_tools_enabled);
    assert!(agent.http_fetch_enabled);
    assert!(agent.mcp_enabled);
    assert!(agent.bash_enabled);
    assert!(agent.grep_search_enabled);
    assert!(agent.background_tasks_enabled);
    assert!(agent.qx_host_actions_enabled);
    assert!(agent.qx_system_tools_enabled);
    assert_eq!(agent.defaults_version, 2);
}

#[test]
fn default_quick_entries_stay_focused_on_core_navigation() {
    let targets = super::default_quick_entries()
        .into_iter()
        .map(|entry| entry.target)
        .collect::<Vec<_>>();
    assert_eq!(
        targets,
        [
            "clipboard",
            "screencap",
            "documents",
            "settings:plugins",
            "settings"
        ]
    );
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

    let mut previous = super::entry_config::previous_default_quick_entries();
    super::entry_config::migrate_legacy_default_quick_entries(&mut previous);
    assert_eq!(previous, super::default_quick_entries());

    let mut short = super::entry_config::previous_short_default_quick_entries();
    super::entry_config::migrate_legacy_default_quick_entries(&mut short);
    assert_eq!(short, super::default_quick_entries());

    let mut customized = super::entry_config::legacy_default_quick_entries();
    customized.reverse();
    let expected = customized.clone();
    super::entry_config::migrate_legacy_default_quick_entries(&mut customized);
    assert_eq!(customized, expected);
}

#[test]
fn tray_defaults_store_only_visible_items() {
    let mut legacy = super::entry_config::legacy_default_tray_actions();
    super::entry_config::migrate_legacy_default_tray_actions(&mut legacy);
    assert_eq!(legacy, super::default_tray_actions());
    assert!(legacy.iter().all(|entry| entry.enabled));

    let mut customized = super::entry_config::legacy_default_tray_actions();
    customized.reverse();
    let expected = customized.clone();
    super::entry_config::migrate_legacy_default_tray_actions(&mut customized);
    assert_eq!(customized, expected);
}

#[test]
fn tray_actions_preserve_optional_module_and_command_dispatch() {
    let module: super::TrayActionConfig = serde_json::from_str(
        r#"{"id":"module:rss","title":"RSS","enabled":true,"kind":"module","target":"rss"}"#,
    )
    .expect("module tray action");
    assert_eq!(module.kind.as_deref(), Some("module"));
    assert_eq!(module.target.as_deref(), Some("rss"));

    let legacy: super::TrayActionConfig =
        serde_json::from_str(r#"{"id":"open_main","title":"Open Main Window","enabled":true}"#)
            .expect("legacy tray action");
    assert!(legacy.kind.is_none());
    assert!(legacy.command.is_none());
}

#[test]
fn shortcut_migration_moves_capture_to_module_default_and_removes_tray_keys() {
    let mut settings = Settings::default();
    settings.shortcuts.insert(
        "capture_screenshot".to_string(),
        super::ShortcutBinding {
            key: "Alt+Shift+S".to_string(),
            enabled: false,
        },
    );
    settings.shortcuts.insert(
        "tray_open_main".to_string(),
        super::ShortcutBinding {
            key: "Alt+Shift+O".to_string(),
            enabled: true,
        },
    );

    super::shortcuts::migrate_capture_shortcut_default(&mut settings);
    super::shortcuts::remove_legacy_tray_shortcuts(&mut settings);

    let capture = settings.shortcuts.get("capture_screenshot").unwrap();
    assert_eq!(capture.key, "Ctrl+G");
    assert!(capture.enabled);
    assert!(!settings.shortcuts.contains_key("tray_open_main"));
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
