use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

static PROCESS_STARTED_AT: OnceLock<u128> = OnceLock::new();
static LOG_SENDER: OnceLock<mpsc::SyncSender<LogEventInput>> = OnceLock::new();
static LOG_CONFIG: Mutex<Option<(Instant, Option<LogLevel>)>> = Mutex::new(None);
static DROPPED_EVENTS: AtomicU64 = AtomicU64::new(0);

const LOG_QUEUE_CAPACITY: usize = 256;
const LOG_CONFIG_TTL: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

impl LogLevel {
    fn from_settings(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "error" => Self::Error,
            "warn" => Self::Warn,
            "debug" => Self::Debug,
            _ => Self::Info,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warn => "warn",
            Self::Info => "info",
            Self::Debug => "debug",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEventInput {
    pub level: LogLevel,
    pub target: String,
    pub message: String,
    #[serde(default)]
    pub fields: Map<String, Value>,
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn log_dir() -> PathBuf {
    crate::paths::state_dir().join("logs")
}

pub fn log_file_path() -> PathBuf {
    log_dir().join("qx.log")
}

fn logging_config() -> Option<LogLevel> {
    let mut cache = LOG_CONFIG
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((sampled_at, level)) = *cache {
        if sampled_at.elapsed() < LOG_CONFIG_TTL {
            return level;
        }
    }
    let settings = crate::settings::read_settings();
    let level = if settings.advanced.dev_mode {
        Some(LogLevel::Debug)
    } else if settings.advanced.logging_enabled {
        Some(LogLevel::from_settings(&settings.advanced.log_level))
    } else {
        None
    };
    *cache = Some((Instant::now(), level));
    level
}

fn enabled(level: LogLevel) -> bool {
    logging_config().is_some_and(|threshold| level <= threshold)
}

fn log_sender() -> &'static mpsc::SyncSender<LogEventInput> {
    LOG_SENDER.get_or_init(|| {
        // A diagnostic storm must never become a second memory/CPU incident.
        // Keep a small bounded queue and let producers drop excess detail.
        let (sender, receiver) = mpsc::sync_channel::<LogEventInput>(LOG_QUEUE_CAPACITY);
        if let Err(error) = std::thread::Builder::new()
            .name("qx-log-writer".to_string())
            .spawn(move || {
                for event in receiver {
                    if let Err(error) = write_json_line(event) {
                        eprintln!("[diagnostics] {error}");
                    }
                }
            })
        {
            eprintln!("[diagnostics] spawn qx-log-writer: {error}");
        }
        sender
    })
}

fn write_json_line(event: LogEventInput) -> Result<(), String> {
    if !enabled(event.level) {
        return Ok(());
    }

    let started_at = *PROCESS_STARTED_AT.get_or_init(now_millis);
    let now = now_millis();
    let mut fields = event.fields;
    fields.insert("pid".to_string(), Value::from(std::process::id()));
    fields.insert(
        "uptimeMs".to_string(),
        Value::from(now.saturating_sub(started_at) as u64),
    );

    let line = serde_json::json!({
        "ts": now,
        "level": event.level.as_str(),
        "target": event.target.trim(),
        "message": event.message,
        "fields": fields,
    });

    let dir = log_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("create log dir: {e}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file_path())
        .map_err(|e| format!("open log file: {e}"))?;
    writeln!(file, "{line}").map_err(|e| format!("write log file: {e}"))
}

pub fn log(level: LogLevel, target: &str, message: impl Into<String>, fields: Value) {
    // Drop before allocating an event or starting the writer when diagnostics
    // are disabled. The cached settings probe keeps hot error paths off disk.
    if !enabled(level) {
        return;
    }
    let fields = match fields {
        Value::Object(map) => map,
        other => {
            let mut map = Map::new();
            map.insert("value".to_string(), other);
            map
        }
    };
    let mut event = LogEventInput {
        level,
        target: target.to_string(),
        message: message.into(),
        fields,
    };
    let dropped = DROPPED_EVENTS.swap(0, Ordering::Relaxed);
    if dropped > 0 {
        event
            .fields
            .insert("droppedEvents".to_string(), Value::from(dropped));
    }
    match log_sender().try_send(event) {
        Ok(()) => {}
        Err(mpsc::TrySendError::Full(_)) => {
            DROPPED_EVENTS.fetch_add(dropped.saturating_add(1), Ordering::Relaxed);
        }
        Err(mpsc::TrySendError::Disconnected(_)) => {
            eprintln!("[diagnostics] log writer disconnected");
        }
    }
}

#[tauri::command]
pub fn qx_log_event(level: LogLevel, target: String, message: String, fields: Value) {
    log(level, &target, message, fields);
}

#[tauri::command]
pub fn qx_log_path() -> String {
    let path = log_file_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = OpenOptions::new().create(true).append(true).open(&path);
    path.to_string_lossy().to_string()
}
