//! Source-pixel compositor for screenshot annotations.
//!
//! Picker coordinates are normalized to the selected frozen image. The WebView
//! only previews these vectors; this module is the sole export renderer so
//! Retina / mixed-DPI captures never resize a browser-generated overlay.

use std::sync::OnceLock;

use ab_glyph::FontVec;
use fontdb::{Database, Family, Query, Stretch, Style, Weight};
use image::{Rgba, RgbaImage};
use imageproc::drawing::{
    draw_antialiased_line_segment_mut, draw_filled_circle_mut, draw_hollow_circle_mut,
    draw_text_mut, text_size,
};
use imageproc::pixelops::interpolate;
use serde::Deserialize;

use super::mosaic::{apply_mosaic_ops, MosaicOp, MosaicPoint};

const LOGICAL_STROKE_WIDTH: f64 = 3.0;
const LOGICAL_ARROW_HEAD: f64 = 12.0;
const LOGICAL_NUMBER_RADIUS: f64 = 12.0;
const LOGICAL_NUMBER_FONT_SIZE: f64 = 13.0;
const TEXT_LINE_HEIGHT: f64 = 1.2;
const TEXT_VERTICAL_PADDING: f64 = 2.0;
const TEXT_HORIZONTAL_PADDING_EM: f64 = 0.22;
const TEXT_MIN_HORIZONTAL_PADDING: f64 = 2.0;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationPoint {
    pub x: f64,
    pub y: f64,
}

/// The stable IPC model for every screenshot annotation.
///
/// Positions and mosaic sizes are selection-normalized. Visual sizes such as
/// stroke width and font size are logical picker pixels and are multiplied by
/// the picker session's source-pixel scale during export.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CaptureAnnotation {
    Text {
        x: f64,
        y: f64,
        #[serde(rename = "fontSize")]
        font_size: f64,
        #[serde(default)]
        lines: Vec<String>,
        color: String,
    },
    Arrow {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        color: String,
    },
    Rect {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        color: String,
    },
    Mosaic {
        mode: String,
        #[serde(default)]
        x1: f64,
        #[serde(default)]
        y1: f64,
        #[serde(default)]
        x2: f64,
        #[serde(default)]
        y2: f64,
        #[serde(default)]
        points: Vec<AnnotationPoint>,
        #[serde(default = "default_mosaic_radius")]
        radius: f64,
        #[serde(rename = "blockSize", default = "default_mosaic_block_size")]
        block_size: f64,
    },
    Number {
        x: f64,
        y: f64,
        value: u32,
        color: String,
    },
    Pen {
        points: Vec<AnnotationPoint>,
        color: String,
    },
}

fn default_mosaic_radius() -> f64 {
    0.045
}

fn default_mosaic_block_size() -> f64 {
    0.035
}

fn normalized_pixel(value: f64, extent: u32) -> f64 {
    value.clamp(0.0, 1.0) * extent as f64
}

fn parse_color(value: &str) -> Result<Rgba<u8>, String> {
    let hex = value.trim().strip_prefix('#').unwrap_or(value.trim());
    let expanded;
    let hex = if hex.len() == 3 {
        expanded = hex
            .chars()
            .flat_map(|character| [character, character])
            .collect::<String>();
        expanded.as_str()
    } else {
        hex
    };
    if hex.len() != 6 {
        return Err(format!("unsupported screenshot annotation color: {value}"));
    }
    let channel = |range: std::ops::Range<usize>| {
        u8::from_str_radix(&hex[range], 16)
            .map_err(|_| format!("invalid screenshot annotation color: {value}"))
    };
    Ok(Rgba([channel(0..2)?, channel(2..4)?, channel(4..6)?, 255]))
}

fn draw_stroke(
    image: &mut RgbaImage,
    start: (f64, f64),
    end: (f64, f64),
    width: u32,
    color: Rgba<u8>,
) {
    let dx = end.0 - start.0;
    let dy = end.1 - start.1;
    let length = dx.hypot(dy);
    let (perp_x, perp_y) = if length > f64::EPSILON {
        (-dy / length, dx / length)
    } else {
        (0.0, 1.0)
    };
    let width = width.max(1);
    let first_offset = -((width as f64 - 1.0) * 0.5);
    for index in 0..width {
        let offset = first_offset + index as f64;
        let shifted_start = (
            (start.0 + perp_x * offset).round() as i32,
            (start.1 + perp_y * offset).round() as i32,
        );
        let shifted_end = (
            (end.0 + perp_x * offset).round() as i32,
            (end.1 + perp_y * offset).round() as i32,
        );
        draw_antialiased_line_segment_mut(image, shifted_start, shifted_end, color, interpolate);
    }
    if width > 1 {
        let radius = (width as f64 * 0.5).floor() as i32;
        draw_filled_circle_mut(
            image,
            (start.0.round() as i32, start.1.round() as i32),
            radius,
            color,
        );
        draw_filled_circle_mut(
            image,
            (end.0.round() as i32, end.1.round() as i32),
            radius,
            color,
        );
    }
}

fn draw_arrow(
    image: &mut RgbaImage,
    start: (f64, f64),
    end: (f64, f64),
    scale: f64,
    color: Rgba<u8>,
) {
    let width = (LOGICAL_STROKE_WIDTH * scale).round().max(1.0) as u32;
    draw_stroke(image, start, end, width, color);
    let angle = (end.1 - start.1).atan2(end.0 - start.0);
    let head = LOGICAL_ARROW_HEAD * scale;
    for offset in [-std::f64::consts::PI / 6.0, std::f64::consts::PI / 6.0] {
        let head_end = (
            end.0 - head * (angle + offset).cos(),
            end.1 - head * (angle + offset).sin(),
        );
        draw_stroke(image, end, head_end, width, color);
    }
}

fn draw_rectangle(
    image: &mut RgbaImage,
    first: (f64, f64),
    second: (f64, f64),
    scale: f64,
    color: Rgba<u8>,
) {
    let width = (LOGICAL_STROKE_WIDTH * scale).round().max(1.0) as u32;
    let left = first.0.min(second.0);
    let right = first.0.max(second.0);
    let top = first.1.min(second.1);
    let bottom = first.1.max(second.1);
    draw_stroke(image, (left, top), (right, top), width, color);
    draw_stroke(image, (right, top), (right, bottom), width, color);
    draw_stroke(image, (right, bottom), (left, bottom), width, color);
    draw_stroke(image, (left, bottom), (left, top), width, color);
}

fn annotation_font() -> Result<&'static FontVec, String> {
    static FONT: OnceLock<Result<FontVec, String>> = OnceLock::new();
    FONT.get_or_init(|| {
        let mut database = Database::new();
        database.load_system_fonts();
        let families = [
            Family::Name("PingFang SC"),
            Family::Name("Microsoft YaHei UI"),
            Family::Name("Noto Sans CJK SC"),
            Family::Name("Noto Sans SC"),
            Family::SansSerif,
        ];
        let id = database
            .query(&Query {
                families: &families,
                weight: Weight::SEMIBOLD,
                stretch: Stretch::Normal,
                style: Style::Normal,
            })
            .ok_or_else(|| {
                "no system sans-serif font is available for screenshot text".to_string()
            })?;
        database
            .with_face_data(id, |bytes, face_index| {
                FontVec::try_from_vec_and_index(bytes.to_vec(), face_index)
                    .map_err(|error| format!("load screenshot annotation font: {error}"))
            })
            .ok_or_else(|| "read screenshot annotation font data".to_string())?
    })
    .as_ref()
    .map_err(Clone::clone)
}

fn draw_number(
    image: &mut RgbaImage,
    center: (f64, f64),
    value: u32,
    scale: f64,
    color: Rgba<u8>,
) -> Result<(), String> {
    let center = (center.0.round() as i32, center.1.round() as i32);
    let radius = (LOGICAL_NUMBER_RADIUS * scale).round().max(2.0) as i32;
    let white = Rgba([255, 255, 255, 235]);
    let black = Rgba([17, 17, 17, 184]);
    let foreground = if color.0[..3] == [255, 255, 255] {
        Rgba([17, 17, 17, 255])
    } else {
        Rgba([255, 255, 255, 255])
    };
    let outline = if foreground.0[0] == 17 { black } else { white };
    draw_filled_circle_mut(image, center, radius, color);
    let outline_width = (2.0 * scale).round().max(1.0) as i32;
    for inset in 0..outline_width {
        draw_hollow_circle_mut(image, center, (radius - inset).max(1), outline);
    }
    let font = annotation_font()?;
    let text = value.to_string();
    let font_size = (LOGICAL_NUMBER_FONT_SIZE * scale).max(1.0) as f32;
    let (text_width, text_height) = text_size(font_size, font, &text);
    draw_text_mut(
        image,
        foreground,
        center.0 - text_width as i32 / 2,
        center.1 - text_height as i32 / 2,
        font_size,
        font,
        &text,
    );
    Ok(())
}

fn draw_text(
    image: &mut RgbaImage,
    origin: (f64, f64),
    font_size: f64,
    lines: &[String],
    scale: f64,
    color: Rgba<u8>,
) -> Result<(), String> {
    if lines.is_empty() {
        return Ok(());
    }
    let font = annotation_font()?;
    let pixel_font_size = (font_size * scale).max(1.0) as f32;
    let padding_x =
        (TEXT_MIN_HORIZONTAL_PADDING.max(font_size * TEXT_HORIZONTAL_PADDING_EM) * scale).round();
    let x = (origin.0 + padding_x).round() as i32;
    let y = (origin.1 + TEXT_VERTICAL_PADDING * scale).round();
    let line_height = font_size * TEXT_LINE_HEIGHT * scale;
    for (index, line) in lines.iter().enumerate() {
        draw_text_mut(
            image,
            color,
            x,
            (y + index as f64 * line_height).round() as i32,
            pixel_font_size,
            font,
            line,
        );
    }
    Ok(())
}

fn mosaic_ops(annotations: &[CaptureAnnotation]) -> Vec<MosaicOp> {
    annotations
        .iter()
        .filter_map(|annotation| match annotation {
            CaptureAnnotation::Mosaic {
                mode,
                x1,
                y1,
                x2,
                y2,
                points,
                radius,
                block_size,
            } if mode == "region" => Some(MosaicOp::Region {
                x1: *x1,
                y1: *y1,
                x2: *x2,
                y2: *y2,
                block_size: *block_size,
            }),
            CaptureAnnotation::Mosaic {
                mode,
                points,
                radius,
                block_size,
                ..
            } if mode == "brush" => Some(MosaicOp::Brush {
                points: points
                    .iter()
                    .map(|point| MosaicPoint {
                        x: point.x,
                        y: point.y,
                    })
                    .collect(),
                radius: *radius,
                block_size: *block_size,
            }),
            _ => None,
        })
        .collect()
}

pub fn contains_mosaic(annotations: &[CaptureAnnotation]) -> bool {
    annotations
        .iter()
        .any(|annotation| matches!(annotation, CaptureAnnotation::Mosaic { .. }))
}

/// Composite all screenshot annotations against the frozen crop in one source
/// pixel coordinate system. Mosaic privacy operations run first; all remaining
/// vectors then paint in their original z-order.
pub fn composite(
    image: &mut RgbaImage,
    annotations: &[CaptureAnnotation],
    coordinate_scale: f64,
) -> Result<(), String> {
    if annotations.is_empty() {
        return Ok(());
    }
    apply_mosaic_ops(image, &mosaic_ops(annotations));
    let scale = coordinate_scale.max(0.01);
    let width = image.width();
    let height = image.height();
    for annotation in annotations {
        match annotation {
            CaptureAnnotation::Text {
                x,
                y,
                font_size,
                lines,
                color,
            } => draw_text(
                image,
                (normalized_pixel(*x, width), normalized_pixel(*y, height)),
                *font_size,
                lines,
                scale,
                parse_color(color)?,
            )?,
            CaptureAnnotation::Arrow {
                x1,
                y1,
                x2,
                y2,
                color,
            } => draw_arrow(
                image,
                (normalized_pixel(*x1, width), normalized_pixel(*y1, height)),
                (normalized_pixel(*x2, width), normalized_pixel(*y2, height)),
                scale,
                parse_color(color)?,
            ),
            CaptureAnnotation::Rect {
                x1,
                y1,
                x2,
                y2,
                color,
            } => draw_rectangle(
                image,
                (normalized_pixel(*x1, width), normalized_pixel(*y1, height)),
                (normalized_pixel(*x2, width), normalized_pixel(*y2, height)),
                scale,
                parse_color(color)?,
            ),
            CaptureAnnotation::Number { x, y, value, color } => draw_number(
                image,
                (normalized_pixel(*x, width), normalized_pixel(*y, height)),
                *value,
                scale,
                parse_color(color)?,
            )?,
            CaptureAnnotation::Pen { points, color } => {
                let stroke_width = (LOGICAL_STROKE_WIDTH * scale).round().max(1.0) as u32;
                let color = parse_color(color)?;
                let pixels: Vec<(f64, f64)> = points
                    .iter()
                    .map(|point| {
                        (
                            normalized_pixel(point.x, width),
                            normalized_pixel(point.y, height),
                        )
                    })
                    .collect();
                if pixels.len() == 1 {
                    let point = pixels[0];
                    draw_filled_circle_mut(
                        image,
                        (point.0.round() as i32, point.1.round() as i32),
                        (stroke_width as f64 * 0.5).ceil() as i32,
                        color,
                    );
                } else {
                    for segment in pixels.windows(2) {
                        draw_stroke(image, segment[0], segment[1], stroke_width, color);
                    }
                }
            }
            CaptureAnnotation::Mosaic { .. } => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{composite, CaptureAnnotation};
    use image::{Rgba, RgbaImage};

    #[test]
    fn normalized_rectangle_uses_source_pixels_and_session_scale() {
        let mut image = RgbaImage::from_pixel(200, 100, Rgba([0, 0, 0, 255]));
        composite(
            &mut image,
            &[CaptureAnnotation::Rect {
                x1: 0.25,
                y1: 0.2,
                x2: 0.75,
                y2: 0.8,
                color: "#ff3b30".to_string(),
            }],
            2.0,
        )
        .unwrap();
        assert_eq!(image.get_pixel(100, 20).0, [255, 59, 48, 255]);
        assert_eq!(image.get_pixel(50, 50).0, [255, 59, 48, 255]);
        assert_eq!(image.get_pixel(100, 50).0, [0, 0, 0, 255]);
    }

    #[test]
    fn frontend_annotation_json_decodes_without_browser_overlay() {
        let annotation: CaptureAnnotation = serde_json::from_str(
            r##"{"type":"text","id":"text-1","x":0.1,"y":0.2,"w":0.3,"h":0.2,"fontSize":24,"text":"中文","lines":["中文"],"color":"#ffffff"}"##,
        )
        .expect("text annotation");
        match annotation {
            CaptureAnnotation::Text {
                lines, font_size, ..
            } => {
                assert_eq!(lines, ["中文"]);
                assert_eq!(font_size, 24.0);
            }
            _ => panic!("expected text annotation"),
        }
    }

    #[test]
    fn system_font_renders_cjk_text_into_source_image() {
        let mut image = RgbaImage::from_pixel(240, 100, Rgba([0, 0, 0, 255]));
        composite(
            &mut image,
            &[CaptureAnnotation::Text {
                x: 0.1,
                y: 0.1,
                font_size: 24.0,
                lines: vec!["中文标注".to_string()],
                color: "#ffffff".to_string(),
            }],
            2.0,
        )
        .unwrap();
        assert!(image.pixels().any(|pixel| pixel.0[0] > 0));
    }
}
