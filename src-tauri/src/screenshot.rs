use chrono::Local;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::command;

#[command]
pub fn capture_at_point(screen_x: i32, screen_y: i32) -> Result<ScreenshotResult, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("Failed to get monitors: {e}"))?;

    // Find the monitor containing the cursor point
    let monitor = xcap::Monitor::from_point(screen_x, screen_y)
        .ok()
        .or_else(|| monitors.first().cloned())
        .ok_or_else(|| "No monitors found".to_string())?;

    let image = monitor
        .capture_image()
        .map_err(|e| format!("Failed to capture: {e}"))?;

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = format!("screenshot_{}.png", timestamp);
    let save_path = get_screenshots_dir().join(&filename);

    image
        .save(&save_path)
        .map_err(|e| format!("Failed to save screenshot: {e}"))?;

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
    source_path: Option<String>, // reuse existing full-screenshot file
) -> Result<ScreenshotResult, String> {
    // Load image: either from source_path or capture monitors[0] as fallback
    let image: image::DynamicImage = if let Some(path) = &source_path {
        image::open(path).map_err(|e| format!("Failed to open source image: {e}"))?
    } else {
        let monitors = xcap::Monitor::all().map_err(|e| format!("Failed to get monitors: {e}"))?;
        if monitors.is_empty() {
            return Err("No monitors found".to_string());
        }
        image::DynamicImage::from(
            monitors[0]
                .capture_image()
                .map_err(|e| format!("Failed to capture: {e}"))?,
        )
    };

    let x = x.max(0) as u32;
    let y = y.max(0) as u32;
    let width = width.min(image.width().saturating_sub(x));
    let height = height.min(image.height().saturating_sub(y));

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
