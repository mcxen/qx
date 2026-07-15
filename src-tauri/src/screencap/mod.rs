pub(crate) mod commands;
mod controls;
mod geometry;
mod picker_window;
mod recording_engine;
pub(crate) mod recording_session;
mod screenshot;
pub(crate) mod selection;
mod state;
mod storage;
mod types;

pub use crate::display::DisplayDescriptor as CaptureDisplay;
pub use commands::screencap_toggle_controls;
pub use selection::screencap_begin_capture_select;
pub use types::{GifEntry, PickerStatus, RecordArea, RecordingOptions, RecordingStatusSnapshot};
