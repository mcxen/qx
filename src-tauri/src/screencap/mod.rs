pub(crate) mod commands;
mod controls;
mod delivery;
mod feedback;
mod geometry;
mod mosaic;
mod picker_window;
pub(crate) mod pin;
mod recording_engine;
pub(crate) mod recording_session;
pub(crate) mod screenshot;
pub(crate) mod selection;
mod state;
mod storage;
mod types;

pub(crate) fn is_picker_surface(label: &str) -> bool {
    picker_window::is_picker_surface(label)
}

pub(crate) fn is_pin_surface(label: &str) -> bool {
    pin::is_pin_surface(label)
}

/// Hot-plug / topology change while the region picker is open.
/// Prefer `force_refresh=false` when the caller already refreshed inventory.
pub(crate) fn on_display_topology_changed(app: &tauri::AppHandle, force_refresh: bool) {
    selection::on_display_topology_changed(app, force_refresh);
}

pub use crate::display::DisplayDescriptor as CaptureDisplay;
pub use commands::screencap_toggle_controls;
pub use selection::screencap_begin_capture_select;
pub use selection::screencap_recapture_last_region;
pub(crate) use types::RecordingOutput;
pub use types::{
    AudioInput, CaptureExecutionOptions, GifEntry, PickerStatus, RecordArea, RecordingOptions,
    RecordingStatusSnapshot,
};
