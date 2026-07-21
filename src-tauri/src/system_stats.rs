use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SystemStats {
    pub cpu: f32,
    pub memory: f32,
    pub memory_used_gb: f32,
    pub memory_total_gb: f32,
    pub gpu: Option<f32>,
}

#[cfg(target_os = "macos")]
mod platform {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    // Multiple consumers (Home Island, tray, and plugins) can request the same
    // process-wide Mach CPU counter at almost the same instant. A second read a
    // few milliseconds later is quantized noise, not a new utilization sample.
    const MIN_CPU_SAMPLE_INTERVAL: Duration = Duration::from_millis(750);

    unsafe extern "C" {
        fn mach_host_self() -> libc::mach_port_t;
        static mach_task_self_: libc::mach_port_t;
    }

    #[derive(Default)]
    struct CpuSample {
        total: u64,
        idle: u64,
        usage: f32,
        sampled_at: Option<Instant>,
    }

    static CPU_SAMPLE: Mutex<CpuSample> = Mutex::new(CpuSample {
        total: 0,
        idle: 0,
        usage: 0.0,
        sampled_at: None,
    });

    fn usage_from_ticks(
        previous_total: u64,
        previous_idle: u64,
        total: u64,
        idle: u64,
    ) -> Option<f32> {
        let delta_total = total.checked_sub(previous_total)?;
        let delta_idle = idle.checked_sub(previous_idle)?;
        if delta_total == 0 || delta_idle > delta_total {
            return None;
        }
        Some(((delta_total - delta_idle) as f32 / delta_total as f32 * 100.0).clamp(0.0, 100.0))
    }

    pub fn cpu_usage() -> f32 {
        let mut processor_count = 0;
        let mut info = std::ptr::null_mut();
        let mut info_count = 0;
        let result = unsafe {
            libc::host_processor_info(
                mach_host_self(),
                libc::PROCESSOR_CPU_LOAD_INFO,
                &mut processor_count,
                &mut info,
                &mut info_count,
            )
        };
        if result != 0 || info.is_null() {
            return 0.0;
        }
        let count = processor_count as usize;
        let ticks = unsafe { std::slice::from_raw_parts(info, count * 4) };
        let mut total = 0u64;
        let mut idle = 0u64;
        for cpu in 0..count {
            let base = cpu * 4;
            for state in 0..4 {
                total = total.saturating_add(ticks[base + state] as u64);
            }
            idle = idle.saturating_add(ticks[base + 2] as u64);
        }
        unsafe {
            libc::vm_deallocate(
                mach_task_self_,
                info as libc::vm_address_t,
                count * 4 * std::mem::size_of::<i32>(),
            );
        }
        let mut previous = CPU_SAMPLE.lock().unwrap_or_else(|value| value.into_inner());
        let now = Instant::now();
        if previous
            .sampled_at
            .is_some_and(|sampled_at| now.duration_since(sampled_at) < MIN_CPU_SAMPLE_INTERVAL)
        {
            return previous.usage;
        }
        let usage =
            usage_from_ticks(previous.total, previous.idle, total, idle).unwrap_or(previous.usage);
        previous.total = total;
        previous.idle = idle;
        previous.usage = usage;
        previous.sampled_at = Some(now);
        usage
    }

    pub fn memory() -> (f32, f32, f32) {
        // Use libc's SDK-matched definition. The old hand-written struct had
        // speculative/purgeable fields in the wrong order and invented a
        // page_size tail field, so every value after wire_count was misread.
        let mut stats: libc::vm_statistics64 = unsafe { std::mem::zeroed() };
        let mut count = libc::HOST_VM_INFO64_COUNT;
        let result = unsafe {
            libc::host_statistics64(
                mach_host_self(),
                libc::HOST_VM_INFO64,
                (&mut stats as *mut libc::vm_statistics64).cast(),
                &mut count,
            )
        };
        if result != 0 {
            return (0.0, 0.0, 0.0);
        }
        let mut mib = [libc::CTL_HW, libc::HW_MEMSIZE];
        let mut total = 0u64;
        let mut len = std::mem::size_of::<u64>() as libc::size_t;
        unsafe {
            libc::sysctl(
                mib.as_mut_ptr(),
                2,
                (&mut total as *mut u64).cast(),
                &mut len,
                std::ptr::null_mut(),
                0,
            );
        }
        let mut page_size = 0i32;
        let mut page_size_len = std::mem::size_of::<i32>() as libc::size_t;
        let mut page_size_mib = [libc::CTL_HW, libc::HW_PAGESIZE];
        let page_size_result = unsafe {
            libc::sysctl(
                page_size_mib.as_mut_ptr(),
                2,
                (&mut page_size as *mut i32).cast(),
                &mut page_size_len,
                std::ptr::null_mut(),
                0,
            )
        };
        if page_size_result != 0 || page_size <= 0 {
            return (0.0, 0.0, 0.0);
        }
        let used_pages = u64::from(stats.active_count)
            .saturating_add(u64::from(stats.inactive_count))
            .saturating_add(u64::from(stats.wire_count))
            .saturating_add(u64::from(stats.compressor_page_count));
        values_from_pages(used_pages, page_size as u64, total)
    }

    fn values_from_pages(used_pages: u64, page_size: u64, total: u64) -> (f32, f32, f32) {
        let used = used_pages.saturating_mul(page_size).min(total);
        values(used, total)
    }

    fn values(used: u64, total: u64) -> (f32, f32, f32) {
        let gib = 1024.0 * 1024.0 * 1024.0;
        let percent = if total == 0 {
            0.0
        } else {
            used as f32 / total as f32 * 100.0
        };
        (
            percent.clamp(0.0, 100.0),
            used as f32 / gib,
            total as f32 / gib,
        )
    }

    #[cfg(test)]
    mod tests {
        use super::{usage_from_ticks, values_from_pages};

        #[test]
        fn cpu_usage_uses_only_the_latest_tick_delta() {
            assert_eq!(usage_from_ticks(1_000, 800, 1_100, 850), Some(50.0));
            assert_eq!(usage_from_ticks(1_100, 850, 1_100, 850), None);
            assert_eq!(usage_from_ticks(1_100, 850, 1_000, 800), None);
        }

        #[test]
        fn memory_pages_use_the_real_page_size_and_clamp_to_physical_ram() {
            let (percent, used_gib, total_gib) =
                values_from_pages(768, 16 * 1024, 16 * 1024 * 1024);
            assert_eq!(percent, 75.0);
            assert!((used_gib - 0.01171875).abs() < f32::EPSILON);
            assert!((total_gib - 0.015625).abs() < f32::EPSILON);

            let (clamped_percent, clamped_used, _) = values_from_pages(2_000, 16_384, 16_384);
            assert_eq!(clamped_percent, 100.0);
            assert_eq!(clamped_used, 16_384.0 / 1024.0 / 1024.0 / 1024.0);
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::sync::Mutex;
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows_sys::Win32::System::Threading::GetSystemTimes;

    #[derive(Default)]
    struct CpuSample {
        total: u64,
        idle: u64,
    }
    static CPU_SAMPLE: Mutex<CpuSample> = Mutex::new(CpuSample { total: 0, idle: 0 });

    fn filetime(value: FILETIME) -> u64 {
        (u64::from(value.dwHighDateTime) << 32) | u64::from(value.dwLowDateTime)
    }

    pub fn cpu_usage() -> f32 {
        let mut idle = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let mut kernel = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let mut user = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        if unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) } == 0 {
            return 0.0;
        }
        let idle = filetime(idle);
        let total = filetime(kernel).saturating_add(filetime(user));
        let mut previous = CPU_SAMPLE.lock().unwrap_or_else(|value| value.into_inner());
        let delta_total = total.saturating_sub(previous.total);
        let delta_idle = idle.saturating_sub(previous.idle);
        previous.total = total;
        previous.idle = idle;
        if delta_total == 0 {
            0.0
        } else {
            (delta_total.saturating_sub(delta_idle) as f32 / delta_total as f32 * 100.0)
                .clamp(0.0, 100.0)
        }
    }

    pub fn memory() -> (f32, f32, f32) {
        let mut status = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..unsafe { std::mem::zeroed() }
        };
        if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
            return (0.0, 0.0, 0.0);
        }
        let total = status.ullTotalPhys;
        let used = total.saturating_sub(status.ullAvailPhys);
        let gib = 1024.0 * 1024.0 * 1024.0;
        (
            status.dwMemoryLoad as f32,
            used as f32 / gib,
            total as f32 / gib,
        )
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub fn cpu_usage() -> f32 {
        0.0
    }
    pub fn memory() -> (f32, f32, f32) {
        (0.0, 0.0, 0.0)
    }
}

/// Synchronous sample for tray labels / short-lived callers (off UI thread preferred).
pub fn platform_cpu_memory_sync() -> SystemStats {
    let cpu = platform::cpu_usage();
    let (memory, memory_used_gb, memory_total_gb) = platform::memory();
    SystemStats {
        cpu,
        memory,
        memory_used_gb,
        memory_total_gb,
        gpu: None,
    }
}

#[tauri::command]
pub async fn get_system_stats() -> Result<SystemStats, String> {
    tauri::async_runtime::spawn_blocking(platform_cpu_memory_sync)
        .await
        .map_err(|error| format!("system stats worker failed: {error}"))
}
