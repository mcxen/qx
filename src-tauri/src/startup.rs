//! Launch-at-login platform port.
//!
//! Settings own the user's intent; this module owns native registration.
//! Windows uses the current-user Run key so enabling startup needs no elevation.

use std::sync::atomic::{AtomicBool, Ordering};

pub(crate) const AUTOSTART_ARG: &str = "--autostart";
static INITIAL_WINDOW_SHOW_CLAIMED: AtomicBool = AtomicBool::new(false);

pub(crate) fn is_autostart_invocation(args: &[String]) -> bool {
    args.iter().any(|arg| arg == AUTOSTART_ARG)
}

pub(crate) fn is_current_autostart_invocation() -> bool {
    is_autostart_invocation(&std::env::args().collect::<Vec<_>>())
}

fn claim_initial_window_show_for(args: &[String], claimed: &AtomicBool) -> bool {
    !is_autostart_invocation(args)
        && claimed
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
}

/// Process-scoped startup handshake consumed by the frontend after hydration.
/// Autostart stays hidden and a WebView remount/HMR cannot re-summon the panel.
#[tauri::command]
pub(crate) fn claim_initial_window_show() -> bool {
    claim_initial_window_show_for(
        &std::env::args().collect::<Vec<_>>(),
        &INITIAL_WINDOW_SHOW_CLAIMED,
    )
}

#[cfg(target_os = "windows")]
fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn autostart_command() -> Result<Vec<u16>, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("resolve Qx executable for autostart: {error}"))?;
    let executable = executable.as_os_str().to_string_lossy();
    if executable.contains('"') {
        return Err("Qx executable path contains an unsupported quote".to_string());
    }
    Ok(wide(std::ffi::OsStr::new(&format!(
        "\"{executable}\" {AUTOSTART_ARG}"
    ))))
}

#[cfg(target_os = "windows")]
pub(crate) fn sync(enabled: bool) -> Result<(), String> {
    use windows_sys::Win32::Foundation::{
        ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS,
    };
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW,
        HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    let subkey = wide(std::ffi::OsStr::new(
        r"Software\Microsoft\Windows\CurrentVersion\Run",
    ));
    let value_name = wide(std::ffi::OsStr::new("Qx"));
    let mut key = std::ptr::null_mut();

    if enabled {
        let command = autostart_command()?;
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                0,
                std::ptr::null_mut(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                std::ptr::null(),
                &mut key,
                std::ptr::null_mut(),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(format!(
                "open Windows autostart registry key: error {status}"
            ));
        }
        let status = unsafe {
            RegSetValueExW(
                key,
                value_name.as_ptr(),
                0,
                REG_SZ,
                command.as_ptr().cast(),
                (command.len() * std::mem::size_of::<u16>()) as u32,
            )
        };
        unsafe { RegCloseKey(key) };
        if status != ERROR_SUCCESS {
            return Err(format!(
                "write Windows autostart registration: error {status}"
            ));
        }
        return Ok(());
    }

    let status = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            0,
            KEY_SET_VALUE,
            &mut key,
        )
    };
    if status == ERROR_FILE_NOT_FOUND || status == ERROR_PATH_NOT_FOUND {
        return Ok(());
    }
    if status != ERROR_SUCCESS {
        return Err(format!(
            "open Windows autostart registry key: error {status}"
        ));
    }
    let status = unsafe { RegDeleteValueW(key, value_name.as_ptr()) };
    unsafe { RegCloseKey(key) };
    if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND {
        Ok(())
    } else {
        Err(format!(
            "remove Windows autostart registration: error {status}"
        ))
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn sync(_enabled: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{claim_initial_window_show_for, is_autostart_invocation, AUTOSTART_ARG};
    use std::sync::atomic::AtomicBool;

    #[test]
    fn recognizes_only_explicit_autostart_argument() {
        assert!(is_autostart_invocation(&[
            "qx".to_string(),
            AUTOSTART_ARG.to_string()
        ]));
        assert!(!is_autostart_invocation(&["qx".to_string()]));
        assert!(!is_autostart_invocation(&[
            "qx".to_string(),
            "--autostarted".to_string()
        ]));
    }

    #[test]
    fn initial_show_is_single_use_and_autostart_never_consumes_it() {
        let claimed = AtomicBool::new(false);
        let autostart = vec!["qx".to_string(), AUTOSTART_ARG.to_string()];
        let explicit = vec!["qx".to_string()];

        assert!(!claim_initial_window_show_for(&autostart, &claimed));
        assert!(claim_initial_window_show_for(&explicit, &claimed));
        assert!(!claim_initial_window_show_for(&explicit, &claimed));
    }
}
