//! Brightness orchestration and platform control policy, separate from capture.
use super::displays;
use serde::Serialize;
#[cfg(target_os = "macos")]
use std::sync::{Mutex, OnceLock};
#[cfg(target_os = "macos")]
static DISPLAY_CONTROL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static CONTROL_GATE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
#[path = "software.rs"]
mod software;

/// A brightness target exposed by the shared display-control port.
///
/// `id` is intentionally opaque to callers. macOS uses DisplayServices or its
/// embedded DDC/CI adapter; Windows uses WMI for integrated panels and Win32
/// Monitor Configuration for physical DDC/CI targets. Plugin/UI code never
/// receives an OS display handle or starts a platform utility.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayBrightnessControl {
    pub id: String,
    pub name: String,
    pub backend: String,
    pub current: Option<u8>,
    pub max: u8,
    pub raw_current: Option<u16>,
    pub raw_max: Option<u16>,
    pub is_builtin: bool,
    pub supported: bool,
    pub error: Option<String>,
    pub error_stage: Option<String>,
    pub error_code: Option<i32>,
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct MacDdcDisplay {
    id: u32,
    current: u16,
    max: u16,
    error_code: i32,
    error_stage: u32,
    name: [std::os::raw::c_char; 256],
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn qx_native_display_brightness(display: u32, out: *mut u16) -> i32;
    fn qx_native_set_display_brightness(display: u32, value: u16) -> i32;
    fn qx_ddc_list(out: *mut MacDdcDisplay, capacity: usize) -> usize;
    fn qx_ddc_set(display: u32, value: u16, error_stage: *mut u32) -> i32;
}

#[cfg(target_os = "macos")]
fn mac_string(value: &[std::os::raw::c_char]) -> String {
    let bytes = value
        .iter()
        .take_while(|byte| **byte != 0)
        .map(|byte| *byte as u8)
        .collect::<Vec<_>>();
    String::from_utf8_lossy(&bytes).trim().to_string()
}

#[cfg(target_os = "macos")]
fn native_target_id(display_id: u32) -> String {
    format!("native:{display_id}")
}

#[cfg(target_os = "macos")]
fn ddc_target_id(display_id: u32) -> String {
    format!("ddc:{display_id}")
}

#[cfg(target_os = "macos")]
fn ddc_stage_name(stage: u32) -> &'static str {
    match stage {
        1 => "missing display info",
        2 => "missing IODisplayLocation",
        3 => "missing IOKit display adapter",
        4 => "IOAVService API unavailable",
        5 => "cannot resolve IOKit registry id",
        6 => "cannot create IOKit iterator",
        7 => "no external DCPAVServiceProxy",
        8 => "cannot create IOAVService",
        9 => "DDC VCP read request failed",
        10 => "DDC VCP read response failed",
        11 => "invalid DDC VCP response",
        12 => "DDC VCP write failed",
        _ => "unknown DDC failure",
    }
}

/// Human hint for common Apple Silicon DDC transport failures (m1ddc/Lunar class).
#[cfg(target_os = "macos")]
fn ddc_hint(stage: u32, error_code: i32) -> Option<&'static str> {
    match stage {
        7 | 8 => Some(
            "No external AV service for this panel. Prefer USB-C/DP Alt Mode; \
             some docks/HDMI paths block DDC on Apple Silicon.",
        ),
        9 | 10 | 12 => {
            // 0xE0114000 (-535740416): private IOAV I2C family error seen when the
            // link does not complete a DDC transaction (hub, cable, or DDC-CI off).
            if error_code == -535_740_416 || error_code as u32 == 0xe011_4000 {
                Some(
                    "Display did not accept DDC I2C. Enable DDC/CI in the monitor OSD, \
                     try a direct USB-C/DP cable (not a passive hub), or use the monitor buttons.",
                )
            } else {
                Some(
                    "DDC/CI transport failed. Check DDC/CI in the monitor menu and connection type.",
                )
            }
        }
        11 => Some("Monitor returned an unusable brightness range over DDC."),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn ddc_error(stage: u32, error_code: i32) -> String {
    let base = if error_code == 0 {
        format!("DDC: {}", ddc_stage_name(stage))
    } else {
        format!("DDC: {} (IOReturn {error_code})", ddc_stage_name(stage))
    };
    match ddc_hint(stage, error_code) {
        Some(hint) => format!("{base}. {hint}"),
        None => base,
    }
}

#[cfg(target_os = "macos")]
fn hardware_controls() -> Result<Vec<DisplayBrightnessControl>, String> {
    let _guard = DISPLAY_CONTROL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "display control lock poisoned".to_string())?;
    let inventory = displays()?;
    let mut controls = Vec::with_capacity(inventory.len());

    // Built-in panels use the same private DisplayServices channel as Apple's
    // brightness UI. This is hardware/native brightness, not a WebView shade.
    for display in inventory.iter() {
        let mut current = 0_u16;
        let status = unsafe { qx_native_display_brightness(display.id, &mut current) };
        if status != 0 && !display.is_builtin {
            continue;
        }
        controls.push(DisplayBrightnessControl {
            id: native_target_id(display.id),
            name: display.name.clone(),
            backend: "native".to_string(),
            current: (status == 0).then_some(current.min(100) as u8),
            max: 100,
            raw_current: (status == 0).then_some(current.min(100)),
            raw_max: (status == 0).then_some(100),
            is_builtin: display.is_builtin,
            supported: status == 0,
            error: (status != 0)
                .then(|| format!("macOS native brightness is unavailable (status {status})")),
            error_stage: (status != 0).then(|| "native DisplayServices".to_string()),
            error_code: (status != 0).then_some(status),
        });
    }

    // Qx embeds the small DDC/CI transport and returns display IDs matching
    // the shared xcap/CoreGraphics inventory. No m1ddc/ddcctl process or
    // Homebrew installation is involved.
    let mut ddc_displays = (0..32)
        .map(|_| MacDdcDisplay {
            id: 0,
            current: 0,
            max: 0,
            error_code: 0,
            error_stage: 0,
            name: [0; 256],
        })
        .collect::<Vec<_>>();
    let ddc_count = unsafe { qx_ddc_list(ddc_displays.as_mut_ptr(), ddc_displays.len()) };
    for display in inventory.iter().filter(|display| !display.is_builtin) {
        if controls
            .iter()
            .any(|c| c.id == native_target_id(display.id) && c.supported)
        {
            continue;
        }
        if let Some(ddc) = ddc_displays
            .iter()
            .take(ddc_count.min(ddc_displays.len()))
            .find(|ddc| ddc.id == display.id)
        {
            let max = ddc.max.max(1);
            let supported = ddc.error_stage == 0 && ddc.max > 0;
            controls.push(DisplayBrightnessControl {
                id: if supported {
                    ddc_target_id(display.id)
                } else {
                    format!("unavailable:{}", display.id)
                },
                name: if mac_string(&ddc.name).is_empty() {
                    display.name.clone()
                } else {
                    mac_string(&ddc.name)
                },
                backend: "ddc".to_string(),
                current: supported
                    .then_some(((ddc.current as f32 / max as f32) * 100.0).round() as u8),
                max: 100,
                raw_current: supported.then_some(ddc.current),
                raw_max: supported.then_some(ddc.max),
                is_builtin: false,
                supported,
                error: (!supported).then(|| ddc_error(ddc.error_stage, ddc.error_code)),
                error_stage: (!supported).then(|| ddc_stage_name(ddc.error_stage).to_string()),
                error_code: (!supported).then_some(ddc.error_code),
            });
        } else {
            controls.push(DisplayBrightnessControl {
                id: format!("unavailable:{}", display.id),
                name: display.name.clone(),
                backend: "ddc".to_string(),
                current: None,
                max: 100,
                raw_current: None,
                raw_max: None,
                is_builtin: false,
                supported: false,
                error: Some(
                    "DDC: display was not returned by the macOS display adapter".to_string(),
                ),
                error_stage: Some("display adapter mismatch".to_string()),
                error_code: None,
            });
        }
    }

    Ok(controls)
}

#[cfg(target_os = "windows")]
fn hardware_controls() -> Result<Vec<DisplayBrightnessControl>, String> {
    super::brightness_windows::brightness_controls()
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn hardware_controls() -> Result<Vec<DisplayBrightnessControl>, String> {
    Ok(Vec::new())
}

pub async fn display_brightness_list() -> Result<Vec<DisplayBrightnessControl>, String> {
    let _permit = CONTROL_GATE.acquire().await.map_err(|e| e.to_string())?;
    crate::runtime::blocking(|| {
        let mut controls = hardware_controls()?;
        controls.extend(software::controls()?);
        Ok(controls)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(target_os = "macos")]
fn set_brightness(display_id: String, value: u8) -> Result<(), String> {
    let _guard = DISPLAY_CONTROL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "display control lock poisoned".to_string())?;
    let value = value.min(100);
    if let Some(raw_id) = display_id.strip_prefix("native:") {
        let id = raw_id
            .parse::<u32>()
            .map_err(|_| "Invalid native display target".to_string())?;
        let display = displays()?
            .into_iter()
            .find(|display| display.id == id)
            .ok_or_else(|| "The selected native display is no longer available".to_string())?;
        let status = unsafe { qx_native_set_display_brightness(display.id, value as u16) };
        if status != 0 {
            return Err(format!(
                "macOS native brightness write failed (status {status})"
            ));
        }
        return Ok(());
    }

    if let Some(raw_id) = display_id.strip_prefix("ddc:") {
        let id = raw_id
            .parse::<u32>()
            .map_err(|_| "Invalid DDC display target".to_string())?;
        let display = displays()?
            .into_iter()
            .find(|display| display.id == id && !display.is_builtin)
            .ok_or_else(|| "The selected DDC display is no longer available".to_string())?;
        let mut error_stage = 0_u32;
        let status = unsafe { qx_ddc_set(display.id, value as u16, &mut error_stage) };
        if status != 0 {
            return Err(ddc_error(error_stage.max(12), status));
        }
        return Ok(());
    }

    Err("Unknown display brightness target".to_string())
}

#[cfg(target_os = "windows")]
fn set_brightness(display_id: String, value: u8) -> Result<(), String> {
    super::brightness_windows::set_brightness(&display_id, value)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn set_brightness(_display_id: String, _value: u8) -> Result<(), String> {
    Err("Display brightness control is unavailable on this platform".to_string())
}

pub async fn display_brightness_set(display_id: String, value: u8) -> Result<(), String> {
    let _permit = CONTROL_GATE.acquire().await.map_err(|e| e.to_string())?;
    crate::runtime::blocking(move || {
        if value > 100 {
            return Err("Brightness must be between 0 and 100".into());
        }
        if software::set(&display_id, value)? {
            return Ok(());
        }
        set_brightness(display_id, value)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "uses connected monitors; writes existing hardware values and briefly tests software dimming"]
    fn connected_display_read_write_smoke() {
        let hardware = hardware_controls().unwrap();
        for target in &hardware {
            println!(
                "hardware {} backend={} supported={} current={:?} error={:?}",
                target.id, target.backend, target.supported, target.current, target.error
            );
            if let Some(value) = target.current.filter(|_| target.supported) {
                set_brightness(target.id.clone(), value).unwrap();
            }
        }
        let software = software::controls().unwrap();
        for target in software {
            let result = software::set(&target.id, 95);
            let restored = software::set(&target.id, 100);
            println!(
                "software {} write={result:?} restore={restored:?}",
                target.id
            );
            result.unwrap();
            restored.unwrap();
        }
        assert!(!hardware.is_empty(), "No connected hardware inventory");
    }
}
