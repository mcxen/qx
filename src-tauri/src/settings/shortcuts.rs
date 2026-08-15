use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use tauri::{command, AppHandle};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use super::macos_shortcut_override::{self, CmdSpaceHandler};
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
        ("capture_screenshot", "Ctrl+G", true),
        ("recapture_last_region", "Alt+Shift+R", false),
        ("toggle_capture_controls", "Alt+Shift+C", false),
        ("rss", "Alt+R", false),
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

pub(super) fn migrate_capture_shortcut_default(settings: &mut Settings) {
    let Some(binding) = settings.shortcuts.get_mut("capture_screenshot") else {
        return;
    };
    if binding.key == "Alt+Shift+S" && !binding.enabled {
        binding.key = "Ctrl+G".to_string();
        binding.enabled = true;
    }
}

pub(super) fn remove_legacy_tray_shortcuts(settings: &mut Settings) {
    settings.shortcuts.retain(|id, _| !id.starts_with("tray_"));
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
        if let Err(error) = crate::screencap::screencap_begin_capture_select(
            app,
            mode.to_string(),
            Some(mode == "screenshot"),
        )
        .await
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

fn recapture_last_region_from_shortcut(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = crate::screencap::selection::screencap_recapture_last_region(app).await
        {
            crate::diagnostics::log(
                crate::diagnostics::LogLevel::Warn,
                "screencap.shortcut",
                "recapture last region failed",
                serde_json::json!({ "error": error }),
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

#[cfg(target_os = "macos")]
fn is_macos_cmd_space(key: &str) -> bool {
    portable_shortcut_key(key).eq_ignore_ascii_case("CmdOrCtrl+Space")
}

#[cfg(not(target_os = "macos"))]
fn is_macos_cmd_space(_key: &str) -> bool {
    false
}

/// Register through Qx's one global-shortcut port. Cmd+Space is a macOS
/// system chord, so it uses the narrow native override adapter instead of
/// competing with Spotlight through RegisterEventHotKey.
fn register_shortcut<F>(app: &AppHandle, key: &str, callback: F) -> Result<(), String>
where
    F: Fn(AppHandle) + Send + Sync + 'static,
{
    if is_macos_cmd_space(key) {
        let app = app.clone();
        let handler: CmdSpaceHandler = Arc::new(move || callback(app.clone()));
        return macos_shortcut_override::set_handler(Some(handler));
    }

    let callback = Arc::new(callback);
    app.global_shortcut()
        .on_shortcut(key, move |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                callback(app.clone());
            }
        })
        .map_err(|error| error.to_string())
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
        let _ = macos_shortcut_override::set_handler(None);
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
    macos_shortcut_override::set_handler(None)?;
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
            register_shortcut(app, key.as_str(), move |app| {
                crate::floating_panel::toggle_launcher(&app);
            })
        ) {
            registered.insert(key);
        }
    }

    if let Some(key) = shortcut_for(settings, "toggle_window") {
        if collect_registration!(
            "register toggle_window shortcut",
            register_shortcut(app, key.as_str(), move |app| {
                crate::floating_panel::toggle(&app);
            })
        ) {
            registered.insert(key);
        }
    }

    // Feature chords: open module, or dismiss if already showing that module.
    if let Some(key) = shortcut_for(settings, "clipboard") {
        if collect_registration!(
            "register clipboard shortcut",
            register_shortcut(app, key.as_str(), move |app| {
                toggle_route(&app, "clipboard");
            })
        ) {
            registered.insert(key);
        }
    }

    if let Some(key) = shortcut_for(settings, "rss") {
        if collect_registration!(
            "register rss shortcut",
            register_shortcut(app, key.as_str(), move |app| {
                toggle_route(&app, "rss");
            })
        ) {
            registered.insert(key);
        }
    }

    if settings.builtin_modules.is_enabled("screencap") {
        if let Some(key) = shortcut_for(settings, "capture_screenshot") {
            if collect_registration!(
                "register capture_screenshot shortcut",
                register_shortcut(app, key.as_str(), move |app| {
                    begin_capture_from_shortcut(app, "screenshot");
                })
            ) {
                registered.insert(key);
            }
        }
        if let Some(key) = shortcut_for(settings, "recapture_last_region") {
            if collect_registration!(
                "register recapture_last_region shortcut",
                register_shortcut(app, key.as_str(), move |app| {
                    recapture_last_region_from_shortcut(app);
                })
            ) {
                registered.insert(key);
            }
        }
        if let Some(key) = shortcut_for(settings, "record_gif") {
            if collect_registration!(
                "register record_gif shortcut",
                register_shortcut(app, key.as_str(), move |app| {
                    begin_capture_from_shortcut(app, "recording");
                })
            ) {
                registered.insert(key);
            }
        }
        if let Some(key) = shortcut_for(settings, "toggle_capture_controls") {
            if collect_registration!(
                "register toggle_capture_controls shortcut",
                register_shortcut(app, key.as_str(), move |app| {
                    let _ = crate::screencap::screencap_toggle_controls(app);
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
            register_shortcut(app, key.as_str(), move |_app| {
                let _ = crate::launch_app_path(&app_path);
            })
        );
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}
