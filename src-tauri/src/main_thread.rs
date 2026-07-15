//! Compatibility shim — prefer [`crate::runtime`].
//!
//! Kept so existing call sites (`crate::main_thread::run_on_main`) compile
//! while modules migrate to `runtime::ui` / `runtime::run_ui`.

pub use crate::runtime::{is_main as is_main_thread, run_on_main, run_ui, spawn_ui, ui};
