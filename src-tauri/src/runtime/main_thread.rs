use std::sync::mpsc::{sync_channel, RecvTimeoutError};
use std::sync::OnceLock;
use std::thread::ThreadId;
use std::time::Duration;

use tauri::AppHandle;

static MAIN_THREAD_ID: OnceLock<ThreadId> = OnceLock::new();

/// Error from scheduling or waiting on runtime work.
#[derive(Debug, Clone)]
pub struct RuntimeError(pub String);

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for RuntimeError {}

impl From<RuntimeError> for String {
    fn from(value: RuntimeError) -> Self {
        value.0
    }
}

/// Record the process UI/main thread id. Call once from `setup` on the event loop.
pub fn install(app: &AppHandle) {
    if MAIN_THREAD_ID.get().is_some() {
        return;
    }
    let app = app.clone();
    // Must schedule through Tauri so the closure actually runs on the UI thread.
    let (tx, rx) = sync_channel(1);
    if app
        .run_on_main_thread(move || {
            let _ = MAIN_THREAD_ID.set(std::thread::current().id());
            let _ = tx.send(());
        })
        .is_ok()
    {
        let _ = rx.recv_timeout(Duration::from_secs(2));
    }
    // Fallback: if scheduling failed (tests), still mark current thread.
    let _ = MAIN_THREAD_ID.set(std::thread::current().id());
}

/// Whether the current OS thread is the UI/main thread.
pub fn is_main() -> bool {
    if let Some(id) = MAIN_THREAD_ID.get() {
        return *id == std::thread::current().id();
    }
    // Before install: best-effort platform probe so early code is still safer.
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::NSThread;
        return NSThread::isMainThread_class();
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Synchronous UI work. Blocks the **caller** until the main thread finishes.
///
/// Use from sync code or when already holding no main-thread locks.
/// Prefer [`ui`] from `async` commands so the tokio worker parks instead of
/// blocking a pool thread on a channel when possible.
pub fn run_ui<T, F>(app: &AppHandle, f: F) -> Result<T, RuntimeError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    if is_main() {
        return Ok(f());
    }
    let (tx, rx) = sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|error| RuntimeError(format!("schedule UI work: {error}")))?;
    rx.recv()
        .map_err(|error| RuntimeError(format!("wait for UI work: {error}")))
}

/// Like [`run_ui`] but fails if the main thread does not respond in time.
pub fn run_ui_timeout<T, F>(app: &AppHandle, timeout: Duration, f: F) -> Result<T, RuntimeError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    if is_main() {
        return Ok(f());
    }
    let (tx, rx) = sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|error| RuntimeError(format!("schedule UI work: {error}")))?;
    match rx.recv_timeout(timeout) {
        Ok(value) => Ok(value),
        Err(RecvTimeoutError::Timeout) => Err(RuntimeError(format!(
            "UI work timed out after {timeout:?}"
        ))),
        Err(RecvTimeoutError::Disconnected) => {
            Err(RuntimeError("UI work channel disconnected".into()))
        }
    }
}

/// Fire-and-forget UI work (no result). Prefer for non-critical reassert/focus.
pub fn spawn_ui<F>(app: &AppHandle, f: F)
where
    F: FnOnce() + Send + 'static,
{
    if is_main() {
        f();
        return;
    }
    let _ = app.run_on_main_thread(f);
}

/// Async-friendly UI hop: does not hold a blocking-pool thread while waiting.
///
/// This is the preferred API from `async fn` Tauri commands.
pub async fn ui<T, F>(app: &AppHandle, f: F) -> Result<T, RuntimeError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    if is_main() {
        return Ok(f());
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|error| RuntimeError(format!("schedule UI work: {error}")))?;
    rx.await
        .map_err(|_| RuntimeError("UI work cancelled".into()))
}

/// Run expensive / blocking work on Tokio's blocking pool (not the UI thread).
///
/// Use for capture encode, disk IO, HTTP blocking clients, image resize, etc.
pub async fn blocking<T, F>(f: F) -> Result<T, RuntimeError>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|error| RuntimeError(format!("blocking worker failed: {error}")))
}

// ── Compatibility aliases (screencap / floating_panel call sites) ───────────

/// Legacy name used during the first crash-fix pass.
#[inline]
pub fn run_on_main<T, F>(app: &AppHandle, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    run_ui(app, f).map_err(Into::into)
}
