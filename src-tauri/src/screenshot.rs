use chrono::Local;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::command;

#[derive(Debug, Serialize)]
pub struct ScreenshotResult {
    pub path: String,
    pub timestamp: String,
}

fn get_screenshots_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/Pictures/Qx", home));
    let _ = fs::create_dir_all(&dir);
    dir
}

#[command]
pub fn take_screenshot() -> Result<ScreenshotResult, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;

    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    let primary = &monitors[0];
    let image = primary
        .capture_image()
        .map_err(|e| format!("Failed to capture: {}", e))?;

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = format!("screenshot_{}.png", timestamp);
    let save_path = get_screenshots_dir().join(&filename);

    image
        .save(&save_path)
        .map_err(|e| format!("Failed to save screenshot: {}", e))?;

    Ok(ScreenshotResult {
        path: save_path.to_string_lossy().to_string(),
        timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    })
}

#[command]
pub fn take_screenshot_area(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<ScreenshotResult, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Failed to get monitors: {}", e))?;

    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    let primary = &monitors[0];
    let image = primary
        .capture_image()
        .map_err(|e| format!("Failed to capture: {}", e))?;

    let x = x.max(0) as u32;
    let y = y.max(0) as u32;
    let width = width.min(image.width() - x);
    let height = height.min(image.height() - y);

    let cropped = image::imageops::crop_imm(&image, x, y, width, height).to_image();

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = format!("screenshot_area_{}.png", timestamp);
    let save_path = get_screenshots_dir().join(&filename);

    cropped
        .save(&save_path)
        .map_err(|e| format!("Failed to save screenshot: {}", e))?;

    Ok(ScreenshotResult {
        path: save_path.to_string_lossy().to_string(),
        timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    })
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
