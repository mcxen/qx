use serde::{Deserialize, Serialize};
use std::sync::mpsc::Receiver;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Instant;
use tauri::{command, AppHandle, Emitter};

use crate::macro_capture::{CaptureEvent, CaptureEventKind, MacroCaptureSession};

const MACRO_RECORDING_EVENT: &str = "macro:recording";
const RECORDING_POINTER_EVENT_INTERVAL_MS: u64 = 16;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroStep {
    pub event_type: String, // key/mouse events, wait, text_input, launch_application
    pub key: Option<String>,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub button: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub application: Option<String>,
    pub duration_ms: u64,
}

fn empty_macro_step(event_type: &str, duration_ms: u64) -> MacroStep {
    MacroStep {
        event_type: event_type.to_string(),
        key: None,
        x: None,
        y: None,
        button: None,
        text: None,
        application: None,
        duration_ms,
    }
}

/// A deterministic cross-platform smoke macro used to verify the full
/// playback path. It deliberately uses a semantic application/text step for
/// the parts that are otherwise dependent on the user's launcher and keyboard
/// layout, while keeping the address-bar shortcut as a real native key pair.
fn demo_macro_steps() -> Vec<MacroStep> {
    #[cfg(target_os = "macos")]
    const ADDRESS_BAR_MODIFIER: &str = "MetaLeft";
    #[cfg(target_os = "windows")]
    const ADDRESS_BAR_MODIFIER: &str = "ControlLeft";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    const ADDRESS_BAR_MODIFIER: &str = "ControlLeft";

    let mut launch = empty_macro_step("launch_application", 0);
    launch.application = Some("Google Chrome".to_string());

    let mut text = empty_macro_step("text_input", 80);
    text.text = Some("hello".to_string());

    let mut modifier_press = empty_macro_step("key_press", 0);
    modifier_press.key = Some(ADDRESS_BAR_MODIFIER.to_string());
    let mut l_press = empty_macro_step("key_press", 40);
    l_press.key = Some("KeyL".to_string());
    let mut l_release = empty_macro_step("key_release", 30);
    l_release.key = Some("KeyL".to_string());
    let mut modifier_release = empty_macro_step("key_release", 30);
    modifier_release.key = Some(ADDRESS_BAR_MODIFIER.to_string());

    let mut return_press = empty_macro_step("key_press", 40);
    return_press.key = Some("Return".to_string());
    let mut return_release = empty_macro_step("key_release", 30);
    return_release.key = Some("Return".to_string());

    vec![
        launch,
        empty_macro_step("wait", 2_500),
        modifier_press,
        l_press,
        l_release,
        modifier_release,
        text,
        return_press,
        return_release,
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroData {
    pub id: Option<i64>,
    pub name: String,
    pub steps: Vec<MacroStep>,
    pub total_duration_ms: u64,
    pub created_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MacroRecordingProgress {
    pub elapsed_ms: u64,
    pub steps: usize,
    pub cursor_x: Option<f64>,
    pub cursor_y: Option<f64>,
    pub mouse_button: Option<String>,
    pub button_pressed: bool,
}

struct RecordingState {
    steps: Vec<MacroStep>,
    /// Capture-relative timestamp for each serialized step. These offsets are
    /// intentionally private: they exist only to remove the stop tail before
    /// a MacroData payload is handed to the frontend or SQLite.
    step_offsets_ms: Vec<u64>,
    start_time: Instant,
    last_ts: Instant,
    mac_modifier_flags: u64,
}

struct CaptureControllerState {
    active: Option<MacroCaptureSession<RecordingState>>,
    starting: bool,
    stopping: bool,
}

static CAPTURE_CONTROLLER: OnceLock<(Mutex<CaptureControllerState>, Condvar)> = OnceLock::new();

fn capture_controller() -> &'static (Mutex<CaptureControllerState>, Condvar) {
    CAPTURE_CONTROLLER.get_or_init(|| {
        (
            Mutex::new(CaptureControllerState {
                active: None,
                starting: false,
                stopping: false,
            }),
            Condvar::new(),
        )
    })
}

fn collect_recording_events(
    receiver: Receiver<CaptureEvent>,
    started_at: Instant,
    app: AppHandle,
) -> RecordingState {
    let mut state = RecordingState {
        steps: Vec::new(),
        step_offsets_ms: Vec::new(),
        start_time: started_at,
        last_ts: started_at,
        mac_modifier_flags: 0,
    };
    let mut last_pointer_event_at: Option<Instant> = None;

    while let Ok(event) = receiver.recv() {
        let pointer = match event.kind {
            CaptureEventKind::MouseMove { x, y } => Some((x, y, None, false)),
            CaptureEventKind::MouseButton {
                button,
                pressed,
                x,
                y,
            } => Some((x, y, Some(button_name(button)), pressed)),
            _ => None,
        };
        append_capture_event(&mut state, event);

        if let Some((x, y, button, button_pressed)) = pointer {
            let should_emit = button.is_some()
                || last_pointer_event_at
                    .map(|last| {
                        event
                            .captured_at
                            .saturating_duration_since(last)
                            .as_millis()
                            >= RECORDING_POINTER_EVENT_INTERVAL_MS as u128
                    })
                    .unwrap_or(true);
            if should_emit {
                last_pointer_event_at = Some(event.captured_at);
                let _ = app.emit(
                    MACRO_RECORDING_EVENT,
                    MacroRecordingProgress {
                        elapsed_ms: event
                            .captured_at
                            .saturating_duration_since(started_at)
                            .as_millis() as u64,
                        steps: state.steps.len(),
                        cursor_x: Some(x),
                        cursor_y: Some(y),
                        mouse_button: button,
                        button_pressed,
                    },
                );
            }
        }
    }

    state
}

fn append_capture_event(state: &mut RecordingState, event: CaptureEvent) {
    let event_offset_ms = event
        .captured_at
        .saturating_duration_since(state.start_time)
        .as_millis() as u64;
    let elapsed = event
        .captured_at
        .saturating_duration_since(state.last_ts)
        .as_millis() as u64;

    let step = match event.kind {
        CaptureEventKind::KeyDown { code } => Some(MacroStep {
            event_type: "key_press".into(),
            key: Some(key_name_from_code(code)),
            x: None,
            y: None,
            button: None,
            text: None,
            application: None,
            duration_ms: elapsed,
        }),
        CaptureEventKind::KeyUp { code } => Some(MacroStep {
            event_type: "key_release".into(),
            key: Some(key_name_from_code(code)),
            x: None,
            y: None,
            button: None,
            text: None,
            application: None,
            duration_ms: elapsed,
        }),
        CaptureEventKind::KeyFlagsChanged { code, flags } => {
            #[cfg(target_os = "macos")]
            {
                let Some(mask) = mac_modifier_mask(code) else {
                    state.mac_modifier_flags = flags;
                    state.last_ts = event.captured_at;
                    return;
                };
                let was_pressed = state.mac_modifier_flags & mask != 0;
                let is_pressed = flags & mask != 0;
                state.mac_modifier_flags = flags;
                if was_pressed == is_pressed {
                    state.last_ts = event.captured_at;
                    return;
                }
                Some(MacroStep {
                    event_type: if is_pressed {
                        "key_press".into()
                    } else {
                        "key_release".into()
                    },
                    key: Some(key_name_from_code(code)),
                    x: None,
                    y: None,
                    button: None,
                    text: None,
                    application: None,
                    duration_ms: elapsed,
                })
            }
            #[cfg(not(target_os = "macos"))]
            {
                state.mac_modifier_flags = flags;
                None
            }
        }
        CaptureEventKind::MouseMove { x, y } => (elapsed > 16).then(|| MacroStep {
            event_type: "mouse_move".into(),
            key: None,
            x: Some(x.round() as i32),
            y: Some(y.round() as i32),
            button: None,
            text: None,
            application: None,
            duration_ms: elapsed,
        }),
        CaptureEventKind::MouseButton {
            button,
            pressed,
            x,
            y,
        } => Some(MacroStep {
            event_type: if pressed {
                "mouse_click".into()
            } else {
                "mouse_release".into()
            },
            key: None,
            // Preserve the click location. A move event can be coalesced or
            // dropped when the user clicks immediately after moving, so
            // replay must not depend on the pointer still being at the right
            // place by accident.
            x: Some(x.round() as i32),
            y: Some(y.round() as i32),
            button: Some(button_name(button)),
            text: None,
            application: None,
            duration_ms: elapsed,
        }),
    };

    state.last_ts = event.captured_at;
    if let Some(step) = step {
        state.steps.push(step);
        state.step_offsets_ms.push(event_offset_ms);
    }
}

fn button_name(button: u32) -> String {
    match button {
        0 => "Left".to_string(),
        1 => "Right".to_string(),
        2 => "Middle".to_string(),
        other => format!("Unknown({other})"),
    }
}

#[cfg(target_os = "macos")]
fn mac_modifier_mask(code: u32) -> Option<u64> {
    match code {
        56 | 60 => Some(0x0002_0000), // Shift
        59 | 62 => Some(0x0004_0000), // Control
        58 | 61 => Some(0x0008_0000), // Option
        54 | 55 => Some(0x0010_0000), // Command
        57 => Some(0x0001_0000),      // Caps Lock
        63 => Some(0x0080_0000),      // Fn
        _ => None,
    }
}

fn key_name_from_code(code: u32) -> String {
    #[cfg(target_os = "macos")]
    let key = mac_key_from_code(code);
    #[cfg(target_os = "windows")]
    let key = windows_key_from_code(code);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let key = rdev::Key::Unknown(code);
    format!("{key:?}")
}

#[cfg(target_os = "macos")]
fn mac_key_from_code(code: u32) -> rdev::Key {
    use rdev::Key;

    match code {
        58 => Key::Alt,
        61 => Key::AltGr,
        51 => Key::Backspace,
        57 => Key::CapsLock,
        59 => Key::ControlLeft,
        62 => Key::ControlRight,
        125 => Key::DownArrow,
        53 => Key::Escape,
        122 => Key::F1,
        120 => Key::F2,
        99 => Key::F3,
        118 => Key::F4,
        96 => Key::F5,
        97 => Key::F6,
        98 => Key::F7,
        100 => Key::F8,
        101 => Key::F9,
        109 => Key::F10,
        103 => Key::F11,
        111 => Key::F12,
        105 | 107 | 113 | 106 | 64 | 79 | 80 | 90 => Key::Unknown(code),
        115 => Key::Home,
        123 => Key::LeftArrow,
        55 => Key::MetaLeft,
        54 => Key::MetaRight,
        116 => Key::PageUp,
        117 => Key::Delete,
        121 => Key::PageDown,
        119 => Key::End,
        36 => Key::Return,
        124 => Key::RightArrow,
        56 => Key::ShiftLeft,
        60 => Key::ShiftRight,
        49 => Key::Space,
        48 => Key::Tab,
        126 => Key::UpArrow,
        50 => Key::BackQuote,
        18 => Key::Num1,
        19 => Key::Num2,
        20 => Key::Num3,
        21 => Key::Num4,
        23 => Key::Num5,
        22 => Key::Num6,
        26 => Key::Num7,
        28 => Key::Num8,
        25 => Key::Num9,
        29 => Key::Num0,
        27 => Key::Minus,
        24 => Key::Equal,
        12 => Key::KeyQ,
        13 => Key::KeyW,
        14 => Key::KeyE,
        15 => Key::KeyR,
        17 => Key::KeyT,
        16 => Key::KeyY,
        32 => Key::KeyU,
        34 => Key::KeyI,
        31 => Key::KeyO,
        35 => Key::KeyP,
        33 => Key::LeftBracket,
        30 => Key::RightBracket,
        0 => Key::KeyA,
        1 => Key::KeyS,
        2 => Key::KeyD,
        3 => Key::KeyF,
        5 => Key::KeyG,
        4 => Key::KeyH,
        38 => Key::KeyJ,
        40 => Key::KeyK,
        37 => Key::KeyL,
        41 => Key::SemiColon,
        39 => Key::Quote,
        42 => Key::BackSlash,
        6 => Key::KeyZ,
        7 => Key::KeyX,
        8 => Key::KeyC,
        9 => Key::KeyV,
        11 => Key::KeyB,
        45 => Key::KeyN,
        46 => Key::KeyM,
        43 => Key::Comma,
        47 => Key::Dot,
        44 => Key::Slash,
        63 => Key::Function,
        other => Key::Unknown(other),
    }
}

#[cfg(target_os = "windows")]
fn windows_key_from_code(code: u32) -> rdev::Key {
    use rdev::Key;

    const LETTERS: [Key; 26] = [
        Key::KeyA,
        Key::KeyB,
        Key::KeyC,
        Key::KeyD,
        Key::KeyE,
        Key::KeyF,
        Key::KeyG,
        Key::KeyH,
        Key::KeyI,
        Key::KeyJ,
        Key::KeyK,
        Key::KeyL,
        Key::KeyM,
        Key::KeyN,
        Key::KeyO,
        Key::KeyP,
        Key::KeyQ,
        Key::KeyR,
        Key::KeyS,
        Key::KeyT,
        Key::KeyU,
        Key::KeyV,
        Key::KeyW,
        Key::KeyX,
        Key::KeyY,
        Key::KeyZ,
    ];
    const NUMBERS: [Key; 10] = [
        Key::Num0,
        Key::Num1,
        Key::Num2,
        Key::Num3,
        Key::Num4,
        Key::Num5,
        Key::Num6,
        Key::Num7,
        Key::Num8,
        Key::Num9,
    ];

    match code {
        164 => Key::Alt,
        165 => Key::AltGr,
        0x08 => Key::Backspace,
        20 => Key::CapsLock,
        162 => Key::ControlLeft,
        163 => Key::ControlRight,
        46 => Key::Delete,
        40 => Key::DownArrow,
        35 => Key::End,
        27 => Key::Escape,
        112 => Key::F1,
        113 => Key::F2,
        114 => Key::F3,
        115 => Key::F4,
        116 => Key::F5,
        117 => Key::F6,
        118 => Key::F7,
        119 => Key::F8,
        120 => Key::F9,
        121 => Key::F10,
        122 => Key::F11,
        123 => Key::F12,
        36 => Key::Home,
        37 => Key::LeftArrow,
        91 => Key::MetaLeft,
        92 => Key::MetaRight,
        34 => Key::PageDown,
        33 => Key::PageUp,
        0x0D => Key::Return,
        39 => Key::RightArrow,
        160 => Key::ShiftLeft,
        161 => Key::ShiftRight,
        32 => Key::Space,
        0x09 => Key::Tab,
        38 => Key::UpArrow,
        44 => Key::PrintScreen,
        145 => Key::ScrollLock,
        19 => Key::Pause,
        144 => Key::NumLock,
        192 => Key::BackQuote,
        49..=57 => NUMBERS[(code - 48) as usize],
        48 => Key::Num0,
        189 => Key::Minus,
        187 => Key::Equal,
        65..=90 => LETTERS[(code - 65) as usize],
        219 => Key::LeftBracket,
        221 => Key::RightBracket,
        186 => Key::SemiColon,
        222 => Key::Quote,
        220 => Key::BackSlash,
        226 => Key::IntlBackslash,
        188 => Key::Comma,
        190 => Key::Dot,
        191 => Key::Slash,
        45 => Key::Insert,
        109 => Key::KpMinus,
        107 => Key::KpPlus,
        106 => Key::KpMultiply,
        111 => Key::KpDivide,
        96 => Key::Kp0,
        97 => Key::Kp1,
        98 => Key::Kp2,
        99 => Key::Kp3,
        100 => Key::Kp4,
        101 => Key::Kp5,
        102 => Key::Kp6,
        103 => Key::Kp7,
        104 => Key::Kp8,
        105 => Key::Kp9,
        other => Key::Unknown(other),
    }
}

fn take_capture_for_stop() -> Option<MacroCaptureSession<RecordingState>> {
    let (lock, wake) = capture_controller();
    let mut state = lock.lock().ok()?;
    loop {
        if state.starting || state.stopping {
            state = wake.wait(state).ok()?;
            continue;
        }
        let session = state.active.take();
        if session.is_some() {
            state.stopping = true;
        }
        return session;
    }
}

fn finish_capture_stop() {
    let (lock, wake) = capture_controller();
    if let Ok(mut state) = lock.lock() {
        state.stopping = false;
        wake.notify_all();
    }
}

fn configured_stop_tail_ms() -> u64 {
    crate::settings::read_settings()
        .macros
        .stop_tail_seconds
        .min(60) as u64
        * 1_000
}

fn finalize_recording(state: RecordingState, stop_elapsed_ms: u64, stop_tail_ms: u64) -> MacroData {
    let cutoff_ms = stop_elapsed_ms.saturating_sub(stop_tail_ms);
    let steps: Vec<MacroStep> = state
        .steps
        .into_iter()
        .zip(state.step_offsets_ms)
        .filter_map(|(step, offset_ms)| (offset_ms < cutoff_ms).then_some(step))
        .collect();
    let total_duration_ms = steps.iter().map(|step| step.duration_ms).sum();

    MacroData {
        id: None,
        name: String::new(),
        steps,
        total_duration_ms,
        created_at: None,
    }
}

fn stop_active_capture(stop_tail_ms: u64) -> Result<Option<MacroData>, String> {
    let Some(session) = take_capture_for_stop() else {
        return Ok(None);
    };

    let stop_started_at = Instant::now();
    let result = session.stop().map(|state| {
        let stop_elapsed_ms = stop_started_at
            .saturating_duration_since(state.start_time)
            .as_millis() as u64;
        finalize_recording(state, stop_elapsed_ms, stop_tail_ms)
    });
    finish_capture_stop();
    result.map(Some)
}

pub(crate) fn open_db() -> Result<rusqlite::Connection, String> {
    let db_path = dirs_db_path();
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| format!("open db: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS macros (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            steps TEXT NOT NULL,
            total_duration_ms INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )",
    )
    .map_err(|e| format!("init db: {e}"))?;
    Ok(conn)
}

fn dirs_db_path() -> std::path::PathBuf {
    crate::paths::state_dir().join("macros.db")
}

#[command]
pub fn macro_start_recording(app: AppHandle) -> Result<(), String> {
    let (lock, wake) = capture_controller();
    {
        let mut state = lock.lock().map_err(|e| format!("lock: {e}"))?;
        if state.active.is_some() || state.starting || state.stopping {
            return Err("Already recording".into());
        }
        state.starting = true;
    }

    let started_at = Instant::now();
    let worker_app = app.clone();
    let session = crate::macro_capture::start(move |receiver| {
        collect_recording_events(receiver, started_at, worker_app)
    });

    let mut state = lock.lock().map_err(|e| format!("lock: {e}"))?;
    state.starting = false;
    match session {
        Ok(session) => {
            state.active = Some(session);
            wake.notify_all();
            Ok(())
        }
        Err(error) => {
            wake.notify_all();
            Err(error)
        }
    }
}

#[command]
pub fn macro_stop_recording(
    app: AppHandle,
    exclude_tail_ms: Option<u64>,
) -> Result<MacroData, String> {
    let result = stop_active_capture(exclude_tail_ms.unwrap_or_else(configured_stop_tail_ms))?
        .ok_or_else(|| "Not recording".to_string());
    if let Err(error) = crate::macro_cursor_overlay::hide(&app) {
        crate::diagnostics::log(
            crate::diagnostics::LogLevel::Warn,
            "macro.cursor-overlay",
            "failed to hide macro cursor overlay",
            serde_json::json!({ "error": error }),
        );
    }
    result
}

/// Stop the native capture session during module teardown or process exit.
/// This intentionally uses the exact same take → native-stop → join path as
/// the user-facing stop command and waits for an in-flight start/stop to
/// finish before returning.
pub(crate) fn stop_for_shutdown() {
    match stop_active_capture(configured_stop_tail_ms()) {
        Ok(Some(_)) => {}
        Ok(None) => {}
        Err(error) => crate::diagnostics::log(
            crate::diagnostics::LogLevel::Warn,
            "macro.capture",
            "macro capture shutdown stop failed",
            serde_json::json!({ "error": error }),
        ),
    }
}

#[command]
pub fn macro_save(name: String, data: MacroData) -> Result<i64, String> {
    let conn = open_db()?;
    let steps_json = serde_json::to_string(&data.steps).map_err(|e| format!("serialize: {e}"))?;
    let now = chrono::Local::now().timestamp();
    conn.execute(
        "INSERT INTO macros (name, steps, total_duration_ms, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![name, steps_json, data.total_duration_ms, now],
    )
    .map_err(|e| format!("insert: {e}"))?;
    Ok(conn.last_insert_rowid())
}

#[command]
pub fn macro_create_demo(name: String) -> Result<i64, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Demo macro name cannot be empty".to_string());
    }

    let steps = demo_macro_steps();
    let total_duration_ms = steps.iter().map(|step| step.duration_ms).sum::<u64>();
    let steps_json = serde_json::to_string(&steps).map_err(|e| format!("serialize demo: {e}"))?;
    let conn = open_db()?;
    let now = chrono::Local::now().timestamp();
    conn.execute(
        "INSERT OR IGNORE INTO macros (name, steps, total_duration_ms, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![name, steps_json, total_duration_ms, now],
    )
    .map_err(|e| format!("insert demo: {e}"))?;
    conn.query_row(
        "SELECT id FROM macros WHERE name = ?1",
        rusqlite::params![name],
        |row| row.get(0),
    )
    .map_err(|e| format!("find demo macro: {e}"))
}

#[command]
pub fn macro_list() -> Vec<MacroData> {
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, name, steps, total_duration_ms, created_at FROM macros ORDER BY created_at DESC",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows = match stmt.query_map([], |row| {
        let steps_str: String = row.get(2)?;
        let steps: Vec<MacroStep> = serde_json::from_str(&steps_str).unwrap_or_default();
        Ok(MacroData {
            id: Some(row.get(0)?),
            name: row.get(1)?,
            steps,
            total_duration_ms: row.get(3)?,
            created_at: Some(row.get(4)?),
        })
    }) {
        Ok(r) => r.flatten().collect(),
        Err(_) => vec![],
    };
    rows
}

#[command]
pub fn macro_delete(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM macros WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| format!("delete: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn worker_interprets_raw_events_without_shared_listener_state() {
        let started_at = Instant::now();
        let mut state = RecordingState {
            steps: Vec::new(),
            step_offsets_ms: Vec::new(),
            start_time: started_at,
            last_ts: started_at,
            mac_modifier_flags: 0,
        };
        append_capture_event(
            &mut state,
            CaptureEvent {
                kind: CaptureEventKind::MouseMove { x: 12.4, y: 18.6 },
                captured_at: started_at + Duration::from_millis(20),
            },
        );

        assert_eq!(state.steps.len(), 1);
        assert_eq!(state.steps[0].event_type, "mouse_move");
        assert_eq!(state.steps[0].x, Some(12));
        assert_eq!(state.steps[0].y, Some(19));
        assert_eq!(state.steps[0].duration_ms, 20);
    }

    #[test]
    fn click_steps_keep_their_coordinates() {
        let started_at = Instant::now();
        let mut state = RecordingState {
            steps: Vec::new(),
            step_offsets_ms: Vec::new(),
            start_time: started_at,
            last_ts: started_at,
            mac_modifier_flags: 0,
        };
        append_capture_event(
            &mut state,
            CaptureEvent {
                kind: CaptureEventKind::MouseButton {
                    button: 0,
                    pressed: true,
                    x: 240.4,
                    y: 118.8,
                },
                captured_at: started_at + Duration::from_millis(7),
            },
        );

        assert_eq!(state.steps[0].event_type, "mouse_click");
        assert_eq!(state.steps[0].x, Some(240));
        assert_eq!(state.steps[0].y, Some(119));
    }

    #[test]
    fn demo_macro_is_cross_platform_and_uses_layout_safe_text() {
        let steps = demo_macro_steps();
        assert_eq!(steps[0].event_type, "launch_application");
        assert_eq!(steps[0].application.as_deref(), Some("Google Chrome"));
        assert!(steps.iter().any(|step| {
            step.event_type == "text_input" && step.text.as_deref() == Some("hello")
        }));
        assert!(steps.iter().any(|step| step.event_type == "key_press"));
        assert!(steps.iter().any(|step| step.event_type == "key_release"));
    }

    #[test]
    fn finalize_recording_removes_only_the_configured_stop_tail() {
        let started_at = Instant::now();
        let state = RecordingState {
            steps: vec![
                empty_macro_step("key_press", 1_000),
                empty_macro_step("key_release", 3_000),
                empty_macro_step("mouse_click", 3_500),
                empty_macro_step("mouse_release", 1_500),
            ],
            step_offsets_ms: vec![1_000, 4_000, 7_500, 9_000],
            start_time: started_at,
            last_ts: started_at + Duration::from_millis(9_000),
            mac_modifier_flags: 0,
        };

        let trimmed = finalize_recording(state, 10_000, 2_000);
        assert_eq!(trimmed.steps.len(), 3);
        assert_eq!(trimmed.total_duration_ms, 7_500);

        let state = RecordingState {
            steps: vec![empty_macro_step("key_press", 9_000)],
            step_offsets_ms: vec![9_000],
            start_time: started_at,
            last_ts: started_at + Duration::from_millis(9_000),
            mac_modifier_flags: 0,
        };
        let kept = finalize_recording(state, 10_000, 0);
        assert_eq!(kept.steps.len(), 1);
    }
}
