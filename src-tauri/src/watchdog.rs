//! Legacy watchdog argument compatibility.
//!
//! Qx previously copied its own executable and kept that copy running as a
//! recovery watchdog. Windows consequently displayed two Qx-branded processes,
//! and repeated startup/install races could leave additional helpers behind.
//! Runtime health telemetry remains in `runtime::health`; process ownership is
//! now single-instance and no companion Qx executable is spawned.

const WATCHDOG_FLAG: &str = "--qx-watchdog";

/// Exit cleanly if an obsolete shortcut or helper invokes the new binary with
/// the former watchdog flag. Existing old copied helpers supervise only their
/// original parent and disappear when that process exits.
pub(crate) fn maybe_run_from_args() -> bool {
    std::env::args().nth(1).as_deref() == Some(WATCHDOG_FLAG)
}

/// Kept as a narrow compatibility port while callers migrate. No process or
/// thread is created; the Tauri single-instance plugin owns process uniqueness.
pub(crate) fn start() -> Result<(), String> {
    Ok(())
}

pub(crate) fn mark_clean_shutdown() {}
