use serde::Serialize;
use tauri::command;

#[derive(Debug, Clone, Serialize)]
pub struct MacPermissionStatus {
    pub id: String,
    pub label: String,
    pub description: String,
    pub granted: bool,
    pub available: bool,
    pub status: String,
    pub settings_url: String,
}

#[cfg(target_os = "macos")]
const SCREEN_RECORDING_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
#[cfg(target_os = "macos")]
const ACCESSIBILITY_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
#[cfg(target_os = "macos")]
const INPUT_MONITORING_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent";

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

#[cfg(target_os = "macos")]
#[link(name = "IOKit", kind = "framework")]
extern "C" {
    fn IOHIDCheckAccess(request_type: u32) -> u32;
    fn IOHIDRequestAccess(request_type: u32) -> bool;
}

#[cfg(target_os = "macos")]
const IOHID_REQUEST_TYPE_LISTEN_EVENT: u32 = 1;
#[cfg(target_os = "macos")]
const IOHID_ACCESS_TYPE_GRANTED: u32 = 0;

#[cfg(target_os = "macos")]
fn status_text(granted: bool) -> String {
    if granted {
        "granted".to_string()
    } else {
        "needed".to_string()
    }
}

#[cfg(target_os = "macos")]
fn permission(
    id: &str,
    label: &str,
    description: &str,
    granted: bool,
    settings_url: &str,
) -> MacPermissionStatus {
    MacPermissionStatus {
        id: id.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        granted,
        available: true,
        status: status_text(granted),
        settings_url: settings_url.to_string(),
    }
}

#[cfg(target_os = "macos")]
fn open_settings_url(url: &str) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| format!("open System Settings: {e}"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn screen_recording_granted() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn screen_recording_granted() -> bool {
    true
}

#[cfg(target_os = "macos")]
fn accessibility_granted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

#[cfg(target_os = "macos")]
fn input_monitoring_granted() -> bool {
    unsafe { IOHIDCheckAccess(IOHID_REQUEST_TYPE_LISTEN_EVENT) == IOHID_ACCESS_TYPE_GRANTED }
}

#[command]
pub fn qx_permissions_status() -> Result<Vec<MacPermissionStatus>, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(vec![
            permission(
                "screen-recording",
                "Screen Recording",
                "Required for screenshots and GIF screen recording.",
                screen_recording_granted(),
                SCREEN_RECORDING_SETTINGS,
            ),
            permission(
                "accessibility",
                "Accessibility",
                "Required for macro playback and system automation.",
                accessibility_granted(),
                ACCESSIBILITY_SETTINGS,
            ),
            permission(
                "input-monitoring",
                "Input Monitoring",
                "Required for recording keyboard and mouse macro events.",
                input_monitoring_granted(),
                INPUT_MONITORING_SETTINGS,
            ),
        ])
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(vec![MacPermissionStatus {
            id: "macos-permissions".to_string(),
            label: "macOS Permissions".to_string(),
            description: "Permission checks are only available on macOS.".to_string(),
            granted: false,
            available: false,
            status: "unsupported".to_string(),
            settings_url: String::new(),
        }])
    }
}

#[command]
pub fn qx_permissions_request(id: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        match id.as_str() {
            "screen-recording" => {
                let granted = unsafe { CGRequestScreenCaptureAccess() };
                if !granted {
                    let _ = open_settings_url(SCREEN_RECORDING_SETTINGS);
                }
                Ok(granted || screen_recording_granted())
            }
            "accessibility" => {
                open_settings_url(ACCESSIBILITY_SETTINGS)?;
                Ok(accessibility_granted())
            }
            "input-monitoring" => {
                let granted = unsafe { IOHIDRequestAccess(IOHID_REQUEST_TYPE_LISTEN_EVENT) };
                if !granted {
                    let _ = open_settings_url(INPUT_MONITORING_SETTINGS);
                }
                Ok(granted || input_monitoring_granted())
            }
            _ => Err(format!("unknown permission: {id}")),
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = id;
        Err("permission requests are only available on macOS".to_string())
    }
}

#[command]
pub fn qx_permissions_open_settings(id: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let url = match id.as_str() {
            "screen-recording" => SCREEN_RECORDING_SETTINGS,
            "accessibility" => ACCESSIBILITY_SETTINGS,
            "input-monitoring" => INPUT_MONITORING_SETTINGS,
            _ => return Err(format!("unknown permission: {id}")),
        };
        open_settings_url(url)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = id;
        Err("permission settings are only available on macOS".to_string())
    }
}
