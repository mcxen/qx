pub(crate) fn append_annex_b_nals(target: &mut Vec<u8>, avcc: &[u8]) -> Result<(), String> {
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

fn strip_annex_b_start_code(nal: &[u8]) -> &[u8] {
    if nal.starts_with(&[0, 0, 0, 1]) {
        &nal[4..]
    } else if nal.starts_with(&[0, 0, 1]) {
        &nal[3..]
    } else {
        nal
    }
}

pub(crate) fn mp4_parts(
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

pub(crate) fn mp4_config(extension: &str) -> Result<mp4::Mp4Config, String> {
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

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{append_annex_b_nals, mp4_config, mp4_parts};

    #[test]
    fn avcc_samples_convert_back_to_annex_b() {
        let mut annex_b = Vec::new();
        append_annex_b_nals(&mut annex_b, &[0, 0, 0, 3, 0x65, 1, 2]).unwrap();
        assert_eq!(annex_b, vec![0, 0, 0, 1, 0x65, 1, 2]);
        assert!(append_annex_b_nals(&mut Vec::new(), &[0, 0, 0, 9, 1]).is_err());
    }

    #[test]
    fn h264_frames_are_muxed_into_a_readable_mp4() {
        let path =
            std::env::temp_dir().join(format!("qx-media-codec-test-{}.mp4", std::process::id()));
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
