use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use super::geometry::{clamp_area, crop_physical_into};
use super::state::{set_capture_error, FRAME_COUNT};
use super::types::{NormalizedRecordingOptions, RecordArea, RecordingOutput};
use crate::display::{capture_monitor, PollingCaptureSession};
use crate::media::h264::{mp4_config, mp4_parts};
use crate::media::image::constrain_video_size;
use image::ImageEncoder;

const STREAM_STALL_TIMEOUTS: u32 = 10;
#[cfg(target_os = "windows")]
const STREAM_START_TIMEOUTS: u32 = 4;
#[cfg(not(target_os = "windows"))]
const STREAM_START_TIMEOUTS: u32 = 6;

#[derive(Default)]
struct FrameEncodeScratch {
    rgb: Vec<u8>,
    yuv: Option<openh264::formats::YUVBuffer>,
}

impl FrameEncodeScratch {
    fn prepare_yuv(&mut self, image: &image::RgbaImage) -> &openh264::formats::YUVBuffer {
        let (width, height) = image.dimensions();
        let rgb_len = width as usize * height as usize * 3;
        self.rgb.resize(rgb_len, 0);
        for (rgba, rgb) in image
            .as_raw()
            .chunks_exact(4)
            .zip(self.rgb.chunks_exact_mut(3))
        {
            rgb.copy_from_slice(&rgba[..3]);
        }
        let source =
            openh264::formats::RgbSliceU8::new(&self.rgb, (width as usize, height as usize));
        if let Some(yuv) = self.yuv.as_mut() {
            yuv.read_rgb8(source);
        } else {
            self.yuv = Some(openh264::formats::YUVBuffer::from_rgb8_source(source));
        }
        self.yuv.as_ref().expect("YUV scratch initialized")
    }
}

fn advance_frame_deadline(
    next_frame_at: &mut std::time::Instant,
    frame_duration: std::time::Duration,
    after_encode: std::time::Instant,
) {
    *next_frame_at += frame_duration;
    if *next_frame_at < after_encode {
        // The encoder already consumed the next slot. Resume immediately so
        // capture is encoder-limited instead of adding another full interval.
        *next_frame_at = after_encode;
    }
}

fn drain_latest_frame<T>(receiver: &std::sync::mpsc::Receiver<T>, latest: &mut Option<T>) {
    while let Ok(frame) = receiver.try_recv() {
        *latest = Some(frame);
    }
}

fn capture_timestamp_ms(
    timeline_origin: &mut Option<std::time::Instant>,
    captured_at: std::time::Instant,
) -> u64 {
    let origin = *timeline_origin.get_or_insert(captured_at);
    captured_at.saturating_duration_since(origin).as_millis() as u64
}

fn encode_rgba_frame(
    encoder: &mut openh264::encoder::Encoder,
    writer: &mut mp4::Mp4Writer<fs::File>,
    track_added: &mut bool,
    dimensions: &mut Option<(u32, u32)>,
    pending_sample: &mut Option<(Vec<u8>, u64, bool)>,
    frame_idx: &mut u64,
    scratch: &mut FrameEncodeScratch,
    timeline_origin: &mut Option<std::time::Instant>,
    cover_frame: &mut Option<image::RgbaImage>,
    img: &image::RgbaImage,
    max_size: Option<(u32, u32)>,
) -> Result<(), String> {
    // MP4 time begins at the first captured frame, not when WGC initialization
    // started. A WGC timeout followed by GDI fallback must not create seconds of
    // frozen/empty lead-in in an otherwise healthy recording.
    let captured_at = capture_timestamp_ms(timeline_origin, std::time::Instant::now());
    let final_img = constrain_video_size(img, max_size);
    let (width, height) = final_img.dimensions();
    if cover_frame.is_none() {
        // Capture one stable frame while pixels are already available. Keeping
        // the frame in memory and encoding it after MP4 finalization avoids a
        // first-frame stall and avoids asking WebKit/WebView2 to seek a local
        // video merely to paint History artwork.
        *cover_frame = Some(image::imageops::thumbnail(final_img.as_ref(), 640, 400));
    }
    if dimensions.is_some_and(|value| value != (width, height)) {
        return Err("capture dimensions changed during recording".to_string());
    }
    *dimensions = Some((width, height));
    // Keep RGB and YUV allocations alive for the recording session. A 1080p
    // frame otherwise allocated and freed roughly 9 MiB of conversion buffers
    // on every sample on both ScreenCaptureKit and WGC paths.
    let yuv = scratch.prepare_yuv(final_img.as_ref());
    let encoded = encoder
        .encode(yuv)
        .map_err(|error| format!("encode H.264 frame: {error}"))?;
    let (sps, pps, sample, is_sync) = mp4_parts(&encoded);
    if !*track_added {
        let sps =
            sps.ok_or_else(|| "H.264 stream has no SPS — capture may have failed".to_string())?;
        let pps =
            pps.ok_or_else(|| "H.264 stream has no PPS — capture may have failed".to_string())?;
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

fn write_recording_cover(output_path: &Path, cover: &image::RgbaImage) -> Result<PathBuf, String> {
    let stem = output_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("recording");
    let cover_path = output_path.with_file_name(format!("{stem}.cover.png"));
    let file = fs::File::create(&cover_path)
        .map_err(|error| format!("create recording cover: {error}"))?;
    image::codecs::png::PngEncoder::new_with_quality(
        BufWriter::new(file),
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Sub,
    )
    .write_image(
        cover.as_raw(),
        cover.width(),
        cover.height(),
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|error| format!("save recording cover: {error}"))?;
    Ok(cover_path)
}

/// Prefer xcap's native continuous stream. Fall back to the root display
/// service's polled frames if initialization fails or the stream stalls.
fn recording_loop_inner(
    output_path: &Path,
    area: Option<RecordArea>,
    monitor_id: Option<u32>,
    options: NormalizedRecordingOptions,
    stop_flag: std::sync::Arc<AtomicBool>,
) -> Result<RecordingOutput, String> {
    let monitor = capture_monitor(
        area.as_ref()
            .and_then(|value| value.monitor_id)
            .or(monitor_id),
    )?;
    let mon_w = monitor
        .width()
        .map_err(|error| format!("display width: {error}"))?;
    let mon_h = monitor
        .height()
        .map_err(|error| format!("display height: {error}"))?;

    // Picker selections have already been converted into this monitor's xcap coordinates.
    let area = area.and_then(|a| clamp_area(a, mon_w, mon_h));
    let full_display_selection = area.as_ref().is_some_and(|area| {
        area.x <= 1 && area.y <= 1 && area.w + 1 >= mon_w && area.h + 1 >= mon_h
    });
    let area = if full_display_selection { None } else { area };
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
    let mut encode_scratch = FrameEncodeScratch::default();
    let mut crop_scratch = image::RgbaImage::new(0, 0);
    let mut timeline_origin = None;
    let mut cover_frame = None;
    let mut next_frame_at = std::time::Instant::now();

    // ── Native continuous stream (region selections crop each stream frame) ─
    let recorder_result =
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| monitor.video_recorder()));
    let stream_ok = match recorder_result {
        Ok(Ok((recorder, rx))) => {
            let started =
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| recorder.start()))
                    .is_ok_and(|result| result.is_ok());
            if !started {
                false
            } else {
                let mut consecutive_empty: u32 = 0;
                let mut received_frame = false;
                let mut stream_healthy = true;
                let mut buffered_frame = None;
                while !stop_flag.load(Ordering::Relaxed) {
                    // Keep the newest stream frame while pacing to the requested
                    // FPS. Discarding the whole queue here made a frame arriving
                    // just before the deadline vanish, then waited for another
                    // display refresh and reduced effective FPS.
                    drain_latest_frame(&rx, &mut buffered_frame);
                    let now = std::time::Instant::now();
                    if now < next_frame_at {
                        std::thread::sleep(
                            (next_frame_at - now).min(std::time::Duration::from_millis(4)),
                        );
                        continue;
                    }

                    let mut latest = if let Some(frame) = buffered_frame.take() {
                        frame
                    } else {
                        match rx.recv_timeout(std::time::Duration::from_millis(500)) {
                            Ok(frame) => frame,
                            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                                consecutive_empty += 1;
                                let timeout_limit = if received_frame {
                                    STREAM_STALL_TIMEOUTS
                                } else {
                                    STREAM_START_TIMEOUTS
                                };
                                if consecutive_empty >= timeout_limit {
                                    stream_healthy = false;
                                    break;
                                }
                                continue;
                            }
                            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                                let _ = recorder.stop();
                                stream_healthy = false;
                                break;
                            }
                        }
                    };
                    consecutive_empty = 0;
                    received_frame = true;

                    while let Ok(more) = rx.try_recv() {
                        latest = more;
                    }

                    let Some(img) =
                        image::RgbaImage::from_raw(latest.width, latest.height, latest.raw)
                    else {
                        continue;
                    };
                    let prepared = if let Some(capture_area) = area.as_ref() {
                        crop_physical_into(&mut crop_scratch, &img, capture_area, mon_w, mon_h)
                    } else {
                        &img
                    };

                    encode_rgba_frame(
                        &mut encoder,
                        &mut writer,
                        &mut track_added,
                        &mut dimensions,
                        &mut pending_sample,
                        &mut frame_idx,
                        &mut encode_scratch,
                        &mut timeline_origin,
                        &mut cover_frame,
                        prepared,
                        options.max_size,
                    )?;

                    let after_encode = std::time::Instant::now();
                    advance_frame_deadline(&mut next_frame_at, frame_duration, after_encode);
                }
                // xcap uses a zero-capacity channel on both WGC and macOS.
                // Release the receiver before stopping the native session so a
                // callback already blocked in send() can exit instead of
                // extending or deadlocking the user's Stop action.
                drop(rx);
                let _ = recorder.stop();
                stream_healthy
            }
        }
        Ok(Err(_)) | Err(_) => false,
    };

    // ── Region / poll path: capture_region uses the same logical points as the picker ─
    if !stream_ok && !stop_flag.load(Ordering::Relaxed) {
        #[cfg(target_os = "windows")]
        crate::display_windows::disable_wgc();
        let (poll_x, poll_y, poll_width, poll_height) = area
            .as_ref()
            .map(|area| (area.x, area.y, area.w, area.h))
            .unwrap_or((0, 0, mon_w, mon_h));
        let mut capture =
            PollingCaptureSession::new(&monitor, poll_x, poll_y, poll_width, poll_height)?;
        let mut consecutive_errors: u32 = 0;
        while !stop_flag.load(Ordering::Relaxed) {
            let now = std::time::Instant::now();
            if now < next_frame_at {
                std::thread::sleep((next_frame_at - now).min(std::time::Duration::from_millis(4)));
                continue;
            }
            match capture.capture() {
                Ok(img) => {
                    consecutive_errors = 0;
                    encode_rgba_frame(
                        &mut encoder,
                        &mut writer,
                        &mut track_added,
                        &mut dimensions,
                        &mut pending_sample,
                        &mut frame_idx,
                        &mut encode_scratch,
                        &mut timeline_origin,
                        &mut cover_frame,
                        img.as_ref(),
                        options.max_size,
                    )?;
                    let after_encode = std::time::Instant::now();
                    advance_frame_deadline(&mut next_frame_at, frame_duration, after_encode);
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
        let timeline_elapsed = timeline_origin
            .map(|origin| origin.elapsed().as_millis() as u64)
            .unwrap_or(sample_duration as u64);
        let duration = timeline_elapsed
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
    let thumbnail_path = cover_frame
        .as_ref()
        .and_then(|cover| write_recording_cover(output_path, cover).ok());
    Ok(RecordingOutput {
        path: output_path.to_path_buf(),
        thumbnail_path,
        width,
        height,
        frame_count: frame_idx as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        advance_frame_deadline, capture_timestamp_ms, drain_latest_frame, write_recording_cover,
        FrameEncodeScratch,
    };
    use openh264::formats::YUVSource;
    use std::time::{Duration, Instant};

    #[test]
    fn frame_deadline_does_not_add_an_interval_after_slow_encode() {
        let start = Instant::now();
        let interval = Duration::from_millis(33);
        let mut deadline = start;
        let encoded_at = start + Duration::from_millis(52);
        advance_frame_deadline(&mut deadline, interval, encoded_at);
        assert_eq!(deadline, encoded_at);
    }

    #[test]
    fn frame_deadline_preserves_requested_interval_when_encoder_is_fast() {
        let start = Instant::now();
        let interval = Duration::from_millis(33);
        let mut deadline = start;
        advance_frame_deadline(&mut deadline, interval, start + Duration::from_millis(8));
        assert_eq!(deadline, start + interval);
    }

    #[test]
    fn recording_timeline_starts_at_the_first_captured_frame() {
        let worker_started = Instant::now();
        let first_frame = worker_started + Duration::from_secs(3);
        let mut origin = None;
        assert_eq!(capture_timestamp_ms(&mut origin, first_frame), 0);
        assert_eq!(
            capture_timestamp_ms(&mut origin, first_frame + Duration::from_millis(42)),
            42
        );
    }

    #[test]
    fn frame_conversion_reuses_rgb_and_yuv_buffers() {
        let image = image::RgbaImage::from_pixel(4, 4, image::Rgba([12, 34, 56, 255]));
        let mut scratch = FrameEncodeScratch::default();
        scratch.prepare_yuv(&image);
        let rgb_ptr = scratch.rgb.as_ptr();
        let yuv_ptr = scratch.yuv.as_ref().unwrap().y().as_ptr();

        scratch.prepare_yuv(&image);
        assert_eq!(scratch.rgb.as_ptr(), rgb_ptr);
        assert_eq!(scratch.yuv.as_ref().unwrap().y().as_ptr(), yuv_ptr);
    }

    #[test]
    fn stream_pacing_retains_the_latest_frame_before_deadline() {
        let (sender, receiver) = std::sync::mpsc::channel();
        sender.send(1_u8).unwrap();
        sender.send(2_u8).unwrap();
        sender.send(3_u8).unwrap();
        let mut buffered = Some(0_u8);
        drain_latest_frame(&receiver, &mut buffered);
        assert_eq!(buffered, Some(3));
    }

    #[test]
    fn recording_cover_is_a_durable_png_sidecar() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let output = std::env::temp_dir().join(format!(
            "qx-recording-cover-{}-{unique}.mp4",
            std::process::id()
        ));
        let frame = image::RgbaImage::from_pixel(24, 16, image::Rgba([12, 34, 56, 255]));
        let cover = write_recording_cover(&output, &frame).unwrap();
        let decoded = image::open(&cover).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (24, 16));
        assert!(cover.ends_with(format!(
            "qx-recording-cover-{}-{unique}.cover.png",
            std::process::id()
        )));
        std::fs::remove_file(cover).unwrap();
    }
}

pub(super) fn run(
    output_path: PathBuf,
    area: Option<RecordArea>,
    monitor_id: Option<u32>,
    options: NormalizedRecordingOptions,
    stop_flag: std::sync::Arc<AtomicBool>,
) -> Result<RecordingOutput, String> {
    let result = recording_loop_inner(&output_path, area, monitor_id, options, stop_flag);
    if let Err(error) = &result {
        let _ = fs::remove_file(&output_path);
        set_capture_error(error.clone());
    }
    result
}
