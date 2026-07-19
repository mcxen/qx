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
    pub path_sep: String,
    pub exe_path: Option<String>,
}

#[tauri::command]
pub fn plugin_system_env() -> PluginSystemEnv {
    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
    .to_string();
    PluginSystemEnv {
        platform,
        arch: std::env::consts::ARCH.to_string(),
        home_dir: crate::paths::home_dir().display().to_string(),
        temp_dir: std::env::temp_dir().display().to_string(),
        path_sep: if cfg!(windows) { ";" } else { ":" }.to_string(),
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
        return Ok(crate::paths::home_dir().join(rest));
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

#[tauri::command]
pub async fn plugin_system_open_path(path: String) -> Result<(), String> {
    let path = validate_user_path(&path)?;
    let display = path.display().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        {
            check_status(Command::new("open").arg(&path).status(), "open", &display)
        }
        #[cfg(target_os = "windows")]
        {
            check_status(
                Command::new("cmd")
                    .args(["/C", "start", "", &display])
                    .status(),
                "open",
                &display,
            )
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
            Command::new("explorer")
                .arg(format!("/select,{}", display))
                .status()
                .map(|_| ())
                .map_err(|e| format!("reveal {display}: {e}"))
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
    use super::{validate_user_path, validate_wallpaper_scope};

    #[test]
    fn wallpaper_scope_is_narrow_and_stable() {
        assert_eq!(validate_wallpaper_scope(None), Ok("every"));
        assert_eq!(validate_wallpaper_scope(Some("current")), Ok("current"));
        assert!(validate_wallpaper_scope(Some("all-displays")).is_err());
    }

    #[test]
    fn system_paths_reject_empty_and_nul() {
        assert!(validate_user_path(" ").is_err());
        assert!(validate_user_path("bad\0path").is_err());
    }
}
