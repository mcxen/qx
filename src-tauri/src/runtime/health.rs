//! Low-frequency event-loop health probe.
//!
//! This is observability, not a restart watchdog: a background thread asks the
//! Tauri event loop to run a no-op and records only stalls/recovery. It never
//! touches user data and writes nothing unless diagnostic logging is enabled.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::AppHandle;

const HEALTH_INTERVAL: Duration = Duration::from_secs(30);
const UI_TIMEOUT: Duration = Duration::from_secs(2);

static STARTED: AtomicBool = AtomicBool::new(false);

pub fn start(app: AppHandle) {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    let result = std::thread::Builder::new()
        .name("qx-runtime-health".to_string())
        .spawn(move || {
            let mut consecutive_stalls = 0_u64;
            loop {
                std::thread::sleep(HEALTH_INTERVAL);
                let started_at = Instant::now();
                match super::run_ui_timeout(&app, UI_TIMEOUT, || ()) {
                    Ok(()) => {
                        if consecutive_stalls > 0 {
                            let (pool_live, pool_queued, media_inflight) =
                                super::pool::pool_stats();
                            crate::diagnostics::log(
                                crate::diagnostics::LogLevel::Info,
                                "runtime.health",
                                "UI event loop recovered",
                                serde_json::json!({
                                    "consecutiveStalls": consecutive_stalls,
                                    "responseMs": started_at.elapsed().as_millis() as u64,
                                    "poolLive": pool_live,
                                    "poolQueued": pool_queued,
                                    "mediaInflight": media_inflight,
                                }),
                            );
                            consecutive_stalls = 0;
                        }
                    }
                    Err(error) => {
                        consecutive_stalls = consecutive_stalls.saturating_add(1);
                        let (pool_live, pool_queued, media_inflight) = super::pool::pool_stats();
                        crate::diagnostics::log(
                            crate::diagnostics::LogLevel::Warn,
                            "runtime.health",
                            "UI event loop did not answer health probe",
                            serde_json::json!({
                                "consecutiveStalls": consecutive_stalls,
                                "timeoutMs": UI_TIMEOUT.as_millis() as u64,
                                "error": error.to_string(),
                                "poolLive": pool_live,
                                "poolQueued": pool_queued,
                                "mediaInflight": media_inflight,
                            }),
                        );
                    }
                }
            }
        });
    if let Err(error) = result {
        STARTED.store(false, Ordering::SeqCst);
        crate::diagnostics::log(
            crate::diagnostics::LogLevel::Warn,
            "runtime.health",
            "failed to start UI event-loop health probe",
            serde_json::json!({ "error": error.to_string() }),
        );
    }
}
