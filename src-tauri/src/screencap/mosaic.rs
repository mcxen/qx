//! True block pixelation for capture privacy masks.
//!
//! Unlike a transparent CSS-blur overlay, these helpers sample real pixels from
//! the captured frame and replace each N×N cell with a solid average color so
//! small text and QR codes cannot be recovered from the export.

use image::RgbaImage;
use serde::Deserialize;

/// One mosaic operation in selection-normalized coordinates (0..1).
///
/// Frontend sends camelCase (`mode`, `blockSize`, `x1`…). Internally tagged so
/// both Windows WebView2 and macOS WKWebView IPC decode the same JSON shape.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum MosaicOp {
    /// Axis-aligned rectangle (primary privacy tool).
    #[serde(rename = "region")]
    Region {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        /// Block edge as a fraction of `min(image_w, image_h)`.
        #[serde(default = "default_block_size", alias = "blockSize")]
        block_size: f64,
    },
    /// Freehand brush: thick stroke sampled from the real image.
    #[serde(rename = "brush")]
    Brush {
        points: Vec<MosaicPoint>,
        /// Brush radius as a fraction of `min(image_w, image_h)`.
        #[serde(default = "default_brush_radius")]
        radius: f64,
        #[serde(default = "default_block_size", alias = "blockSize")]
        block_size: f64,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MosaicPoint {
    pub x: f64,
    pub y: f64,
}

fn default_block_size() -> f64 {
    0.035
}

fn default_brush_radius() -> f64 {
    0.045
}

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn block_pixels(image: &RgbaImage, block_size: f64) -> u32 {
    let min_side = image.width().min(image.height()).max(1) as f64;
    let px = (block_size.clamp(0.004, 0.25) * min_side).round() as u32;
    px.clamp(4, 96)
}

fn radius_pixels(image: &RgbaImage, radius: f64) -> f64 {
    let min_side = image.width().min(image.height()).max(1) as f64;
    (radius.clamp(0.004, 0.35) * min_side).max(2.0)
}

/// Average-color pixelate inside an inclusive-exclusive pixel rectangle.
pub fn pixelate_region_px(
    image: &mut RgbaImage,
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
    block: u32,
) {
    if right <= left || bottom <= top || block == 0 {
        return;
    }
    let right = right.min(image.width());
    let bottom = bottom.min(image.height());
    let left = left.min(right);
    let top = top.min(bottom);
    let block = block.max(1);

    let mut y = top;
    while y < bottom {
        let cell_bottom = (y + block).min(bottom);
        let mut x = left;
        while x < right {
            let cell_right = (x + block).min(right);
            let (r, g, b, a, count) = average_cell(image, x, y, cell_right, cell_bottom);
            if count > 0 {
                let pixel = image::Rgba([
                    (r / count) as u8,
                    (g / count) as u8,
                    (b / count) as u8,
                    (a / count) as u8,
                ]);
                for py in y..cell_bottom {
                    for px in x..cell_right {
                        image.put_pixel(px, py, pixel);
                    }
                }
            }
            x = cell_right;
        }
        y = cell_bottom;
    }
}

fn average_cell(
    image: &RgbaImage,
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
) -> (u64, u64, u64, u64, u64) {
    let mut r = 0u64;
    let mut g = 0u64;
    let mut b = 0u64;
    let mut a = 0u64;
    let mut count = 0u64;
    for py in top..bottom {
        for px in left..right {
            let p = image.get_pixel(px, py).0;
            r += p[0] as u64;
            g += p[1] as u64;
            b += p[2] as u64;
            a += p[3] as u64;
            count += 1;
        }
    }
    (r, g, b, a, count)
}

/// Pixelate every block that intersects the brush stroke mask.
pub fn pixelate_brush_px(image: &mut RgbaImage, points: &[(f64, f64)], radius: f64, block: u32) {
    if points.is_empty() || radius <= 0.0 || block == 0 {
        return;
    }
    let width = image.width();
    let height = image.height();
    if width == 0 || height == 0 {
        return;
    }

    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;
    for &(x, y) in points {
        min_x = min_x.min(x - radius);
        min_y = min_y.min(y - radius);
        max_x = max_x.max(x + radius);
        max_y = max_y.max(y + radius);
    }
    let left = min_x.floor().max(0.0) as u32;
    let top = min_y.floor().max(0.0) as u32;
    let right = (max_x.ceil() as u32).min(width);
    let bottom = (max_y.ceil() as u32).min(height);
    if right <= left || bottom <= top {
        return;
    }

    let radius_sq = radius * radius;
    let block = block.max(1);
    let mut y = top;
    while y < bottom {
        let cell_bottom = (y + block).min(bottom);
        let mut x = left;
        while x < right {
            let cell_right = (x + block).min(right);
            let cx = (x as f64 + cell_right as f64 - 1.0) * 0.5;
            let cy = (y as f64 + cell_bottom as f64 - 1.0) * 0.5;
            if stroke_hits(points, cx, cy, radius_sq) {
                let (r, g, b, a, count) = average_cell(image, x, y, cell_right, cell_bottom);
                if count > 0 {
                    let pixel = image::Rgba([
                        (r / count) as u8,
                        (g / count) as u8,
                        (b / count) as u8,
                        (a / count) as u8,
                    ]);
                    for py in y..cell_bottom {
                        for px in x..cell_right {
                            image.put_pixel(px, py, pixel);
                        }
                    }
                }
            }
            x = cell_right;
        }
        y = cell_bottom;
    }
}

fn stroke_hits(points: &[(f64, f64)], x: f64, y: f64, radius_sq: f64) -> bool {
    if points.len() == 1 {
        let (px, py) = points[0];
        let dx = x - px;
        let dy = y - py;
        return dx * dx + dy * dy <= radius_sq;
    }
    for window in points.windows(2) {
        let (x1, y1) = window[0];
        let (x2, y2) = window[1];
        if point_segment_distance_sq(x, y, x1, y1, x2, y2) <= radius_sq {
            return true;
        }
    }
    false
}

fn point_segment_distance_sq(px: f64, py: f64, x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    let dx = x2 - x1;
    let dy = y2 - y1;
    let len_sq = dx * dx + dy * dy;
    if len_sq <= f64::EPSILON {
        let ex = px - x1;
        let ey = py - y1;
        return ex * ex + ey * ey;
    }
    let t = ((px - x1) * dx + (py - y1) * dy) / len_sq;
    let t = t.clamp(0.0, 1.0);
    let proj_x = x1 + t * dx;
    let proj_y = y1 + t * dy;
    let ex = px - proj_x;
    let ey = py - proj_y;
    ex * ex + ey * ey
}

/// Apply every mosaic op (normalized coords) to a captured frame.
pub fn apply_mosaic_ops(image: &mut RgbaImage, ops: &[MosaicOp]) {
    if ops.is_empty() {
        return;
    }
    let width = image.width() as f64;
    let height = image.height() as f64;
    if width < 1.0 || height < 1.0 {
        return;
    }

    for op in ops {
        match op {
            MosaicOp::Region {
                x1,
                y1,
                x2,
                y2,
                block_size,
            } => {
                let left = (clamp01(x1.min(*x2)) * width).floor() as u32;
                let top = (clamp01(y1.min(*y2)) * height).floor() as u32;
                let right = (clamp01(x1.max(*x2)) * width).ceil() as u32;
                let bottom = (clamp01(y1.max(*y2)) * height).ceil() as u32;
                let block = block_pixels(image, *block_size);
                pixelate_region_px(
                    image,
                    left,
                    top,
                    right.max(left + 1),
                    bottom.max(top + 1),
                    block,
                );
            }
            MosaicOp::Brush {
                points,
                radius,
                block_size,
            } => {
                if points.is_empty() {
                    continue;
                }
                let pts: Vec<(f64, f64)> = points
                    .iter()
                    .map(|p| (clamp01(p.x) * width, clamp01(p.y) * height))
                    .collect();
                let radius_px = radius_pixels(image, *radius);
                let block = block_pixels(image, *block_size);
                pixelate_brush_px(image, &pts, radius_px, block);
            }
        }
    }
}

/// Convenience for recording masks that only carry axis-aligned rectangles.
pub fn pixelate_relative_rects(
    image: &mut RgbaImage,
    rects: &[super::types::RelativeCaptureRect],
    block_size: f64,
) {
    let ops: Vec<MosaicOp> = rects
        .iter()
        .map(|rect| MosaicOp::Region {
            x1: rect.x,
            y1: rect.y,
            x2: rect.x + rect.w,
            y2: rect.y + rect.h,
            block_size,
        })
        .collect();
    apply_mosaic_ops(image, &ops);
}

#[cfg(test)]
mod tests {
    use super::{apply_mosaic_ops, pixelate_region_px, MosaicOp, MosaicPoint};
    use image::{Rgba, RgbaImage};

    fn checkerboard(width: u32, height: u32) -> RgbaImage {
        let mut image = RgbaImage::new(width, height);
        for y in 0..height {
            for x in 0..width {
                let on = ((x / 2) + (y / 2)) % 2 == 0;
                let tone = if on { 255 } else { 0 };
                image.put_pixel(x, y, Rgba([tone, tone, tone, 255]));
            }
        }
        image
    }

    #[test]
    fn region_pixelate_collapses_high_frequency_detail() {
        let mut image = checkerboard(32, 32);
        pixelate_region_px(&mut image, 0, 0, 32, 32, 8);
        // Every 8×8 block is uniform.
        for by in 0..4 {
            for bx in 0..4 {
                let sample = image.get_pixel(bx * 8, by * 8).0;
                for oy in 0..8 {
                    for ox in 0..8 {
                        assert_eq!(image.get_pixel(bx * 8 + ox, by * 8 + oy).0, sample);
                    }
                }
            }
        }
    }

    #[test]
    fn brush_ops_only_touch_stroke_neighborhood() {
        let mut image = checkerboard(40, 40);
        let untouched = image.get_pixel(2, 2).0;
        apply_mosaic_ops(
            &mut image,
            &[MosaicOp::Brush {
                points: vec![
                    MosaicPoint { x: 0.5, y: 0.5 },
                    MosaicPoint { x: 0.75, y: 0.5 },
                ],
                radius: 0.08,
                block_size: 0.1,
            }],
        );
        // Far corner remains the original checker pattern sample.
        assert_eq!(image.get_pixel(2, 2).0, untouched);
        // Center of the stroke is uniform inside its block.
        let center = image.get_pixel(20, 20).0;
        assert_eq!(image.get_pixel(21, 20).0, center);
    }

    #[test]
    fn normalized_region_op_covers_expected_area() {
        let mut image = checkerboard(20, 20);
        apply_mosaic_ops(
            &mut image,
            &[MosaicOp::Region {
                x1: 0.0,
                y1: 0.0,
                x2: 0.5,
                y2: 0.5,
                block_size: 0.25,
            }],
        );
        let a = image.get_pixel(0, 0).0;
        let b = image.get_pixel(4, 4).0;
        assert_eq!(a, b);
        // Outside region keeps contrast between neighbors on the checker.
        assert_ne!(image.get_pixel(18, 18).0, image.get_pixel(16, 18).0);
    }

    #[test]
    fn frontend_camel_case_json_decodes_on_all_platforms() {
        let region: MosaicOp = serde_json::from_str(
            r#"{"mode":"region","x1":0.1,"y1":0.2,"x2":0.5,"y2":0.6,"blockSize":0.04}"#,
        )
        .expect("region op");
        match region {
            MosaicOp::Region {
                x1,
                y1,
                x2,
                y2,
                block_size,
            } => {
                assert!((x1 - 0.1).abs() < 1e-9);
                assert!((y1 - 0.2).abs() < 1e-9);
                assert!((x2 - 0.5).abs() < 1e-9);
                assert!((y2 - 0.6).abs() < 1e-9);
                assert!((block_size - 0.04).abs() < 1e-9);
            }
            MosaicOp::Brush { .. } => panic!("expected region"),
        }

        let brush: MosaicOp = serde_json::from_str(
            r#"{"mode":"brush","points":[{"x":0.1,"y":0.2},{"x":0.3,"y":0.4}],"radius":0.05,"blockSize":0.03}"#,
        )
        .expect("brush op");
        match brush {
            MosaicOp::Brush {
                points,
                radius,
                block_size,
            } => {
                assert_eq!(points.len(), 2);
                assert!((radius - 0.05).abs() < 1e-9);
                assert!((block_size - 0.03).abs() < 1e-9);
            }
            MosaicOp::Region { .. } => panic!("expected brush"),
        }
    }
}
