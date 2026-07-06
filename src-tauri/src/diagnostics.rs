use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{mpsc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static PROCESS_STARTED_AT: OnceLock<u128> = OnceLock::new();
static LOG_SENDER: OnceLock<mpsc::Sender<LogEventInput>> = OnceLock::new();

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
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(home).join(".qx").join("logs")
}

pub fn log_file_path() -> PathBuf {
    log_dir().join("qx.log")
}

fn threshold() -> LogLevel {
    let settings = crate::settings::read_settings();
    if settings.advanced.dev_mode {
        LogLevel::Debug
    } else {
        LogLevel::from_settings(&settings.advanced.log_level)
    }
}

fn enabled(level: LogLevel) -> bool {
    level <= threshold()
}

fn log_sender() -> &'static mpsc::Sender<LogEventInput> {
    LOG_SENDER.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<LogEventInput>();
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
    let fields = match fields {
        Value::Object(map) => map,
        other => {
            let mut map = Map::new();
            map.insert("value".to_string(), other);
            map
        }
    };
    let event = LogEventInput {
        level,
        target: target.to_string(),
        message: message.into(),
        fields,
    };
    if let Err(error) = log_sender().send(event) {
        eprintln!("[diagnostics] {error}");
    }
}

#[tauri::command]
pub fn qx_log_event(level: LogLevel, target: String, message: String, fields: Value) {
    log(level, &target, message, fields);
}

#[tauri::command]
pub fn qx_log_path() -> String {
    log_file_path().to_string_lossy().to_string()
}
