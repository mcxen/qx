use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use tauri::{command, AppHandle};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::{read_settings, Settings, ShortcutBinding};

/// While ShortcutRecorder is open, OS global hotkeys must not fire.
static GLOBAL_SHORTCUTS_PAUSED: AtomicBool = AtomicBool::new(false);
static GLOBAL_SHORTCUTS_PAUSE_DEPTH: AtomicUsize = AtomicUsize::new(0);

pub(super) fn default_toggle_window_shortcut() -> &'static str {
    if cfg!(target_os = "windows") {
        // Alt+Space is the Windows system-menu chord and is also PowerToys
        // Run's factory default. Avoid making a common collision Qx's only
        // enabled path back to an initially hidden window.
        "Ctrl+Alt+Space"
    } else {
        "Alt+Space"
    }
}

pub(super) fn default_toggle_launcher_shortcut() -> &'static str {
    if cfg!(target_os = "windows") {
        "Ctrl+Alt+Shift+Space"
    } else {
        "Alt+Shift+Space"
    }
}

pub(super) fn default_shortcut_bindings() -> BTreeMap<String, ShortcutBinding> {
    let mut shortcuts = BTreeMap::new();
    // macOS keeps Option+Space. Windows uses Ctrl+Alt+Space because Alt+Space
    // belongs to the system menu and is commonly owned by PowerToys Run.
    for (id, key, enabled) in [
        ("toggle_launcher", default_toggle_launcher_shortcut(), false),
        ("toggle_window", default_toggle_window_shortcut(), true),
        ("clipboard", "Alt+V", false),
        ("record_gif", "Alt+G", false),
        ("capture_screenshot", "Alt+Shift+S", false),
        ("toggle_capture_controls", "Alt+Shift+C", false),
        ("rss", "Alt+R", false),
        ("tray_open_main", "Alt+Shift+O", false),
        ("tray_keep_visible", "Alt+Shift+K", false),
        ("tray_settings", "Alt+Shift+,", false),
        ("tray_hide_main", "Alt+Shift+H", false),
        ("tray_status_memory", "", false),
        ("tray_status_network", "", false),
        ("tray_status_cpu", "", false),
    ] {
        shortcuts.insert(
            id.to_string(),
            ShortcutBinding {
                key: key.to_string(),
                enabled,
            },
        );
    }
    shortcuts
}

pub(super) fn merge_missing_default_shortcuts(settings: &mut Settings) {
    for (id, binding) in Settings::default().shortcuts {
        settings.shortcuts.entry(id).or_insert(binding);
    }
}

/// One-time flip for installs that still have the pre-swap factory defaults:
/// launcher=`Alt+Space` on, window=`Alt+Shift+Space` off.
pub(super) fn migrate_swapped_window_launcher_defaults(settings: &mut Settings) {
    let Some(launcher) = settings.shortcuts.get("toggle_launcher").cloned() else {
        return;
    };
    let Some(window) = settings.shortcuts.get("toggle_window").cloned() else {
        return;
    };
    let launcher_is_old = launcher.key.eq_ignore_ascii_case("Alt+Space") && launcher.enabled;
    let window_is_old = window.key.eq_ignore_ascii_case("Alt+Shift+Space") && !window.enabled;
    if !(launcher_is_old && window_is_old) {
        return;
    }
    settings.shortcuts.insert(
        "toggle_launcher".to_string(),
        ShortcutBinding {
            key: default_toggle_launcher_shortcut().to_string(),
            enabled: false,
        },
    );
    settings.shortcuts.insert(
        "toggle_window".to_string(),
        ShortcutBinding {
            key: default_toggle_window_shortcut().to_string(),
            enabled: true,
        },
    );
}

/// Move untouched Windows factory bindings away from the system/PowerToys
/// Alt+Space chord. Customized shortcuts are never rewritten.
pub(super) fn migrate_windows_factory_host_shortcuts(settings: &mut Settings) {
    if !cfg!(target_os = "windows") {
        return;
    }
    let Some(launcher) = settings.shortcuts.get("toggle_launcher").cloned() else {
        return;
    };
    let Some(window) = settings.shortcuts.get("toggle_window").cloned() else {
        return;
    };
    let launcher_is_factory =
        launcher.key.eq_ignore_ascii_case("Alt+Shift+Space") && !launcher.enabled;
    let window_is_factory = window.key.eq_ignore_ascii_case("Alt+Space") && window.enabled;
    if !(launcher_is_factory && window_is_factory) {
        return;
    }
    settings.shortcuts.insert(
        "toggle_launcher".to_string(),
        ShortcutBinding {
            key: default_toggle_launcher_shortcut().to_string(),
            enabled: false,
        },
    );
    settings.shortcuts.insert(
        "toggle_window".to_string(),
        ShortcutBinding {
            key: default_toggle_window_shortcut().to_string(),
            enabled: true,
        },
    );
}

fn shortcut_for(settings: &Settings, id: &str) -> Option<String> {
    settings
        .shortcuts
        .get(id)
        .filter(|binding| binding.enabled && !binding.key.trim().is_empty())
        .map(|binding| portable_shortcut_key(binding.key.trim()))
}

fn begin_capture_from_shortcut(app: AppHandle, mode: &'static str) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) =
            crate::screencap::screencap_begin_capture_select(app, mode.to_string()).await
        {
            crate::diagnostics::log(
                crate::diagnostics::LogLevel::Error,
                "screencap.shortcut",
                "capture shortcut failed",
                serde_json::json!({ "mode": mode, "error": error }),
            );
        }
    });
}

fn enabled_shortcut_key(binding: &ShortcutBinding) -> Option<String> {
    if binding.enabled && !binding.key.trim().is_empty() {
        Some(portable_shortcut_key(binding.key.trim()))
    } else {
        None
    }
}

/// Canonical cross-platform modifier understood by Tauri's global-hotkey
/// parser. `CmdOrCtrl` becomes Super/Command on macOS and Control on Windows.
/// `Super` remains available when a user explicitly wants the Windows key.
pub(super) fn portable_shortcut_key(key: &str) -> String {
    key.split('+')
        .map(str::trim)
        .map(|token| match token.to_ascii_lowercase().as_str() {
            "cmd" | "command" | "meta" | "primary" | "mod" => "CmdOrCtrl".to_string(),
            _ => token.to_string(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

fn toggle_route(app: &AppHandle, route: &str) {
    crate::floating_panel::toggle_route(app, route);
}

pub(crate) fn global_shortcuts_are_paused() -> bool {
    GLOBAL_SHORTCUTS_PAUSED.load(Ordering::SeqCst)
}

/// Unregister all process-global shortcuts so the recorder can capture chords.
#[command]
pub fn shortcuts_pause_global(app: AppHandle) -> Result<(), String> {
    let depth = GLOBAL_SHORTCUTS_PAUSE_DEPTH.fetch_add(1, Ordering::SeqCst) + 1;
    GLOBAL_SHORTCUTS_PAUSED.store(true, Ordering::SeqCst);
    if depth == 1 {
        let _ = app.global_shortcut().unregister_all();
    }
    Ok(())
}

/// Re-register shortcuts from saved settings after the recorder closes.
#[command]
pub fn shortcuts_resume_global(app: AppHandle) -> Result<(), String> {
    let prev = GLOBAL_SHORTCUTS_PAUSE_DEPTH.load(Ordering::SeqCst);
    if prev == 0 {
        GLOBAL_SHORTCUTS_PAUSED.store(false, Ordering::SeqCst);
        return register_shortcuts(&app, &read_settings());
    }
    let depth = GLOBAL_SHORTCUTS_PAUSE_DEPTH.fetch_sub(1, Ordering::SeqCst) - 1;
    if depth == 0 {
        GLOBAL_SHORTCUTS_PAUSED.store(false, Ordering::SeqCst);
        register_shortcuts(&app, &read_settings())?;
    }
    Ok(())
}

pub(crate) fn register_shortcuts(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if global_shortcuts_are_paused() {
        // Settings are saved while recording; apply OS bindings on resume.
        return Ok(());
    }
    let mut registered = BTreeSet::new();
    let mut failures = Vec::new();

    macro_rules! collect_registration {
        ($context:expr, $registration:expr) => {
            match $registration {
                Ok(()) => true,
                Err(error) => {
                    failures.push(format!("{}: {error}", $context));
                    false
                }
            }
        };
    }

    // Default host chords are platform-specific; see Settings::default.
    if let Some(key) = shortcut_for(settings, "toggle_launcher") {
        if collect_registration!(
            "register toggle_launcher shortcut",
            gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    crate::floating_panel::toggle_launcher(app);
                }
            })
        ) {
            registered.insert(key);
        }
    }

    if let Some(key) = shortcut_for(settings, "toggle_window") {
        if collect_registration!(
            "register toggle_window shortcut",
            gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    crate::floating_panel::toggle(app);
                }
            })
        ) {
            registered.insert(key);
        }
    }

    // Feature chords: open module, or dismiss if already showing that module.
    if let Some(key) = shortcut_for(settings, "clipboard") {
        if collect_registration!(
            "register clipboard shortcut",
            gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    toggle_route(app, "clipboard");
                }
            })
        ) {
            registered.insert(key);
        }
    }

    if let Some(key) = shortcut_for(settings, "rss") {
        if collect_registration!(
            "register rss shortcut",
            gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    toggle_route(app, "rss");
                }
            })
        ) {
            registered.insert(key);
        }
    }

    for (shortcut_id, action_id) in [
        ("tray_open_main", "open_main"),
        ("tray_keep_visible", "keep_visible"),
        ("tray_settings", "settings"),
        ("tray_hide_main", "hide_main"),
        ("tray_status_memory", "status_memory"),
        ("tray_status_network", "status_network"),
        ("tray_status_cpu", "status_cpu"),
    ] {
        if let Some(key) = shortcut_for(settings, shortcut_id) {
            let action_id = action_id.to_string();
            if collect_registration!(
                format!("register {shortcut_id} shortcut"),
                gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        crate::tray_menu::handle_tray_action(app, &action_id);
                    }
                })
            ) {
                registered.insert(key);
            }
        }
    }

    if settings.builtin_modules.is_enabled("screencap") {
        if let Some(key) = shortcut_for(settings, "capture_screenshot") {
            if collect_registration!(
                "register capture_screenshot shortcut",
                gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        begin_capture_from_shortcut(app.clone(), "screenshot");
                    }
                })
            ) {
                registered.insert(key);
            }
        }
        if let Some(key) = shortcut_for(settings, "record_gif") {
            if collect_registration!(
                "register record_gif shortcut",
                gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        begin_capture_from_shortcut(app.clone(), "recording");
                    }
                })
            ) {
                registered.insert(key);
            }
        }
        if let Some(key) = shortcut_for(settings, "toggle_capture_controls") {
            if collect_registration!(
                "register toggle_capture_controls shortcut",
                gs.on_shortcut(key.as_str(), move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let _ = crate::screencap::screencap_toggle_controls(app.clone());
                    }
                })
            ) {
                registered.insert(key);
            }
        }
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
        collect_registration!(
            format!("register app shortcut {id}"),
            gs.on_shortcut(key.as_str(), move |_app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let _ = crate::launch_app_path(&app_path);
                }
            })
        );
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}
