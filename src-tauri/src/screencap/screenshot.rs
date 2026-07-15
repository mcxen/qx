use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::Local;

use super::geometry::clamp_area;
use super::storage::{captures_dir, insert_history};
use super::types::{RecordArea, RecordingOutput};
use crate::display::{capture_monitor, capture_region};

pub(super) fn capture(
    area: RecordArea,
    annotation_overlay_base64: Option<String>,
) -> Result<RecordingOutput, String> {
    // Allow the protected picker window to finish hiding before the still frame.
    std::thread::sleep(std::time::Duration::from_millis(120));
    let monitor = capture_monitor(area.monitor_id)?;
    let mon_w = monitor
        .width()
        .map_err(|error| format!("display width: {error}"))?;
    let mon_h = monitor
        .height()
        .map_err(|error| format!("display height: {error}"))?;
    let area = clamp_area(area, mon_w, mon_h)
        .ok_or_else(|| "Selection is outside the selected display".to_string())?;
    // Region still-frame is a display system capability; screencap only owns
    // annotation composite + history persistence.
    let mut image = capture_region(area.monitor_id, area.x, area.y, area.w, area.h)?;
    composite_annotation_overlay(&mut image, annotation_overlay_base64.as_deref())?;
    let timestamp = Local::now().format("%Y%m%d_%H%M%S_%3f").to_string();
    let output_path = captures_dir().join(format!("screenshot_{timestamp}.png"));
    image
        .save(&output_path)
        .map_err(|error| format!("save screenshot: {error}"))?;
    let (width, height) = image.dimensions();
    insert_history(&output_path, width, height, 1, 0)
        .map_err(|error| format!("save screenshot history: {error}"))?;
    Ok(RecordingOutput {
        path: output_path,
        width,
        height,
        frame_count: 1,
    })
}

fn composite_annotation_overlay(
    image: &mut image::RgbaImage,
    annotation_overlay_base64: Option<&str>,
) -> Result<(), String> {
    let Some(encoded) = annotation_overlay_base64.filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    let bytes = BASE64
        .decode(encoded)
        .map_err(|error| format!("decode screenshot annotations: {error}"))?;
    let overlay = image::load_from_memory(&bytes)
        .map_err(|error| format!("read screenshot annotations: {error}"))?
        .to_rgba8();
    let overlay = if overlay.dimensions() == image.dimensions() {
        overlay
    } else {
        image::imageops::resize(
            &overlay,
            image.width(),
            image.height(),
            image::imageops::FilterType::Lanczos3,
        )
    };
    image::imageops::overlay(image, &overlay, 0, 0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

    use super::composite_annotation_overlay;

    #[test]
    fn annotations_are_composited() {
        let mut base = image::RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 255]));
        let overlay = image::RgbaImage::from_pixel(2, 2, image::Rgba([255, 0, 0, 255]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(overlay)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let encoded = BASE64.encode(bytes.into_inner());
        composite_annotation_overlay(&mut base, Some(&encoded)).unwrap();
        assert_eq!(base.get_pixel(2, 2), &image::Rgba([255, 0, 0, 255]));
    }
}
