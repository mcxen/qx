use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Local;
use image::ImageEncoder;
use std::io::BufWriter;

use super::annotations::{composite as composite_annotations, contains_mosaic, CaptureAnnotation};
use super::geometry::clamp_area;
use super::storage::{captures_dir, insert_history};
use super::types::{RecordArea, RecordingOutput};
use crate::display::{capture_monitor, capture_region_from_monitor};

/// Capture a still PNG of `area` into the screencap library (and history).
/// Used by the interactive picker and headless QxAI / schedule jobs.
pub(crate) fn capture(
    area: RecordArea,
    annotations: Option<Vec<CaptureAnnotation>>,
    annotation_scale: f64,
    include_cursor: bool,
) -> Result<RecordingOutput, String> {
    // The picker hide is dispatched synchronously to the UI thread. Synchronize
    // with DWM on Windows, then keep only a short driver grace period instead
    // of paying the old fixed 80-110 ms on every screenshot.
    // Mosaic redaction needs a clean post-hide frame; Windows layered-window
    // teardown can lag slightly longer when the picker also hosted a freeze
    // capture earlier in the session.
    let has_mosaic = annotations.as_deref().is_some_and(contains_mosaic);
    #[cfg(target_os = "windows")]
    {
        let dwm_synced = unsafe { windows_sys::Win32::Graphics::Dwm::DwmFlush() } >= 0;
        let grace_ms = if dwm_synced {
            if has_mosaic {
                24
            } else {
                12
            }
        } else if has_mosaic {
            110
        } else {
            80
        };
        std::thread::sleep(std::time::Duration::from_millis(grace_ms));
    }
    #[cfg(target_os = "macos")]
    // Hiding the protected, full-display picker is asynchronous in
    // WindowServer. Give system-owned layers (menu bar, Dock, and app window
    // chrome) one compositor turn before taking the framebuffer snapshot.
    std::thread::sleep(std::time::Duration::from_millis(if has_mosaic {
        110
    } else {
        80
    }));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    std::thread::sleep(std::time::Duration::from_millis(if has_mosaic {
        32
    } else {
        24
    }));
    let monitor = capture_monitor(area.monitor_id)?;
    let mon_w = monitor
        .width()
        .map_err(|error| format!("display width: {error}"))?;
    let mon_h = monitor
        .height()
        .map_err(|error| format!("display height: {error}"))?;
    let area = clamp_area(area, mon_w, mon_h)
        .ok_or_else(|| "Selection is outside the selected display".to_string())?;
    // Interactive capture crops the immutable frame displayed by the picker;
    // silent/headless recapture has no picker snapshot and samples live pixels.
    let frozen = super::snapshot::crop(&area)?;
    let used_frozen_frame = frozen.is_some();
    let mut image = match frozen {
        Some(image) => image,
        None => capture_region_from_monitor(&monitor, area.x, area.y, area.w, area.h)?,
    };
    if include_cursor && !used_frozen_frame {
        crate::input_events::composite_pointer(
            &mut image,
            (
                monitor.x().unwrap_or_default(),
                monitor.y().unwrap_or_default(),
            ),
            monitor.scale_factor().unwrap_or(1.0) as f64,
            (area.x, area.y),
            false,
        );
    }
    // One source-pixel compositor owns mosaic, rectangle, arrow, pen, number,
    // and text output. The WebView canvas is preview-only and is never resized
    // or overlaid onto the saved image.
    if let Some(annotations) = annotations.as_deref() {
        composite_annotations(&mut image, annotations, annotation_scale)?;
    }
    let timestamp = Local::now().format("%Y%m%d_%H%M%S_%3f").to_string();
    let output_path = captures_dir().join(format!("screenshot_{timestamp}.png"));
    let (width, height) = image.dimensions();
    let file = std::fs::File::create(&output_path)
        .map_err(|error| format!("create screenshot: {error}"))?;
    image::codecs::png::PngEncoder::new_with_quality(
        BufWriter::new(file),
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Sub,
    )
    .write_image(
        image.as_raw(),
        width,
        height,
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|error| format!("save screenshot: {error}"))?;
    insert_history(&output_path, width, height, 1, 0)
        .map_err(|error| format!("save screenshot history: {error}"))?;
    let rgba = image.into_raw();
    Ok(RecordingOutput {
        path: output_path,
        thumbnail_path: None,
        width,
        height,
        frame_count: 1,
        rgba: Some(rgba),
    })
}

/// Capture a selection region as PNG base64 for live mosaic preview (no history).
///
/// Windows note: the picker uses `WDA_EXCLUDEFROMCAPTURE`. WGC can still return
/// the desktop beneath, but GDI `BitBlt` often paints excluded windows as black
/// boxes. Reject effectively-black frames so the frontend keeps outline-only
/// preview rather than sampling garbage pixels. Final export is unaffected —
/// it captures after the picker is hidden.
pub(super) fn preview_region_base64(area: RecordArea) -> Result<String, String> {
    let monitor = capture_monitor(area.monitor_id)?;
    let mon_w = monitor
        .width()
        .map_err(|error| format!("display width: {error}"))?;
    let mon_h = monitor
        .height()
        .map_err(|error| format!("display height: {error}"))?;
    let area = clamp_area(area, mon_w, mon_h)
        .ok_or_else(|| "Selection is outside the selected display".to_string())?;
    let image = super::snapshot::crop(&area)?
        .ok_or_else(|| "Frozen desktop frame is unavailable".to_string())?;
    let mut bytes = Vec::new();
    {
        let writer = BufWriter::new(&mut bytes);
        image::codecs::png::PngEncoder::new_with_quality(
            writer,
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::Sub,
        )
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| format!("encode selection preview: {error}"))?;
    }
    Ok(BASE64.encode(bytes))
}
