//! Place another app's windows onto a physical display.
//!
//! Feature modules launch through [`crate::apps::launch`]; this module owns the
//! geometry and native window-move adapters. Virtual desktops / Spaces are
//! out of scope — only the physical work area is a target.

use std::path::Path;

use tauri::AppHandle;
#[cfg(target_os = "windows")]
use tauri::Manager;

#[cfg(target_os = "windows")]
use crate::display::DisplayArea;
#[cfg(target_os = "windows")]
use crate::floating_panel::MAIN_LABEL;
use crate::runtime;

#[cfg(target_os = "macos")]
use super::place_macos;
#[cfg(target_os = "windows")]
use super::place_win;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct NativeWorkArea {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub frame_x: i32,
    pub frame_y: i32,
    pub frame_w: i32,
    pub frame_h: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct WindowRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PlaceResult {
    Moved,
    AlreadyOnDisplay,
    NoWindows,
    Unavailable,
}

impl NativeWorkArea {
    #[cfg(target_os = "windows")]
    pub(crate) fn from_display_area(area: DisplayArea) -> Self {
        Self {
            x: area.work_x,
            y: area.work_y,
            w: area.work_width as i32,
            h: area.work_height as i32,
            frame_x: area.frame_x,
            frame_y: area.frame_y,
            frame_w: area.frame_width as i32,
            frame_h: area.frame_height as i32,
        }
    }

    pub(crate) fn contains_center(self, window: WindowRect) -> bool {
        let cx = window.x.saturating_add(window.w / 2);
        let cy = window.y.saturating_add(window.h / 2);
        cx >= self.x
            && cx < self.x.saturating_add(self.w)
            && cy >= self.y
            && cy < self.y.saturating_add(self.h)
    }

    pub(crate) fn same_frame(self, other: Self) -> bool {
        (self.frame_x - other.frame_x).abs() <= 4
            && (self.frame_y - other.frame_y).abs() <= 4
            && (self.frame_w - other.frame_w).abs() <= 4
            && (self.frame_h - other.frame_h).abs() <= 4
    }
}

impl WindowRect {
    pub(crate) fn is_fullscreen_on(self, display: NativeWorkArea) -> bool {
        self.w >= display.frame_w.saturating_sub(16)
            && self.h >= display.frame_h.saturating_sub(16)
            && (self.x - display.frame_x).abs() <= 16
            && (self.y - display.frame_y).abs() <= 16
    }
}

/// Capture the physical display Qx should launch onto. `None` on a single
/// display (nothing to move) or when the OS inventory is unavailable.
pub(crate) fn capture_qx_launch_display(app: &AppHandle) -> Option<NativeWorkArea> {
    let app = app.clone();
    runtime::run_ui(&app.clone(), move || capture_qx_launch_display_now(&app))
        .ok()
        .flatten()
}

fn capture_qx_launch_display_now(app: &AppHandle) -> Option<NativeWorkArea> {
    let monitor_count = app.available_monitors().ok()?.len();
    if monitor_count < 2 {
        return None;
    }

    #[cfg(target_os = "macos")]
    {
        return place_macos::capture_launch_display(app);
    }

    #[cfg(target_os = "windows")]
    {
        return capture_windows_launch_display(app);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = app;
        None
    }
}

#[cfg(target_os = "windows")]
fn capture_windows_launch_display(app: &AppHandle) -> Option<NativeWorkArea> {
    use crate::display::{display_area_for_window, resolve_pointer_display};

    let win = app.get_webview_window(MAIN_LABEL)?;
    let visible = win.is_visible().unwrap_or(false);
    if visible {
        if let Some(area) = display_area_for_window(&win) {
            return Some(NativeWorkArea::from_display_area(area));
        }
    }
    resolve_pointer_display(app, Some(&win), None).map(NativeWorkArea::from_display_area)
}

pub(crate) fn app_has_placeable_windows(path: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        place_macos::has_placeable_windows(path)
    }
    #[cfg(target_os = "windows")]
    {
        place_win::has_placeable_windows(path)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = path;
        false
    }
}

pub(crate) fn place_launched_app(path: &Path, target: NativeWorkArea) -> PlaceResult {
    #[cfg(target_os = "macos")]
    {
        place_macos::place_app_bundle(path, target)
    }
    #[cfg(target_os = "windows")]
    {
        place_win::place_app_path(path, target)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (path, target);
        PlaceResult::Unavailable
    }
}

/// Map `primary` from `source` onto `target`, preserving its offset from the
/// source origin and clamping so the window stays in the target work area.
pub(crate) fn translation_onto_display(
    primary: WindowRect,
    source: NativeWorkArea,
    target: NativeWorkArea,
) -> Option<(i32, i32)> {
    if source.same_frame(target) || target.contains_center(primary) {
        return None;
    }
    if primary.w <= 0 || primary.h <= 0 {
        return None;
    }

    let mapped = WindowRect {
        x: target.x.saturating_add(primary.x.saturating_sub(source.x)),
        y: target.y.saturating_add(primary.y.saturating_sub(source.y)),
        w: primary.w,
        h: primary.h,
    };
    let (x, y) = clamp_to_work(mapped, target);
    let dx = x.saturating_sub(primary.x);
    let dy = y.saturating_sub(primary.y);
    if dx == 0 && dy == 0 {
        None
    } else {
        Some((dx, dy))
    }
}

pub(crate) fn clamp_to_work(window: WindowRect, target: NativeWorkArea) -> (i32, i32) {
    let x = if window.w >= target.w {
        target.x
    } else {
        window.x.clamp(
            target.x,
            target.x.saturating_add(target.w.saturating_sub(window.w)),
        )
    };
    let y = if window.h >= target.h {
        target.y
    } else {
        window.y.clamp(
            target.y,
            target.y.saturating_add(target.h.saturating_sub(window.h)),
        )
    };
    (x, y)
}

pub(crate) fn largest_window(windows: &[WindowRect]) -> Option<WindowRect> {
    windows
        .iter()
        .copied()
        .max_by_key(|window| (window.w.max(0) as i64).saturating_mul(window.h.max(0) as i64))
}

#[cfg(test)]
mod tests {
    use super::{translation_onto_display, NativeWorkArea, WindowRect};

    fn area(x: i32, y: i32, w: i32, h: i32) -> NativeWorkArea {
        NativeWorkArea {
            x,
            y,
            w,
            h,
            frame_x: x,
            frame_y: y,
            frame_w: w,
            frame_h: h,
        }
    }

    fn rect(x: i32, y: i32, w: i32, h: i32) -> WindowRect {
        WindowRect { x, y, w, h }
    }

    #[test]
    fn already_on_target_is_noop() {
        let target = area(1920, 0, 1920, 1080);
        let window = rect(2000, 80, 800, 600);
        assert_eq!(translation_onto_display(window, target, target), None);
        assert_eq!(
            translation_onto_display(window, area(0, 0, 1920, 1080), target),
            None
        );
    }

    #[test]
    fn preserves_offset_when_moving_right() {
        let source = area(0, 0, 1920, 1080);
        let target = area(1920, 0, 1920, 1080);
        let window = rect(100, 80, 800, 600);
        assert_eq!(
            translation_onto_display(window, source, target),
            Some((1920, 0))
        );
    }

    #[test]
    fn clamps_to_smaller_target() {
        let source = area(0, 0, 2560, 1440);
        let target = area(2560, 0, 1280, 800);
        let window = rect(1800, 900, 900, 700);
        let (dx, dy) = translation_onto_display(window, source, target).unwrap();
        let placed = rect(window.x + dx, window.y + dy, window.w, window.h);
        assert!(placed.x >= target.x);
        assert!(placed.y >= target.y);
        assert!(placed.x + placed.w <= target.x + target.w);
        assert!(placed.y + placed.h <= target.y + target.h);
    }
}
