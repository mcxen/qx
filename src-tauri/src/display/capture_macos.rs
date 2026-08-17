//! macOS display-frame capture adapter.
//!
//! `xcap 0.9` builds still images with `CGWindowListCreateImage`. A protected,
//! full-display picker is itself a WindowServer layer, and that window-list
//! snapshot can omit the system layers it covered (notably the menu bar and
//! Dock) immediately after the picker is hidden. Capture the display
//! framebuffer instead, then crop it in framebuffer pixels. This is also the
//! full-desktop snapshot pattern used by established screenshot tools.

use core_graphics::display::CGDisplay;

pub(super) fn capture_region(
    monitor: &xcap::Monitor,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<image::RgbaImage, String> {
    let display_id = monitor
        .id()
        .map_err(|error| format!("display id: {error}"))?;
    let monitor_width = monitor
        .width()
        .map_err(|error| format!("display width: {error}"))?;
    let monitor_height = monitor
        .height()
        .map_err(|error| format!("display height: {error}"))?;
    if width == 0
        || height == 0
        || x.saturating_add(width) > monitor_width
        || y.saturating_add(height) > monitor_height
    {
        return Err(format!(
            "capture region ({x}, {y}, {width}, {height}) is outside display ({monitor_width}, {monitor_height})"
        ));
    }

    // CGDisplayCreateImage is a synchronous framebuffer snapshot. Qx targets
    // macOS 14+, where the long-term successor is ScreenCaptureKit; keeping the
    // adapter narrow lets that implementation change without touching
    // screenshot, OCR, clipboard, or recording consumers.
    let frame = CGDisplay::new(display_id)
        .image()
        .ok_or_else(|| "capture display framebuffer: no image returned".to_string())?;
    if frame.bits_per_pixel() != 32 || frame.bits_per_component() != 8 {
        return Err(format!(
            "capture display framebuffer: unsupported {}-bit pixel format",
            frame.bits_per_pixel()
        ));
    }

    let bounds = scaled_crop_bounds(
        frame.width() as u32,
        frame.height() as u32,
        monitor_width,
        monitor_height,
        x,
        y,
        width,
        height,
    );
    bgra_crop_to_rgba(frame.data().bytes(), frame.bytes_per_row(), bounds)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PixelCrop {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

fn scaled_crop_bounds(
    frame_width: u32,
    frame_height: u32,
    monitor_width: u32,
    monitor_height: u32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> PixelCrop {
    let scale_x = frame_width as f64 / monitor_width.max(1) as f64;
    let scale_y = frame_height as f64 / monitor_height.max(1) as f64;
    let pixel_x = (x as f64 * scale_x).round() as u32;
    let pixel_y = (y as f64 * scale_y).round() as u32;
    PixelCrop {
        x: pixel_x.min(frame_width.saturating_sub(1)),
        y: pixel_y.min(frame_height.saturating_sub(1)),
        width: ((width as f64 * scale_x).round().max(1.0) as u32)
            .min(frame_width.saturating_sub(pixel_x).max(1)),
        height: ((height as f64 * scale_y).round().max(1.0) as u32)
            .min(frame_height.saturating_sub(pixel_y).max(1)),
    }
}

fn bgra_crop_to_rgba(
    source: &[u8],
    source_stride: usize,
    crop: PixelCrop,
) -> Result<image::RgbaImage, String> {
    let row_bytes = crop.width as usize * 4;
    let last_row = crop.y as usize + crop.height as usize - 1;
    let required = last_row
        .checked_mul(source_stride)
        .and_then(|offset| offset.checked_add(crop.x as usize * 4 + row_bytes))
        .ok_or_else(|| "capture display framebuffer: buffer bounds overflow".to_string())?;
    if required > source.len() {
        return Err("capture display framebuffer: truncated pixel buffer".to_string());
    }

    let mut rgba = vec![0_u8; row_bytes * crop.height as usize];
    for row in 0..crop.height as usize {
        let source_start = (crop.y as usize + row) * source_stride + crop.x as usize * 4;
        let target_start = row * row_bytes;
        rgba[target_start..target_start + row_bytes]
            .copy_from_slice(&source[source_start..source_start + row_bytes]);
    }
    for pixel in rgba.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    image::RgbaImage::from_raw(crop.width, crop.height, rgba)
        .ok_or_else(|| "capture display framebuffer: invalid RGBA buffer".to_string())
}

#[cfg(test)]
mod tests {
    use super::{bgra_crop_to_rgba, scaled_crop_bounds, PixelCrop};

    #[test]
    fn retina_crop_scales_points_to_framebuffer_pixels() {
        assert_eq!(
            scaled_crop_bounds(3024, 1964, 1512, 982, 10, 20, 100, 50),
            PixelCrop {
                x: 20,
                y: 40,
                width: 200,
                height: 100,
            }
        );
    }

    #[test]
    fn crop_respects_row_padding_and_converts_bgra() {
        let source = [
            1, 2, 3, 255, 4, 5, 6, 255, 0, 0, 0, 0, 7, 8, 9, 255, 10, 11, 12, 255, 0, 0, 0, 0,
        ];
        let image = bgra_crop_to_rgba(
            &source,
            12,
            PixelCrop {
                x: 1,
                y: 0,
                width: 1,
                height: 2,
            },
        )
        .expect("valid crop");
        assert_eq!(image.as_raw(), &[6, 5, 4, 255, 12, 11, 10, 255]);
    }
}
