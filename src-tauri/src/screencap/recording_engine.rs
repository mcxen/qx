use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use super::geometry::{clamp_area, crop_physical};
use super::state::{set_capture_error, FRAME_COUNT};
use super::types::{NormalizedRecordingOptions, RecordArea, RecordingOutput};
use crate::display::{capture_image_from_monitor, capture_monitor, capture_region_from_monitor};
use crate::media::h264::{mp4_config, mp4_parts};
use crate::media::image::constrain_video_size;

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

/// Prefer xcap's native continuous stream. Fall back to the root display
/// service's polled frames if initialization fails or the stream stalls.
fn recording_loop_inner(
    output_path: &Path,
    area: Option<RecordArea>,
    monitor_id: Option<u32>,
    options: NormalizedRecordingOptions,
    stop_flag: std::sync::Arc<AtomicBool>,
) -> Result<RecordingOutput, String> {
    // Let the picker / main shell finish hiding before the first sample.
    std::thread::sleep(std::time::Duration::from_millis(200));

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
    let started_at = std::time::Instant::now();
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
                let mut stream_healthy = true;
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
                    };
                    consecutive_empty = 0;

                    let mut latest = frame;
                    while let Ok(more) = rx.try_recv() {
                        latest = more;
                    }

                    let Some(mut img) =
                        image::RgbaImage::from_raw(latest.width, latest.height, latest.raw)
                    else {
                        continue;
                    };
                    if let Some(ref capture_area) = area {
                        img = crop_physical(&img, capture_area, mon_w, mon_h);
                    }

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

                    let after_encode = std::time::Instant::now();
                    advance_frame_deadline(&mut next_frame_at, frame_duration, after_encode);
                }
                let _ = recorder.stop();
                stream_healthy
            }
        }
        Ok(Err(_)) | Err(_) => false,
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
                capture_region_from_monitor(&monitor, a.x, a.y, a.w, a.h)
            } else {
                capture_image_from_monitor(&monitor)
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

#[cfg(test)]
mod tests {
    use super::advance_frame_deadline;
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
