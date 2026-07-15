use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Mutex, OnceLock};

use super::types::{PickerSession, RecordingRuntimeStatus, RecordingState};

static RECORDING: OnceLock<Mutex<Option<RecordingState>>> = OnceLock::new();
/// Last capture-thread failure (permission, display open, etc.).
static CAPTURE_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static RECORDING_STATUS: OnceLock<Mutex<RecordingRuntimeStatus>> = OnceLock::new();
static PICKER_SESSION: OnceLock<Mutex<Option<PickerSession>>> = OnceLock::new();

pub(super) static FRAME_COUNT: AtomicU64 = AtomicU64::new(0);
pub(super) static CONTROLS_PINNED: AtomicBool = AtomicBool::new(false);

pub(super) fn recording() -> &'static Mutex<Option<RecordingState>> {
    RECORDING.get_or_init(|| Mutex::new(None))
}

pub(super) fn runtime() -> &'static Mutex<RecordingRuntimeStatus> {
    RECORDING_STATUS.get_or_init(|| Mutex::new(RecordingRuntimeStatus::default()))
}

pub(super) fn picker() -> &'static Mutex<Option<PickerSession>> {
    PICKER_SESSION.get_or_init(|| Mutex::new(None))
}

pub(super) fn set_capture_error(message: impl Into<String>) {
    let message = message.into();
    if let Ok(mut slot) = CAPTURE_ERROR.get_or_init(|| Mutex::new(None)).lock() {
        *slot = Some(message.clone());
    }
    if let Ok(mut status) = runtime().lock() {
        status.phase = "error";
        status.error = Some(message);
    }
}

pub(super) fn take_capture_error() -> Option<String> {
    CAPTURE_ERROR
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()
        .and_then(|mut slot| slot.take())
}

pub(super) fn clear_capture_error() {
    if let Ok(mut slot) = CAPTURE_ERROR.get_or_init(|| Mutex::new(None)).lock() {
        *slot = None;
    }
}
