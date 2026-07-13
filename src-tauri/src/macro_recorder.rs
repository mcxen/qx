use enigo::{Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};
use rdev::{listen, Event, EventType};
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, Once, OnceLock};
use std::time::{Duration, Instant};
use tauri::command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroStep {
    pub event_type: String, // "key_press", "key_release", "mouse_move", "mouse_click", "mouse_release", "wait"
    pub key: Option<String>,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub button: Option<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MacroData {
    pub id: Option<i64>,
    pub name: String,
    pub steps: Vec<MacroStep>,
    pub total_duration_ms: u64,
    pub created_at: Option<i64>,
}

struct RecordingState {
    steps: Vec<MacroStep>,
    start_time: Instant,
    last_ts: Instant,
}

static RECORDING: OnceLock<Mutex<Option<RecordingState>>> = OnceLock::new();
static LISTENER: Once = Once::new();

fn recording_state() -> &'static Mutex<Option<RecordingState>> {
    RECORDING.get_or_init(|| Mutex::new(None))
}

fn start_listener_once() {
    LISTENER.call_once(|| {
        std::thread::Builder::new()
            .name("qx-macro-recorder".to_string())
            .spawn(|| {
                if let Err(e) = listen(|event| record_event(event)) {
                    eprintln!("rdev listen error: {e:?}");
                }
            })
            .ok();
    });
}

fn record_event(event: Event) {
    let Ok(mut guard) = recording_state().lock() else {
        return;
    };
    let Some(state) = guard.as_mut() else {
        return;
    };

    let now = Instant::now();
    let elapsed = now.duration_since(state.last_ts).as_millis() as u64;

    let step = match event.event_type {
        EventType::KeyPress(key) => Some(MacroStep {
            event_type: "key_press".into(),
            key: Some(format!("{:?}", key)),
            x: None,
            y: None,
            button: None,
            duration_ms: elapsed,
        }),
        EventType::KeyRelease(key) => Some(MacroStep {
            event_type: "key_release".into(),
            key: Some(format!("{:?}", key)),
            x: None,
            y: None,
            button: None,
            duration_ms: elapsed,
        }),
        EventType::ButtonPress(button) => Some(MacroStep {
            event_type: "mouse_click".into(),
            key: None,
            x: None,
            y: None,
            button: Some(format!("{:?}", button)),
            duration_ms: elapsed,
        }),
        EventType::ButtonRelease(button) => Some(MacroStep {
            event_type: "mouse_release".into(),
            key: None,
            x: None,
            y: None,
            button: Some(format!("{:?}", button)),
            duration_ms: elapsed,
        }),
        EventType::MouseMove { x, y } => {
            if elapsed > 16 {
                Some(MacroStep {
                    event_type: "mouse_move".into(),
                    key: None,
                    x: Some(x as i32),
                    y: Some(y as i32),
                    button: None,
                    duration_ms: elapsed,
                })
            } else {
                None
            }
        }
        _ => None,
    };

    if let Some(step) = step {
        state.steps.push(step);
        state.last_ts = now;
    }
}

fn open_db() -> Result<rusqlite::Connection, String> {
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
pub fn macro_start_recording() -> Result<(), String> {
    start_listener_once();

    let mut guard = recording_state().lock().map_err(|e| format!("lock: {e}"))?;
    if guard.is_some() {
        return Err("Already recording".into());
    }

    let now = Instant::now();
    *guard = Some(RecordingState {
        steps: Vec::new(),
        start_time: now,
        last_ts: now,
    });

    Ok(())
}

#[command]
pub fn macro_stop_recording() -> Result<MacroData, String> {
    let mut guard = recording_state().lock().map_err(|e| format!("lock: {e}"))?;
    let state = guard.take().ok_or("Not recording")?;

    let total_duration_ms = state.start_time.elapsed().as_millis() as u64;

    Ok(MacroData {
        id: None,
        name: String::new(),
        steps: state.steps,
        total_duration_ms,
        created_at: None,
    })
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

#[command]
pub fn macro_play(id: i64) -> Result<(), String> {
    let conn = open_db()?;
    let steps_str: String = conn
        .query_row(
            "SELECT steps FROM macros WHERE id = ?1",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("load macro: {e}"))?;

    let steps: Vec<MacroStep> =
        serde_json::from_str(&steps_str).map_err(|e| format!("parse: {e}"))?;

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {e}"))?;

    for step in &steps {
        std::thread::sleep(Duration::from_millis(step.duration_ms));
        match step.event_type.as_str() {
            "key_press" => {
                if let Some(ref k) = step.key {
                    if let Ok(key) = parse_key(k) {
                        let _ = enigo.key(key, Direction::Click);
                    }
                }
            }
            "mouse_move" => {
                if let (Some(x), Some(y)) = (step.x, step.y) {
                    let _ = enigo.move_mouse(x as i32, y as i32, Coordinate::Abs);
                }
            }
            "mouse_click" => {
                let _ = enigo.button(enigo::Button::Left, Direction::Click);
            }
            _ => {}
        }
    }

    Ok(())
}

fn parse_key(s: &str) -> Result<Key, String> {
    match s {
        "Return" | "Enter" => Ok(Key::Return),
        "Space" => Ok(Key::Space),
        "Tab" => Ok(Key::Tab),
        "BackSpace" | "Backspace" => Ok(Key::Backspace),
        "Escape" | "Esc" => Ok(Key::Escape),
        "ShiftLeft" | "ShiftRight" | "Shift" => Ok(Key::Shift),
        "ControlLeft" | "ControlRight" | "Control" | "Ctrl" => Ok(Key::Control),
        "Alt" | "AltLeft" | "AltRight" | "Option" => Ok(Key::Alt),
        "MetaLeft" | "MetaRight" | "Meta" | "Command" | "Cmd" | "Super" => Ok(Key::Meta),
        "UpArrow" | "Up" => Ok(Key::UpArrow),
        "DownArrow" | "Down" => Ok(Key::DownArrow),
        "LeftArrow" | "Left" => Ok(Key::LeftArrow),
        "RightArrow" | "Right" => Ok(Key::RightArrow),
        "PageUp" => Ok(Key::PageUp),
        "PageDown" => Ok(Key::PageDown),
        "Home" => Ok(Key::Home),
        "End" => Ok(Key::End),
        "Delete" => Ok(Key::Delete),
        k if k.len() == 1 => {
            let c = k.chars().next().unwrap();
            Ok(Key::Unicode(c))
        }
        _ => Err(format!("unknown key: {s}")),
    }
}
