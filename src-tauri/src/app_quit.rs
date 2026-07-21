//! Process quit policy.
//!
//! Qx is a background helper. On macOS, a single accidental ⌘Q must not tear
//! down the tray process — require two presses within a short window. Windows
//! and explicit programmatic exits still quit immediately.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager};

use crate::clipboard;

/// Window for the second ⌘Q / Quit confirmation (macOS only).
const QUIT_CONFIRM_WINDOW_MS: u64 = 2_500;

static LAST_QUIT_REQUEST_MS: AtomicU64 = AtomicU64::new(0);
/// Once true, further ExitRequested / quit paths must not re-arm confirmation.
static EXITING: AtomicBool = AtomicBool::new(false);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn arm_exit_cleanup(app: &AppHandle) {
    EXITING.store(true, Ordering::SeqCst);
    LAST_QUIT_REQUEST_MS.store(0, Ordering::SeqCst);
    if let Some(flag) = app.try_state::<clipboard::ClipboardShutdown>() {
        flag.0.store(true, Ordering::SeqCst);
    }
}

fn notify_quit_confirm(app: &AppHandle) {
    let _ = app.emit(
        "qx:quit-confirm",
        serde_json::json!({
            "title": "Press ⌘Q again to quit",
            "detail": "Qx stays running in the background. Press ⌘Q twice to fully quit.",
            "windowMs": QUIT_CONFIRM_WINDOW_MS,
        }),
    );
    #[cfg(target_os = "macos")]
    {
        // Best-effort native banner when the main window is hidden.
        let app = app.clone();
        let _ = crate::main_thread::run_on_main(&app, move || {
            let _ = crate::plugin_api::send_host_notification(
                "Qx",
                "Press ⌘Q again to quit",
                "Background helper stays running",
            );
        });
    }
}

/// True when a second confirm press is still inside the arm window.
fn second_press_confirmed() -> bool {
    let now = now_ms();
    let last = LAST_QUIT_REQUEST_MS.load(Ordering::SeqCst);
    last > 0 && now.saturating_sub(last) <= QUIT_CONFIRM_WINDOW_MS
}

fn arm_first_press(app: &AppHandle) {
    LAST_QUIT_REQUEST_MS.store(now_ms(), Ordering::SeqCst);
    notify_quit_confirm(app);
}

/// Tray menu / explicit quit. On macOS the first call only confirms; the second
/// calls `app.exit`. Returns `true` when the process is exiting.
pub fn request_quit(app: &AppHandle) -> bool {
    if EXITING.load(Ordering::SeqCst) {
        return true;
    }

    #[cfg(target_os = "macos")]
    {
        if second_press_confirmed() {
            arm_exit_cleanup(app);
            app.exit(0);
            return true;
        }
        arm_first_press(app);
        return false;
    }

    #[cfg(not(target_os = "macos"))]
    {
        arm_exit_cleanup(app);
        app.exit(0);
        true
    }
}

/// `RunEvent::ExitRequested` path. On confirm, arm cleanup and allow the exit
/// to proceed without nesting another `app.exit`.
pub fn allow_exit_event(app: &AppHandle) -> bool {
    if EXITING.load(Ordering::SeqCst) {
        return true;
    }

    #[cfg(target_os = "macos")]
    {
        if second_press_confirmed() {
            arm_exit_cleanup(app);
            return true;
        }
        arm_first_press(app);
        return false;
    }

    #[cfg(not(target_os = "macos"))]
    {
        arm_exit_cleanup(app);
        true
    }
}
