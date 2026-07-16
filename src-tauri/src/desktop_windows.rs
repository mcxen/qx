//! System-level desktop window inventory.
//!
//! Enumerates visible top-level windows with stable geometry for any feature
//! that needs window targeting (capture hover-select, layout tools, etc.).
//! Feature modules must not call `xcap::Window` directly.

use serde::{Deserialize, Serialize};
use tauri::command;

use crate::display::capture_monitor;

/// Visible desktop window in capture-backend pixel space (monitor-absolute).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWindow {
    pub id: u32,
    pub title: String,
    pub app_name: String,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub z: i32,
    pub is_minimized: bool,
    pub is_focused: bool,
    pub monitor_id: Option<u32>,
}

/// Optional query filters for [`list_windows`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopWindowQuery {
    /// Only windows that intersect this capture-monitor id.
    pub monitor_id: Option<u32>,
    /// Convert rects into logical points relative to that monitor origin.
    /// Requires `monitor_id`. When omitted, rects stay in capture pixels.
    pub logical_scale: Option<f64>,
    /// Drop windows whose app name or title contains any of these (case-insensitive).
    #[serde(default)]
    pub exclude_name_substrings: Vec<String>,
    /// Minimum width/height in the same coordinate space as the result rect.
    #[serde(default = "default_min_size")]
    pub min_size: u32,
    /// Minimum intersection with the selected monitor (physical pixels).
    #[serde(default = "default_min_intersection")]
    pub min_intersection: i32,
}

impl Default for DesktopWindowQuery {
    fn default() -> Self {
        Self {
            monitor_id: None,
            logical_scale: None,
            exclude_name_substrings: Vec::new(),
            min_size: default_min_size(),
            min_intersection: default_min_intersection(),
        }
    }
}

fn default_min_size() -> u32 {
    48
}

fn default_min_intersection() -> i32 {
    32
}

/// List visible windows (front-most first). Pure system inventory — no UI policy.
pub fn list_windows(query: DesktopWindowQuery) -> Result<Vec<DesktopWindow>, String> {
    let monitor_bounds = if let Some(monitor_id) = query.monitor_id {
        let monitor = capture_monitor(Some(monitor_id))?;
        let x = monitor.x().map_err(|error| format!("display x: {error}"))?;
        let y = monitor.y().map_err(|error| format!("display y: {error}"))?;
        let w = monitor
            .width()
            .map_err(|error| format!("display width: {error}"))? as i32;
        let h = monitor
            .height()
            .map_err(|error| format!("display height: {error}"))? as i32;
        Some((x, y, w, h, monitor_id))
    } else {
        None
    };

    let logical_scale = query.logical_scale.map(|scale| scale.max(0.1));
    if logical_scale.is_some() && monitor_bounds.is_none() {
        return Err("logical_scale requires monitor_id".to_string());
    }

    let exclude: Vec<String> = query
        .exclude_name_substrings
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .collect();

    let windows = xcap::Window::all().map_err(|error| format!("list windows: {error}"))?;
    let mut result = Vec::new();

    for window in windows {
        let Ok(id) = window.id() else { continue };
        let Ok(is_minimized) = window.is_minimized() else {
            continue;
        };
        if is_minimized {
            continue;
        }
        let Ok(width) = window.width() else { continue };
        let Ok(height) = window.height() else {
            continue;
        };
        if width < 2 || height < 2 {
            continue;
        }
        let Ok(x) = window.x() else { continue };
        let Ok(y) = window.y() else { continue };
        let z = window.z().unwrap_or_default();
        let is_focused = window.is_focused().unwrap_or(false);
        let title = window.title().unwrap_or_default();
        let app_name = window.app_name().unwrap_or_default();
        let title_l = title.to_ascii_lowercase();
        let app_l = app_name.to_ascii_lowercase();

        if exclude
            .iter()
            .any(|needle| app_l.contains(needle) || title_l.contains(needle))
        {
            continue;
        }

        let monitor_id = window
            .current_monitor()
            .ok()
            .and_then(|monitor| monitor.id().ok());

        if let Some((mon_x, mon_y, mon_w, mon_h, expected_id)) = monitor_bounds {
            let right = x.saturating_add(width as i32);
            let bottom = y.saturating_add(height as i32);
            let mon_right = mon_x.saturating_add(mon_w);
            let mon_bottom = mon_y.saturating_add(mon_h);
            let intersect_w = (right.min(mon_right) - x.max(mon_x)).max(0);
            let intersect_h = (bottom.min(mon_bottom) - y.max(mon_y)).max(0);
            if intersect_w < query.min_intersection || intersect_h < query.min_intersection {
                continue;
            }
            // Prefer windows that report the same monitor when available.
            if let Some(window_monitor) = monitor_id {
                if window_monitor != expected_id && intersect_w * intersect_h < (mon_w * mon_h) / 4
                {
                    // Keep large intersections even if monitor id mapping is noisy.
                }
            }

            let (out_x, out_y, out_w, out_h) = if let Some(scale) = logical_scale {
                (
                    ((x - mon_x) as f64 / scale).round() as i32,
                    ((y - mon_y) as f64 / scale).round() as i32,
                    ((width as f64 / scale).round() as u32).max(2),
                    ((height as f64 / scale).round() as u32).max(2),
                )
            } else {
                (x, y, width, height)
            };

            if out_w < query.min_size || out_h < query.min_size {
                continue;
            }

            result.push(DesktopWindow {
                id,
                title,
                app_name,
                x: out_x,
                y: out_y,
                w: out_w,
                h: out_h,
                z,
                is_minimized,
                is_focused,
                monitor_id: Some(expected_id),
            });
            continue;
        }

        if width < query.min_size || height < query.min_size {
            continue;
        }
        result.push(DesktopWindow {
            id,
            title,
            app_name,
            x,
            y,
            w: width,
            h: height,
            z,
            is_minimized,
            is_focused,
            monitor_id,
        });
    }

    Ok(result)
}

/// Capture-oriented convenience: logical rects on one monitor, excluding Qx chrome.
pub fn list_windows_for_capture(
    monitor_id: u32,
    logical_scale: f64,
) -> Result<Vec<DesktopWindow>, String> {
    list_windows(DesktopWindowQuery {
        monitor_id: Some(monitor_id),
        logical_scale: Some(logical_scale),
        exclude_name_substrings: vec![
            "qx".to_string(),
            "qx region picker".to_string(),
            "qx recording controls".to_string(),
        ],
        min_size: 48,
        min_intersection: 32,
    })
}

/// Public IPC: list desktop windows for any feature.
#[command]
pub fn desktop_windows_list(
    query: Option<DesktopWindowQuery>,
) -> Result<Vec<DesktopWindow>, String> {
    list_windows(query.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::DesktopWindowQuery;

    #[test]
    fn query_defaults_are_conservative() {
        let query = DesktopWindowQuery::default();
        assert_eq!(query.min_size, 48);
        assert_eq!(query.min_intersection, 32);
        assert!(query.exclude_name_substrings.is_empty());
    }
}
