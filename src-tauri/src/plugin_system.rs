//! Stable system capabilities exposed to plugins.
//!
//! OS-specific path opening and wallpaper mutation stay below this port so
//! business plugins do not duplicate PowerShell, AppleScript, or Win32 details.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSystemEnv {
    pub platform: String,
    pub arch: String,
    pub home_dir: String,
    pub temp_dir: String,
    /// Backward-compatible alias for `path_list_sep`.
    pub path_sep: String,
    /// Separator between entries in PATH-like environment variables.
    pub path_list_sep: String,
    /// Native directory separator for display/building platform paths.
    pub dir_sep: String,
    pub exe_path: Option<String>,
}

#[cfg(target_os = "macos")]
fn plugin_platform() -> &'static str {
    "macos"
}

#[cfg(target_os = "windows")]
fn plugin_platform() -> &'static str {
    "windows"
}

#[cfg(target_os = "linux")]
fn plugin_platform() -> &'static str {
    "linux"
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn plugin_platform() -> &'static str {
    "unknown"
}

#[cfg(windows)]
const PATH_LIST_SEPARATOR: &str = ";";
#[cfg(not(windows))]
const PATH_LIST_SEPARATOR: &str = ":";

#[cfg(windows)]
const DIRECTORY_SEPARATOR: &str = "\\";
#[cfg(not(windows))]
const DIRECTORY_SEPARATOR: &str = "/";

#[tauri::command]
pub fn plugin_system_env() -> PluginSystemEnv {
    PluginSystemEnv {
        platform: plugin_platform().to_string(),
        arch: std::env::consts::ARCH.to_string(),
        home_dir: crate::paths::home_dir().display().to_string(),
        temp_dir: std::env::temp_dir().display().to_string(),
        path_sep: PATH_LIST_SEPARATOR.to_string(),
        path_list_sep: PATH_LIST_SEPARATOR.to_string(),
        dir_sep: DIRECTORY_SEPARATOR.to_string(),
        exe_path: std::env::current_exe()
            .ok()
            .map(|path| path.display().to_string()),
    }
}

fn validate_user_path(path: &str) -> Result<PathBuf, String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("path is empty".to_string());
    }
    if raw.contains('\0') {
        return Err("path must not contain NUL".to_string());
    }
    if raw == "~" {
        return Ok(crate::paths::home_dir());
    }
    if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        let relative = rest
            .split(['/', '\\'])
            .filter(|component| !component.is_empty())
            .fold(PathBuf::new(), |path, component| path.join(component));
        return Ok(crate::paths::home_dir().join(relative));
    }
    Ok(PathBuf::from(raw))
}

fn validate_wallpaper_path(plugin_id: &str, path: &str) -> Result<PathBuf, String> {
    let path = crate::plugin_api::plugin_file_path(plugin_id, path)?;
    if !path.is_absolute() {
        return Err("wallpaper path must be absolute".to_string());
    }
    if !path.is_file() {
        return Err(format!("wallpaper file does not exist: {}", path.display()));
    }
    Ok(path)
}

fn validate_wallpaper_scope(scope: Option<&str>) -> Result<&str, String> {
    match scope.unwrap_or("every") {
        "current" => Ok("current"),
        "every" => Ok("every"),
        value => Err(format!("unsupported wallpaper scope: {value}")),
    }
}

#[cfg(target_os = "windows")]
fn shell_execute_windows(target: &std::ffi::OsStr, operation_name: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let operation = "open\0".encode_utf16().collect::<Vec<_>>();
    let target = target
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize > 32 {
        Ok(())
    } else {
        Err(format!(
            "{operation_name} with Windows ShellExecuteW failed (code {})",
            result as isize
        ))
    }
}

#[cfg(target_os = "windows")]
fn open_path_windows(path: &Path) -> Result<(), String> {
    shell_execute_windows(path.as_os_str(), "open path")
}

#[tauri::command]
pub async fn plugin_system_open_path(path: String) -> Result<(), String> {
    let path = validate_user_path(&path)?;
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let display = path.display().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            check_status(Command::new("open").arg(&path).status(), "open", &display)
        }
        #[cfg(target_os = "windows")]
        {
            open_path_windows(&path)
        }
        #[cfg(target_os = "linux")]
        {
            check_status(
                Command::new("xdg-open").arg(&path).status(),
                "open",
                &display,
            )
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = path;
            Err("openPath is not supported on this platform".to_string())
        }
    })
    .await
    .map_err(|e| format!("open path task failed: {e}"))?
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn check_status(
    status: std::io::Result<std::process::ExitStatus>,
    operation: &str,
    display: &str,
) -> Result<(), String> {
    let status = status.map_err(|e| format!("{operation} {display}: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{operation} {display} failed with {status}"))
    }
}

#[tauri::command]
pub async fn plugin_system_reveal_path(path: String) -> Result<(), String> {
    let path = validate_user_path(&path)?;
    #[cfg(not(target_os = "windows"))]
    let display = path.display().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            check_status(
                Command::new("open").args(["-R", &display]).status(),
                "reveal",
                &display,
            )
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::ffi::{OsStrExt, OsStringExt};
            use std::os::windows::process::CommandExt;
            use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

            // Build Explorer's `/select,PATH` argument as native UTF-16. Going
            // through Path::display() would replace unpaired UTF-16 code units
            // and make revealPath less faithful than openPath's ShellExecuteW.
            let mut argument = "/select,".encode_utf16().collect::<Vec<_>>();
            argument.extend(path.as_os_str().encode_wide());
            let mut command = Command::new(crate::windows_process::explorer_binary());
            command
                .arg(std::ffi::OsString::from_wide(&argument))
                .creation_flags(CREATE_NO_WINDOW);
            command
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("reveal {}: {e}", path.display()))
        }
        #[cfg(target_os = "linux")]
        {
            let parent = path.parent().unwrap_or(path.as_path());
            check_status(
                Command::new("xdg-open").arg(parent).status(),
                "reveal",
                &display,
            )
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
        {
            let _ = path;
            Err("revealPath is not supported on this platform".to_string())
        }
    })
    .await
    .map_err(|e| format!("reveal path task failed: {e}"))?
}

fn validate_settings_section(section: &str) -> Result<&str, String> {
    match section.trim() {
        "about" | "display" | "storage" | "network" | "power" | "privacy" | "apps" => {
            Ok(section.trim())
        }
        _ => Err(
            "settings section must be about, display, storage, network, power, privacy, or apps"
                .to_string(),
        ),
    }
}

/// Open one stable semantic settings destination. Plugins do not need to know
/// `ms-settings:` identifiers or version-specific macOS preference URLs.
#[tauri::command]
pub async fn plugin_system_open_settings(section: String) -> Result<(), String> {
    let section = validate_settings_section(&section)?.to_string();
    crate::floating_panel::set_external_interaction_active(true);
    let result = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            let url = match section.as_str() {
                "about" => "x-apple.systempreferences:com.apple.SystemProfiler.AboutExtension",
                "display" => "x-apple.systempreferences:com.apple.Displays-Settings.extension",
                "storage" => "x-apple.systempreferences:com.apple.settings.Storage",
                "network" => "x-apple.systempreferences:com.apple.Network-Settings.extension",
                "power" => "x-apple.systempreferences:com.apple.Battery-Settings.extension",
                "privacy" => {
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
                }
                "apps" => "x-apple.systempreferences:com.apple.LoginItems-Settings.extension",
                _ => unreachable!("validated settings section"),
            };
            Command::new("open")
                .arg(url)
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("open macOS settings: {error}"))
        }
        #[cfg(target_os = "windows")]
        {
            let uri = match section.as_str() {
                "about" => "ms-settings:about",
                "display" => "ms-settings:display",
                "storage" => "ms-settings:storagesense",
                "network" => "ms-settings:network-status",
                "power" => "ms-settings:powersleep",
                "privacy" => "ms-settings:privacy",
                "apps" => "ms-settings:appsfeatures",
                _ => unreachable!("validated settings section"),
            };
            shell_execute_windows(std::ffi::OsStr::new(uri), "open Windows settings")
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = section;
            Err("openSettings is only supported on macOS and Windows".to_string())
        }
    })
    .await
    .map_err(|error| format!("open settings task failed: {error}"))
    .and_then(|result| result);
    if result.is_err() {
        crate::floating_panel::set_external_interaction_active(false);
    }
    result
}

#[cfg(target_os = "macos")]
fn set_wallpaper_platform(path: &Path, scope: &str) -> Result<(), String> {
    let target = if scope == "current" {
        "set picture of current desktop to (p as text)"
    } else {
        "repeat with d in every desktop\ntry\nset picture of d to (p as text)\nend try\nend repeat"
    };
    let script = format!(
        "on run argv\nset p to POSIX file (item 1 of argv)\ntell application \"System Events\"\n{target}\nend tell\nreturn \"ok\"\nend run"
    );
    let output = Command::new("osascript")
        .args(["-e", &script, "--"])
        .arg(path)
        .output()
        .map_err(|e| format!("start wallpaper automation: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(target_os = "windows")]
fn set_wallpaper_platform(path: &Path, _scope: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_SETDESKWALLPAPER,
    };

    let mut wide = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let changed = unsafe {
        SystemParametersInfoW(
            SPI_SETDESKWALLPAPER,
            0,
            wide.as_mut_ptr().cast(),
            SPIF_UPDATEINIFILE | SPIF_SENDCHANGE,
        )
    };
    if changed == 0 {
        Err(format!(
            "set Windows wallpaper: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn set_wallpaper_platform(_path: &Path, _scope: &str) -> Result<(), String> {
    Err("setWallpaper is not supported on this platform".to_string())
}

#[tauri::command]
pub async fn plugin_system_set_wallpaper(
    plugin_id: String,
    path: String,
    scope: Option<String>,
) -> Result<(), String> {
    let path = validate_wallpaper_path(&plugin_id, &path)?;
    let scope = validate_wallpaper_scope(scope.as_deref())?.to_string();
    tauri::async_runtime::spawn_blocking(move || set_wallpaper_platform(&path, &scope))
        .await
        .map_err(|e| format!("set wallpaper task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        plugin_system_env, validate_settings_section, validate_user_path, validate_wallpaper_scope,
    };

    #[test]
    fn system_env_distinguishes_directory_and_path_list_separators() {
        let env = plugin_system_env();
        assert_eq!(env.path_sep, env.path_list_sep);
        #[cfg(windows)]
        {
            assert_eq!(env.platform, "windows");
            assert_eq!(env.path_list_sep, ";");
            assert_eq!(env.dir_sep, "\\");
        }
        #[cfg(not(windows))]
        {
            assert_eq!(env.path_list_sep, ":");
            assert_eq!(env.dir_sep, "/");
        }
    }

    #[test]
    fn wallpaper_scope_is_narrow_and_stable() {
        assert_eq!(validate_wallpaper_scope(None), Ok("every"));
        assert_eq!(validate_wallpaper_scope(Some("current")), Ok("current"));
        assert!(validate_wallpaper_scope(Some("all-displays")).is_err());
    }

    #[test]
    fn settings_sections_are_semantic_and_bounded() {
        for section in [
            "about", "display", "storage", "network", "power", "privacy", "apps",
        ] {
            assert_eq!(validate_settings_section(section), Ok(section));
        }
        assert!(validate_settings_section("shell:payload").is_err());
    }

    #[test]
    fn system_paths_reject_empty_and_nul() {
        assert!(validate_user_path(" ").is_err());
        assert!(validate_user_path("bad\0path").is_err());
    }

    #[test]
    fn home_paths_accept_both_desktop_separators_at_every_level() {
        let path = validate_user_path(r"~\Pictures/Qx\capture.png").expect("home path");
        let relative = path
            .strip_prefix(crate::paths::home_dir())
            .expect("path remains under home");
        assert_eq!(
            relative,
            std::path::Path::new("Pictures")
                .join("Qx")
                .join("capture.png")
        );
    }
}
