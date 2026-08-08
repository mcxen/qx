use std::sync::{Mutex, Once, OnceLock};
use std::time::{Duration, Instant};

use enigo::{Enigo, Mouse, Settings};
use rdev::{listen, Event, EventType};

#[derive(Clone, Copy)]
struct PointerState {
    x: f64,
    y: f64,
    last_click: Option<Instant>,
}

static POINTER: OnceLock<Mutex<Option<PointerState>>> = OnceLock::new();
static LISTENER: Once = Once::new();

fn pointer_state() -> &'static Mutex<Option<PointerState>> {
    POINTER.get_or_init(|| Mutex::new(None))
}

fn receive(event: Event) {
    if let Ok(mut state) = pointer_state().lock() {
        match event.event_type {
            EventType::MouseMove { x, y } => {
                let last_click = state.as_ref().and_then(|value| value.last_click);
                *state = Some(PointerState { x, y, last_click });
            }
            EventType::ButtonPress(_) => {
                if let Some(value) = state.as_mut() {
                    value.last_click = Some(Instant::now());
                }
            }
            _ => {}
        }
    }
}

pub(crate) fn ensure_started() {
    LISTENER.call_once(|| {
        let _ = std::thread::Builder::new()
            .name("qx-input-events".to_string())
            .spawn(|| {
                if let Err(error) = listen(receive) {
                    crate::diagnostics::log(
                        crate::diagnostics::LogLevel::Warn,
                        "input.events",
                        "shared input event listener stopped",
                        serde_json::json!({ "error": format!("{error:?}") }),
                    );
                }
            });
    });
}

fn pointer_snapshot() -> Option<PointerState> {
    let cached = pointer_state().lock().ok().and_then(|value| *value);
    if cached.is_some() {
        return cached;
    }
    let enigo = Enigo::new(&Settings::default()).ok()?;
    let (x, y) = enigo.location().ok()?;
    Some(PointerState {
        x: x as f64,
        y: y as f64,
        last_click: None,
    })
}

fn put_pixel(image: &mut image::RgbaImage, x: i32, y: i32, color: image::Rgba<u8>) {
    if x >= 0 && y >= 0 && x < image.width() as i32 && y < image.height() as i32 {
        image.put_pixel(x as u32, y as u32, color);
    }
}

fn draw_cursor(image: &mut image::RgbaImage, x: i32, y: i32) {
    for row in 0..22_i32 {
        let width = (row / 2 + 1).min(10);
        for col in 0..width {
            let border = col == 0 || col == width - 1 || row == 0 || row == 21;
            put_pixel(
                image,
                x + col,
                y + row,
                if border {
                    image::Rgba([16, 16, 16, 255])
                } else {
                    image::Rgba([248, 248, 248, 255])
                },
            );
        }
    }
}

fn draw_click_ring(image: &mut image::RgbaImage, x: i32, y: i32) {
    for dy in -14_i32..=14 {
        for dx in -14_i32..=14 {
            let distance = ((dx * dx + dy * dy) as f64).sqrt();
            if (10.0..=14.0).contains(&distance) {
                put_pixel(image, x + dx, y + dy, image::Rgba([255, 78, 58, 210]));
            }
        }
    }
}

/// Composite the shared pointer state into capture pixels. Platform capture
/// adapters provide monitor origin/scale; the capture workflow provides crop.
pub(crate) fn composite_pointer(
    image: &mut image::RgbaImage,
    monitor_origin: (i32, i32),
    scale: f64,
    crop_origin: (u32, u32),
    show_clicks: bool,
) {
    ensure_started();
    let Some(pointer) = pointer_snapshot() else {
        return;
    };
    let x = ((pointer.x - monitor_origin.0 as f64) * scale).round() as i32 - crop_origin.0 as i32;
    let y = ((pointer.y - monitor_origin.1 as f64) * scale).round() as i32 - crop_origin.1 as i32;
    if show_clicks
        && pointer
            .last_click
            .is_some_and(|at| at.elapsed() <= Duration::from_millis(420))
    {
        draw_click_ring(image, x, y);
    }
    draw_cursor(image, x, y);
}
