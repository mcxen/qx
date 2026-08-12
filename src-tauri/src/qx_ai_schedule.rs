//! QxAI scheduled jobs and headless module actions for the agent.
//!
//! Schedules live under `~/.qx/qxai-schedules.json`. A background tick runs
//! every 30s and executes due jobs without requiring the chat UI to be open.
//! Job kinds:
//! - `morning_desk_log`: screenshot + clipboard digest → Markdown log
//! - `agent_prompt`: emit a frontend event so QxAI can run a full tool agent

use chrono::{Datelike, Local, NaiveTime, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::g4f::{self, ChatMessage};
use crate::screencap::RecordArea;

const TICK_SECS: u64 = 30;
const MORNING_DESK_SKILL_ID: &str = "morning-desk-log";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QxAiScheduleKind {
    /// Capture desktop + summarize clipboard into Downloads/QxLogs.
    #[serde(alias = "morningDeskLog")]
    MorningDeskLog,
    /// Ask the frontend to run a QxAI agent turn with optional skill.
    #[serde(alias = "agentPrompt")]
    AgentPrompt,
}

impl Default for QxAiScheduleKind {
    fn default() -> Self {
        Self::MorningDeskLog
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QxAiSchedule {
    pub id: String,
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub kind: QxAiScheduleKind,
    /// Local wall-clock time for daily jobs, e.g. "10:00".
    #[serde(default = "default_daily_time")]
    pub daily_time: String,
    /// Optional skill id injected when kind is AgentPrompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill_id: Option<String>,
    /// User prompt for AgentPrompt jobs (and optional note for logs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    /// Last successful run unix ms.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<i64>,
    /// Last error message if the previous run failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_daily_time() -> String {
    "10:00".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ScheduleFile {
    schedules: Vec<QxAiSchedule>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDesktopResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub copied_to: Option<String>,
}

fn schedule_path() -> PathBuf {
    crate::paths::state_dir().join("qxai-schedules.json")
}

fn storage_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn with_lock<T>(task: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _guard = storage_lock()
        .lock()
        .map_err(|_| "QxAI schedule lock poisoned".to_string())?;
    task()
}

fn read_file() -> ScheduleFile {
    let path = schedule_path();
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => ScheduleFile::default(),
    }
}

fn write_file(file: &ScheduleFile) -> Result<(), String> {
    let path = schedule_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create schedule dir: {e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(file).map_err(|e| format!("encode schedules: {e}"))?;
    fs::write(&tmp, bytes).map_err(|e| format!("write schedules: {e}"))?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("replace schedules: {e}"))?;
    }
    fs::rename(&tmp, &path).map_err(|e| format!("commit schedules: {e}"))
}

fn parse_daily_time(raw: &str) -> Option<NaiveTime> {
    let raw = raw.trim();
    NaiveTime::parse_from_str(raw, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(raw, "%H:%M:%S"))
        .ok()
}

fn logs_root() -> PathBuf {
    dirs::download_dir()
        .unwrap_or_else(|| crate::paths::home_dir().join("Downloads"))
        .join("QxLogs")
}

fn ensure_logs_dirs() -> Result<(PathBuf, PathBuf), String> {
    let root = logs_root();
    let shots = root.join("screenshots");
    fs::create_dir_all(&shots).map_err(|e| format!("create {}: {e}", shots.display()))?;
    Ok((root, shots))
}

/// Capture the full desktop (primary monitor when `monitor_id` is None).
pub fn capture_desktop_sync(
    monitor_id: Option<u32>,
    dest_dir: Option<&Path>,
) -> Result<CaptureDesktopResult, String> {
    let monitor = crate::display::capture_monitor(monitor_id)?;
    let id = monitor.id().map_err(|e| format!("display id: {e}"))?;
    let width = monitor.width().map_err(|e| format!("display width: {e}"))?;
    let height = monitor
        .height()
        .map_err(|e| format!("display height: {e}"))?;
    let area = RecordArea {
        x: 0,
        y: 0,
        w: width,
        h: height,
        monitor_id: Some(id),
    };
    let output = crate::screencap::screenshot::capture(area, None, false, None)?;
    let path = output.path.to_string_lossy().into_owned();
    let mut copied_to = None;
    if let Some(dir) = dest_dir {
        fs::create_dir_all(dir).map_err(|e| format!("create dest dir: {e}"))?;
        let name = output
            .path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("screenshot.png");
        let target = dir.join(name);
        fs::copy(&output.path, &target)
            .map_err(|e| format!("copy screenshot to {}: {e}", target.display()))?;
        copied_to = Some(target.to_string_lossy().into_owned());
    }
    Ok(CaptureDesktopResult {
        path,
        width: output.width,
        height: output.height,
        copied_to,
    })
}

fn clipboard_text_snapshot(limit: u32) -> Result<Vec<Value>, String> {
    // Read directly from the clipboard DB without requiring UI state inject.
    let db_path = crate::paths::data_dir().join("clipboard.db");
    if !db_path.exists() {
        return Ok(vec![]);
    }
    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("open clipboard db: {e}"))?;
    let limit = limit.clamp(1, 200) as i64;
    let mut stmt = conn
        .prepare(
            "SELECT id, text, timestamp, image_path, file_path, ocr_text
             FROM clipboard_history
             ORDER BY pinned DESC, timestamp DESC, id DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("prepare clipboard query: {e}"))?;
    let rows = stmt
        .query_map([limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "text": row.get::<_, Option<String>>(1)?,
                "timestamp": row.get::<_, String>(2)?,
                "imagePath": row.get::<_, Option<String>>(3)?,
                "filePath": row.get::<_, Option<String>>(4)?,
                "ocrText": row.get::<_, Option<String>>(5)?,
            }))
        })
        .map_err(|e| format!("query clipboard: {e}"))?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|e| format!("clipboard row: {e}"))?);
    }
    Ok(items)
}

fn is_morning_item(timestamp: &str) -> bool {
    // ISO-ish or local strings that include today's date or hour < 12.
    let today = Local::now().format("%Y-%m-%d").to_string();
    if timestamp.contains(&today) {
        if let Some(hour_str) = timestamp
            .split('T')
            .nth(1)
            .or_else(|| timestamp.split(' ').nth(1))
            .map(|s| s.chars().take(2).collect::<String>())
        {
            if let Ok(hour) = hour_str.parse::<u32>() {
                return hour < 12;
            }
        }
        return true;
    }
    true // if undated, include and let the model filter
}

fn format_clipboard_for_prompt(items: &[Value]) -> String {
    let mut lines = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let ts = item.get("timestamp").and_then(|v| v.as_str()).unwrap_or("");
        if !is_morning_item(ts) {
            continue;
        }
        let text = item
            .get("text")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty());
        let ocr = item
            .get("ocrText")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty());
        let image = item
            .get("imagePath")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let file = item
            .get("filePath")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let body = text
            .or(ocr)
            .map(|s| s.chars().take(800).collect::<String>())
            .unwrap_or_else(|| {
                if image.is_some() {
                    "[image clip]".to_string()
                } else if let Some(path) = file {
                    format!("[file] {path}")
                } else {
                    "[empty]".to_string()
                }
            });
        lines.push(format!("{}. ({ts}) {body}", index + 1));
        if lines.len() >= 40 {
            break;
        }
    }
    if lines.is_empty() {
        "(no clipboard text items found for this morning)".to_string()
    } else {
        lines.join("\n")
    }
}

fn read_skill_body(id: &str) -> Option<String> {
    crate::qx_ai_skills::read_skill_content_for_host(id).ok()
}

fn run_morning_desk_log(note: Option<&str>) -> Result<Value, String> {
    let (logs_root, shots_dir) = ensure_logs_dirs()?;
    let shot = capture_desktop_sync(None, Some(&shots_dir))?;
    let clip_items = clipboard_text_snapshot(80)?;
    let clip_block = format_clipboard_for_prompt(&clip_items);
    let skill = read_skill_body(MORNING_DESK_SKILL_ID).unwrap_or_else(|| {
        "You write concise Markdown morning desk journals for the user.".to_string()
    });
    let today = Local::now().format("%Y-%m-%d").to_string();
    let now = Local::now().format("%Y-%m-%d %H:%M").to_string();
    let user_prompt = format!(
        r#"{skill}

# Task
Write today's morning desk log as a single Markdown document for {today}.

## Screenshot
- Saved path: {shot_path}
- Dimensions: {w}x{h}
- Extra copy: {copied}

## Morning clipboard snippets
{clip}

## User note
{note}

# Output rules
- Reply with ONLY the Markdown document body (no code fences wrapping the whole file).
- Sections: Title, Desktop snapshot, Clipboard highlights, Action items, Reflection.
- Be factual; do not invent clipboard entries that are not listed.
- Use Chinese if clipboard content is mostly Chinese; otherwise English.
"#,
        skill = skill,
        shot_path = shot.copied_to.as_deref().unwrap_or(&shot.path),
        w = shot.width,
        h = shot.height,
        copied = shot.copied_to.as_deref().unwrap_or("(library only)"),
        clip = clip_block,
        note = note.unwrap_or("(none)"),
    );

    let settings = crate::settings::read_settings();
    let provider = Some(settings.agent.default_provider.clone()).filter(|s| !s.is_empty());
    let model = Some(settings.agent.default_model.clone()).filter(|s| !s.is_empty());
    let messages = vec![
        ChatMessage {
            role: "system".to_string(),
            content: json!("You are QxAI writing durable local Markdown journals."),
        },
        ChatMessage {
            role: "user".to_string(),
            content: json!(user_prompt),
        },
    ];
    let md = g4f::qxai_chat(provider, model, messages)?;
    let md = md.trim().to_string();
    let out_path = logs_root.join(format!("{today}-morning.md"));
    fs::write(
        &out_path,
        format!("<!-- generated by QxAI {now} -->\n\n{md}\n"),
    )
    .map_err(|e| format!("write log {}: {e}", out_path.display()))?;

    Ok(json!({
        "logPath": out_path.to_string_lossy(),
        "screenshotPath": shot.copied_to.as_ref().unwrap_or(&shot.path),
        "screenshotLibraryPath": shot.path,
        "clipboardItems": clip_items.len(),
    }))
}

fn should_fire(schedule: &QxAiSchedule, now: chrono::DateTime<Local>) -> bool {
    if !schedule.enabled {
        return false;
    }
    let Some(target) = parse_daily_time(&schedule.daily_time) else {
        return false;
    };
    // Fire in the minute matching HH:MM, once per calendar day.
    if now.hour() != target.hour() || now.minute() != target.minute() {
        return false;
    }
    if let Some(last) = schedule.last_run_at {
        if let Some(last_dt) = chrono::DateTime::from_timestamp_millis(last) {
            let last_local = last_dt.with_timezone(&Local);
            if last_local.date_naive() == now.date_naive() {
                return false;
            }
        }
    }
    true
}

fn mark_run(id: &str, ok: bool, error: Option<String>) {
    let _ = with_lock(|| {
        let mut file = read_file();
        if let Some(item) = file.schedules.iter_mut().find(|s| s.id == id) {
            item.last_run_at = Some(Local::now().timestamp_millis());
            item.last_error = if ok { None } else { error };
        }
        write_file(&file)
    });
}

fn execute_schedule(app: &AppHandle, schedule: &QxAiSchedule) {
    match schedule.kind {
        QxAiScheduleKind::MorningDeskLog => {
            match run_morning_desk_log(schedule.prompt.as_deref()) {
                Ok(result) => {
                    mark_run(&schedule.id, true, None);
                    let _ = app.emit(
                        "qxai-schedule-result",
                        json!({
                            "id": schedule.id,
                            "kind": "morning_desk_log",
                            "ok": true,
                            "result": result,
                        }),
                    );
                }
                Err(error) => {
                    mark_run(&schedule.id, false, Some(error.clone()));
                    let _ = app.emit(
                        "qxai-schedule-result",
                        json!({
                            "id": schedule.id,
                            "kind": "morning_desk_log",
                            "ok": false,
                            "error": error,
                        }),
                    );
                }
            }
        }
        QxAiScheduleKind::AgentPrompt => {
            mark_run(&schedule.id, true, None);
            let _ = app.emit(
                "qxai-schedule-fire",
                json!({
                    "id": schedule.id,
                    "name": schedule.name,
                    "kind": "agent_prompt",
                    "skillId": schedule.skill_id,
                    "prompt": schedule.prompt.clone().unwrap_or_else(|| {
                        "Run the scheduled QxAI task.".to_string()
                    }),
                }),
            );
        }
    }
}

fn tick(app: &AppHandle) {
    let now = Local::now();
    let due: Vec<QxAiSchedule> = with_lock(|| {
        let file = read_file();
        Ok(file
            .schedules
            .into_iter()
            .filter(|s| should_fire(s, now))
            .collect())
    })
    .unwrap_or_default();
    for schedule in due {
        execute_schedule(app, &schedule);
    }
}

/// Seed bundled skills + a disabled example schedule once.
pub fn ensure_defaults() {
    let _ = seed_bundled_skills();
    let _ = with_lock(|| {
        let mut file = read_file();
        if file.schedules.is_empty() {
            file.schedules.push(QxAiSchedule {
                id: "morning-desk-log-10".into(),
                name: "Morning desk log".into(),
                enabled: false,
                kind: QxAiScheduleKind::MorningDeskLog,
                daily_time: "10:00".into(),
                skill_id: Some(MORNING_DESK_SKILL_ID.into()),
                prompt: Some("Summarize this morning's desktop and clipboard.".into()),
                last_run_at: None,
                last_error: None,
            });
            write_file(&file)?;
        }
        Ok(())
    });
}

/// First-party skills shipped under `resources/skills/`. Missing ids only — never overwrite user edits.
fn seed_bundled_skills() -> Result<(), String> {
    const BUNDLED: &[(&str, &str, Option<&str>)] = &[
        (
            MORNING_DESK_SKILL_ID,
            include_str!("../resources/skills/morning-desk-log/SKILL.md"),
            Some("fixed"),
        ),
        (
            "rss-brief",
            include_str!("../resources/skills/rss-brief/SKILL.md"),
            Some("smart"),
        ),
        (
            "qx-plugin-capabilities",
            include_str!("../resources/skills/qx-plugin-capabilities/SKILL.md"),
            Some("smart"),
        ),
    ];
    for (id, content, mode) in BUNDLED {
        if crate::qx_ai_skills::skill_exists(id) {
            continue;
        }
        crate::qx_ai_skills::write_skill_for_host(id, content, *mode).map(|_| ())?;
    }
    Ok(())
}

/// Start the background scheduler (called from app setup).
pub fn start(app: AppHandle) {
    ensure_defaults();
    std::thread::Builder::new()
        .name("qxai-schedule".into())
        .spawn(move || loop {
            tick(&app);
            std::thread::sleep(Duration::from_secs(TICK_SECS));
        })
        .ok();
}

// ── Tauri commands ──────────────────────────────────────────────────────

#[tauri::command]
pub fn qxai_list_schedules() -> Result<Vec<QxAiSchedule>, String> {
    with_lock(|| Ok(read_file().schedules))
}

#[tauri::command]
pub fn qxai_upsert_schedule(schedule: QxAiSchedule) -> Result<QxAiSchedule, String> {
    with_lock(|| {
        let mut file = read_file();
        if schedule.id.trim().is_empty() {
            return Err("schedule id is required".into());
        }
        if parse_daily_time(&schedule.daily_time).is_none() {
            return Err("daily_time must be HH:MM".into());
        }
        if let Some(existing) = file.schedules.iter_mut().find(|s| s.id == schedule.id) {
            *existing = schedule.clone();
        } else {
            file.schedules.push(schedule.clone());
        }
        write_file(&file)?;
        Ok(schedule)
    })
}

#[tauri::command]
pub fn qxai_delete_schedule(id: String) -> Result<(), String> {
    with_lock(|| {
        let mut file = read_file();
        let before = file.schedules.len();
        file.schedules.retain(|s| s.id != id);
        if file.schedules.len() == before {
            return Err(format!("schedule not found: {id}"));
        }
        write_file(&file)
    })
}

#[tauri::command]
pub fn qxai_run_schedule_now(app: AppHandle, id: String) -> Result<Value, String> {
    let schedule = with_lock(|| {
        read_file()
            .schedules
            .into_iter()
            .find(|s| s.id == id)
            .ok_or_else(|| format!("schedule not found: {id}"))
    })?;
    match schedule.kind {
        QxAiScheduleKind::MorningDeskLog => {
            let result = run_morning_desk_log(schedule.prompt.as_deref())?;
            mark_run(&schedule.id, true, None);
            Ok(result)
        }
        QxAiScheduleKind::AgentPrompt => {
            execute_schedule(&app, &schedule);
            Ok(json!({ "queued": true, "id": schedule.id }))
        }
    }
}

#[tauri::command]
pub async fn qxai_capture_desktop(
    monitor_id: Option<u32>,
    dest_dir: Option<String>,
) -> Result<CaptureDesktopResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dest = dest_dir.as_deref().map(Path::new);
        capture_desktop_sync(monitor_id, dest)
    })
    .await
    .map_err(|e| format!("capture worker failed: {e}"))?
}

#[tauri::command]
pub fn qxai_clipboard_history(limit: Option<u32>) -> Result<Vec<Value>, String> {
    clipboard_text_snapshot(limit.unwrap_or(40))
}

#[tauri::command]
pub fn qxai_logs_directory() -> Result<String, String> {
    let (root, _) = ensure_logs_dirs()?;
    Ok(root.to_string_lossy().into_owned())
}
