use arboard::{Clipboard, ImageData};
use chrono::Local;
use image::{ImageBuffer, ImageEncoder, Rgba};
use serde::Serialize;
use std::borrow::Cow;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::command;
use xcap::{Monitor, Window};

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

fn save_image_capture(image: &xcap::image::RgbaImage, save_path: &PathBuf) -> Result<(), String> {
    image
        .save(save_path)
        .map_err(|e| format!("Failed to save screenshot: {e}"))
}

fn screenshot_result(save_path: PathBuf) -> ScreenshotResult {
    ScreenshotResult {
        path: save_path.to_string_lossy().to_string(),
        timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    }
}

fn screenshot_path(prefix: &str) -> PathBuf {
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    get_screenshots_dir().join(format!("{prefix}_{timestamp}.png"))
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

    let save_path = screenshot_path("screenshot");

    save_monitor_capture(&monitor, &save_path)?;

    Ok(screenshot_result(save_path))
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

#[derive(Debug, Serialize)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub app_name: String,
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

    let save_path = screenshot_path("screenshot");

    save_monitor_capture(&monitors[0], &save_path)?;

    Ok(screenshot_result(save_path))
}

#[command]
pub fn capture_all_monitors() -> Result<ScreenshotResult, String> {
    let monitors = Monitor::all().map_err(|e| format!("Failed to list monitors: {e}"))?;
    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    let save_path = screenshot_path("screenshot_all");
    if monitors.len() == 1 {
        save_monitor_capture(&monitors[0], &save_path)?;
        return Ok(screenshot_result(save_path));
    }

    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;
    let mut captures: Vec<(i32, i32, xcap::image::RgbaImage)> = Vec::new();

    for monitor in &monitors {
        let x = monitor.x().map_err(capture_permission_hint)?;
        let y = monitor.y().map_err(capture_permission_hint)?;
        let image = monitor.capture_image().map_err(capture_permission_hint)?;
        let w = image.width() as i32;
        let h = image.height() as i32;
        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x + w);
        max_y = max_y.max(y + h);
        captures.push((x, y, image));
    }

    let total_w = (max_x - min_x).max(1) as u32;
    let total_h = (max_y - min_y).max(1) as u32;
    let mut stitched = xcap::image::RgbaImage::new(total_w, total_h);
    for (x, y, image) in &captures {
        image::imageops::overlay(&mut stitched, image, (x - min_x) as i64, (y - min_y) as i64);
    }

    save_image_capture(&stitched, &save_path)?;
    Ok(screenshot_result(save_path))
}

fn is_filtered_window(title: &str, app_name: &str) -> bool {
    const FILTERED_TITLES: &[&str] = &[
        "Control Center",
        "Notification Center",
        "Spotlight",
        "Focus",
        "Dock",
        "Window Server",
        "WindowManager",
        "SystemUIServer",
        "Wallpaper",
        "Finder Desktop",
    ];
    const FILTERED_APPS: &[&str] = &[
        "Control Center",
        "Notification Center",
        "WindowManager",
        "Window Server",
        "Dock",
        "SystemUIServer",
        "Spotlight",
        "Qx",
    ];

    title.trim().is_empty()
        || FILTERED_TITLES.iter().any(|needle| title.contains(needle))
        || FILTERED_APPS.iter().any(|needle| app_name == *needle)
}

#[command]
pub fn list_capturable_windows() -> Result<Vec<WindowInfo>, String> {
    let windows = Window::all().map_err(|e| format!("Failed to list windows: {e}"))?;
    let mut out = Vec::new();

    for window in windows {
        let title = window.title().unwrap_or_default();
        let app_name = window.app_name().unwrap_or_default();
        if is_filtered_window(&title, &app_name) {
            continue;
        }
        out.push(WindowInfo {
            id: window.id().unwrap_or(0),
            title,
            app_name,
        });
    }

    Ok(out)
}

#[command]
pub fn capture_window(window_id: u32) -> Result<ScreenshotResult, String> {
    let windows = Window::all().map_err(|e| format!("Failed to list windows: {e}"))?;
    let window = windows
        .into_iter()
        .find(|window| window.id().unwrap_or(0) == window_id)
        .ok_or_else(|| format!("Window with ID {window_id} not found"))?;

    let image = window.capture_image().map_err(capture_permission_hint)?;
    let save_path = screenshot_path("screenshot_window");
    save_image_capture(&image, &save_path)?;
    Ok(screenshot_result(save_path))
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

    let save_path = screenshot_path("screenshot_area");

    save_area_capture(monitor, x, y, width, height, &save_path)?;

    Ok(screenshot_result(save_path))
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
pub fn export_screenshot_image(
    image_data: Vec<u8>,
    width: u32,
    height: u32,
    output_path: String,
    format: String,
    quality: u32,
) -> Result<String, String> {
    let expected_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|px| px.checked_mul(4))
        .ok_or_else(|| "Image dimensions are too large".to_string())?;
    if image_data.len() != expected_len {
        return Err(format!(
            "Invalid image data: expected {expected_len} bytes, got {}",
            image_data.len()
        ));
    }

    let img: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(width, height, image_data)
        .ok_or_else(|| "Invalid image data dimensions".to_string())?;

    let path = PathBuf::from(&output_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    let file = fs::File::create(&path).map_err(|e| format!("Failed to create file: {e}"))?;
    let writer = std::io::BufWriter::new(file);

    match format.as_str() {
        "png" => image::codecs::png::PngEncoder::new(writer)
            .write_image(img.as_raw(), width, height, image::ExtendedColorType::Rgba8)
            .map_err(|e| format!("PNG encoding failed: {e}"))?,
        "jpeg" | "jpg" => {
            let rgb = image::DynamicImage::ImageRgba8(img).to_rgb8();
            image::codecs::jpeg::JpegEncoder::new_with_quality(writer, quality.min(100) as u8)
                .write_image(rgb.as_raw(), width, height, image::ExtendedColorType::Rgb8)
                .map_err(|e| format!("JPEG encoding failed: {e}"))?;
        }
        "webp" => image::codecs::webp::WebPEncoder::new_lossless(writer)
            .write_image(img.as_raw(), width, height, image::ExtendedColorType::Rgba8)
            .map_err(|e| format!("WebP encoding failed: {e}"))?,
        _ => return Err(format!("Unsupported format: {format}")),
    }

    Ok(output_path)
}

#[command]
pub fn save_temp_export(image_data: Vec<u8>, width: u32, height: u32) -> Result<String, String> {
    let output_path = std::env::temp_dir()
        .join("qx")
        .join("screenshot-export.png");
    export_screenshot_image(
        image_data,
        width,
        height,
        output_path.to_string_lossy().to_string(),
        "png".to_string(),
        100,
    )
}

#[command]
pub fn save_screenshot_project(path: String, contents: String) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    if let Some(parent) = path_buf.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    fs::write(&path_buf, contents.as_bytes())
        .map_err(|e| format!("Failed to save project: {e}"))?;
    Ok(path)
}

#[command]
pub fn read_screenshot_project(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read project: {e}"))
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
