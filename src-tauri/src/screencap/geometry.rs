use super::RecordArea;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PhysicalFrame {
    pub(super) x: i32,
    pub(super) y: i32,
    pub(super) width: u32,
    pub(super) height: u32,
}

pub(super) fn capture_coordinate_scale(capture_width: u32, logical_width: f64) -> f64 {
    (capture_width as f64 / logical_width.max(1.0)).clamp(0.1, 8.0)
}

pub(super) fn clamp_area(
    area: RecordArea,
    monitor_width: u32,
    monitor_height: u32,
) -> Option<RecordArea> {
    if area.w < 2 || area.h < 2 || monitor_width < 2 || monitor_height < 2 {
        return None;
    }
    let x = area.x.min(monitor_width.saturating_sub(2));
    let y = area.y.min(monitor_height.saturating_sub(2));
    Some(RecordArea {
        x,
        y,
        w: area.w.min(monitor_width.saturating_sub(x)).max(2),
        h: area.h.min(monitor_height.saturating_sub(y)).max(2),
        monitor_id: area.monitor_id,
    })
}

pub(super) fn covers_full_display(
    area: &RecordArea,
    logical_width: f64,
    logical_height: f64,
) -> bool {
    area.x <= 1
        && area.y <= 1
        && area.w as f64 + 1.0 >= logical_width
        && area.h as f64 + 1.0 >= logical_height
}

pub(super) fn physical_frame(
    monitor_x: i32,
    monitor_y: i32,
    scale: f64,
    area: &RecordArea,
) -> PhysicalFrame {
    let scale = scale.max(1.0);
    PhysicalFrame {
        x: monitor_x + (area.x as f64 * scale).round() as i32,
        y: monitor_y + (area.y as f64 * scale).round() as i32,
        width: (area.w as f64 * scale).round().max(2.0) as u32,
        height: (area.h as f64 * scale).round().max(2.0) as u32,
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn crop_physical(
    frame: &image::RgbaImage,
    area: &RecordArea,
    monitor_width: u32,
    monitor_height: u32,
) -> image::RgbaImage {
    let frame_width = frame.width().max(1);
    let frame_height = frame.height().max(1);
    let scale_x = frame_width as f64 / monitor_width.max(1) as f64;
    let scale_y = frame_height as f64 / monitor_height.max(1) as f64;
    let mut x = (area.x as f64 * scale_x).round() as u32;
    let mut y = (area.y as f64 * scale_y).round() as u32;
    let mut width = (area.w as f64 * scale_x).round() as u32;
    let mut height = (area.h as f64 * scale_y).round() as u32;
    x = x.min(frame_width.saturating_sub(2));
    y = y.min(frame_height.saturating_sub(2));
    width = width.min(frame_width.saturating_sub(x)).max(2) & !1;
    height = height.min(frame_height.saturating_sub(y)).max(2) & !1;
    if width == frame_width && height == frame_height && x == 0 && y == 0 {
        frame.clone()
    } else {
        image::imageops::crop_imm(frame, x, y, width, height).to_image()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        capture_coordinate_scale, clamp_area, covers_full_display, crop_physical, physical_frame,
    };
    use crate::screencap::RecordArea;

    #[test]
    fn recording_frame_uses_monitor_origin_and_scale() {
        let area = RecordArea {
            x: 100,
            y: 50,
            w: 640,
            h: 360,
            monitor_id: Some(7),
        };
        let frame = physical_frame(3024, -200, 2.0, &area);
        assert_eq!((frame.x, frame.y), (3224, -100));
        assert_eq!((frame.width, frame.height), (1280, 720));
    }

    #[test]
    fn full_display_selection_does_not_need_a_border_window() {
        let full = RecordArea {
            x: 0,
            y: 0,
            w: 1512,
            h: 982,
            monitor_id: Some(7),
        };
        assert!(covers_full_display(&full, 1512.0, 982.0));
    }

    #[test]
    fn logical_area_is_clamped_to_monitor() {
        let area = clamp_area(
            RecordArea {
                x: 10,
                y: 20,
                w: 9999,
                h: 40,
                monitor_id: Some(42),
            },
            800,
            600,
        )
        .expect("valid");
        assert_eq!((area.x, area.y, area.w, area.h), (10, 20, 790, 40));
        assert_eq!(area.monitor_id, Some(42));
    }

    #[test]
    fn crop_scales_logical_points_to_physical_pixels() {
        let frame = image::RgbaImage::from_pixel(200, 100, image::Rgba([1, 2, 3, 255]));
        let area = RecordArea {
            x: 10,
            y: 5,
            w: 40,
            h: 20,
            monitor_id: None,
        };
        let cropped = crop_physical(&frame, &area, 100, 50);
        assert_eq!((cropped.width(), cropped.height()), (80, 40));
    }

    #[test]
    fn picker_coordinates_scale_to_each_capture_backend() {
        assert_eq!(capture_coordinate_scale(1728, 1728.0), 1.0);
        assert_eq!(capture_coordinate_scale(3840, 1920.0), 2.0);
    }
}
