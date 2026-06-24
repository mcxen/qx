use arboard::{Clipboard, ImageData};
use chrono::Local;
use serde::Serialize;
use std::borrow::Cow;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::command;

fn capture_permission_hint(error: impl std::fmt::Display) -> String {
    format!(
        "Failed to capture screen: {error}. If Screen Recording is enabled, quit and reopen Qx. If it still fails, remove Qx from System Settings > Privacy & Security > Screen Recording and grant it again."
    )
}

#[cfg(target_os = "macos")]
fn run_screencapture(args: &[String], save_path: &PathBuf) -> Result<(), String> {
    let output = Command::new("screencapture")
        .args(args)
        .arg(save_path)
        .output()
        .map_err(|e| capture_permission_hint(e))?;

    if output.status.success() && save_path.exists() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let reason = if stderr.is_empty() {
        format!("screencapture exited with {}", output.status)
    } else {
        stderr
    };
    Err(capture_permission_hint(reason))
}

#[cfg(target_os = "macos")]
fn save_monitor_capture(monitor: &xcap::Monitor, save_path: &PathBuf) -> Result<(), String> {
    let scale = monitor.scale_factor().unwrap_or(1.0).max(1.0) as f64;
    let x = monitor.x().map_err(capture_permission_hint)? as f64 / scale;
    let y = monitor.y().map_err(capture_permission_hint)? as f64 / scale;
    let width = monitor.width().map_err(capture_permission_hint)? as f64 / scale;
    let height = monitor.height().map_err(capture_permission_hint)? as f64 / scale;
    let rect = format!(
        "{},{},{},{}",
        x.round() as i32,
        y.round() as i32,
        width.round() as u32,
        height.round() as u32
    );
    run_screencapture(&["-x".to_string(), "-R".to_string(), rect], save_path)
}

#[cfg(not(target_os = "macos"))]
fn save_monitor_capture(monitor: &xcap::Monitor, save_path: &PathBuf) -> Result<(), String> {
    let image = monitor.capture_image().map_err(capture_permission_hint)?;
    image
        .save(save_path)
        .map_err(|e| format!("Failed to save screenshot: {e}"))
}

#[cfg(target_os = "macos")]
fn save_area_capture(
    monitor: &xcap::Monitor,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    save_path: &PathBuf,
) -> Result<(), String> {
    let scale = monitor.scale_factor().unwrap_or(1.0).max(1.0) as f64;
    let monitor_x = monitor.x().map_err(capture_permission_hint)? as f64 / scale;
    let monitor_y = monitor.y().map_err(capture_permission_hint)? as f64 / scale;
    let rect = format!(
        "{},{},{},{}",
        (monitor_x + (x as f64 / scale)).round() as i32,
        (monitor_y + (y as f64 / scale)).round() as i32,
        (width as f64 / scale).round().max(1.0) as u32,
        (height as f64 / scale).round().max(1.0) as u32
    );
    run_screencapture(&["-x".to_string(), "-R".to_string(), rect], save_path)
}

#[cfg(not(target_os = "macos"))]
fn save_area_capture(
    monitor: &xcap::Monitor,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    save_path: &PathBuf,
) -> Result<(), String> {
    let full = monitor.capture_image().map_err(capture_permission_hint)?;
    let mon_x = monitor.x().unwrap_or(0);
    let mon_y = monitor.y().unwrap_or(0);
    let rel_x = (x - mon_x).max(0) as u32;
    let rel_y = (y - mon_y).max(0) as u32;
    let crop_w = width.min(full.width().saturating_sub(rel_x));
    let crop_h = height.min(full.height().saturating_sub(rel_y));
    let cropped = image::imageops::crop_imm(&full, rel_x, rel_y, crop_w, crop_h).to_image();
    cropped
        .save(save_path)
        .map_err(|e| format!("Failed to save screenshot: {}", e))
}

#[command]
pub fn capture_at_point(screen_x: i32, screen_y: i32) -> Result<ScreenshotResult, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Failed to get monitors: {e}"))?;

    // Find the monitor containing the cursor point
    let monitor = xcap::Monitor::from_point(screen_x, screen_y)
        .ok()
        .or_else(|| monitors.first().cloned())
        .ok_or_else(|| "No monitors found".to_string())?;

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = format!("screenshot_{}.png", timestamp);
    let save_path = get_screenshots_dir().join(&filename);

    save_monitor_capture(&monitor, &save_path)?;

    Ok(ScreenshotResult {
        path: save_path.to_string_lossy().to_string(),
        timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    })
}

#[command]
pub fn get_monitors() -> Result<Vec<MonitorInfo>, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Failed to get monitors: {e}"))?;
    let mut out = Vec::with_capacity(monitors.len());
    for m in &monitors {
        out.push(MonitorInfo {
            id: m.id().unwrap_or(0),
            x: m.x().map_err(|e| format!("{e}"))?,
            y: m.y().map_err(|e| format!("{e}"))?,
            width: m.width().map_err(|e| format!("{e}"))?,
            height: m.height().map_err(|e| format!("{e}"))?,
            scale_factor: m.scale_factor().unwrap_or(1.0) as f64,
        });
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
pub struct MonitorInfo {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

#[derive(Debug, Serialize)]
pub struct ScreenshotResult {
    pub path: String,
    pub timestamp: String,
}

fn get_screenshots_dir() -> PathBuf {
    // Cross-platform: use dirs::picture_dir() (resolves to ~/Pictures on macOS/Linux,
    // %USERPROFILE%\Pictures on Windows). Fall back to $HOME-based or /tmp for
    // environments where the Pictures directory can't be determined.
    let base = dirs::picture_dir().unwrap_or_else(|| {
        std::env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/tmp"))
    });
    let dir = base.join("Qx");
    let _ = fs::create_dir_all(&dir);
    dir
}

#[command]
pub fn take_screenshot() -> Result<ScreenshotResult, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;

    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = format!("screenshot_{}.png", timestamp);
    let save_path = get_screenshots_dir().join(&filename);

    save_monitor_capture(&monitors[0], &save_path)?;

    Ok(ScreenshotResult {
        path: save_path.to_string_lossy().to_string(),
        timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    })
}

/// Capture a region directly from the specified monitor.
/// On macOS this uses the system screencapture tool with a logical-point rect;
/// other platforms keep the xcap full-monitor capture and crop path.
#[command]
pub fn take_screenshot_area(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    monitor_index: u32,
) -> Result<ScreenshotResult, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Failed to get monitors: {e}"))?;
    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    let idx = monitor_index.min(monitors.len() as u32 - 1) as usize;
    let monitor = &monitors[idx];

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = format!("screenshot_area_{}.png", timestamp);
    let save_path = get_screenshots_dir().join(&filename);

    save_area_capture(monitor, x, y, width, height, &save_path)?;

    Ok(ScreenshotResult {
        path: save_path.to_string_lossy().to_string(),
        timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    })
}

/// Copy a screenshot image (PNG file) to the system clipboard.
#[command]
pub fn copy_screenshot_to_clipboard(path: String) -> Result<(), String> {
    let img = image::open(&path).map_err(|e| format!("Failed to open image: {e}"))?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let bytes = rgba.into_raw();

    let mut clipboard = Clipboard::new().map_err(|e| format!("Failed to open clipboard: {e}"))?;
    clipboard
        .set_image(ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::Owned(bytes),
        })
        .map_err(|e| format!("Failed to copy image to clipboard: {e}"))?;

    Ok(())
}

/// Open a screenshot in the default image viewer (Preview on macOS).
#[command]
pub fn open_in_preview(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open file: {e}"))?;
    Ok(())
}

/// Delete a screenshot file.
#[command]
pub fn delete_screenshot(path: String) -> Result<(), String> {
    fs::remove_file(&path).map_err(|e| format!("Failed to delete screenshot: {e}"))
}

#[command]
pub fn get_recent_screenshots(limit: u32) -> Vec<ScreenshotResult> {
    let dir = get_screenshots_dir();
    let mut results = Vec::new();

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "png").unwrap_or(false) {
                if let Ok(metadata) = fs::metadata(&path) {
                    if let Ok(modified) = metadata.modified() {
                        let datetime: chrono::DateTime<Local> = modified.into();
                        results.push(ScreenshotResult {
                            path: path.to_string_lossy().to_string(),
                            timestamp: datetime.format("%Y-%m-%d %H:%M:%S").to_string(),
                        });
                    }
                }
            }
        }
    }

    results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    results.truncate(limit as usize);
    results
}
