use super::RecordArea;

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
