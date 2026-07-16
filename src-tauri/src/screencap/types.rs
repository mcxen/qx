use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

pub(super) const DEFAULT_FPS: u32 = 24;

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
pub(super) struct NormalizedRecordingOptions {
    pub(super) extension: &'static str,
    pub(super) fps: u32,
    pub(super) bitrate: u32,
    pub(super) max_size: Option<(u32, u32)>,
}

impl RecordingOptions {
    pub(super) fn normalize(self) -> NormalizedRecordingOptions {
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
#[serde(rename_all = "camelCase")]
pub struct RecordArea {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    #[serde(default)]
    pub monitor_id: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CaptureMode {
    Recording,
    Screenshot,
}

impl CaptureMode {
    pub(super) fn parse(value: &str) -> Result<Self, String> {
        match value.to_ascii_lowercase().as_str() {
            "screenshot" => Ok(Self::Screenshot),
            "recording" => Ok(Self::Recording),
            _ => Err(format!("Unsupported screen capture mode: {value}")),
        }
    }

    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Recording => "recording",
            Self::Screenshot => "screenshot",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::CaptureMode;

    #[test]
    fn capture_modes_are_explicit() {
        assert_eq!(
            CaptureMode::parse("screenshot"),
            Ok(CaptureMode::Screenshot)
        );
        assert_eq!(CaptureMode::parse("recording"), Ok(CaptureMode::Recording));
        assert!(CaptureMode::parse("video").is_err());
    }
}

#[derive(Debug, Clone)]
pub(super) struct PickerSession {
    pub(super) mode: CaptureMode,
    pub(super) monitor_id: u32,
    pub(super) monitor_name: String,
    pub(super) coordinate_scale: f64,
    pub(super) logical_area: Option<RecordArea>,
    pub(super) frame_x: i32,
    pub(super) frame_y: i32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickerStatus {
    pub(super) mode: String,
    pub(super) monitor_id: u32,
    pub(super) monitor_name: String,
    /// Capture-pixel → picker logical scale for this session (from display service).
    pub(super) coordinate_scale: f64,
    /// Logical selection on the picker display, when one has been confirmed or restored.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) logical_area: Option<RecordArea>,
    /// When true, the frontend should rehydrate `logical_area` instead of clearing the canvas.
    #[serde(default)]
    pub(super) restore_selection: bool,
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
    pub controls_pinned: bool,
}

pub(super) struct RecordingRuntimeStatus {
    pub(super) phase: &'static str,
    pub(super) started_at: Option<std::time::Instant>,
    pub(super) area: Option<RecordArea>,
    pub(super) output_path: Option<String>,
    pub(super) error: Option<String>,
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

pub(super) struct RecordingState {
    pub(super) stop_flag: std::sync::Arc<AtomicBool>,
    pub(super) thread_handle: Option<std::thread::JoinHandle<Result<RecordingOutput, String>>>,
    pub(super) started_at: std::time::Instant,
}

#[derive(Debug)]
pub(super) struct RecordingOutput {
    pub(super) path: PathBuf,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) frame_count: u32,
}
