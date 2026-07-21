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

pub(crate) fn is_picker_surface(label: &str) -> bool {
    picker_window::is_picker_surface(label)
}

/// Hot-plug / topology change while the region picker is open.
/// Prefer `force_refresh=false` when the caller already refreshed inventory.
pub(crate) fn on_display_topology_changed(app: &tauri::AppHandle, force_refresh: bool) {
    selection::on_display_topology_changed(app, force_refresh);
}

pub use crate::display::DisplayDescriptor as CaptureDisplay;
pub use commands::screencap_toggle_controls;
pub use selection::screencap_begin_capture_select;
pub use types::{GifEntry, PickerStatus, RecordArea, RecordingOptions, RecordingStatusSnapshot};
