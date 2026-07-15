use chrono::Local;
use std::fs;
use std::path::PathBuf;

use super::{h264, MediaOutput};

pub(crate) fn convert_recording_to_gif(
    source_path: String,
    max_width: u32,
    target_fps: u32,
) -> Result<MediaOutput, String> {
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
                h264::append_annex_b_nals(&mut packet, &sample.bytes)?;
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
    Ok(MediaOutput {
        path: output,
        width,
        height,
        frame_count: produced_frames,
        duration_ms,
    })
}
