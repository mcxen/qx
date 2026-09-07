//! Windows adapter: move a process's top-level windows onto a monitor work area.

use std::collections::HashSet;
use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::path::{Path, PathBuf};
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HWND, LPARAM, RECT};
use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, IsIconic,
    IsWindowVisible, SetWindowPos, ShowWindow, GWL_EXSTYLE, GW_OWNER, SWP_NOACTIVATE, SWP_NOSIZE,
    SWP_NOZORDER, SW_RESTORE,
};

use super::place::{NativeWorkArea, PlaceResult, WindowRect};

const WS_EX_TOOLWINDOW: i32 = 0x0000_0080;
const WS_EX_NOACTIVATE: i32 = 0x0800_0000;

struct WinWindow {
    hwnd: HWND,
    rect: WindowRect,
}

struct EnumState {
    names: HashSet<String>,
    self_pid: u32,
    windows: Vec<WinWindow>,
}

pub(super) fn has_placeable_windows(path: &Path) -> bool {
    !collect_windows(path).is_empty()
}

pub(super) fn place_app_path(path: &Path, target: NativeWorkArea) -> PlaceResult {
    let windows = collect_windows(path);
    if windows.is_empty() {
        return PlaceResult::NoWindows;
    }

    let movable: Vec<WindowRect> = windows
        .iter()
        .filter(|window| !window.rect.is_fullscreen_on(target))
        .map(|window| window.rect)
        .collect();
    let Some(primary) = super::place::largest_window(&movable).or_else(|| {
        super::place::largest_window(&windows.iter().map(|w| w.rect).collect::<Vec<_>>())
    }) else {
        return PlaceResult::NoWindows;
    };

    if target.contains_center(primary) {
        return PlaceResult::AlreadyOnDisplay;
    }

    let source = windows
        .iter()
        .find(|window| window.rect == primary)
        .and_then(|window| monitor_work_area(window.hwnd))
        .unwrap_or(target);
    let Some((dx, dy)) = super::place::translation_onto_display(primary, source, target) else {
        return PlaceResult::AlreadyOnDisplay;
    };

    for window in &windows {
        if window.rect.is_fullscreen_on(source) || window.rect.is_fullscreen_on(target) {
            continue;
        }
        unsafe {
            if IsIconic(window.hwnd) != 0 {
                let _ = ShowWindow(window.hwnd, SW_RESTORE);
            }
        }
        let moved = WindowRect {
            x: window.rect.x.saturating_add(dx),
            y: window.rect.y.saturating_add(dy),
            w: window.rect.w,
            h: window.rect.h,
        };
        let (x, y) = super::place::clamp_to_work(moved, target);
        unsafe {
            let _ = SetWindowPos(
                window.hwnd,
                null_mut(),
                x,
                y,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }
    PlaceResult::Moved
}

fn monitor_work_area(hwnd: HWND) -> Option<NativeWorkArea> {
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_null() {
        return None;
    }
    let mut info: MONITORINFO = unsafe { zeroed() };
    info.cbSize = size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return None;
    }
    Some(NativeWorkArea {
        x: info.rcWork.left,
        y: info.rcWork.top,
        w: info.rcWork.right.saturating_sub(info.rcWork.left),
        h: info.rcWork.bottom.saturating_sub(info.rcWork.top),
        frame_x: info.rcMonitor.left,
        frame_y: info.rcMonitor.top,
        frame_w: info.rcMonitor.right.saturating_sub(info.rcMonitor.left),
        frame_h: info.rcMonitor.bottom.saturating_sub(info.rcMonitor.top),
    })
}

fn collect_windows(path: &Path) -> Vec<WinWindow> {
    let names = image_names(path);
    if names.is_empty() {
        return Vec::new();
    }
    let mut state = EnumState {
        names,
        self_pid: std::process::id(),
        windows: Vec::new(),
    };
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_proc),
            &mut state as *mut EnumState as LPARAM,
        );
    }
    state.windows
}

unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = unsafe { &mut *(lparam as *mut EnumState) };
    if hwnd.is_null() {
        return 1;
    }
    unsafe {
        if IsWindowVisible(hwnd) == 0 && IsIconic(hwnd) == 0 {
            return 1;
        }
        let owner = GetWindow(hwnd, GW_OWNER);
        if !owner.is_null() {
            return 1;
        }
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        if ex_style & WS_EX_TOOLWINDOW != 0 && ex_style & WS_EX_NOACTIVATE != 0 {
            return 1;
        }
        if is_cloaked(hwnd) {
            return 1;
        }
        let mut pid = 0u32;
        let _ = GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 || pid == state.self_pid {
            return 1;
        }
        let Some(image) = process_image_name(pid) else {
            return 1;
        };
        let Some(file_name) = file_name_key(&image) else {
            return 1;
        };
        if !state.names.contains(&file_name) {
            return 1;
        }
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return 1;
        }
        let w = rect.right.saturating_sub(rect.left);
        let h = rect.bottom.saturating_sub(rect.top);
        if w < 2 || h < 2 {
            return 1;
        }
        state.windows.push(WinWindow {
            hwnd,
            rect: WindowRect {
                x: rect.left,
                y: rect.top,
                w,
                h,
            },
        });
    }
    1
}

fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked: u32 = 0;
    let status = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED as u32,
            &mut cloaked as *mut u32 as *mut c_void,
            size_of::<u32>() as u32,
        )
    };
    status == 0 && cloaked != 0
}

fn process_image_name(pid: u32) -> Option<PathBuf> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return None;
    }
    let mut buf = [0u16; 1024];
    let mut size = buf.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size) };
    unsafe { CloseHandle(handle) };
    if ok == 0 || size == 0 {
        return None;
    }
    Some(PathBuf::from(String::from_utf16_lossy(
        &buf[..size as usize],
    )))
}

fn image_names(path: &Path) -> HashSet<String> {
    let mut names = HashSet::new();
    if let Some(name) = file_name_key(path) {
        if name.ends_with(".exe") {
            names.insert(name);
        }
    }
    if path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("lnk"))
    {
        if let Some(target) = lnk_local_base_path(path) {
            if let Some(name) = file_name_key(&target) {
                names.insert(name);
            }
        }
    }
    names
}

fn file_name_key(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase())
}

/// Best-effort Shell Link LocalBasePath reader. Returns `None` for store/URI
/// shortcuts; launch still succeeds, placement is skipped.
fn lnk_local_base_path(path: &Path) -> Option<PathBuf> {
    let bytes = std::fs::read(path).ok()?;
    parse_lnk_local_base_path(&bytes)
}

fn parse_lnk_local_base_path(bytes: &[u8]) -> Option<PathBuf> {
    if bytes.len() < 0x4c {
        return None;
    }
    let header_size = u32::from_le_bytes(bytes[0..4].try_into().ok()?);
    if header_size != 0x4c {
        return None;
    }
    let flags = u32::from_le_bytes(bytes[0x14..0x18].try_into().ok()?);
    let has_id_list = flags & 0x1 != 0;
    let has_link_info = flags & 0x2 != 0;
    if !has_link_info {
        return None;
    }
    let mut cursor = 0x4cusize;
    if has_id_list {
        if bytes.len() < cursor + 2 {
            return None;
        }
        let id_list_size = u16::from_le_bytes(bytes[cursor..cursor + 2].try_into().ok()?) as usize;
        cursor = cursor.checked_add(2)?.checked_add(id_list_size)?;
    }
    if bytes.len() < cursor.checked_add(0x10)? {
        return None;
    }
    let info_size = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().ok()?) as usize;
    let info_header = u32::from_le_bytes(bytes[cursor + 4..cursor + 8].try_into().ok()?) as usize;
    let info_flags = u32::from_le_bytes(bytes[cursor + 8..cursor + 12].try_into().ok()?);
    if info_size < 0x10 || cursor.checked_add(info_size)? > bytes.len() {
        return None;
    }
    if info_flags & 0x1 == 0 {
        return None;
    }
    let local_offset =
        u32::from_le_bytes(bytes[cursor + 16..cursor + 20].try_into().ok()?) as usize;
    if info_header >= 0x24 && bytes.len() >= cursor + 0x20 {
        let unicode_offset =
            u32::from_le_bytes(bytes[cursor + 28..cursor + 32].try_into().ok()?) as usize;
        if unicode_offset > 0 && cursor.checked_add(unicode_offset)? < bytes.len() {
            if let Some(path) = read_utf16z(bytes, cursor + unicode_offset) {
                return Some(path);
            }
        }
    }
    if local_offset > 0 {
        return read_ascii_z(bytes, cursor + local_offset);
    }
    None
}

fn read_ascii_z(bytes: &[u8], start: usize) -> Option<PathBuf> {
    if start >= bytes.len() {
        return None;
    }
    let end = bytes[start..].iter().position(|b| *b == 0)? + start;
    let text = std::str::from_utf8(&bytes[start..end]).ok()?;
    if text.is_empty() {
        None
    } else {
        Some(PathBuf::from(text))
    }
}

fn read_utf16z(bytes: &[u8], start: usize) -> Option<PathBuf> {
    if start >= bytes.len() {
        return None;
    }
    let mut units = Vec::new();
    let mut offset = start;
    while offset + 1 < bytes.len() {
        let unit = u16::from_le_bytes(bytes[offset..offset + 2].try_into().ok()?);
        offset += 2;
        if unit == 0 {
            break;
        }
        units.push(unit);
    }
    if units.is_empty() {
        return None;
    }
    Some(PathBuf::from(String::from_utf16_lossy(&units)))
}

#[cfg(test)]
mod tests {
    use super::parse_lnk_local_base_path;

    #[test]
    fn rejects_truncated_lnk() {
        assert!(parse_lnk_local_base_path(&[0u8; 8]).is_none());
        assert!(parse_lnk_local_base_path(&[]).is_none());
    }
}
