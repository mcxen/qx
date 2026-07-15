//! Process runtime scheduling — system foundation for thread-safe UI + multi-thread work.
//!
//! # Why this exists
//!
//! Tauri `#[command]` handlers (especially `async`) run on **tokio workers**, not the
//! process UI thread. On macOS, AppKit (`NSWindow` show/hide/orderFront/setLevel,
//! pasteboard) **aborts with SIGTRAP** when called off-main:
//! `"Must only be used from the main thread"`.
//!
//! Modules must not invent their own thread checks. Use this crate-level service.
//!
//! # Split of responsibilities
//!
//! | Work | API | Thread |
//! |------|-----|--------|
//! | Window / panel / clipboard UI | [`ui`] / [`run_ui`] / [`spawn_ui`] | Main (AppKit / message pump) |
//! | CPU / disk / encode / network blocking | [`blocking`] | Tokio blocking pool |
//! | Lightweight pure logic | inline in the command | Current (async worker OK) |
//!
//! # Module pattern
//!
//! ```ignore
//! #[command]
//! pub async fn my_feature(app: AppHandle) -> Result<Out, String> {
//!     // 1) heavy work off the async pool
//!     let data = runtime::blocking(|| load_or_encode()).await?;
//!     // 2) single UI hop for all surface mutations
//!     runtime::ui(&app, move || {
//!         floating_panel::show_and_navigate_now(&app, "route");
//!         Ok(data)
//!     }).await
//! }
//! ```
//!
//! Prefer **one** [`ui`] transaction per user-visible transition (show island +
//! hide picker + navigate) over many small hops.
//!
//! # Install
//!
//! Call [`install`] once from app setup so main-thread identity is known on all
//! platforms (not only macOS `NSThread`).

mod main_thread;

pub use main_thread::{
    blocking, install, is_main, run_on_main, run_ui, run_ui_timeout, spawn_ui, ui, RuntimeError,
};
