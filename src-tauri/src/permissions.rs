//! macOS privacy permissions used by Qx (FDA, Accessibility, Screen Recording, Input Monitoring).
//!
//! Full Disk Access cannot be granted programmatically — we probe via a protected path
//! (same approach as [inket/FullDiskAccess](https://github.com/inket/FullDiskAccess)) and
//! open System Settings for the user to toggle Qx on.

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
    /// Whether this permission is required for core launcher features (file search, etc.).
    pub required: bool,
    /// Soft grouping for onboarding: "files" | "automation" | "capture" | "macros".
    pub group: String,
}

#[cfg(target_os = "macos")]
const FULL_DISK_ACCESS_SETTINGS: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
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
    fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
    static kAXTrustedCheckOptionPrompt: *const std::ffi::c_void;
}

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFDictionaryCreate(
        allocator: *const std::ffi::c_void,
        keys: *const *const std::ffi::c_void,
        values: *const *const std::ffi::c_void,
        num_values: isize,
        key_callbacks: *const std::ffi::c_void,
        value_callbacks: *const std::ffi::c_void,
    ) -> *const std::ffi::c_void;
    fn CFRelease(cf: *const std::ffi::c_void);
    static kCFBooleanTrue: *const std::ffi::c_void;
    static kCFTypeDictionaryKeyCallBacks: std::ffi::c_void;
    static kCFTypeDictionaryValueCallBacks: std::ffi::c_void;
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
    required: bool,
    group: &str,
) -> MacPermissionStatus {
    MacPermissionStatus {
        id: id.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        granted,
        available: true,
        status: status_text(granted),
        settings_url: settings_url.to_string(),
        required,
        group: group.to_string(),
    }
}

#[cfg(target_os = "macos")]
fn open_settings_url(url: &str) -> Result<(), String> {
    crate::floating_panel::set_external_interaction_active(true);
    let result = std::process::Command::new("open")
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("open System Settings: {e}"));
    if result.is_err() {
        crate::floating_panel::set_external_interaction_active(false);
    }
    result
}

/// Probe Full Disk Access by listing a TCC-protected directory.
/// Reading this path on 10.15+ also registers the app in the FDA list (unchecked).
/// Approach mirrors [inket/FullDiskAccess](https://github.com/inket/FullDiskAccess).
#[cfg(target_os = "macos")]
pub(crate) fn full_disk_access_granted() -> bool {
    let home = dirs::home_dir().unwrap_or_default();
    // macOS 12+: Stocks container is a reliable FDA canary.
    let primary = home.join("Library/Containers/com.apple.stocks");
    // Older macOS / fallback when Stocks is missing.
    let fallback = home.join("Library/Safari");
    if primary.exists() {
        return std::fs::read_dir(&primary).is_ok();
    }
    if fallback.exists() {
        return std::fs::read_dir(&fallback).is_ok();
    }
    // Neither path exists — do not block onboarding on unusual layouts.
    true
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
pub(crate) fn accessibility_granted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn accessibility_granted() -> bool {
    true
}

#[cfg(target_os = "macos")]
fn input_monitoring_granted() -> bool {
    unsafe { IOHIDCheckAccess(IOHID_REQUEST_TYPE_LISTEN_EVENT) == IOHID_ACCESS_TYPE_GRANTED }
}

/// Prompt the system Accessibility dialog (adds app to the list when possible).
#[cfg(target_os = "macos")]
fn request_accessibility_prompt() -> bool {
    unsafe {
        let keys = [kAXTrustedCheckOptionPrompt];
        let values = [kCFBooleanTrue];
        let dict = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr() as *const *const std::ffi::c_void,
            values.as_ptr() as *const *const std::ffi::c_void,
            1,
            &kCFTypeDictionaryKeyCallBacks as *const _ as *const std::ffi::c_void,
            &kCFTypeDictionaryValueCallBacks as *const _ as *const std::ffi::c_void,
        );
        if dict.is_null() {
            return AXIsProcessTrusted();
        }
        let granted = AXIsProcessTrustedWithOptions(dict);
        CFRelease(dict);
        granted
    }
}

#[cfg(target_os = "macos")]
fn all_permission_statuses() -> Vec<MacPermissionStatus> {
    vec![
        permission(
            "full-disk-access",
            "Full Disk Access",
            "Required for complete file search across protected folders (Mail, Messages, Safari data, other app containers).",
            full_disk_access_granted(),
            FULL_DISK_ACCESS_SETTINGS,
            true,
            "files",
        ),
        permission(
            "accessibility",
            "Accessibility",
            "Required for clipboard auto-paste, macro playback, and system automation (Cmd+V simulation).",
            accessibility_granted(),
            ACCESSIBILITY_SETTINGS,
            false,
            "automation",
        ),
        permission(
            "screen-recording",
            "Screen Recording",
            "Required for MP4/MOV screen recording and region capture.",
            screen_recording_granted(),
            SCREEN_RECORDING_SETTINGS,
            false,
            "capture",
        ),
        permission(
            "input-monitoring",
            "Input Monitoring",
            "Required for recording keyboard and mouse macro events.",
            input_monitoring_granted(),
            INPUT_MONITORING_SETTINGS,
            false,
            "macros",
        ),
    ]
}

#[command]
pub fn qx_permissions_status() -> Result<Vec<MacPermissionStatus>, String> {
    #[cfg(target_os = "macos")]
    {
        let statuses = all_permission_statuses();
        if statuses
            .iter()
            .any(|status| status.id == "full-disk-access" && status.granted)
        {
            // The startup index deliberately stays Spotlight-only until FDA is
            // available. A successful poll is the stable hand-off that starts
            // the complete Home index without requiring an app restart.
            crate::file_search::refresh_platform_permissions();
        }
        Ok(statuses)
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
            required: false,
            group: "none".to_string(),
        }])
    }
}

#[command]
pub fn qx_permissions_request(id: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        match id.as_str() {
            "full-disk-access" => {
                // Probe first so the app appears in the FDA list, then open Settings.
                let _ = full_disk_access_granted();
                open_settings_url(FULL_DISK_ACCESS_SETTINGS)?;
                Ok(full_disk_access_granted())
            }
            "screen-recording" => {
                let granted = unsafe { CGRequestScreenCaptureAccess() };
                if !granted {
                    let _ = open_settings_url(SCREEN_RECORDING_SETTINGS);
                }
                Ok(granted || screen_recording_granted())
            }
            "accessibility" => {
                let granted = request_accessibility_prompt();
                if !granted {
                    let _ = open_settings_url(ACCESSIBILITY_SETTINGS);
                }
                Ok(granted || accessibility_granted())
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

/// Request several optional permissions in one shot (onboarding "enable all").
/// Returns the latest status list after each request attempt.
#[command]
pub fn qx_permissions_request_all(ids: Vec<String>) -> Result<Vec<MacPermissionStatus>, String> {
    #[cfg(target_os = "macos")]
    {
        for id in ids {
            let _ = qx_permissions_request(id);
            // Brief gap so successive Settings panes / dialogs do not race.
            std::thread::sleep(std::time::Duration::from_millis(350));
        }
        Ok(all_permission_statuses())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = ids;
        qx_permissions_status()
    }
}

#[command]
pub fn qx_permissions_open_settings(id: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let url = match id.as_str() {
            "full-disk-access" => {
                let _ = full_disk_access_granted();
                FULL_DISK_ACCESS_SETTINGS
            }
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

/// Whether the current platform should run the macOS first-launch onboarding.
#[command]
pub fn qx_onboarding_platform() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        Ok("macos".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        Ok("windows".to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok("other".to_string())
    }
}
