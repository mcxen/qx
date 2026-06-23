use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use sysinfo::System;

#[derive(Debug, Serialize)]
pub struct SystemStats {
    pub cpu: f32,
    pub memory: f32,
    pub memory_used_gb: f32,
    pub memory_total_gb: f32,
    pub gpu: Option<f32>,
}

static SYSTEM: OnceLock<Mutex<System>> = OnceLock::new();

fn system() -> &'static Mutex<System> {
    SYSTEM.get_or_init(|| Mutex::new(System::new_all()))
}

#[tauri::command]
pub fn get_system_stats() -> Result<SystemStats, String> {
    {
        let mut sys = system().lock().map_err(|e| format!("system lock: {e}"))?;
        sys.refresh_cpu();
    }
    thread::sleep(Duration::from_millis(120));

    let mut sys = system().lock().map_err(|e| format!("system lock: {e}"))?;
    sys.refresh_cpu();
    sys.refresh_memory();

    let cpu = sys.global_cpu_info().cpu_usage().clamp(0.0, 100.0);
    let total = sys.total_memory() as f32;
    let used = sys.used_memory() as f32;
    let memory = if total > 0.0 {
        (used / total * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };
    let gib = 1024.0 * 1024.0 * 1024.0;

    Ok(SystemStats {
        cpu,
        memory,
        memory_used_gb: used / gib,
        memory_total_gb: total / gib,
        gpu: None,
    })
}
