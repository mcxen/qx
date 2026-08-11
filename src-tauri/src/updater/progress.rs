//! Floating update progress window + progress event bus.
//!
//! Download/install runs off the UI thread; the main process keeps a dedicated
//! always-on-top WebView so users still see phase + percent on both macOS and
//! Windows while the launcher is hidden.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder,
};

const LABEL: &str = "update-progress";
const WIDTH: f64 = 376.0;
const HEIGHT: f64 = 172.0;
const EVENT: &str = "qx-update-progress";
const MIN_EMIT_INTERVAL: Duration = Duration::from_millis(80);

/// Cooperative cancel for download / pre-helper install. Helper spawn and
/// restart phases ignore this so we never leave a half-applied update.
fn cancel_flag() -> &'static AtomicBool {
    static CANCEL: AtomicBool = AtomicBool::new(false);
    &CANCEL
}

pub fn clear_cancel() {
    cancel_flag().store(false, Ordering::SeqCst);
}

pub fn request_cancel() {
    cancel_flag().store(true, Ordering::SeqCst);
}

pub fn is_cancelled() -> bool {
    cancel_flag().load(Ordering::SeqCst)
}

/// Single background download/install job slot (pre-helper only).
fn job_running_flag() -> &'static AtomicBool {
    static RUNNING: AtomicBool = AtomicBool::new(false);
    &RUNNING
}

/// Atomically claim the update job. Returns false if another job is active.
pub fn try_begin_job() -> bool {
    job_running_flag()
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
}

pub fn end_job() {
    job_running_flag().store(false, Ordering::SeqCst);
}

pub fn ensure_not_cancelled() -> Result<(), String> {
    if is_cancelled() {
        Err(cancelled_message().to_string())
    } else {
        Ok(())
    }
}

pub fn cancelled_message() -> &'static str {
    "Update cancelled."
}

pub fn is_cancel_error(message: &str) -> bool {
    message.contains(cancelled_message())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub phase: String,
    pub message: String,
    pub version: Option<String>,
    /// 0–100 when known; omitted for indeterminate waiting states.
    pub percent: Option<f64>,
    pub bytes_downloaded: Option<u64>,
    pub bytes_total: Option<u64>,
    pub indeterminate: bool,
    /// Download/stage finished; host waits for user to click Install & Restart.
    pub ready_to_install: bool,
    pub error: Option<String>,
}

/// Staged payload waiting for explicit user apply (helper spawn + quit).
#[derive(Debug, Clone)]
pub struct PendingInstall {
    pub version: String,
    pub payload: PathBuf,
    pub target: PathBuf,
}

fn pending_install_slot() -> &'static Mutex<Option<PendingInstall>> {
    static PENDING: OnceLock<Mutex<Option<PendingInstall>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(None))
}

pub fn set_pending_install(pending: PendingInstall) {
    if let Ok(mut guard) = pending_install_slot().lock() {
        *guard = Some(pending);
    }
}

pub fn take_pending_install() -> Option<PendingInstall> {
    pending_install_slot()
        .lock()
        .ok()
        .and_then(|mut guard| guard.take())
}

pub fn clear_pending_install() {
    if let Ok(mut guard) = pending_install_slot().lock() {
        *guard = None;
    }
}

#[derive(Clone)]
pub struct ProgressReporter {
    app: AppHandle,
    version: Option<String>,
    last_emit_ms: std::sync::Arc<AtomicU64>,
}

impl ProgressReporter {
    pub fn new(app: AppHandle, version: Option<String>) -> Self {
        Self {
            app,
            version,
            last_emit_ms: std::sync::Arc::new(AtomicU64::new(0)),
        }
    }

    pub fn emit_phase(&self, phase: &str, message: &str) {
        self.emit(UpdateProgress {
            phase: phase.to_string(),
            message: message.to_string(),
            version: self.version.clone(),
            percent: None,
            bytes_downloaded: None,
            bytes_total: None,
            indeterminate: true,
            ready_to_install: false,
            error: None,
        });
    }

    pub fn emit_ready(&self, message: &str) {
        self.emit(UpdateProgress {
            phase: "ready".to_string(),
            message: message.to_string(),
            version: self.version.clone(),
            percent: Some(100.0),
            bytes_downloaded: None,
            bytes_total: None,
            indeterminate: false,
            ready_to_install: true,
            error: None,
        });
    }

    pub fn emit_download(&self, downloaded: u64, total: Option<u64>, force: bool) {
        let percent = total
            .filter(|value| *value > 0)
            .map(|value| ((downloaded as f64 / value as f64) * 100.0).clamp(0.0, 100.0));
        let message = match total {
            Some(total) if total > 0 => format!(
                "Downloading… {} / {}",
                format_bytes(downloaded),
                format_bytes(total)
            ),
            _ => format!("Downloading… {}", format_bytes(downloaded)),
        };
        self.emit_throttled(
            UpdateProgress {
                phase: "downloading".to_string(),
                message,
                version: self.version.clone(),
                percent,
                bytes_downloaded: Some(downloaded),
                bytes_total: total,
                indeterminate: percent.is_none(),
                ready_to_install: false,
                error: None,
            },
            force,
        );
    }

    pub fn emit_error(&self, message: &str) {
        self.emit(UpdateProgress {
            phase: "error".to_string(),
            message: message.to_string(),
            version: self.version.clone(),
            percent: None,
            bytes_downloaded: None,
            bytes_total: None,
            indeterminate: false,
            ready_to_install: false,
            error: Some(message.to_string()),
        });
    }

    fn emit_throttled(&self, progress: UpdateProgress, force: bool) {
        let now = unix_ms();
        if !force {
            let previous = self.last_emit_ms.load(Ordering::Relaxed);
            if now.saturating_sub(previous) < MIN_EMIT_INTERVAL.as_millis() as u64 {
                // Still refresh the snapshot store so poll-based UI can advance
                // even when high-frequency download ticks are coalesced.
                store_last_progress(progress);
                return;
            }
        }
        self.last_emit_ms.store(now, Ordering::Relaxed);
        self.emit(progress);
    }

    fn emit(&self, progress: UpdateProgress) {
        store_last_progress(progress.clone());
        // Broadcast + target the progress surface. A bare emit can miss a
        // late-mounted secondary webview; emit_to keeps the dedicated window
        // in lockstep with download bytes.
        let _ = self.app.emit(EVENT, progress.clone());
        let _ = self.app.emit_to(LABEL, EVENT, progress);
    }
}

fn unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn last_progress_slot() -> &'static Mutex<Option<UpdateProgress>> {
    static LAST: OnceLock<Mutex<Option<UpdateProgress>>> = OnceLock::new();
    LAST.get_or_init(|| Mutex::new(None))
}

fn store_last_progress(progress: UpdateProgress) {
    if let Ok(mut guard) = last_progress_slot().lock() {
        *guard = Some(progress);
    }
}

pub fn last_progress() -> Option<UpdateProgress> {
    last_progress_slot()
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn format_bytes(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let value = bytes as f64;
    if value >= GB {
        format!("{:.2} GB", value / GB)
    } else if value >= MB {
        format!("{:.1} MB", value / MB)
    } else if value >= KB {
        format!("{:.0} KB", value / KB)
    } else {
        format!("{bytes} B")
    }
}

fn ensure_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?surface=update-progress".into()),
    )
    .title("Qx Update")
    .inner_size(WIDTH, HEIGHT)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    // Windows DWM draws a rectangular shadow around transparent undecorated
    // windows. The inset WebView surface owns its shadow and 8px clipping there.
    .shadow(cfg!(target_os = "macos"))
    .always_on_top(true)
    // Keep a taskbar / dock presence so a stuck update is findable, and allow
    // the surface to receive the first click for Cancel / drag without an
    // extra activation click (macOS + Windows).
    .skip_taskbar(false)
    .visible(false)
    .focused(false)
    .accept_first_mouse(true)
    .build()
    .map_err(|error| format!("open update progress window: {error}"))
}

fn place_window(app: &AppHandle, window: &tauri::WebviewWindow) {
    let area = crate::display::resolve_pointer_display(app, Some(window), None);
    let Some(area) = area else {
        return;
    };
    let scale = area.scale_factor.max(1.0);
    let width = (WIDTH * scale).round() as i32;
    let height = (HEIGHT * scale).round() as i32;
    let x = area.work_x + ((area.work_width as i32 - width) / 2);
    let y = area.work_y + ((area.work_height as i32 - height) / 3);
    let _ = window.set_size(LogicalSize::new(WIDTH, HEIGHT));
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

/// Open (or focus) the progress surface and seed an initial waiting state.
/// Must run on the UI/main thread — never from `spawn_blocking`.
pub fn show_window(app: &AppHandle, version: Option<&str>) -> Result<ProgressReporter, String> {
    clear_cancel();
    let reporter = ProgressReporter::new(app.clone(), version.map(str::to_string));
    reporter.emit_phase("preparing", "Preparing update…");
    let window = ensure_window(app)?;
    place_window(app, &window);
    window
        .show()
        .map_err(|error| format!("show update progress window: {error}"))?;
    // Never steal key focus from the main launcher while downloading — only the
    // helper-install/restart phase ends the host process.
    let _ = crate::auxiliary_window::make_non_activating(&window);
    let _ = window.set_always_on_top(true);
    Ok(reporter)
}

pub fn hide_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        window
            .hide()
            .map_err(|error| format!("hide update progress window: {error}"))?;
    }
    Ok(())
}

/// User-facing cancel / "Later": stop cooperative download and drop a staged
/// apply slot. If no worker is running (already ready), hide the surface so
/// Windows/macOS users return to the main app immediately.
pub fn cancel(app: &AppHandle) -> Result<(), String> {
    let was_ready = last_progress()
        .map(|p| p.ready_to_install || p.phase == "ready")
        .unwrap_or(false);
    request_cancel();
    clear_pending_install();
    if was_ready || !job_running_flag().load(Ordering::SeqCst) {
        let _ = hide_window(app);
        clear_cancel();
        return Ok(());
    }
    let reporter = ProgressReporter::new(app.clone(), last_progress().and_then(|p| p.version));
    reporter.emit_phase("cancelling", "Cancelling update…");
    Ok(())
}
