//! Focus settlement and scoped protection for OS-owned interactions.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

use super::{hide_and_restore_focus, MAIN_LABEL};

/// Ignore Focused(false) auto-hide until this instant (e.g. after screencap
/// stop: show main then focus flickers and would look like Qx "quit").
static SUPPRESS_AUTO_HIDE_UNTIL: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
/// Sticky suppress while the macOS first-launch permission wizard is open
/// (user spends time in System Settings without hiding Qx).
static ONBOARDING_ACTIVE: AtomicBool = AtomicBool::new(false);
/// Privacy panes end on focus return; file-dialog leases end explicitly.
/// Neither may let a temporary OS focus transfer auto-hide the owner window.
static EXTERNAL_INTERACTIONS: ExternalInteractions = ExternalInteractions::new();
/// Sticky while the screenshot picker intentionally leaves the main Qx window
/// visible so Qx itself can be selected.
static CAPTURE_MAIN_VISIBLE_ACTIVE: AtomicBool = AtomicBool::new(false);
/// Invalidates delayed blur decisions when focus moves between Qx-owned
/// windows. A short settlement delay is required because macOS reports the
/// main panel losing key status before the island becomes key.
static AUTO_HIDE_BLUR_GENERATION: AtomicU64 = AtomicU64::new(0);
const AUTO_HIDE_FOCUS_SETTLE: Duration = Duration::from_millis(80);

fn suppress_auto_hide_lock() -> &'static Mutex<Option<Instant>> {
    SUPPRESS_AUTO_HIDE_UNTIL.get_or_init(|| Mutex::new(None))
}

/// Block auto-hide-on-blur for a short period after programmatically showing
/// the panel (recording stop, region cancel, etc.).
pub fn suppress_auto_hide(duration: Duration) {
    if let Ok(mut guard) = suppress_auto_hide_lock().lock() {
        *guard = Some(Instant::now() + duration);
    }
}

/// Whether Focused(false) should skip auto-hide right now.
pub fn auto_hide_suppressed() -> bool {
    if ONBOARDING_ACTIVE.load(Ordering::SeqCst)
        || EXTERNAL_INTERACTIONS.active()
        || CAPTURE_MAIN_VISIBLE_ACTIVE.load(Ordering::SeqCst)
    {
        return true;
    }
    suppress_auto_hide_lock()
        .lock()
        .ok()
        .and_then(|guard| *guard)
        .map(|until| Instant::now() < until)
        .unwrap_or(false)
}

pub fn set_capture_main_visible_active(active: bool) {
    CAPTURE_MAIN_VISIBLE_ACTIVE.store(active, Ordering::SeqCst);
}

pub fn capture_main_visible_active() -> bool {
    CAPTURE_MAIN_VISIBLE_ACTIVE.load(Ordering::SeqCst)
}

pub(super) fn should_hide_after_focus_settles(
    auto_hide_enabled: bool,
    suppressed: bool,
    main_visible: bool,
    main_focused: bool,
    island_focused: bool,
) -> bool {
    auto_hide_enabled && !suppressed && main_visible && !main_focused && !island_focused
}

/// Cancel a pending outside-Qx blur decision. Call whenever either Qx-owned
/// interactive window becomes focused.
pub fn cancel_pending_auto_hide() {
    AUTO_HIDE_BLUR_GENERATION.fetch_add(1, Ordering::SeqCst);
}

/// Defer auto-hide until the OS has finished moving focus. The main panel and
/// the floating island form one focus group: moving between them must not hide
/// the main panel, while leaving both still follows the user's auto-hide rule.
pub fn request_auto_hide_after_focus_settles(app: &AppHandle) {
    let generation = AUTO_HIDE_BLUR_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(AUTO_HIDE_FOCUS_SETTLE).await;
        if AUTO_HIDE_BLUR_GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }

        let auto_hide_enabled =
            crate::settings::read_settings().appearance.window_behavior == "auto-hide";
        let app_for_ui = app.clone();
        let _ = crate::main_thread::ui(&app, move || {
            // Validate and hide in the same UI transaction. A summon or focus
            // change between a snapshot and a second UI hop must win.
            if AUTO_HIDE_BLUR_GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            let main = app_for_ui.get_webview_window(MAIN_LABEL);
            let island = app_for_ui.get_webview_window("island");
            if should_hide_after_focus_settles(
                auto_hide_enabled,
                auto_hide_suppressed(),
                main.as_ref()
                    .and_then(|window| window.is_visible().ok())
                    .unwrap_or(false),
                main.as_ref()
                    .and_then(|window| window.is_focused().ok())
                    .unwrap_or(false),
                island
                    .as_ref()
                    .and_then(|window| window.is_focused().ok())
                    .unwrap_or(false),
            ) {
                hide_and_restore_focus(&app_for_ui);
            }
        })
        .await;
    });
}

/// Keep the main panel visible while the user grants macOS permissions.
pub fn set_onboarding_active(active: bool) {
    ONBOARDING_ACTIVE.store(active, Ordering::SeqCst);
    if active {
        // Also refresh the timed suppress as a safety net.
        suppress_auto_hide(Duration::from_secs(120));
    }
}

pub fn set_external_interaction_active(active: bool) {
    EXTERNAL_INTERACTIONS
        .focus_return
        .store(active, Ordering::SeqCst);
}

/// Update the external-interaction guard and the native window ordering as one
/// transition. The guard keeps Qx visible while an OS-owned surface is open;
/// the native ordering lets that surface remain in front of Qx.
pub fn set_external_interaction_active_with_app(app: &AppHandle, active: bool) {
    set_external_interaction_active(active);
    apply_external_interaction_window_mode(app);
}

fn apply_external_interaction_window_mode(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let app_for_ui = app.clone();
    let _ = crate::main_thread::run_on_main(app, move || {
        #[cfg(target_os = "macos")]
        super::macos::set_external_interaction_window_mode(
            &app_for_ui,
            EXTERNAL_INTERACTIONS.active(),
        );
    });
}

struct ExternalInteractions {
    focus_return: AtomicBool,
    file_dialogs: AtomicUsize,
}

impl ExternalInteractions {
    const fn new() -> Self {
        Self {
            focus_return: AtomicBool::new(false),
            file_dialogs: AtomicUsize::new(0),
        }
    }

    fn active(&self) -> bool {
        self.focus_return.load(Ordering::SeqCst) || self.file_dialogs.load(Ordering::SeqCst) > 0
    }

    fn set_file_dialog_active(&self, active: bool) {
        if active {
            self.file_dialogs.fetch_add(1, Ordering::SeqCst);
        } else {
            let _ = self
                .file_dialogs
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                    Some(count.saturating_sub(1))
                });
        }
    }
}

pub fn set_file_dialog_active_with_app(app: &AppHandle, active: bool) {
    EXTERNAL_INTERACTIONS.set_file_dialog_active(active);
    // Reject focus-transfer blur work, without changing explicit Esc/hide semantics.
    cancel_pending_auto_hide();
    apply_external_interaction_window_mode(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_dialog_lease_survives_focus_return_and_releases_without_a_timer() {
        let interactions = ExternalInteractions::new();
        interactions.focus_return.store(true, Ordering::SeqCst);
        interactions.set_file_dialog_active(true);
        interactions.focus_return.store(false, Ordering::SeqCst);
        assert!(interactions.active());
        interactions.set_file_dialog_active(false);
        assert!(!interactions.active());
    }

    #[test]
    fn one_dialog_cannot_release_another_dialog_or_privacy_pane() {
        let interactions = ExternalInteractions::new();
        interactions.set_file_dialog_active(true);
        interactions.set_file_dialog_active(true);
        interactions.set_file_dialog_active(false);
        assert!(interactions.active());
        interactions.focus_return.store(true, Ordering::SeqCst);
        interactions.set_file_dialog_active(false);
        assert!(interactions.active());
        interactions.focus_return.store(false, Ordering::SeqCst);
        assert!(!interactions.active());
        interactions.set_file_dialog_active(false);
        assert!(!interactions.active());
    }
}
