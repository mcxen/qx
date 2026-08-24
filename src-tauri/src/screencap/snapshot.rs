//! Snapshot-first picker backing store.
//!
//! The picker never edits the live desktop. At session start we capture every
//! display into an immutable frame, persist a browser-readable PNG, and retain
//! the decoded RGBA pixels for final cropping and mosaic previews.

use image::ImageEncoder;
use serde::Serialize;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock, RwLock};

use super::types::RecordArea;
use crate::display::{all_capture_monitors, capture_region_from_monitor};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickerSnapshotDescriptor {
    pub monitor_id: u32,
    pub path: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone)]
pub(super) struct PickerSnapshotFrame {
    descriptor: PickerSnapshotDescriptor,
    image: Arc<image::RgbaImage>,
}

static SNAPSHOTS: OnceLock<RwLock<Vec<PickerSnapshotFrame>>> = OnceLock::new();

fn snapshots() -> &'static RwLock<Vec<PickerSnapshotFrame>> {
    SNAPSHOTS.get_or_init(|| RwLock::new(Vec::new()))
}

fn snapshot_cache_dir() -> PathBuf {
    crate::paths::cache_dir().join("screencap-picker")
}

fn prune_old_snapshot_files(directory: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_picker_png = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("picker-") && name.ends_with(".png"));
        if is_picker_png {
            let _ = std::fs::remove_file(path);
        }
    }
}

pub(super) fn capture_all(
    generation: u64,
    include_cursor: bool,
) -> Result<Vec<PickerSnapshotFrame>, String> {
    let monitors = all_capture_monitors()?;
    if monitors.is_empty() {
        return Err("No display found for frozen capture".to_string());
    }

    // Capture every framebuffer first so multi-display frames describe one
    // moment as closely as the platform's synchronous APIs permit. PNG encoding
    // happens only after all live desktop reads have completed.
    let mut captured = Vec::with_capacity(monitors.len());
    for monitor in monitors {
        let monitor_id = monitor
            .id()
            .map_err(|error| format!("display id: {error}"))?;
        let width = monitor
            .width()
            .map_err(|error| format!("display width: {error}"))?;
        let height = monitor
            .height()
            .map_err(|error| format!("display height: {error}"))?;
        let mut image = capture_region_from_monitor(&monitor, 0, 0, width, height)?;
        if include_cursor {
            crate::input_events::composite_pointer(
                &mut image,
                (
                    monitor.x().unwrap_or_default(),
                    monitor.y().unwrap_or_default(),
                ),
                monitor.scale_factor().unwrap_or(1.0) as f64,
                (0, 0),
                false,
            );
        }
        captured.push((monitor_id, image));
    }

    let directory = snapshot_cache_dir();
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("create picker snapshot cache: {error}"))?;
    prune_old_snapshot_files(&directory);

    let mut frames = Vec::with_capacity(captured.len());
    for (monitor_id, image) in captured {
        let path = directory.join(format!("picker-{generation}-{monitor_id}.png"));
        let file = std::fs::File::create(&path)
            .map_err(|error| format!("create picker snapshot: {error}"))?;
        image::codecs::png::PngEncoder::new_with_quality(
            BufWriter::new(file),
            image::codecs::png::CompressionType::Fast,
            image::codecs::png::FilterType::Sub,
        )
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|error| format!("encode picker snapshot: {error}"))?;
        frames.push(PickerSnapshotFrame {
            descriptor: PickerSnapshotDescriptor {
                monitor_id,
                path: path.to_string_lossy().to_string(),
                width: image.width(),
                height: image.height(),
            },
            image: Arc::new(image),
        });
    }
    Ok(frames)
}

pub(super) fn install(frames: Vec<PickerSnapshotFrame>) {
    if let Ok(mut current) = snapshots().write() {
        *current = frames;
    }
}

pub(super) fn clear() {
    let paths = snapshots()
        .write()
        .map(|mut current| {
            current
                .drain(..)
                .map(|frame| PathBuf::from(frame.descriptor.path))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if paths.is_empty() {
        return;
    }
    // Frozen frames can contain the entire visible desktop. Remove them as
    // soon as the picker closes without doing filesystem work on the UI thread.
    let _ = std::thread::Builder::new()
        .name("qx-picker-snapshot-cleanup".to_string())
        .spawn(move || {
            for path in paths {
                let _ = std::fs::remove_file(path);
            }
        });
}

pub(super) fn count() -> usize {
    snapshots().read().map(|frames| frames.len()).unwrap_or(0)
}

pub(super) fn descriptor(monitor_id: u32) -> Option<PickerSnapshotDescriptor> {
    snapshots().read().ok().and_then(|frames| {
        frames
            .iter()
            .find(|frame| frame.descriptor.monitor_id == monitor_id)
            .map(|frame| frame.descriptor.clone())
    })
}

pub(super) fn descriptors() -> Vec<PickerSnapshotDescriptor> {
    snapshots()
        .read()
        .map(|frames| {
            frames
                .iter()
                .map(|frame| frame.descriptor.clone())
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn crop(area: &RecordArea) -> Result<Option<image::RgbaImage>, String> {
    let Some(monitor_id) = area.monitor_id else {
        return Ok(None);
    };
    let frame = snapshots().read().ok().and_then(|frames| {
        frames
            .iter()
            .find(|frame| frame.descriptor.monitor_id == monitor_id)
            .cloned()
    });
    let Some(frame) = frame else {
        return Ok(None);
    };
    if area.w == 0
        || area.h == 0
        || area.x.saturating_add(area.w) > frame.image.width()
        || area.y.saturating_add(area.h) > frame.image.height()
    {
        return Err("Frozen selection is outside its display snapshot".to_string());
    }
    Ok(Some(
        image::imageops::crop_imm(&*frame.image, area.x, area.y, area.w, area.h).to_image(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    #[test]
    fn crop_uses_the_installed_immutable_frame() {
        clear();
        let mut image = image::RgbaImage::new(4, 3);
        image.put_pixel(2, 1, Rgba([17, 34, 51, 255]));
        install(vec![PickerSnapshotFrame {
            descriptor: PickerSnapshotDescriptor {
                monitor_id: 42,
                path: "/tmp/qx-nonexistent-picker-test.png".to_string(),
                width: 4,
                height: 3,
            },
            image: Arc::new(image),
        }]);

        let cropped = crop(&RecordArea {
            x: 2,
            y: 1,
            w: 1,
            h: 1,
            monitor_id: Some(42),
        })
        .expect("crop succeeds")
        .expect("snapshot exists");

        assert_eq!(cropped.get_pixel(0, 0), &Rgba([17, 34, 51, 255]));
        clear();
    }
}
