use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::Emitter;

/// Starts a background thread that polls screen count every 2 seconds.
/// Display changes are emitted for the frontend, but they must not surface the
/// launcher by themselves: macOS sleep/wake and xcap can transiently report a
/// lower count, then recover and look like a fresh attachment.
pub(crate) fn start_display_monitor(handle: tauri::AppHandle) {
    let known_count = Arc::new(AtomicUsize::new(0));
    let _ = thread::Builder::new()
        .name("qx-display-monitor".to_string())
        .spawn(move || {
            // Count through the cheapest platform API. Full xcap inventory is
            // refreshed only after a topology change or by a capture request.
            if let Ok(count) = crate::display::capture_monitor_count() {
                known_count.store(count, Ordering::SeqCst);
            }

            loop {
                thread::sleep(Duration::from_secs(2));

                // Wrap the whole pass in catch_unwind so a panic (e.g. from
                // xcap while a monitor disappears) doesn't silently kill the
                // long-lived Rust monitor.
                let result = std::panic::catch_unwind(AssertUnwindSafe(|| {
                    poll_once(&handle, &known_count);
                }));
                if let Err(payload) = result {
                    let msg = payload
                        .downcast_ref::<&str>()
                        .map(|s| (*s).to_string())
                        .or_else(|| payload.downcast_ref::<String>().map(|s| s.clone()))
                        .unwrap_or_else(|| "<unknown panic>".to_string());
                    eprintln!("[display_monitor] poll panicked: {msg}");
                }
            }
        });
}

fn poll_once(handle: &tauri::AppHandle, known_count: &Arc<AtomicUsize>) {
    let Ok(curr) = crate::display::capture_monitor_count() else {
        return;
    };

    let prev = known_count.load(Ordering::SeqCst);

    if curr == prev {
        return;
    }

    // Populate capture objects only for consumers that need the changed
    // topology. Keep the old count on failure so the daemon retries instead of
    // publishing a change while capture consumers still hold stale objects.
    if crate::display::refresh_capture_monitor_cache().is_err() {
        return;
    }

    known_count.store(curr, Ordering::SeqCst);
    let attached = curr > prev;

    // Keep an open capture picker in sync (single ↔ multi-display fast path).
    // Inventory was just force-refreshed above — no need to re-enumerate.
    crate::screencap::on_display_topology_changed(handle, false);

    // Emit event so the frontend can react too.
    if let Err(e) = handle.emit(
        "display:changed",
        serde_json::json!({
            "attached": attached,
            "count": curr,
            "previous": prev,
        }),
    ) {
        eprintln!("[display_monitor] emit display:changed failed: {e}");
    }
}
