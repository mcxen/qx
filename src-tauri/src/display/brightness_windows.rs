//! Windows adapter for the shared display-brightness port.
//!
//! Integrated panels are controlled through the `ROOT\WMI`
//! `WmiMonitorBrightness*` classes. External physical monitors use the Win32
//! Monitor Configuration API (DXVA2/DDC-CI). All calls are made from the root
//! display service's blocking boundary.

use super::DisplayBrightnessControl;
use super::{all_capture_monitors, windows_display_connection, windows_display_connections};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::sync::{Mutex, OnceLock};
use windows_sys::Win32::Devices::Display::{
    DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR,
    GetPhysicalMonitorsFromHMONITOR, SetMonitorBrightness, PHYSICAL_MONITOR,
};
use windows_sys::Win32::Foundation::{BOOL, LPARAM, RECT};
use windows_sys::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};
use wmi::{COMLibrary, WMIConnection};

static CONTROL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct WmiMonitorBrightness {
    Active: bool,
    CurrentBrightness: u8,
    InstanceName: String,
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct WmiMonitorBrightnessMethods {
    Active: bool,
    InstanceName: String,
    __Path: String,
}

#[derive(Debug, Serialize)]
#[allow(non_snake_case)]
struct WmiSetBrightnessInput {
    Brightness: u8,
    Timeout: u32,
}

#[derive(Debug, Deserialize)]
#[allow(non_snake_case)]
struct WmiSetBrightnessOutput {
    ReturnValue: u32,
}

#[derive(Clone, Debug)]
struct LogicalMonitor {
    handle: HMONITOR,
    x: i32,
    y: i32,
}

struct PhysicalMonitors(Vec<PHYSICAL_MONITOR>);

impl Drop for PhysicalMonitors {
    fn drop(&mut self) {
        if !self.0.is_empty() {
            unsafe {
                DestroyPhysicalMonitors(self.0.len() as u32, self.0.as_ptr());
            }
        }
    }
}

fn last_error(operation: &str) -> (String, Option<i32>) {
    let error = std::io::Error::last_os_error();
    (format!("{operation}: {error}"), error.raw_os_error())
}

fn instance_key(instance_name: &str) -> String {
    let mut hasher = DefaultHasher::new();
    instance_name.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn native_target_id(instance_name: &str) -> String {
    format!("windows-native:{}", instance_key(instance_name))
}

fn ddc_target_id(logical: &LogicalMonitor, physical_index: usize, name: &str) -> String {
    let mut hasher = DefaultHasher::new();
    logical.x.hash(&mut hasher);
    logical.y.hash(&mut hasher);
    physical_index.hash(&mut hasher);
    name.hash(&mut hasher);
    format!("windows-ddc:{:016x}", hasher.finish())
}

fn ddc_target_key(id: &str) -> Option<&str> {
    id.strip_prefix("windows-ddc:")
        .filter(|key| key.len() == 16 && key.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

unsafe extern "system" fn collect_monitor(
    monitor: HMONITOR,
    _dc: HDC,
    rect: *mut RECT,
    data: LPARAM,
) -> BOOL {
    let monitors = &mut *(data as *mut Vec<LogicalMonitor>);
    let rect = rect.as_ref().copied().unwrap_or(RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    });
    monitors.push(LogicalMonitor {
        handle: monitor,
        x: rect.left,
        y: rect.top,
    });
    1
}

fn logical_monitors() -> Result<Vec<LogicalMonitor>, String> {
    let mut monitors = Vec::new();
    let ok = unsafe {
        EnumDisplayMonitors(
            std::ptr::null_mut(),
            std::ptr::null(),
            Some(collect_monitor),
            (&mut monitors as *mut Vec<LogicalMonitor>) as LPARAM,
        )
    };
    if ok == 0 {
        return Err(last_error("EnumDisplayMonitors").0);
    }
    Ok(monitors)
}

fn physical_monitors(logical: HMONITOR) -> Result<PhysicalMonitors, (String, Option<i32>)> {
    let mut count = 0_u32;
    if unsafe { GetNumberOfPhysicalMonitorsFromHMONITOR(logical, &mut count) } == 0 {
        return Err(last_error("GetNumberOfPhysicalMonitorsFromHMONITOR"));
    }
    if count == 0 {
        return Ok(PhysicalMonitors(Vec::new()));
    }
    let mut monitors = vec![unsafe { std::mem::zeroed::<PHYSICAL_MONITOR>() }; count as usize];
    if unsafe { GetPhysicalMonitorsFromHMONITOR(logical, count, monitors.as_mut_ptr()) } == 0 {
        return Err(last_error("GetPhysicalMonitorsFromHMONITOR"));
    }
    Ok(PhysicalMonitors(monitors))
}

fn physical_handle(monitor: &PHYSICAL_MONITOR) -> windows_sys::Win32::Foundation::HANDLE {
    unsafe { std::ptr::addr_of!(monitor.hPhysicalMonitor).read_unaligned() }
}

fn physical_name(monitor: &PHYSICAL_MONITOR) -> String {
    let value =
        unsafe { std::ptr::addr_of!(monitor.szPhysicalMonitorDescription).read_unaligned() };
    let length = value
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..length])
        .trim()
        .to_string()
}

fn capture_inventory() -> Vec<(i32, i32, String, bool)> {
    let connections = windows_display_connections();
    all_capture_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| {
            let name = monitor
                .friendly_name()
                .or_else(|_| monitor.name())
                .unwrap_or_else(|_| "Display".to_string());
            let is_builtin = windows_display_connection(&name, &connections)
                .is_some_and(|connection| connection.is_builtin);
            (
                monitor.x().unwrap_or_default(),
                monitor.y().unwrap_or_default(),
                name,
                is_builtin,
            )
        })
        .collect()
}

fn wmi_connection() -> Result<WMIConnection, String> {
    let com = COMLibrary::new().map_err(|error| format!("initialize Windows COM: {error}"))?;
    WMIConnection::with_namespace_path("ROOT\\WMI", com)
        .map_err(|error| format!("connect to ROOT\\WMI: {error}"))
}

fn wmi_brightness_controls() -> Result<Vec<DisplayBrightnessControl>, String> {
    let connection = wmi_connection()?;
    let monitors: Vec<WmiMonitorBrightness> = connection
        .raw_query("SELECT Active, CurrentBrightness, InstanceName FROM WmiMonitorBrightness")
        .map_err(|error| format!("query WmiMonitorBrightness: {error}"))?;
    let builtin_names = capture_inventory()
        .into_iter()
        .filter(|(_, _, _, builtin)| *builtin)
        .map(|(_, _, name, _)| name)
        .collect::<Vec<_>>();
    Ok(monitors
        .into_iter()
        .filter(|monitor| monitor.Active)
        .enumerate()
        .map(|(index, monitor)| {
            let current = monitor.CurrentBrightness.min(100);
            DisplayBrightnessControl {
                id: native_target_id(&monitor.InstanceName),
                name: builtin_names
                    .get(index)
                    .cloned()
                    .unwrap_or_else(|| "Built-in Display".to_string()),
                backend: "native".to_string(),
                current: Some(current),
                max: 100,
                raw_current: Some(current as u16),
                raw_max: Some(100),
                is_builtin: true,
                supported: true,
                error: None,
                error_stage: None,
                error_code: None,
            }
        })
        .collect())
}

fn ddc_brightness_controls(skip_builtin: bool) -> Result<Vec<DisplayBrightnessControl>, String> {
    let logical = logical_monitors()?;
    let inventory = capture_inventory();
    let mut controls = Vec::new();

    for (logical_index, target) in logical.into_iter().enumerate() {
        let metadata = inventory
            .iter()
            .find(|(x, y, _, _)| *x == target.x && *y == target.y);
        let is_builtin = metadata.is_some_and(|(_, _, _, builtin)| *builtin);
        if skip_builtin && is_builtin {
            continue;
        }
        let fallback_name = metadata
            .map(|(_, _, name, _)| name.clone())
            .unwrap_or_else(|| format!("Display {}", logical_index + 1));
        let physical = match physical_monitors(target.handle) {
            Ok(monitors) if !monitors.0.is_empty() => monitors,
            Ok(_) => {
                controls.push(DisplayBrightnessControl {
                    id: format!("unavailable:windows:{logical_index}"),
                    name: fallback_name,
                    backend: if is_builtin { "native" } else { "ddc" }.to_string(),
                    current: None,
                    max: 100,
                    raw_current: None,
                    raw_max: None,
                    is_builtin,
                    supported: false,
                    error: Some("Windows did not expose a physical brightness target".to_string()),
                    error_stage: Some("physical monitor discovery".to_string()),
                    error_code: None,
                });
                continue;
            }
            Err((error, code)) => {
                controls.push(DisplayBrightnessControl {
                    id: format!("unavailable:windows:{logical_index}"),
                    name: fallback_name,
                    backend: if is_builtin { "native" } else { "ddc" }.to_string(),
                    current: None,
                    max: 100,
                    raw_current: None,
                    raw_max: None,
                    is_builtin,
                    supported: false,
                    error: Some(error),
                    error_stage: Some("physical monitor discovery".to_string()),
                    error_code: code,
                });
                continue;
            }
        };

        for (physical_index, monitor) in physical.0.iter().enumerate() {
            let name = match physical_name(monitor) {
                value if value.is_empty() => fallback_name.clone(),
                value => value,
            };
            let mut minimum = 0_u32;
            let mut current = 0_u32;
            let mut maximum = 0_u32;
            let success = unsafe {
                GetMonitorBrightness(
                    physical_handle(monitor),
                    &mut minimum,
                    &mut current,
                    &mut maximum,
                )
            } != 0;
            let range = maximum.saturating_sub(minimum);
            let supported = success && range > 0;
            let (error, error_code) = if supported {
                (None, None)
            } else if success {
                (
                    Some("Monitor reported an invalid brightness range".to_string()),
                    None,
                )
            } else {
                let (message, code) = last_error("GetMonitorBrightness");
                (Some(message), code)
            };
            controls.push(DisplayBrightnessControl {
                id: if supported {
                    ddc_target_id(&target, physical_index, &name)
                } else {
                    format!("unavailable:windows:{logical_index}:{physical_index}")
                },
                name,
                backend: "ddc".to_string(),
                current: supported.then(|| {
                    (((current.saturating_sub(minimum)) as f64 / range as f64) * 100.0).round()
                        as u8
                }),
                max: 100,
                raw_current: supported.then_some(current.min(u16::MAX as u32) as u16),
                raw_max: supported.then_some(maximum.min(u16::MAX as u32) as u16),
                is_builtin,
                supported,
                error,
                error_stage: (!supported).then(|| "Win32 monitor brightness read".to_string()),
                error_code,
            });
        }
    }
    Ok(controls)
}

pub(super) fn brightness_controls() -> Result<Vec<DisplayBrightnessControl>, String> {
    let _guard = CONTROL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "display control lock poisoned".to_string())?;
    let native = wmi_brightness_controls().unwrap_or_default();
    let mut controls = native.clone();
    controls.extend(ddc_brightness_controls(!native.is_empty())?);
    Ok(controls)
}

fn set_native_brightness(display_id: &str, value: u8) -> Result<bool, String> {
    let Some(key) = display_id.strip_prefix("windows-native:") else {
        return Ok(false);
    };
    let connection = wmi_connection()?;
    let methods: Vec<WmiMonitorBrightnessMethods> = connection
        .raw_query("SELECT Active, InstanceName, __Path FROM WmiMonitorBrightnessMethods")
        .map_err(|error| format!("query WmiMonitorBrightnessMethods: {error}"))?;
    let target = methods
        .into_iter()
        .find(|method| method.Active && instance_key(&method.InstanceName) == key)
        .ok_or_else(|| "The selected Windows native display is no longer available".to_string())?;
    let output: WmiSetBrightnessOutput = connection
        .exec_instance_method::<WmiMonitorBrightnessMethods, _, _>(
            "WmiSetBrightness",
            &target.__Path,
            WmiSetBrightnessInput {
                Brightness: value.min(100),
                Timeout: 0,
            },
        )
        .map_err(|error| format!("set WMI monitor brightness: {error}"))?;
    if output.ReturnValue != 0 {
        return Err(format!(
            "WmiSetBrightness failed with status {}",
            output.ReturnValue
        ));
    }
    Ok(true)
}

fn set_ddc_brightness(display_id: &str, value: u8) -> Result<bool, String> {
    let Some(target_key) = ddc_target_key(display_id) else {
        return Ok(false);
    };
    for logical in logical_monitors()? {
        let physical = match physical_monitors(logical.handle) {
            Ok(monitors) => monitors,
            Err(_) => continue,
        };
        for (physical_index, monitor) in physical.0.iter().enumerate() {
            let name = physical_name(monitor);
            let candidate = ddc_target_id(&logical, physical_index, &name);
            if ddc_target_key(&candidate) != Some(target_key) {
                continue;
            }
            let handle = physical_handle(monitor);
            let mut minimum = 0_u32;
            let mut current = 0_u32;
            let mut maximum = 0_u32;
            if unsafe { GetMonitorBrightness(handle, &mut minimum, &mut current, &mut maximum) }
                == 0
            {
                return Err(last_error("GetMonitorBrightness before write").0);
            }
            let range = maximum.saturating_sub(minimum);
            if range == 0 {
                return Err("Monitor reported an invalid brightness range".to_string());
            }
            let raw = minimum + ((value.min(100) as u64 * range as u64 + 50) / 100) as u32;
            if unsafe { SetMonitorBrightness(handle, raw.min(maximum)) } == 0 {
                return Err(last_error("SetMonitorBrightness").0);
            }
            return Ok(true);
        }
    }
    Err("The selected physical monitor is no longer available".to_string())
}

pub(super) fn set_brightness(display_id: &str, value: u8) -> Result<(), String> {
    let _guard = CONTROL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "display control lock poisoned".to_string())?;
    if set_native_brightness(display_id, value)? || set_ddc_brightness(display_id, value)? {
        return Ok(());
    }
    Err("Unknown Windows display brightness target".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ddc_target_keys_are_strict() {
        assert_eq!(
            ddc_target_key("windows-ddc:0123456789abcdef"),
            Some("0123456789abcdef")
        );
        assert_eq!(ddc_target_key("windows-ddc:2:4"), None);
        assert_eq!(ddc_target_key("ddc:0123456789abcdef"), None);
    }
}
