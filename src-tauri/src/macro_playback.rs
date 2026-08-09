use enigo::{Coordinate, Direction, Enigo, Keyboard, Mouse, Settings};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::thread;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{command, AppHandle, Emitter};

use crate::macro_playback_keys::parse_key;
use crate::macro_recorder::{open_db, MacroData, MacroStep};

const MACRO_PLAYBACK_EVENT: &str = "macro:playback";
const MAX_PLAYBACK_DELAY_MS: u64 = 60_000;
const PLAYBACK_TICK_MS: u64 = 25;
const PLAYBACK_PROGRESS_INTERVAL_MS: u64 = 100;

#[derive(Debug, Clone, Serialize)]
pub struct MacroPlaybackProgress {
    pub playback_id: u64,
    pub macro_id: i64,
    pub macro_name: String,
    pub state: String,
    pub delay_ms: u64,
    pub remaining_delay_ms: u64,
    pub completed_steps: usize,
    pub total_steps: usize,
    /// One-based step number so the value can be shown directly in the UI.
    pub current_step_index: Option<usize>,
    pub current_step: Option<MacroStep>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MacroPlaybackStarted {
    pub playback_id: u64,
    pub macro_id: i64,
    pub macro_name: String,
    pub total_steps: usize,
    pub delay_ms: u64,
}

struct PlaybackTask {
    id: u64,
    control: Arc<PlaybackControl>,
    thread: JoinHandle<()>,
}

/// Cooperative control for one playback worker. Pause is deliberately kept
/// separate from cancellation: pausing must freeze elapsed playback time and
/// native input, while stopping must wake and join the worker immediately.
struct PlaybackControl {
    cancel: AtomicBool,
    paused: AtomicBool,
    wake: Condvar,
    wake_lock: Mutex<()>,
}

impl PlaybackControl {
    fn new() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            paused: AtomicBool::new(false),
            wake: Condvar::new(),
            wake_lock: Mutex::new(()),
        }
    }
}

struct PlaybackControllerState {
    next_id: u64,
    active: Option<PlaybackTask>,
    starting: bool,
    stopping: bool,
}

static PLAYBACK_CONTROLLER: OnceLock<(Mutex<PlaybackControllerState>, Condvar)> = OnceLock::new();

fn playback_controller() -> &'static (Mutex<PlaybackControllerState>, Condvar) {
    PLAYBACK_CONTROLLER.get_or_init(|| {
        (
            Mutex::new(PlaybackControllerState {
                next_id: 1,
                active: None,
                starting: false,
                stopping: false,
            }),
            Condvar::new(),
        )
    })
}

fn next_playback_id(state: &mut PlaybackControllerState) -> u64 {
    let id = if state.next_id == 0 { 1 } else { state.next_id };
    state.next_id = id.wrapping_add(1);
    id
}

fn take_playback_for_stop() -> Result<Option<PlaybackTask>, String> {
    let (lock, wake) = playback_controller();
    let mut state = lock.lock().map_err(|e| format!("lock: {e}"))?;
    loop {
        if state.starting || state.stopping {
            state = wake.wait(state).map_err(|e| format!("wait: {e}"))?;
            continue;
        }
        let task = state.active.take();
        if task.is_some() {
            state.stopping = true;
        }
        return Ok(task);
    }
}

fn finish_playback(playback_id: u64) {
    let (lock, wake) = playback_controller();
    if let Ok(mut state) = lock.lock() {
        if state
            .active
            .as_ref()
            .map(|task| task.id == playback_id)
            .unwrap_or(false)
        {
            // Dropping the handle here is safe: the worker is the current
            // thread and has already emitted its terminal event. A stop
            // request takes ownership of this handle before joining it.
            state.active.take();
            wake.notify_all();
        }
    }
}

fn finish_playback_stop() {
    let (lock, wake) = playback_controller();
    if let Ok(mut state) = lock.lock() {
        state.stopping = false;
        wake.notify_all();
    }
}

fn emit_playback(app: &AppHandle, progress: MacroPlaybackProgress) {
    let _ = app.emit(MACRO_PLAYBACK_EVENT, progress);
}

fn playback_progress(
    data: &MacroData,
    playback_id: u64,
    delay_ms: u64,
    state: &str,
    remaining_delay_ms: u64,
    completed_steps: usize,
    current_step_index: Option<usize>,
    current_step: Option<MacroStep>,
    error: Option<String>,
) -> MacroPlaybackProgress {
    MacroPlaybackProgress {
        playback_id,
        macro_id: data.id.unwrap_or_default(),
        macro_name: data.name.clone(),
        state: state.to_string(),
        delay_ms,
        remaining_delay_ms,
        completed_steps,
        total_steps: data.steps.len(),
        current_step_index,
        current_step,
        error,
    }
}

fn wait_for_resume(
    control: &PlaybackControl,
    mut on_pause: impl FnMut(),
    mut on_resume: impl FnMut(),
) -> bool {
    if control.cancel.load(Ordering::SeqCst) {
        return false;
    }
    if !control.paused.load(Ordering::SeqCst) {
        return true;
    }

    on_pause();
    let mut guard = match control.wake_lock.lock() {
        Ok(guard) => guard,
        Err(_) => return false,
    };
    while control.paused.load(Ordering::SeqCst) && !control.cancel.load(Ordering::SeqCst) {
        guard = match control.wake.wait(guard) {
            Ok(guard) => guard,
            Err(_) => return false,
        };
    }
    let cancelled = control.cancel.load(Ordering::SeqCst);
    drop(guard);
    if cancelled {
        return false;
    }
    on_resume();
    true
}

fn wait_cancellable(
    control: &PlaybackControl,
    duration_ms: u64,
    mut on_tick: impl FnMut(u64),
    mut on_pause: impl FnMut(u64),
    mut on_resume: impl FnMut(u64),
) -> bool {
    if duration_ms == 0 {
        return wait_for_resume(control, || on_pause(0), || on_resume(0));
    }

    let mut remaining_ms = duration_ms;
    let mut segment_started = Instant::now();
    let mut last_tick = segment_started;
    loop {
        if control.cancel.load(Ordering::SeqCst) {
            return false;
        }

        if control.paused.load(Ordering::SeqCst) {
            remaining_ms =
                remaining_ms.saturating_sub(segment_started.elapsed().as_millis() as u64);
            if !wait_for_resume(
                control,
                || on_pause(remaining_ms),
                || on_resume(remaining_ms),
            ) {
                return false;
            }
            segment_started = Instant::now();
            last_tick = segment_started;
            continue;
        }

        let elapsed_ms = segment_started.elapsed().as_millis() as u64;
        if elapsed_ms >= remaining_ms {
            return true;
        }

        if last_tick.elapsed().as_millis() as u64 >= PLAYBACK_PROGRESS_INTERVAL_MS {
            on_tick(remaining_ms.saturating_sub(elapsed_ms));
            last_tick = Instant::now();
        }

        let remaining = remaining_ms.saturating_sub(elapsed_ms);
        thread::sleep(Duration::from_millis(remaining.min(PLAYBACK_TICK_MS)));
    }
}

fn parse_button(button: Option<&str>) -> Result<enigo::Button, String> {
    match button.unwrap_or_default() {
        "Left" | "" => Ok(enigo::Button::Left),
        "Right" => Ok(enigo::Button::Right),
        "Middle" => Ok(enigo::Button::Middle),
        other => Err(format!("unknown mouse button: {other}")),
    }
}

#[cfg(target_os = "macos")]
fn launch_application(application: &str) -> Result<(), String> {
    let status = std::process::Command::new("/usr/bin/open")
        .args(["-a", application])
        .status()
        .map_err(|error| format!("launch {application}: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "launch {application}: open exited with {}",
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "signal".to_string())
        ))
    }
}

#[cfg(target_os = "windows")]
fn launch_application(application: &str) -> Result<(), String> {
    if !application.eq_ignore_ascii_case("Google Chrome") {
        return Err(format!(
            "unsupported Windows demo application: {application}"
        ));
    }

    let roots = [
        std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from),
        std::env::var_os("PROGRAMFILES").map(std::path::PathBuf::from),
        std::env::var_os("PROGRAMFILES(X86)").map(std::path::PathBuf::from),
    ];
    let executable = roots
        .into_iter()
        .flatten()
        .map(|root| {
            root.join("Google")
                .join("Chrome")
                .join("Application")
                .join("chrome.exe")
        })
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "Google Chrome was not found in the standard Windows install locations".to_string()
        })?;

    crate::launch_app_path(&executable).map_err(|error| format!("launch Google Chrome: {error}"))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn launch_application(application: &str) -> Result<(), String> {
    Err(format!(
        "launching demo application is unsupported on this platform: {application}"
    ))
}

fn execute_macro_step(enigo: &mut Enigo, step: &MacroStep) -> Result<(), String> {
    match step.event_type.as_str() {
        "key_press" | "key_release" => {
            let key_name = step
                .key
                .as_deref()
                .ok_or_else(|| format!("{} step is missing a key", step.event_type))?;
            let key = parse_key(key_name)?;
            let direction = if step.event_type == "key_press" {
                Direction::Press
            } else {
                Direction::Release
            };
            enigo
                .key(key, direction)
                .map_err(|error| format!("key input failed: {error:?}"))?;
        }
        "mouse_move" => {
            let (x, y) = step
                .x
                .zip(step.y)
                .ok_or_else(|| "mouse_move step is missing coordinates".to_string())?;
            enigo
                .move_mouse(x, y, Coordinate::Abs)
                .map_err(|error| format!("mouse move failed: {error:?}"))?;
        }
        "mouse_click" | "mouse_release" => {
            // Click/release events retain their own coordinates. This makes
            // an immediate click after a fast pointer move deterministic even
            // if the move event was coalesced by the bounded capture queue.
            if let Some((x, y)) = step.x.zip(step.y) {
                enigo
                    .move_mouse(x, y, Coordinate::Abs)
                    .map_err(|error| format!("mouse move failed: {error:?}"))?;
            }
            let direction = if step.event_type == "mouse_click" {
                Direction::Press
            } else {
                Direction::Release
            };
            enigo
                .button(parse_button(step.button.as_deref())?, direction)
                .map_err(|error| format!("mouse input failed: {error:?}"))?;
        }
        "text_input" => {
            let text = step
                .text
                .as_deref()
                .ok_or_else(|| "text_input step is missing text".to_string())?;
            enigo
                .text(text)
                .map_err(|error| format!("text input failed: {error:?}"))?;
        }
        "launch_application" => {
            let application = step
                .application
                .as_deref()
                .ok_or_else(|| "launch_application step is missing an application".to_string())?;
            launch_application(application)?;
        }
        // A wait is represented by duration_ms and therefore has no native
        // input side effect.
        "wait" => {}
        unsupported => return Err(format!("unsupported macro step type: {unsupported}")),
    }
    Ok(())
}

fn wait_for_playback_start(start_gate: &Arc<(Mutex<bool>, Condvar)>) {
    let (lock, wake) = &**start_gate;
    if let Ok(mut ready) = lock.lock() {
        while !*ready {
            match wake.wait(ready) {
                Ok(next) => ready = next,
                Err(_) => return,
            }
        }
    }
}

fn run_playback(
    app: AppHandle,
    playback_id: u64,
    data: MacroData,
    delay_ms: u64,
    control: Arc<PlaybackControl>,
    start_gate: Arc<(Mutex<bool>, Condvar)>,
) {
    wait_for_playback_start(&start_gate);

    if delay_ms > 0 {
        emit_playback(
            &app,
            playback_progress(
                &data,
                playback_id,
                delay_ms,
                "waiting",
                delay_ms,
                0,
                None,
                None,
                None,
            ),
        );
        let app_for_tick = app.clone();
        let data_for_tick = data.clone();
        let delayed = wait_cancellable(
            &control,
            delay_ms,
            |remaining| {
                emit_playback(
                    &app_for_tick,
                    playback_progress(
                        &data_for_tick,
                        playback_id,
                        delay_ms,
                        "waiting",
                        remaining,
                        0,
                        None,
                        None,
                        None,
                    ),
                );
            },
            |remaining| {
                emit_playback(
                    &app_for_tick,
                    playback_progress(
                        &data_for_tick,
                        playback_id,
                        delay_ms,
                        "paused",
                        remaining,
                        0,
                        None,
                        None,
                        None,
                    ),
                );
            },
            |remaining| {
                emit_playback(
                    &app_for_tick,
                    playback_progress(
                        &data_for_tick,
                        playback_id,
                        delay_ms,
                        "waiting",
                        remaining,
                        0,
                        None,
                        None,
                        None,
                    ),
                );
            },
        );
        if !delayed {
            emit_playback(
                &app,
                playback_progress(
                    &data,
                    playback_id,
                    delay_ms,
                    "cancelled",
                    0,
                    0,
                    None,
                    None,
                    None,
                ),
            );
            finish_playback(playback_id);
            return;
        }
    }

    let mut enigo = match Enigo::new(&Settings::default()) {
        Ok(enigo) => enigo,
        Err(error) => {
            let message = format!("enigo init: {error}");
            emit_playback(
                &app,
                playback_progress(
                    &data,
                    playback_id,
                    delay_ms,
                    "error",
                    0,
                    0,
                    None,
                    None,
                    Some(message),
                ),
            );
            finish_playback(playback_id);
            return;
        }
    };

    for (index, step) in data.steps.iter().enumerate() {
        let step_number = index + 1;
        if control.cancel.load(Ordering::SeqCst) {
            emit_playback(
                &app,
                playback_progress(
                    &data,
                    playback_id,
                    delay_ms,
                    "cancelled",
                    0,
                    index,
                    Some(step_number),
                    Some(step.clone()),
                    None,
                ),
            );
            finish_playback(playback_id);
            return;
        }

        let app_for_pause = app.clone();
        let data_for_pause = data.clone();
        let step_for_pause = step.clone();
        if !wait_for_resume(
            &control,
            || {
                emit_playback(
                    &app_for_pause,
                    playback_progress(
                        &data_for_pause,
                        playback_id,
                        delay_ms,
                        "paused",
                        step_for_pause.duration_ms,
                        index,
                        Some(step_number),
                        Some(step_for_pause.clone()),
                        None,
                    ),
                )
            },
            || {
                emit_playback(
                    &app_for_pause,
                    playback_progress(
                        &data_for_pause,
                        playback_id,
                        delay_ms,
                        "playing",
                        step_for_pause.duration_ms,
                        index,
                        Some(step_number),
                        Some(step_for_pause.clone()),
                        None,
                    ),
                )
            },
        ) {
            emit_playback(
                &app,
                playback_progress(
                    &data,
                    playback_id,
                    delay_ms,
                    "cancelled",
                    0,
                    index,
                    Some(step_number),
                    Some(step.clone()),
                    None,
                ),
            );
            finish_playback(playback_id);
            return;
        }

        emit_playback(
            &app,
            playback_progress(
                &data,
                playback_id,
                delay_ms,
                "playing",
                0,
                index,
                Some(step_number),
                Some(step.clone()),
                None,
            ),
        );

        let app_for_tick = app.clone();
        let data_for_tick = data.clone();
        let step_for_tick = step.clone();
        let app_for_pause = app.clone();
        let data_for_pause = data.clone();
        let step_for_pause = step.clone();
        if !wait_cancellable(
            &control,
            step.duration_ms,
            |remaining| {
                emit_playback(
                    &app_for_tick,
                    playback_progress(
                        &data_for_tick,
                        playback_id,
                        delay_ms,
                        "playing",
                        remaining,
                        index,
                        Some(step_number),
                        Some(step_for_tick.clone()),
                        None,
                    ),
                );
            },
            |remaining| {
                emit_playback(
                    &app_for_pause,
                    playback_progress(
                        &data_for_pause,
                        playback_id,
                        delay_ms,
                        "paused",
                        remaining,
                        index,
                        Some(step_number),
                        Some(step_for_pause.clone()),
                        None,
                    ),
                );
            },
            |remaining| {
                emit_playback(
                    &app_for_pause,
                    playback_progress(
                        &data_for_pause,
                        playback_id,
                        delay_ms,
                        "playing",
                        remaining,
                        index,
                        Some(step_number),
                        Some(step_for_pause.clone()),
                        None,
                    ),
                );
            },
        ) {
            emit_playback(
                &app,
                playback_progress(
                    &data,
                    playback_id,
                    delay_ms,
                    "cancelled",
                    0,
                    index,
                    Some(step_number),
                    Some(step.clone()),
                    None,
                ),
            );
            finish_playback(playback_id);
            return;
        }

        let app_for_pause = app.clone();
        let data_for_pause = data.clone();
        let step_for_pause = step.clone();
        if !wait_for_resume(
            &control,
            || {
                emit_playback(
                    &app_for_pause,
                    playback_progress(
                        &data_for_pause,
                        playback_id,
                        delay_ms,
                        "paused",
                        0,
                        index,
                        Some(step_number),
                        Some(step_for_pause.clone()),
                        None,
                    ),
                )
            },
            || {
                emit_playback(
                    &app_for_pause,
                    playback_progress(
                        &data_for_pause,
                        playback_id,
                        delay_ms,
                        "playing",
                        0,
                        index,
                        Some(step_number),
                        Some(step_for_pause.clone()),
                        None,
                    ),
                )
            },
        ) {
            emit_playback(
                &app,
                playback_progress(
                    &data,
                    playback_id,
                    delay_ms,
                    "cancelled",
                    0,
                    index,
                    Some(step_number),
                    Some(step.clone()),
                    None,
                ),
            );
            finish_playback(playback_id);
            return;
        }

        if let Err(error) = execute_macro_step(&mut enigo, step) {
            emit_playback(
                &app,
                playback_progress(
                    &data,
                    playback_id,
                    delay_ms,
                    "error",
                    0,
                    index,
                    Some(step_number),
                    Some(step.clone()),
                    Some(error),
                ),
            );
            finish_playback(playback_id);
            return;
        }

        emit_playback(
            &app,
            playback_progress(
                &data,
                playback_id,
                delay_ms,
                "playing",
                0,
                step_number,
                Some(step_number),
                Some(step.clone()),
                None,
            ),
        );
    }

    emit_playback(
        &app,
        playback_progress(
            &data,
            playback_id,
            delay_ms,
            "completed",
            0,
            data.steps.len(),
            None,
            None,
            None,
        ),
    );
    finish_playback(playback_id);
}

#[command]
pub async fn macro_play(
    app: AppHandle,
    id: i64,
    delay_ms: Option<u64>,
) -> Result<MacroPlaybackStarted, String> {
    let (lock, wake) = playback_controller();
    let playback_id = {
        let mut state = lock.lock().map_err(|e| format!("lock: {e}"))?;
        if state.active.is_some() || state.starting || state.stopping {
            return Err("Macro playback already in progress".into());
        }

        let playback_id = next_playback_id(&mut state);
        state.starting = true;
        playback_id
    };

    let data = match tauri::async_runtime::spawn_blocking(move || load_macro_for_play(id)).await {
        Ok(Ok(data)) => data,
        Ok(Err(error)) => {
            let mut state = lock.lock().map_err(|e| format!("lock: {e}"))?;
            state.starting = false;
            wake.notify_all();
            return Err(error);
        }
        Err(error) => {
            let mut state = lock.lock().map_err(|e| format!("lock: {e}"))?;
            state.starting = false;
            wake.notify_all();
            return Err(format!("load macro task: {error}"));
        }
    };

    let delay_ms = delay_ms.unwrap_or(0).min(MAX_PLAYBACK_DELAY_MS);
    let control = Arc::new(PlaybackControl::new());
    let start_gate = Arc::new((Mutex::new(false), Condvar::new()));
    let started = MacroPlaybackStarted {
        playback_id,
        macro_id: id,
        macro_name: data.name.clone(),
        total_steps: data.steps.len(),
        delay_ms,
    };

    let worker_control = control.clone();
    let worker_gate = start_gate.clone();
    let worker_app = app.clone();
    let worker_data = data.clone();
    let thread = thread::Builder::new()
        .name(format!("qx-macro-playback-{playback_id}"))
        .spawn(move || {
            run_playback(
                worker_app,
                playback_id,
                worker_data,
                delay_ms,
                worker_control,
                worker_gate,
            );
        })
        .map_err(|error| format!("start playback thread: {error}"));

    let mut state = lock.lock().map_err(|e| format!("lock: {e}"))?;
    state.starting = false;
    let thread = match thread {
        Ok(thread) => thread,
        Err(error) => {
            wake.notify_all();
            return Err(error);
        }
    };
    state.active = Some(PlaybackTask {
        id: playback_id,
        control,
        thread,
    });
    wake.notify_all();
    drop(state);

    let (gate_lock, gate_wake) = &*start_gate;
    if let Ok(mut ready) = gate_lock.lock() {
        *ready = true;
        gate_wake.notify_all();
    }

    Ok(started)
}

/// Toggle pause without taking ownership of the playback worker. The worker
/// emits the authoritative paused/resumed progress event and preserves the
/// remaining delay for the current step.
#[command]
pub fn macro_toggle_playback_pause() -> Result<bool, String> {
    let (lock, _) = playback_controller();
    let state = lock.lock().map_err(|e| format!("lock: {e}"))?;
    if state.starting || state.stopping {
        return Err("Macro playback is changing state".into());
    }
    let task = state
        .active
        .as_ref()
        .ok_or_else(|| "No macro playback in progress".to_string())?;
    let paused = !task.control.paused.load(Ordering::SeqCst);
    task.control.paused.store(paused, Ordering::SeqCst);
    task.control.wake.notify_all();
    Ok(paused)
}

fn load_macro_for_play(id: i64) -> Result<MacroData, String> {
    let conn = open_db()?;
    conn.query_row(
        "SELECT name, steps, total_duration_ms, created_at FROM macros WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            let steps_str: String = row.get(1)?;
            let steps: Vec<MacroStep> = serde_json::from_str(&steps_str).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    1,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(MacroData {
                id: Some(id),
                name: row.get(0)?,
                steps,
                total_duration_ms: row.get(2)?,
                created_at: Some(row.get(3)?),
            })
        },
    )
    .map_err(|e| format!("load macro: {e}"))
}

#[command]
pub async fn macro_stop_playback() -> Result<(), String> {
    let Some(task) = take_playback_for_stop()? else {
        return Ok(());
    };
    task.control.cancel.store(true, Ordering::SeqCst);
    task.control.wake.notify_all();
    let join_result = tauri::async_runtime::spawn_blocking(move || {
        task.thread
            .join()
            .map_err(|_| "macro playback thread panicked".to_string())
    })
    .await
    .map_err(|error| format!("stop playback task: {error}"))?;
    finish_playback_stop();
    join_result
}

/// Stop playback during module teardown or process exit. The worker uses
/// short cancellable waits, so joining here does not leave native input alive.
pub(crate) fn stop_for_shutdown() {
    let task = match take_playback_for_stop() {
        Ok(task) => task,
        Err(error) => {
            crate::diagnostics::log(
                crate::diagnostics::LogLevel::Warn,
                "macro.playback",
                "macro playback shutdown stop failed",
                serde_json::json!({ "error": error }),
            );
            return;
        }
    };
    if let Some(task) = task {
        task.control.cancel.store(true, Ordering::SeqCst);
        task.control.wake.notify_all();
        if task.thread.join().is_err() {
            crate::diagnostics::log(
                crate::diagnostics::LogLevel::Warn,
                "macro.playback",
                "macro playback thread panicked during shutdown",
                serde_json::json!({}),
            );
        }
        finish_playback_stop();
    }
}

#[cfg(test)]
#[path = "macro_playback_tests.rs"]
mod tests;
