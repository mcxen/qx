use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use super::types::{PickerSession, RecordingRuntimeStatus, RecordingState};

static RECORDING: OnceLock<Mutex<Option<RecordingState>>> = OnceLock::new();
/// Last capture-thread failure (permission, display open, etc.).
static CAPTURE_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static RECORDING_STATUS: OnceLock<Mutex<RecordingRuntimeStatus>> = OnceLock::new();
static PICKER_SESSION: OnceLock<Mutex<Option<PickerSession>>> = OnceLock::new();

pub(super) static FRAME_COUNT: AtomicU64 = AtomicU64::new(0);
pub(super) static CONTROLS_PINNED: AtomicBool = AtomicBool::new(false);
static PICKER_POINTER_FOLLOW: AtomicBool = AtomicBool::new(false);
/// True while the webview is mid drag/resize. Blocks cross-display handoff even
/// if a stale `pointer_follow=true` has not been cleared yet (Windows IPC race).
static PICKER_INTERACTION_LOCK: AtomicBool = AtomicBool::new(false);
static PICKER_GENERATION: AtomicU64 = AtomicU64::new(0);

pub(super) fn begin_picker_session() -> u64 {
    PICKER_INTERACTION_LOCK.store(false, Ordering::Release);
    PICKER_POINTER_FOLLOW.store(true, Ordering::Release);
    PICKER_GENERATION.fetch_add(1, Ordering::AcqRel) + 1
}

pub(super) fn end_picker_session() {
    PICKER_INTERACTION_LOCK.store(false, Ordering::Release);
    PICKER_POINTER_FOLLOW.store(false, Ordering::Release);
    PICKER_GENERATION.fetch_add(1, Ordering::AcqRel);
}

pub(super) fn set_picker_pointer_follow(enabled: bool) {
    PICKER_POINTER_FOLLOW.store(enabled, Ordering::Release);
}

pub(super) fn set_picker_interaction_lock(locked: bool) {
    PICKER_INTERACTION_LOCK.store(locked, Ordering::Release);
    if locked {
        // Drag/resize must pin the current display immediately.
        PICKER_POINTER_FOLLOW.store(false, Ordering::Release);
    }
}

pub(super) fn picker_pointer_following(generation: u64) -> bool {
    !PICKER_INTERACTION_LOCK.load(Ordering::Acquire)
        && PICKER_POINTER_FOLLOW.load(Ordering::Acquire)
        && PICKER_GENERATION.load(Ordering::Acquire) == generation
}

pub(super) fn picker_session_is_current(generation: u64) -> bool {
    PICKER_GENERATION.load(Ordering::Acquire) == generation
}

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
