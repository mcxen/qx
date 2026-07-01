use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tauri::Emitter;

/// Starts a background thread that polls screen count every 2 seconds.
/// When the count increases (external monitor connected), Qx auto-shows.
pub(crate) fn start_display_monitor(handle: tauri::AppHandle) {
    // Snapshot the display count at app startup.
    let known_count = Arc::new(AtomicUsize::new(0));
    let kc = known_count.clone();

    if let Ok(monitors) = xcap::Monitor::all() {
        kc.store(monitors.len(), Ordering::SeqCst);
    }

    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));

        // Wrap the whole pass in catch_unwind so a panic (e.g. from xcap on a
        // monitor going away mid-enumeration) doesn't silently kill the
        // monitoring thread. We log and keep polling.
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
    });
}

fn poll_once(handle: &tauri::AppHandle, known_count: &Arc<AtomicUsize>) {
    let Ok(monitors) = xcap::Monitor::all() else {
        return;
    };

    let prev = known_count.load(Ordering::SeqCst);
    let curr = monitors.len();

    if curr == prev {
        return;
    }

    known_count.store(curr, Ordering::SeqCst);
    let attached = curr > prev;

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

    // Auto-show Qx when an external monitor is connected. The monitor poller
    // runs on a background thread, while AppKit window operations must run on
    // the main thread.
    if attached {
        let app = handle.clone();
        if let Err(e) = handle.run_on_main_thread(move || {
            crate::floating_panel::show_floating(&app);
        }) {
            eprintln!("[display_monitor] schedule auto-show failed: {e}");
        }
    }
}
