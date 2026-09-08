//! Explicit software dimming. Preserve the existing calibration; never alter backlight.
use super::DisplayBrightnessControl;
use std::collections::HashMap;
use std::sync::{Mutex, Once, OnceLock};

type Ramp = [Vec<f32>; 3];
struct Session {
    original: Ramp,
    applied: Ramp,
    value: u8,
}
static SESSIONS: OnceLock<Mutex<HashMap<String, Session>>> = OnceLock::new();
static EXIT_HOOK: Once = Once::new();

fn sessions() -> &'static Mutex<HashMap<String, Session>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn same(a: &Ramp, b: &Ramp) -> bool {
    a.iter()
        .zip(b)
        .all(|(a, b)| a.len() == b.len() && a.iter().zip(b).all(|(a, b)| (a - b).abs() < 0.002))
}

fn scaled(original: &Ramp, value: u8) -> Ramp {
    // Keep a visible floor, even when a generic 0–100 slider sends zero.
    let factor = 0.1 + 0.9 * value.min(100) as f32 / 100.0;
    original
        .clone()
        .map(|channel| channel.into_iter().map(|v| v * factor).collect())
}

extern "C" fn restore_on_exit() {
    if let Ok(mut sessions) = sessions().lock() {
        for (id, session) in sessions.drain() {
            // Do not undo Night Shift / another color utility's later changes.
            if platform::read(&id).is_ok_and(|ramp| same(&ramp, &session.applied)) {
                let _ = platform::write(&id, &session.original);
            }
        }
    }
}

pub(super) fn controls() -> Result<Vec<DisplayBrightnessControl>, String> {
    let mut sessions = sessions().lock().map_err(|e| e.to_string())?;
    let targets = platform::targets()?;
    sessions.retain(|id, _| targets.iter().any(|(key, _, _)| key == id));
    Ok(targets
        .into_iter()
        .filter_map(|(id, name, builtin)| {
            let ramp = platform::read(&id).ok()?;
            if sessions.get(&id).is_some_and(|s| !same(&ramp, &s.applied)) {
                sessions.remove(&id);
            }
            let current = sessions.get(&id).map_or(100, |s| s.value);
            Some(DisplayBrightnessControl {
                id: format!("software:{id}"),
                name,
                backend: "software".into(),
                current: Some(current),
                max: 100,
                raw_current: None,
                raw_max: None,
                is_builtin: builtin,
                supported: true,
                error: None,
                error_stage: None,
                error_code: None,
            })
        })
        .collect())
}

pub(super) fn set(target: &str, value: u8) -> Result<bool, String> {
    let Some(id) = target.strip_prefix("software:") else {
        return Ok(false);
    };
    if !platform::targets()?.iter().any(|(key, _, _)| key == id) {
        return Err("Software dimming display is no longer available".into());
    }
    let mut sessions = sessions().lock().map_err(|e| e.to_string())?;
    let current = platform::read(id)?;
    if sessions
        .get(id)
        .is_some_and(|s| !same(&current, &s.applied))
    {
        sessions.remove(id);
        return Err("Display color calibration changed; refresh before dimming again".into());
    }
    let original = sessions
        .get(id)
        .map_or_else(|| current.clone(), |s| s.original.clone());
    let next = scaled(&original, value);
    EXIT_HOOK.call_once(|| unsafe {
        unsafe extern "C" {
            fn atexit(callback: extern "C" fn()) -> i32;
        }
        atexit(restore_on_exit);
    });
    if let Err(error) = platform::write(id, &next) {
        let _ = platform::write(id, &original);
        sessions.remove(id);
        return Err(error);
    }
    // Drivers may accept the API call without applying it (HDR/virtual displays).
    let actual = match platform::read(id) {
        Ok(actual) if same(&actual, &next) => actual,
        _ => {
            let _ = platform::write(id, &original);
            sessions.remove(id);
            return Err("Display driver did not apply software dimming".into());
        }
    };
    if value == 100 {
        sessions.remove(id);
    } else {
        sessions.insert(
            id.into(),
            Session {
                original,
                applied: actual,
                value,
            },
        );
    }
    Ok(true)
}

#[cfg(target_os = "macos")]
mod platform {
    use super::Ramp;
    unsafe extern "C" {
        fn CGGetDisplayTransferByTable(
            id: u32,
            capacity: u32,
            r: *mut f32,
            g: *mut f32,
            b: *mut f32,
            count: *mut u32,
        ) -> i32;
        fn CGSetDisplayTransferByTable(
            id: u32,
            count: u32,
            r: *const f32,
            g: *const f32,
            b: *const f32,
        ) -> i32;
    }
    pub fn targets() -> Result<Vec<(String, String, bool)>, String> {
        Ok(super::super::super::displays()?
            .into_iter()
            .map(|d| (d.id.to_string(), d.name, d.is_builtin))
            .collect())
    }
    pub fn read(id: &str) -> Result<Ramp, String> {
        let id = id.parse::<u32>().map_err(|e| e.to_string())?;
        let [mut r, mut g, mut b] = [vec![0.; 4096], vec![0.; 4096], vec![0.; 4096]];
        let mut count = 0;
        let status = unsafe {
            CGGetDisplayTransferByTable(
                id,
                4096,
                r.as_mut_ptr(),
                g.as_mut_ptr(),
                b.as_mut_ptr(),
                &mut count,
            )
        };
        if status != 0 || count < 2 || count > 4096 {
            return Err(format!("Gamma table unavailable ({status})"));
        }
        r.truncate(count as usize);
        g.truncate(count as usize);
        b.truncate(count as usize);
        let ramp = [r, g, b];
        if ramp.iter().flatten().any(|v| !v.is_finite()) {
            return Err("Invalid gamma table".into());
        }
        Ok(ramp)
    }
    pub fn write(id: &str, ramp: &Ramp) -> Result<(), String> {
        let id = id.parse::<u32>().map_err(|e| e.to_string())?;
        let status = unsafe {
            CGSetDisplayTransferByTable(
                id,
                ramp[0].len() as u32,
                ramp[0].as_ptr(),
                ramp[1].as_ptr(),
                ramp[2].as_ptr(),
            )
        };
        if status == 0 {
            Ok(())
        } else {
            Err(format!("Software dimming failed ({status})"))
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::Ramp;
    use windows_sys::Win32::Graphics::Gdi::{CreateDCW, DeleteDC, HDC};
    use windows_sys::Win32::UI::ColorSystem::{GetDeviceGammaRamp, SetDeviceGammaRamp};
    struct Dc(HDC);
    impl Drop for Dc {
        fn drop(&mut self) {
            unsafe {
                DeleteDC(self.0);
            }
        }
    }
    fn dc(id: &str) -> Result<Dc, String> {
        if !sdr_sources().contains(id) {
            return Err("Software dimming requires a verified SDR display".into());
        }
        let name: Vec<u16> = id.encode_utf16().chain(Some(0)).collect();
        let handle = unsafe {
            CreateDCW(
                name.as_ptr(),
                name.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
            )
        };
        if handle.is_null() {
            Err("Display device context unavailable".into())
        } else {
            Ok(Dc(handle))
        }
    }
    // Gamma ramp behavior is undefined for HDR. Fail closed on unknown color
    // state, and exclude a cloned source if any of its targets uses advanced color.
    fn sdr_sources() -> std::collections::HashSet<String> {
        use windows_sys::Win32::Devices::Display as dc;
        let mut sources = std::collections::HashMap::<String, bool>::new();
        let (mut path_count, mut mode_count) = (0, 0);
        unsafe {
            if dc::GetDisplayConfigBufferSizes(
                dc::QDC_ONLY_ACTIVE_PATHS,
                &mut path_count,
                &mut mode_count,
            ) != 0
            {
                return Default::default();
            }
            let mut paths =
                vec![std::mem::zeroed::<dc::DISPLAYCONFIG_PATH_INFO>(); path_count as usize];
            let mut modes =
                vec![std::mem::zeroed::<dc::DISPLAYCONFIG_MODE_INFO>(); mode_count as usize];
            if dc::QueryDisplayConfig(
                dc::QDC_ONLY_ACTIVE_PATHS,
                &mut path_count,
                paths.as_mut_ptr(),
                &mut mode_count,
                modes.as_mut_ptr(),
                std::ptr::null_mut(),
            ) != 0
            {
                return Default::default();
            }
            for path in paths.into_iter().take(path_count as usize) {
                let mut source = std::mem::zeroed::<dc::DISPLAYCONFIG_SOURCE_DEVICE_NAME>();
                source.header.r#type = dc::DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
                source.header.size = std::mem::size_of_val(&source) as u32;
                source.header.adapterId = path.sourceInfo.adapterId;
                source.header.id = path.sourceInfo.id;
                if dc::DisplayConfigGetDeviceInfo(&mut source.header) != 0 {
                    return Default::default();
                }
                let name = super::super::super::utf16_buffer(&source.viewGdiDeviceName);
                let mut color = std::mem::zeroed::<dc::DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO>();
                color.header.r#type = dc::DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO;
                color.header.size = std::mem::size_of_val(&color) as u32;
                color.header.adapterId = path.targetInfo.adapterId;
                color.header.id = path.targetInfo.id;
                let safe = dc::DisplayConfigGetDeviceInfo(&mut color.header) == 0
                    && color.Anonymous.value & 2 == 0;
                sources
                    .entry(name)
                    .and_modify(|value| *value &= safe)
                    .or_insert(safe);
            }
        }
        sources
            .into_iter()
            .filter_map(|(name, safe)| safe.then_some(name))
            .collect()
    }
    pub fn targets() -> Result<Vec<(String, String, bool)>, String> {
        Ok(super::super::super::all_capture_monitors()?
            .into_iter()
            .filter_map(|m| {
                Some((
                    m.name().ok()?,
                    m.friendly_name().or_else(|_| m.name()).ok()?,
                    false,
                ))
            })
            .collect())
    }
    pub fn read(id: &str) -> Result<Ramp, String> {
        let dc = dc(id)?;
        let mut ramp = [[0u16; 256]; 3];
        if unsafe { GetDeviceGammaRamp(dc.0, ramp.as_mut_ptr().cast()) } == 0 {
            return Err("Gamma table unavailable".into());
        }
        Ok(ramp.map(|c| c.into_iter().map(|v| v as f32 / 65535.0).collect()))
    }
    pub fn write(id: &str, ramp: &Ramp) -> Result<(), String> {
        let dc = dc(id)?;
        let raw: [[u16; 256]; 3] =
            std::array::from_fn(|c| std::array::from_fn(|i| (ramp[c][i] * 65535.0).round() as u16));
        if unsafe { SetDeviceGammaRamp(dc.0, raw.as_ptr().cast()) } == 0 {
            Err("Display driver rejected software dimming".into())
        } else {
            Ok(())
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::Ramp;
    pub fn targets() -> Result<Vec<(String, String, bool)>, String> {
        Ok(vec![])
    }
    pub fn read(_: &str) -> Result<Ramp, String> {
        Err("Unsupported platform".into())
    }
    pub fn write(_: &str, _: &Ramp) -> Result<(), String> {
        Err("Unsupported platform".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn software_scaling_preserves_calibration_and_visible_floor() {
        let ramp = [vec![0., 0.8], vec![0., 0.9], vec![0., 1.]];
        assert!(same(&scaled(&ramp, 100), &ramp));
        assert!((scaled(&ramp, 0)[0][1] - 0.08).abs() < 0.00001);
        assert!(!same(&scaled(&ramp, 50), &ramp));
        assert!(!same(&[vec![0.], vec![0.], vec![0.]], &ramp));
    }
}
