//! Launch installed applications and, on multi-monitor machines, place their
//! windows onto the physical display where Qx was summoned.

use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{command, AppHandle};

use crate::desktop_windows::{
    app_has_placeable_windows, capture_qx_launch_display, place_launched_app, NativeWorkArea,
    PlaceResult,
};
use crate::runtime;

const PLACE_RETRY_BUDGET: Duration = Duration::from_millis(900);
const PLACE_RETRY_STEP: Duration = Duration::from_millis(80);

#[command]
pub async fn open_app(app: AppHandle, path: String) -> Result<(), String> {
    let app_path = validate_open_app_path(&path)?;
    let target = capture_qx_launch_display(&app);
    runtime::blocking(move || launch_and_place(&app_path, target))
        .await
        .map_err(String::from)?
}

/// Fire-and-forget launch used by global app shortcuts. Placement is best-effort.
pub(crate) fn spawn_launch_on_active_display(app: &AppHandle, path: &Path) {
    let target = capture_qx_launch_display(app);
    let path = path.to_path_buf();
    let fallback = path.clone();
    if !runtime::pool::try_spawn(move || {
        if let Err(error) = launch_and_place(&path, target) {
            eprintln!("[apps] launch failed: {error}");
        }
    }) {
        let _ = launch_app_path(&fallback);
    }
}

pub(crate) fn launch_and_place(
    app_path: &Path,
    target: Option<NativeWorkArea>,
) -> Result<(), String> {
    let already_open = app_has_placeable_windows(app_path);
    if already_open {
        if let Some(target) = target {
            let _ = place_launched_app(app_path, target);
        }
        launch_app_path(app_path)?;
        if let Some(target) = target {
            let _ = place_launched_app(app_path, target);
        }
        return Ok(());
    }

    launch_app_path(app_path)?;
    if let Some(target) = target {
        retry_place(app_path, target);
    }
    Ok(())
}

fn retry_place(app_path: &Path, target: NativeWorkArea) {
    let deadline = Instant::now() + PLACE_RETRY_BUDGET;
    loop {
        match place_launched_app(app_path, target) {
            PlaceResult::Moved | PlaceResult::AlreadyOnDisplay | PlaceResult::Unavailable => {
                return;
            }
            PlaceResult::NoWindows => {
                if Instant::now() >= deadline {
                    return;
                }
                thread::sleep(PLACE_RETRY_STEP);
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn launch_app_path(app_path: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(app_path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open app: {e}"))
}

#[cfg(target_os = "windows")]
pub(crate) fn launch_app_path(app_path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let path = app_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            std::ptr::null(),
            path.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;
    if result <= 32 {
        Err(format!(
            "Failed to open Windows app (ShellExecuteW code {result})"
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn launch_app_path(app_path: &Path) -> Result<(), String> {
    std::process::Command::new(app_path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open app: {e}"))
}

#[cfg(target_os = "macos")]
pub(crate) fn validate_open_app_path(path: &str) -> Result<PathBuf, String> {
    let raw_path = Path::new(path);
    if raw_path.extension().and_then(|value| value.to_str()) != Some("app") {
        return Err("open_app only accepts .app bundles".to_string());
    }

    let app_path = raw_path
        .canonicalize()
        .map_err(|e| format!("Invalid app path: {e}"))?;
    if app_path.extension().and_then(|value| value.to_str()) != Some("app") {
        return Err("open_app only accepts .app bundles".to_string());
    }

    let home_applications = std::env::var("HOME")
        .ok()
        .map(|home| PathBuf::from(home).join("Applications"));
    let allowed_roots = [
        Some(PathBuf::from("/Applications")),
        Some(PathBuf::from("/System/Applications")),
        home_applications,
    ];

    let allowed = allowed_roots
        .iter()
        .flatten()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| app_path.starts_with(root));
    if !allowed {
        return Err("open_app path must be inside /Applications or ~/Applications".to_string());
    }

    Ok(app_path)
}

#[cfg(target_os = "windows")]
pub(crate) fn validate_open_app_path(path: &str) -> Result<PathBuf, String> {
    let raw_path = Path::new(path);
    let extension = raw_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("lnk") && !extension.eq_ignore_ascii_case("exe") {
        return Err("open_app only accepts Windows shortcuts or executables".to_string());
    }
    let app_path = raw_path
        .canonicalize()
        .map_err(|e| format!("Invalid app path: {e}"))?;
    let allowed = [
        "APPDATA",
        "PROGRAMDATA",
        "LOCALAPPDATA",
        "ProgramFiles",
        "ProgramFiles(x86)",
    ]
    .into_iter()
    .filter_map(|name| std::env::var_os(name))
    .map(PathBuf::from)
    .filter_map(|root| root.canonicalize().ok())
    .any(|root| app_path.starts_with(root));
    if !allowed {
        return Err("open_app path must be inside a Windows application directory".to_string());
    }
    Ok(app_path)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn validate_open_app_path(path: &str) -> Result<PathBuf, String> {
    Path::new(path)
        .canonicalize()
        .map_err(|e| format!("Invalid app path: {e}"))
}

#[cfg(test)]
mod tests {
    use super::validate_open_app_path;

    #[test]
    fn rejects_non_app_paths_on_macos() {
        #[cfg(target_os = "macos")]
        {
            assert!(validate_open_app_path("/tmp/not-an-app").is_err());
            assert!(validate_open_app_path("/etc/hosts").is_err());
        }
        #[cfg(not(target_os = "macos"))]
        let _ = validate_open_app_path;
    }
}
