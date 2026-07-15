use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{
    command, AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder,
};

const DEFAULT_FPS: u32 = 24;
const CONTROL_LABEL: &str = "recording-controls";
/// Dedicated transparent fullscreen surface for region pick (not the main glass shell).
const PICKER_LABEL: &str = "region-picker";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingOptions {
    pub output_format: Option<String>,
    pub fps: Option<u32>,
    pub quality: Option<String>,
    pub resolution: Option<String>,
}

impl Default for RecordingOptions {
    fn default() -> Self {
        Self {
            output_format: Some("mp4".to_string()),
            fps: Some(DEFAULT_FPS),
            quality: Some("balanced".to_string()),
            resolution: Some("1080p".to_string()),
        }
    }
}

#[derive(Debug)]
struct NormalizedRecordingOptions {
    extension: &'static str,
    fps: u32,
    bitrate: u32,
    max_size: Option<(u32, u32)>,
}

impl RecordingOptions {
    fn normalize(self) -> NormalizedRecordingOptions {
        let extension = match self.output_format.as_deref() {
            Some("mov") => "mov",
            _ => "mp4",
        };
        let fps = match self.fps.unwrap_or(DEFAULT_FPS) {
            15 => 15,
            30 => 30,
            _ => DEFAULT_FPS,
        };
        let bitrate = match self.quality.as_deref() {
            Some("compact") => 2_500_000,
            Some("high") => 8_000_000,
            _ => 4_500_000,
        };
        let max_size = match self.resolution.as_deref() {
            Some("720p") => Some((1280, 720)),
            Some("native") => Some((3840, 2160)),
            _ => Some((1920, 1080)),
        };
        NormalizedRecordingOptions {
            extension,
            fps,
            bitrate,
            max_size,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordArea {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Serialize)]
pub struct GifEntry {
    pub id: i64,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub frame_count: u32,
    pub duration_ms: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStatusSnapshot {
    pub phase: String,
    pub is_recording: bool,
    pub elapsed_ms: u64,
    pub frame_count: u64,
    pub area: Option<RecordArea>,
    pub output_path: Option<String>,
    pub error: Option<String>,
    pub controls_visible: bool,
}

struct RecordingRuntimeStatus {
    phase: &'static str,
    started_at: Option<std::time::Instant>,
    area: Option<RecordArea>,
    output_path: Option<String>,
    error: Option<String>,
}

impl Default for RecordingRuntimeStatus {
    fn default() -> Self {
        Self {
            phase: "idle",
            started_at: None,
            area: None,
            output_path: None,
            error: None,
        }
    }
}

struct RecordingState {
    stop_flag: std::sync::Arc<AtomicBool>,
    thread_handle: Option<std::thread::JoinHandle<Result<RecordingOutput, String>>>,
    started_at: std::time::Instant,
}

#[derive(Debug)]
struct RecordingOutput {
    path: PathBuf,
    width: u32,
    height: u32,
    frame_count: u32,
}

static RECORDING: OnceLock<Mutex<Option<RecordingState>>> = OnceLock::new();
/// Last capture-thread failure (permission, display open, etc.). Cleared on start.
static CAPTURE_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static RECORDING_STATUS: OnceLock<Mutex<RecordingRuntimeStatus>> = OnceLock::new();
static FRAME_COUNT: AtomicU64 = AtomicU64::new(0);

fn recording_state() -> &'static Mutex<Option<RecordingState>> {
    RECORDING.get_or_init(|| Mutex::new(None))
}

fn capture_error_slot() -> &'static Mutex<Option<String>> {
    CAPTURE_ERROR.get_or_init(|| Mutex::new(None))
}

fn runtime_status() -> &'static Mutex<RecordingRuntimeStatus> {
    RECORDING_STATUS.get_or_init(|| Mutex::new(RecordingRuntimeStatus::default()))
}

fn set_capture_error(msg: impl Into<String>) {
    let message = msg.into();
    if let Ok(mut slot) = capture_error_slot().lock() {
        *slot = Some(message.clone());
    }
    if let Ok(mut status) = runtime_status().lock() {
        status.phase = "error";
        status.error = Some(message);
    }
}

fn take_capture_error() -> Option<String> {
    capture_error_slot()
        .lock()
        .ok()
        .and_then(|mut slot| slot.take())
}

fn recording_status_snapshot(app: &AppHandle) -> RecordingStatusSnapshot {
    let controls_visible = app
        .get_webview_window(CONTROL_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    let Ok(status) = runtime_status().lock() else {
        return RecordingStatusSnapshot {
            phase: "error".to_string(),
            is_recording: false,
            elapsed_ms: 0,
            frame_count: FRAME_COUNT.load(Ordering::Relaxed),
            area: None,
            output_path: None,
            error: Some("Recording status is unavailable".to_string()),
            controls_visible,
        };
    };
    RecordingStatusSnapshot {
        phase: status.phase.to_string(),
        is_recording: recording_state()
            .lock()
            .map(|recording| recording.is_some())
            .unwrap_or_else(|_| matches!(status.phase, "recording" | "processing")),
        elapsed_ms: status
            .started_at
            .map(|started| started.elapsed().as_millis() as u64)
            .unwrap_or(0),
        frame_count: FRAME_COUNT.load(Ordering::Relaxed),
        area: status.area.clone(),
        output_path: status.output_path.clone(),
        error: status.error.clone(),
        controls_visible,
    }
}

fn emit_recording_status(app: &AppHandle) {
    let _ = app.emit("screencap:state", recording_status_snapshot(app));
}

fn set_recording_ui_protected(app: &AppHandle, protected: bool) {
    if let Some(main) = app.get_webview_window(crate::floating_panel::MAIN_LABEL) {
        let _ = main.set_content_protected(protected);
    }
    if let Some(controls) = app.get_webview_window(CONTROL_LABEL) {
        // The standalone controller must never appear in captured output.
        let _ = controls.set_content_protected(true);
    }
}

const CONTROLS_LOGICAL_W: f64 = 340.0;
const CONTROLS_LOGICAL_H: f64 = 36.0;

/// Bottom-center Dynamic Island style placement on the primary work area.
fn position_controls(app: &AppHandle) {
    let Some(controls) = app.get_webview_window(CONTROL_LABEL) else {
        return;
    };
    let monitor = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| {
            app.get_webview_window(crate::floating_panel::MAIN_LABEL)
                .and_then(|main| main.current_monitor().ok().flatten())
        })
        .or_else(|| controls.current_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };
    let work = monitor.work_area();
    let scale = monitor.scale_factor().max(1.0);
    let width = (CONTROLS_LOGICAL_W * scale).round() as i32;
    let height = (CONTROLS_LOGICAL_H * scale).round() as i32;
    let margin = (20.0 * scale).round() as i32;
    // Center-bottom of the usable work area (island control strip).
    let x = work.position.x + (work.size.width as i32 - width) / 2;
    let y = work.position.y + work.size.height as i32 - height - margin;
    let _ = controls.set_size(PhysicalSize::new(width.max(1) as u32, height.max(1) as u32));
    let _ = controls.set_position(PhysicalPosition::new(x, y));
}

#[cfg(target_os = "macos")]
fn promote_controls_window(controls: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::NSWindowCollectionBehavior;
    let Ok(ptr) = controls.ns_window() else {
        return;
    };
    let ns_window = ptr as *mut AnyObject;
    if ns_window.is_null() {
        return;
    }
    unsafe {
        // 3 == NSFloatingWindowLevel — above normal app windows while recording.
        let _: () = msg_send![ns_window, setLevel: 3isize];
        let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::IgnoresCycle;
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
        let _: () = msg_send![ns_window, setHidesOnDeactivate: false];
        let _: () = msg_send![ns_window, orderFrontRegardless];
    }
}

fn show_recording_controls_internal(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(CONTROL_LABEL).is_none() {
        WebviewWindowBuilder::new(
            app,
            CONTROL_LABEL,
            WebviewUrl::App("index.html?view=recording-controls".into()),
        )
        .title("Qx Recording Controls")
        .inner_size(CONTROLS_LOGICAL_W, CONTROLS_LOGICAL_H)
        .min_inner_size(CONTROLS_LOGICAL_W, CONTROLS_LOGICAL_H)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .accept_first_mouse(true)
        .content_protected(true)
        .visible(true)
        .build()
        .map_err(|error| format!("open recording controls: {error}"))?;
    }
    let controls = app
        .get_webview_window(CONTROL_LABEL)
        .ok_or_else(|| "recording controls window is unavailable".to_string())?;
    let _ = controls.set_content_protected(true);
    let _ = controls.set_always_on_top(true);
    let _ = controls.set_ignore_cursor_events(false);
    position_controls(app);
    controls
        .show()
        .map_err(|error| format!("show recording controls: {error}"))?;
    #[cfg(target_os = "macos")]
    promote_controls_window(&controls);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = controls.set_focus();
    }
    emit_recording_status(app);
    Ok(())
}

fn hide_recording_controls_internal(app: &AppHandle) {
    if let Some(controls) = app.get_webview_window(CONTROL_LABEL) {
        let _ = controls.hide();
    }
}

fn hide_region_picker_internal(app: &AppHandle) {
    // Hide only — do not destroy. Destroying the last *visible* surface while
    // main is hidden has looked like a full app quit on some macOS builds.
    if let Some(picker) = app.get_webview_window(PICKER_LABEL) {
        let _ = picker.hide();
    }
}

fn show_region_picker_internal(app: &AppHandle) -> Result<(), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|error| format!("primary monitor: {error}"))?
        .ok_or_else(|| "No primary display found".to_string())?;
    let position = monitor.position();
    let size = monitor.size();
    let scale = monitor.scale_factor().max(1.0);
    // Logical size of the primary display (matches CSS clientX/Y in the picker).
    let logical_w = size.width as f64 / scale;
    let logical_h = size.height as f64 / scale;
    let logical_x = position.x as f64 / scale;
    let logical_y = position.y as f64 / scale;

    if app.get_webview_window(PICKER_LABEL).is_none() {
        WebviewWindowBuilder::new(
            app,
            PICKER_LABEL,
            WebviewUrl::App("index.html?view=region-picker".into()),
        )
        .title("Qx Region Picker")
        .inner_size(logical_w, logical_h)
        .position(logical_x, logical_y)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(true)
        .accept_first_mouse(true)
        // Picker must never end up in the recording itself.
        .content_protected(true)
        .build()
        .map_err(|error| format!("open region picker: {error}"))?;
    }

    let picker = app
        .get_webview_window(PICKER_LABEL)
        .ok_or_else(|| "region picker window is unavailable".to_string())?;
    let _ = picker.set_content_protected(true);
    let _ = picker.set_always_on_top(true);
    // Cover the primary display exactly. Physical size/position matches the
    // monitor framebuffer; CSS clientX/Y stay in logical points (DPR scaled).
    let _ = picker.set_position(PhysicalPosition::new(position.x, position.y));
    let _ = picker.set_size(PhysicalSize::new(size.width, size.height));
    let _ = (logical_w, logical_h, logical_x, logical_y);
    picker
        .show()
        .map_err(|error| format!("show region picker: {error}"))?;
    let _ = picker.set_focus();
    Ok(())
}

fn gifs_dir() -> PathBuf {
    let base = crate::paths::pictures_dir();
    let dir = base.join("Qx");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn db_path() -> PathBuf {
    let dir = crate::paths::data_dir();
    let _ = fs::create_dir_all(&dir);
    dir.join("screencap.db")
}

fn open_db() -> rusqlite::Result<Connection> {
    let conn = Connection::open(db_path())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS gif_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            frame_count INTEGER,
            duration_ms INTEGER,
            created_at INTEGER NOT NULL
        );",
    )?;
    Ok(conn)
}

fn insert_history(
    path: &std::path::Path,
    w: u32,
    h: u32,
    frames: u32,
    duration_ms: u64,
) -> rusqlite::Result<i64> {
    let conn = open_db()?;
    let now = Local::now().timestamp();
    conn.execute(
        "INSERT INTO gif_history (file_path, width, height, frame_count, duration_ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![path.to_string_lossy(), w, h, frames, duration_ms, now],
    )?;
    Ok(conn.last_insert_rowid())
}

fn constrain_video_size(image: image::RgbaImage, max_size: Option<(u32, u32)>) -> image::RgbaImage {
    let (max_width, max_height) = max_size.unwrap_or((3840, 2160));
    let width_ratio = max_width as f64 / image.width().max(1) as f64;
    let height_ratio = max_height as f64 / image.height().max(1) as f64;
    let ratio = width_ratio.min(height_ratio).min(1.0);
    // H.264 4:2:0 requires even dimensions.
    let width = ((image.width() as f64 * ratio).floor() as u32).max(2) & !1;
    let height = ((image.height() as f64 * ratio).floor() as u32).max(2) & !1;
    if width == image.width() && height == image.height() {
        image
    } else {
        image::imageops::resize(&image, width, height, image::imageops::FilterType::Triangle)
    }
}

fn strip_annex_b_start_code(nal: &[u8]) -> &[u8] {
    if nal.starts_with(&[0, 0, 0, 1]) {
        &nal[4..]
    } else if nal.starts_with(&[0, 0, 1]) {
        &nal[3..]
    } else {
        nal
    }
}

fn mp4_parts(
    bitstream: &openh264::encoder::EncodedBitStream<'_>,
) -> (Option<Vec<u8>>, Option<Vec<u8>>, Vec<u8>, bool) {
    let mut sps = None;
    let mut pps = None;
    let mut sample = Vec::new();
    let mut sync = false;
    for layer_index in 0..bitstream.num_layers() {
        let Some(layer) = bitstream.layer(layer_index) else {
            continue;
        };
        for nal_index in 0..layer.nal_count() {
            let Some(raw_nal) = layer.nal_unit(nal_index) else {
                continue;
            };
            let nal = strip_annex_b_start_code(raw_nal);
            if nal.is_empty() {
                continue;
            }
            match nal[0] & 0x1f {
                7 => sps = Some(nal.to_vec()),
                8 => pps = Some(nal.to_vec()),
                5 => {
                    sync = true;
                    sample.extend_from_slice(&(nal.len() as u32).to_be_bytes());
                    sample.extend_from_slice(nal);
                }
                _ => {
                    sample.extend_from_slice(&(nal.len() as u32).to_be_bytes());
                    sample.extend_from_slice(nal);
                }
            }
        }
    }
    (sps, pps, sample, sync)
}

fn mp4_config(extension: &str) -> Result<mp4::Mp4Config, String> {
    let brand = if extension == "mov" { "qt  " } else { "isom" };
    let compatible = if extension == "mov" {
        vec!["qt  "]
    } else {
        vec!["isom", "iso2", "avc1", "mp41"]
    };
    Ok(mp4::Mp4Config {
        major_brand: brand
            .parse()
            .map_err(|error| format!("video brand: {error}"))?,
        minor_version: 512,
        compatible_brands: compatible
            .into_iter()
            .map(|value| {
                value
                    .parse()
                    .map_err(|error| format!("video brand: {error}"))
            })
            .collect::<Result<Vec<_>, _>>()?,
        timescale: 1000,
    })
}

fn primary_monitor() -> Result<xcap::Monitor, String> {
    let monitors = xcap::Monitor::all().map_err(|error| {
        format!(
            "Cannot list displays: {error}. Grant Screen Recording permission, then fully quit and reopen Qx."
        )
    })?;
    monitors
        .into_iter()
        .find(|monitor| monitor.is_primary().unwrap_or(false))
        .ok_or_else(|| {
            "No primary display found. Grant Screen Recording permission, then restart Qx."
                .to_string()
        })
}

/// Clamp a logical (points) crop to the primary monitor. xcap's
/// `capture_region` and CGDisplayBounds both use **points**, not pixels.
fn clamp_logical_area(area: RecordArea, mon_w: u32, mon_h: u32) -> Option<RecordArea> {
    if area.w < 2 || area.h < 2 || mon_w < 2 || mon_h < 2 {
        return None;
    }
    let x = area.x.min(mon_w.saturating_sub(2));
    let y = area.y.min(mon_h.saturating_sub(2));
    let w = area.w.min(mon_w.saturating_sub(x)).max(2);
    let h = area.h.min(mon_h.saturating_sub(y)).max(2);
    Some(RecordArea { x, y, w, h })
}

/// Map a logical (points) crop onto a framebuffer using the frame's real
/// pixel size vs the monitor's logical size (more reliable than scale_factor
/// alone — AVCapture dimensions can disagree slightly with CGDisplayMode).
#[cfg_attr(not(test), allow(dead_code))]
fn crop_physical(
    frame: &image::RgbaImage,
    area: &RecordArea,
    mon_w: u32,
    mon_h: u32,
) -> image::RgbaImage {
    let fw = frame.width().max(1);
    let fh = frame.height().max(1);
    let mon_w = mon_w.max(1) as f64;
    let mon_h = mon_h.max(1) as f64;
    let sx = fw as f64 / mon_w;
    let sy = fh as f64 / mon_h;
    let mut x = ((area.x as f64) * sx).round() as u32;
    let mut y = ((area.y as f64) * sy).round() as u32;
    let mut w = ((area.w as f64) * sx).round() as u32;
    let mut h = ((area.h as f64) * sy).round() as u32;
    x = x.min(fw.saturating_sub(2));
    y = y.min(fh.saturating_sub(2));
    w = w.min(fw.saturating_sub(x)).max(2) & !1;
    h = h.min(fh.saturating_sub(y)).max(2) & !1;
    if w == fw && h == fh && x == 0 && y == 0 {
        frame.clone()
    } else {
        image::imageops::crop_imm(frame, x, y, w, h).to_image()
    }
}

fn encode_rgba_frame(
    encoder: &mut openh264::encoder::Encoder,
    writer: &mut mp4::Mp4Writer<fs::File>,
    track_added: &mut bool,
    dimensions: &mut Option<(u32, u32)>,
    pending_sample: &mut Option<(Vec<u8>, u64, bool)>,
    frame_idx: &mut u64,
    started_at: std::time::Instant,
    img: image::RgbaImage,
    max_size: Option<(u32, u32)>,
) -> Result<(), String> {
    let final_img = constrain_video_size(img, max_size);
    let (width, height) = final_img.dimensions();
    if dimensions.is_some_and(|value| value != (width, height)) {
        return Err("capture dimensions changed during recording".to_string());
    }
    *dimensions = Some((width, height));
    let rgb = image::DynamicImage::ImageRgba8(final_img)
        .to_rgb8()
        .into_raw();
    let rgb_source = openh264::formats::RgbSliceU8::new(&rgb, (width as usize, height as usize));
    let yuv = openh264::formats::YUVBuffer::from_rgb8_source(rgb_source);
    let encoded = encoder
        .encode(&yuv)
        .map_err(|error| format!("encode H.264 frame: {error}"))?;
    let (sps, pps, sample, is_sync) = mp4_parts(&encoded);
    if !*track_added {
        let sps = sps.ok_or_else(|| {
            "H.264 stream has no SPS — capture may have failed".to_string()
        })?;
        let pps = pps.ok_or_else(|| {
            "H.264 stream has no PPS — capture may have failed".to_string()
        })?;
        writer
            .add_track(&mp4::TrackConfig::from(mp4::AvcConfig {
                width: width as u16,
                height: height as u16,
                seq_param_set: sps,
                pic_param_set: pps,
            }))
            .map_err(|error| format!("create video track: {error}"))?;
        *track_added = true;
    }
    if sample.is_empty() {
        return Ok(());
    }
    let captured_at = started_at.elapsed().as_millis() as u64;
    if let Some((previous, previous_at, previous_sync)) = pending_sample.take() {
        let duration = captured_at
            .saturating_sub(previous_at)
            .max(1)
            .clamp(1, u32::MAX as u64) as u32;
        writer
            .write_sample(
                1,
                &mp4::Mp4Sample {
                    start_time: previous_at,
                    duration,
                    rendering_offset: 0,
                    is_sync: previous_sync,
                    bytes: bytes::Bytes::from(previous),
                },
            )
            .map_err(|error| format!("write video frame: {error}"))?;
        *frame_idx += 1;
    }
    *pending_sample = Some((sample, captured_at, is_sync));
    FRAME_COUNT.store(*frame_idx + 1, Ordering::Relaxed);
    Ok(())
}

/// Prefer xcap's AVFoundation `video_recorder` stream (continuous frames).
/// Fall back to polled `capture_region` / `capture_image` if the stream fails.
fn recording_loop_inner(
    output_path: &Path,
    area: Option<RecordArea>,
    options: NormalizedRecordingOptions,
    stop_flag: std::sync::Arc<AtomicBool>,
) -> Result<RecordingOutput, String> {
    // Let the picker / main shell finish hiding before the first sample.
    std::thread::sleep(std::time::Duration::from_millis(200));

    let monitor = primary_monitor()?;
    let mon_w = monitor
        .width()
        .map_err(|error| format!("display width: {error}"))?;
    let mon_h = monitor
        .height()
        .map_err(|error| format!("display height: {error}"))?;

    // Selection is in logical points (CSS px on the picker overlay / primary).
    let area = area.and_then(|a| clamp_logical_area(a, mon_w, mon_h));
    // Region capture: use capture_region (same coordinate space as the picker).
    // Full-screen: prefer the continuous AVCapture stream for FPS.
    let region_mode = area.is_some();

    let frame_duration = std::time::Duration::from_secs_f64(1.0 / options.fps as f64);
    let sample_duration = (1000 / options.fps).max(1);
    let encoder_config = openh264::encoder::EncoderConfig::new()
        .bitrate(openh264::encoder::BitRate::from_bps(options.bitrate))
        .max_frame_rate(openh264::encoder::FrameRate::from_hz(options.fps as f32))
        .rate_control_mode(openh264::encoder::RateControlMode::Bitrate)
        .usage_type(openh264::encoder::UsageType::ScreenContentRealTime)
        .profile(openh264::encoder::Profile::Baseline)
        .complexity(openh264::encoder::Complexity::Low)
        .skip_frames(false)
        .intra_frame_period(openh264::encoder::IntraFramePeriod::from_num_frames(
            (options.fps * 2).max(1),
        ));
    let mut encoder = openh264::encoder::Encoder::with_api_config(
        openh264::OpenH264API::from_source(),
        encoder_config,
    )
    .map_err(|error| format!("initialize H.264 encoder: {error}"))?;
    let file = fs::File::create(output_path).map_err(|error| format!("create video: {error}"))?;
    let config = mp4_config(options.extension)?;
    let mut writer = mp4::Mp4Writer::write_start(file, &config)
        .map_err(|error| format!("start video file: {error}"))?;
    let mut track_added = false;
    let mut dimensions = None;
    let mut frame_idx: u64 = 0;
    let mut pending_sample: Option<(Vec<u8>, u64, bool)> = None;
    let started_at = std::time::Instant::now();
    let mut next_frame_at = std::time::Instant::now();

    // ── Full-screen stream path (xcap VideoRecorder / AVCaptureScreenInput) ─
    let stream_ok = if region_mode {
        false
    } else {
        match monitor.video_recorder() {
            Ok((recorder, rx)) => {
                if recorder.start().is_err() {
                    false
                } else {
                    let mut consecutive_empty: u32 = 0;
                    while !stop_flag.load(Ordering::Relaxed) {
                        let now = std::time::Instant::now();
                        if now < next_frame_at {
                            while rx.try_recv().is_ok() {}
                            std::thread::sleep(
                                (next_frame_at - now).min(std::time::Duration::from_millis(4)),
                            );
                            continue;
                        }

                        let frame = match rx.recv_timeout(std::time::Duration::from_millis(500)) {
                            Ok(frame) => frame,
                            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                                consecutive_empty += 1;
                                if consecutive_empty >= 10 {
                                    let _ = recorder.stop();
                                    return Err(
                                        "Screen capture stream stalled. Grant Screen Recording permission and restart Qx."
                                            .to_string(),
                                    );
                                }
                                continue;
                            }
                            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                                let _ = recorder.stop();
                                return Err("Screen capture stream disconnected".to_string());
                            }
                        };
                        consecutive_empty = 0;

                        let mut latest = frame;
                        while let Ok(more) = rx.try_recv() {
                            latest = more;
                        }

                        let Some(img) =
                            image::RgbaImage::from_raw(latest.width, latest.height, latest.raw)
                        else {
                            continue;
                        };

                        encode_rgba_frame(
                            &mut encoder,
                            &mut writer,
                            &mut track_added,
                            &mut dimensions,
                            &mut pending_sample,
                            &mut frame_idx,
                            started_at,
                            img,
                            options.max_size,
                        )?;

                        next_frame_at += frame_duration;
                        if next_frame_at + frame_duration < std::time::Instant::now() {
                            next_frame_at = std::time::Instant::now() + frame_duration;
                        }
                    }
                    let _ = recorder.stop();
                    true
                }
            }
            Err(_) => false,
        }
    };

    // ── Region / poll path: capture_region uses the same logical points as the picker ─
    if !stream_ok && !stop_flag.load(Ordering::Relaxed) {
        let mut consecutive_errors: u32 = 0;
        while !stop_flag.load(Ordering::Relaxed) {
            let now = std::time::Instant::now();
            if now < next_frame_at {
                std::thread::sleep((next_frame_at - now).min(std::time::Duration::from_millis(4)));
                continue;
            }
            let captured = if let Some(ref a) = area {
                monitor.capture_region(a.x, a.y, a.w, a.h)
            } else {
                monitor.capture_image()
            };
            match captured {
                Ok(img) => {
                    consecutive_errors = 0;
                    encode_rgba_frame(
                        &mut encoder,
                        &mut writer,
                        &mut track_added,
                        &mut dimensions,
                        &mut pending_sample,
                        &mut frame_idx,
                        started_at,
                        img,
                        options.max_size,
                    )?;
                    next_frame_at += frame_duration;
                    if next_frame_at + frame_duration < std::time::Instant::now() {
                        next_frame_at = std::time::Instant::now() + frame_duration;
                    }
                }
                Err(error) => {
                    consecutive_errors += 1;
                    if consecutive_errors >= 20 {
                        return Err(format!("Screen capture stopped: {error}"));
                    }
                    std::thread::sleep(std::time::Duration::from_millis(16));
                }
            }
        }
    }

    if let Some((sample, captured_at, is_sync)) = pending_sample.take() {
        let duration = (started_at.elapsed().as_millis() as u64)
            .saturating_sub(captured_at)
            .max(sample_duration as u64)
            .clamp(1, u32::MAX as u64) as u32;
        writer
            .write_sample(
                1,
                &mp4::Mp4Sample {
                    start_time: captured_at,
                    duration,
                    rendering_offset: 0,
                    is_sync,
                    bytes: bytes::Bytes::from(sample),
                },
            )
            .map_err(|error| format!("write final video frame: {error}"))?;
        frame_idx += 1;
    }
    if frame_idx == 0 {
        return Err(
            "No frames captured. Grant Screen Recording permission and restart Qx, or try a smaller region."
                .to_string(),
        );
    }
    writer
        .write_end()
        .map_err(|error| format!("finalize video: {error}"))?;
    let (width, height) = dimensions.ok_or_else(|| "video has no dimensions".to_string())?;
    Ok(RecordingOutput {
        path: output_path.to_path_buf(),
        width,
        height,
        frame_count: frame_idx as u32,
    })
}

fn recording_loop(
    output_path: PathBuf,
    area: Option<RecordArea>,
    options: NormalizedRecordingOptions,
    stop_flag: std::sync::Arc<AtomicBool>,
) -> Result<RecordingOutput, String> {
    let result = recording_loop_inner(&output_path, area, options, stop_flag);
    if let Err(error) = &result {
        let _ = fs::remove_file(&output_path);
        set_capture_error(error.clone());
    }
    result
}

#[command]
pub async fn start_recording(
    app: AppHandle,
    area: Option<RecordArea>,
    options: Option<RecordingOptions>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if !crate::permissions::screen_recording_granted() {
            // Prompt the system dialog when possible; still fail closed if denied.
            let _ = crate::permissions::qx_permissions_request("screen-recording".to_string());
            if !crate::permissions::screen_recording_granted() {
                return Err(
                    "Screen Recording permission required. Enable Qx in System Settings → Privacy & Security → Screen Recording, then fully quit and reopen Qx."
                        .to_string(),
                );
            }
        }
    }

    let mut guard = recording_state().lock().map_err(|e| format!("lock: {e}"))?;
    if guard.is_some() {
        return Err("Already recording".to_string());
    }
    if let Ok(mut slot) = capture_error_slot().lock() {
        *slot = None;
    }
    FRAME_COUNT.store(0, Ordering::Relaxed);

    let options = options.unwrap_or_default().normalize();
    let timestamp = Local::now().format("%Y%m%d_%H%M%S_%3f").to_string();
    let output_path = gifs_dir().join(format!("recording_{timestamp}.{}", options.extension));

    let stop_flag = std::sync::Arc::new(AtomicBool::new(false));
    let stop_clone = stop_flag.clone();

    let capture_area = area.clone();
    let handle =
        std::thread::spawn(move || recording_loop(output_path, capture_area, options, stop_clone));

    let started_at = std::time::Instant::now();
    *guard = Some(RecordingState {
        stop_flag,
        thread_handle: Some(handle),
        started_at,
    });
    drop(guard);

    if let Ok(mut status) = runtime_status().lock() {
        status.phase = "recording";
        status.started_at = Some(started_at);
        status.area = area;
        status.output_path = None;
        status.error = None;
    }
    // Hide picker + main shell so neither appears in the capture stream,
    // then always surface the floating island control strip.
    hide_region_picker_internal(&app);
    set_recording_ui_protected(&app, true);
    crate::floating_panel::hide(&app);
    // Brief yield so hide + capture thread settle before the island window maps.
    std::thread::sleep(std::time::Duration::from_millis(40));
    show_recording_controls_internal(&app).map_err(|error| {
        format!("recording started but floating controls failed to open: {error}")
    })?;
    // Re-assert visibility once more (macOS Space / fullscreen races).
    if let Some(controls) = app.get_webview_window(CONTROL_LABEL) {
        position_controls(&app);
        let _ = controls.show();
        #[cfg(target_os = "macos")]
        promote_controls_window(&controls);
    }
    emit_recording_status(&app);
    Ok(())
}

/// Open a dedicated transparent fullscreen picker (no main-window glass mask).
#[command]
pub async fn screencap_begin_region_select(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if !crate::permissions::screen_recording_granted() {
            let _ = crate::permissions::qx_permissions_request("screen-recording".to_string());
            if !crate::permissions::screen_recording_granted() {
                return Err(
                    "Screen Recording permission required. Enable Qx in System Settings → Privacy & Security → Screen Recording, then fully quit and reopen Qx."
                        .to_string(),
                );
            }
        }
    }
    crate::floating_panel::hide(&app);
    show_region_picker_internal(&app)
}

#[command]
pub async fn screencap_cancel_region_select(app: AppHandle) -> Result<(), String> {
    hide_region_picker_internal(&app);
    crate::floating_panel::suppress_auto_hide(std::time::Duration::from_millis(800));
    crate::floating_panel::show_and_navigate(&app, "screencap");
    Ok(())
}

/// Confirm a logical-point crop from the picker and start recording immediately.
#[command]
pub async fn screencap_confirm_region_select(
    app: AppHandle,
    area: RecordArea,
    options: Option<RecordingOptions>,
) -> Result<(), String> {
    hide_region_picker_internal(&app);
    if area.w < 16 || area.h < 16 {
        crate::floating_panel::suppress_auto_hide(std::time::Duration::from_millis(800));
        crate::floating_panel::show_and_navigate(&app, "screencap");
        return Err("Selection too small — drag a larger region".to_string());
    }
    // Area is CSS client points on a picker that fully covers the primary display
    // (= xcap capture_region logical coordinates).
    match start_recording(app.clone(), Some(area), options).await {
        Ok(()) => Ok(()),
        Err(error) => {
            crate::floating_panel::suppress_auto_hide(std::time::Duration::from_millis(800));
            crate::floating_panel::show_and_navigate(&app, "screencap");
            Err(error)
        }
    }
}

fn stop_recording_blocking() -> Result<String, String> {
    let mut guard = recording_state().lock().map_err(|e| format!("lock: {e}"))?;
    let mut state = guard.take().ok_or("Not recording")?;
    drop(guard);

    state.stop_flag.store(true, Ordering::Relaxed);
    let duration_ms = state.started_at.elapsed().as_millis() as u64;
    let output = state
        .thread_handle
        .take()
        .ok_or_else(|| "recording worker is unavailable".to_string())?
        .join()
        .map_err(|_| "recording worker crashed".to_string())??;
    if let Some(error) = take_capture_error() {
        let _ = fs::remove_file(&output.path);
        return Err(error);
    }
    insert_history(
        &output.path,
        output.width,
        output.height,
        output.frame_count,
        duration_ms,
    )
    .map_err(|error| format!("save recording history: {error}"))?;
    Ok(output.path.to_string_lossy().to_string())
}

#[command]
pub async fn stop_recording(app: AppHandle) -> Result<String, String> {
    // Joining the capture thread and finalizing the MP4/MOV container can block
    // briefly. Keep that work off Tauri's async core threads so the launcher and
    // its progress island remain responsive.
    if let Ok(mut status) = runtime_status().lock() {
        status.phase = "processing";
        status.error = None;
    }
    emit_recording_status(&app);
    let result = tauri::async_runtime::spawn_blocking(stop_recording_blocking)
        .await
        .map_err(|e| format!("recording encoder worker failed: {e}"))?;

    match &result {
        Ok(path) => {
            if let Ok(mut status) = runtime_status().lock() {
                status.phase = "done";
                status.started_at = None;
                status.output_path = Some(path.clone());
                status.error = None;
            }
        }
        Err(error) => {
            if let Ok(mut status) = runtime_status().lock() {
                status.phase = "error";
                status.started_at = None;
                status.error = Some(error.clone());
            }
        }
    }

    set_recording_ui_protected(&app, false);
    hide_recording_controls_internal(&app);
    // Stop button / focus handoff can fire Focused(false) immediately after show.
    crate::floating_panel::suppress_auto_hide(std::time::Duration::from_millis(1200));
    crate::floating_panel::show_and_navigate(&app, "screencap");
    emit_recording_status(&app);
    result
}

#[command]
pub fn recording_status(app: AppHandle) -> RecordingStatusSnapshot {
    recording_status_snapshot(&app)
}

#[command]
pub async fn screencap_show_controls(app: AppHandle) -> Result<(), String> {
    set_recording_ui_protected(&app, true);
    show_recording_controls_internal(&app)
}

#[command]
pub fn screencap_hide_controls(app: AppHandle) {
    hide_recording_controls_internal(&app);
    emit_recording_status(&app);
}

#[command]
pub fn screencap_return_to_main(app: AppHandle) {
    hide_recording_controls_internal(&app);
    set_recording_ui_protected(&app, true);
    crate::floating_panel::suppress_auto_hide(std::time::Duration::from_millis(800));
    crate::floating_panel::show_and_navigate(&app, "screencap");
    emit_recording_status(&app);
}

fn append_annex_b_nals(target: &mut Vec<u8>, avcc: &[u8]) -> Result<(), String> {
    let mut cursor = 0_usize;
    while cursor < avcc.len() {
        if cursor + 4 > avcc.len() {
            return Err("invalid H.264 sample length".to_string());
        }
        let length = u32::from_be_bytes([
            avcc[cursor],
            avcc[cursor + 1],
            avcc[cursor + 2],
            avcc[cursor + 3],
        ]) as usize;
        cursor += 4;
        if cursor + length > avcc.len() {
            return Err("invalid H.264 NAL unit".to_string());
        }
        target.extend_from_slice(&[0, 0, 0, 1]);
        target.extend_from_slice(&avcc[cursor..cursor + length]);
        cursor += length;
    }
    Ok(())
}

fn convert_recording_to_gif_blocking(
    source_path: String,
    max_width: u32,
    target_fps: u32,
) -> Result<String, String> {
    use openh264::formats::YUVSource;
    use std::io::BufReader;

    let source = PathBuf::from(source_path)
        .canonicalize()
        .map_err(|error| format!("open recording: {error}"))?;
    let file = fs::File::open(&source).map_err(|error| format!("open recording: {error}"))?;
    let size = file
        .metadata()
        .map_err(|error| format!("read recording: {error}"))?
        .len();
    let mut reader = mp4::Mp4Reader::read_header(BufReader::new(file), size)
        .map_err(|error| format!("read video container: {error}"))?;
    let track = reader
        .tracks()
        .values()
        .find(|track| track.media_type().ok() == Some(mp4::MediaType::H264))
        .ok_or_else(|| "recording has no supported H.264 video track".to_string())?;
    let track_id = track.track_id();
    let sample_count = track.sample_count();
    let timescale = track.timescale().max(1);
    let duration_ms = track.duration().as_millis() as u64;
    let avc1 = track
        .trak
        .mdia
        .minf
        .stbl
        .stsd
        .avc1
        .as_ref()
        .ok_or_else(|| "recording has no AVC configuration".to_string())?;
    let sps = avc1
        .avcc
        .sequence_parameter_sets
        .first()
        .map(|unit| unit.bytes.clone())
        .ok_or_else(|| "recording has no H.264 sequence parameters".to_string())?;
    let pps = avc1
        .avcc
        .picture_parameter_sets
        .first()
        .map(|unit| unit.bytes.clone())
        .ok_or_else(|| "recording has no H.264 picture parameters".to_string())?;

    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("recording");
    let output = source.with_file_name(format!(
        "{stem}_gif_{}.gif",
        Local::now().format("%Y%m%d_%H%M%S_%3f")
    ));
    let gif_width = max_width.clamp(320, 1600);
    let gif_fps = target_fps.clamp(6, 20);
    let settings = gifski::Settings {
        // Frames are already resized below; leaving dimensions unset prevents
        // gifski from upscaling recordings smaller than the selected maximum.
        width: None,
        height: None,
        quality: 82,
        fast: true,
        repeat: gifski::Repeat::Infinite,
    };
    let (collector, writer) =
        gifski::new(settings).map_err(|error| format!("start GIF encoder: {error}"))?;

    let produced_frames = std::thread::scope(|scope| -> Result<u32, String> {
        let producer = scope.spawn(move || -> Result<u32, String> {
            let mut decoder = openh264::decoder::Decoder::new()
                .map_err(|error| format!("start H.264 decoder: {error}"))?;
            let mut gif_index = 0_usize;
            let mut next_frame_time = 0_f64;
            for sample_id in 1..=sample_count {
                let Some(sample) = reader
                    .read_sample(track_id, sample_id)
                    .map_err(|error| format!("read video frame: {error}"))?
                else {
                    continue;
                };
                let mut packet =
                    Vec::with_capacity(sample.bytes.len() + sps.len() + pps.len() + 12);
                if sample_id == 1 {
                    packet.extend_from_slice(&[0, 0, 0, 1]);
                    packet.extend_from_slice(&sps);
                    packet.extend_from_slice(&[0, 0, 0, 1]);
                    packet.extend_from_slice(&pps);
                }
                append_annex_b_nals(&mut packet, &sample.bytes)?;
                let Some(decoded) = decoder
                    .decode(&packet)
                    .map_err(|error| format!("decode video frame: {error}"))?
                else {
                    continue;
                };
                let timestamp = sample.start_time as f64 / timescale as f64;
                if timestamp + 0.000_1 < next_frame_time {
                    continue;
                }
                next_frame_time = timestamp + 1.0 / gif_fps as f64;
                let (width, height) = decoded.dimensions();
                let mut rgba = vec![0_u8; width * height * 4];
                decoded.write_rgba8(&mut rgba);
                let image = image::RgbaImage::from_raw(width as u32, height as u32, rgba)
                    .ok_or_else(|| "decoded video frame is invalid".to_string())?;
                let resized = if image.width() > gif_width {
                    let height = (image.height() as f64 * gif_width as f64 / image.width() as f64)
                        .round()
                        .max(1.0) as u32;
                    image::imageops::resize(
                        &image,
                        gif_width,
                        height,
                        image::imageops::FilterType::Triangle,
                    )
                } else {
                    image
                };
                let (gif_frame_width, gif_frame_height) = resized.dimensions();
                let pixels = resized
                    .into_raw()
                    .chunks_exact(4)
                    .map(|pixel| gifski::collector::RGBA8 {
                        r: pixel[0],
                        g: pixel[1],
                        b: pixel[2],
                        a: pixel[3],
                    })
                    .collect();
                collector
                    .add_frame_rgba(
                        gif_index,
                        gifski::collector::ImgVec::new(
                            pixels,
                            gif_frame_width as usize,
                            gif_frame_height as usize,
                        ),
                        timestamp,
                    )
                    .map_err(|error| format!("add GIF frame: {error}"))?;
                gif_index += 1;
            }
            drop(collector);
            Ok(gif_index as u32)
        });

        let mut file = fs::File::create(&output).map_err(|error| format!("create GIF: {error}"))?;
        let mut progress = gifski::progress::NoProgress {};
        let writer_result = writer
            .write(&mut file, &mut progress)
            .map_err(|error| format!("write GIF: {error}"));
        let frame_count = producer
            .join()
            .map_err(|_| "GIF conversion worker crashed".to_string())??;
        writer_result?;
        Ok(frame_count)
    })?;
    if produced_frames == 0 {
        let _ = fs::remove_file(&output);
        return Err("video did not contain any decodable frames".to_string());
    }
    let (width, height) = image::image_dimensions(&output).unwrap_or((gif_width, 0));
    insert_history(&output, width, height, produced_frames, duration_ms)
        .map_err(|error| format!("save GIF history: {error}"))?;
    Ok(output.to_string_lossy().to_string())
}

#[command]
pub async fn convert_recording_to_gif(
    source_path: String,
    max_width: Option<u32>,
    fps: Option<u32>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        convert_recording_to_gif_blocking(source_path, max_width.unwrap_or(960), fps.unwrap_or(12))
    })
    .await
    .map_err(|error| format!("GIF conversion worker failed: {error}"))?
}

#[command]
pub fn save_gif(source_path: String, dest_path: String) -> Result<String, String> {
    fs::copy(&source_path, &dest_path).map_err(|e| format!("copy: {e}"))?;
    Ok(dest_path)
}

#[command]
pub fn list_gif_history(limit: Option<u32>) -> Vec<GifEntry> {
    let limit = limit.unwrap_or(50) as i64;
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut stmt = match conn.prepare(
        "SELECT id, file_path, width, height, frame_count, duration_ms, created_at FROM gif_history ORDER BY created_at DESC LIMIT ?1",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map(params![limit], |row| {
        Ok(GifEntry {
            id: row.get(0)?,
            path: row.get(1)?,
            width: row.get::<_, Option<i64>>(2)?.unwrap_or(0) as u32,
            height: row.get::<_, Option<i64>>(3)?.unwrap_or(0) as u32,
            frame_count: row.get::<_, Option<i64>>(4)?.unwrap_or(0) as u32,
            duration_ms: row.get::<_, Option<i64>>(5)?.unwrap_or(0) as u64,
            created_at: row.get(6)?,
        })
    });
    let mut out = Vec::new();
    if let Ok(rows) = rows {
        for r in rows.flatten() {
            out.push(r);
        }
    }
    out
}

#[command]
pub fn is_recording() -> bool {
    let Ok(guard) = recording_state().lock() else {
        return false;
    };
    guard.is_some()
}

#[command]
pub fn get_screencap_history(limit: Option<u32>) -> Vec<GifEntry> {
    list_gif_history(limit)
}

#[command]
pub fn delete_screencap(id: i64) -> Result<(), String> {
    let conn = open_db().map_err(|e| format!("db: {e}"))?;
    let file_path: String = conn
        .query_row(
            "SELECT file_path FROM gif_history WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("not found: {e}"))?;
    conn.execute("DELETE FROM gif_history WHERE id = ?1", params![id])
        .map_err(|e| format!("delete: {e}"))?;
    let _ = fs::remove_file(&file_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logical_area_is_clamped_to_monitor() {
        let area = clamp_logical_area(
            RecordArea {
                x: 10,
                y: 20,
                w: 9999,
                h: 40,
            },
            800,
            600,
        )
        .expect("valid");
        assert_eq!(area.x, 10);
        assert_eq!(area.y, 20);
        assert_eq!(area.w, 790);
        assert_eq!(area.h, 40);
    }

    #[test]
    fn crop_physical_scales_logical_points() {
        let frame = image::RgbaImage::from_pixel(200, 100, image::Rgba([1, 2, 3, 255]));
        let area = RecordArea {
            x: 10,
            y: 5,
            w: 40,
            h: 20,
        };
        // Frame is 2× a 100×50 logical monitor.
        let cropped = crop_physical(&frame, &area, 100, 50);
        assert_eq!(cropped.width(), 80);
        assert_eq!(cropped.height(), 40);
    }

    #[test]
    fn video_dimensions_are_even_and_bounded() {
        let source = image::RgbaImage::new(2559, 1439);
        let output = constrain_video_size(source, Some((1920, 1080)));
        assert!(output.width() <= 1920);
        assert!(output.height() <= 1080);
        assert_eq!(output.width() % 2, 0);
        assert_eq!(output.height() % 2, 0);
    }

    #[test]
    fn avcc_samples_convert_back_to_annex_b() {
        let mut annex_b = Vec::new();
        append_annex_b_nals(&mut annex_b, &[0, 0, 0, 3, 0x65, 1, 2]).unwrap();
        assert_eq!(annex_b, vec![0, 0, 0, 1, 0x65, 1, 2]);
        assert!(append_annex_b_nals(&mut Vec::new(), &[0, 0, 0, 9, 1]).is_err());
    }

    #[test]
    fn h264_frames_are_muxed_into_a_readable_mp4() {
        let path = std::env::temp_dir().join(format!(
            "qx-screencap-codec-test-{}.mp4",
            std::process::id()
        ));
        let file = fs::File::create(&path).unwrap();
        let mut writer = mp4::Mp4Writer::write_start(file, &mp4_config("mp4").unwrap()).unwrap();
        let mut encoder = openh264::encoder::Encoder::new().unwrap();
        let mut track_added = false;

        for index in 0..3_u64 {
            let rgb = vec![(index * 70) as u8; 64 * 64 * 3];
            let source = openh264::formats::RgbSliceU8::new(&rgb, (64, 64));
            let yuv = openh264::formats::YUVBuffer::from_rgb8_source(source);
            let encoded = encoder.encode(&yuv).unwrap();
            let (sps, pps, sample, sync) = mp4_parts(&encoded);
            if !track_added {
                writer
                    .add_track(&mp4::TrackConfig::from(mp4::AvcConfig {
                        width: 64,
                        height: 64,
                        seq_param_set: sps.unwrap(),
                        pic_param_set: pps.unwrap(),
                    }))
                    .unwrap();
                track_added = true;
            }
            writer
                .write_sample(
                    1,
                    &mp4::Mp4Sample {
                        start_time: index * 40,
                        duration: 40,
                        rendering_offset: 0,
                        is_sync: sync,
                        bytes: bytes::Bytes::from(sample),
                    },
                )
                .unwrap();
        }
        writer.write_end().unwrap();

        let file = fs::File::open(&path).unwrap();
        let size = file.metadata().unwrap().len();
        let reader = mp4::Mp4Reader::read_header(std::io::BufReader::new(file), size).unwrap();
        assert_eq!(reader.sample_count(1).unwrap(), 3);
        assert_eq!(reader.tracks().get(&1).unwrap().width(), 64);
        assert_eq!(reader.tracks().get(&1).unwrap().height(), 64);
        let _ = fs::remove_file(path);
    }
}
