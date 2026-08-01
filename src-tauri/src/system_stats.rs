use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SystemStats {
    pub cpu: f32,
    pub memory: f32,
    pub memory_used_gb: f32,
    pub memory_total_gb: f32,
    pub memory_pressure: String,
    pub memory_pressure_level: i32,
    pub swap_used_gb: f32,
    pub swap_total_gb: f32,
    pub gpu: Option<f32>,
}

struct MemorySample {
    percent: f32,
    used_gb: f32,
    total_gb: f32,
    pressure: String,
    pressure_level: i32,
    swap_used_gb: f32,
    swap_total_gb: f32,
}

#[cfg(target_os = "macos")]
mod platform {
    use super::MemorySample;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    // Multiple consumers (Home Island, tray, and plugins) can request the same
    // process-wide Mach CPU counter at almost the same instant. A second read a
    // few milliseconds later is quantized noise, not a new utilization sample.
    const MIN_CPU_SAMPLE_INTERVAL: Duration = Duration::from_millis(750);

    unsafe extern "C" {
        fn mach_host_self() -> libc::mach_port_t;
    }

    #[derive(Default)]
    struct CpuSample {
        ticks: [u64; 4],
        usage: f32,
        sampled_at: Option<Instant>,
    }

    static CPU_SAMPLE: Mutex<CpuSample> = Mutex::new(CpuSample {
        ticks: [0; 4],
        usage: 0.0,
        sampled_at: None,
    });

    fn usage_from_ticks(previous: [u64; 4], current: [u64; 4]) -> Option<f32> {
        let mut delta = [0u64; 4];
        for index in 0..delta.len() {
            delta[index] = current[index].checked_sub(previous[index])?;
        }
        let total = delta.iter().copied().sum::<u64>();
        if total == 0 {
            return None;
        }
        // Match Stats: total load is user + system. Nice remains part of the
        // denominator but is exposed neither as user nor system utilization.
        let busy = delta[libc::CPU_STATE_USER as usize]
            .saturating_add(delta[libc::CPU_STATE_SYSTEM as usize]);
        Some((busy as f32 / total as f32 * 100.0).clamp(0.0, 100.0))
    }

    pub fn cpu_usage() -> f32 {
        let mut info: libc::host_cpu_load_info = unsafe { std::mem::zeroed() };
        let mut info_count = libc::HOST_CPU_LOAD_INFO_COUNT;
        let result = unsafe {
            libc::host_statistics(
                mach_host_self(),
                libc::HOST_CPU_LOAD_INFO,
                (&mut info as *mut libc::host_cpu_load_info).cast(),
                &mut info_count,
            )
        };
        if result != 0 {
            return 0.0;
        }
        let ticks = info.cpu_ticks.map(u64::from);
        let mut previous = CPU_SAMPLE.lock().unwrap_or_else(|value| value.into_inner());
        let now = Instant::now();
        if previous
            .sampled_at
            .is_some_and(|sampled_at| now.duration_since(sampled_at) < MIN_CPU_SAMPLE_INTERVAL)
        {
            return previous.usage;
        }
        let usage = if previous.sampled_at.is_some() {
            usage_from_ticks(previous.ticks, ticks).unwrap_or(previous.usage)
        } else {
            0.0
        };
        previous.ticks = ticks;
        previous.usage = usage;
        previous.sampled_at = Some(now);
        usage
    }

    pub fn memory() -> MemorySample {
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
            return unavailable_memory();
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
            return unavailable_memory();
        }
        // Match Stats and Activity Monitor semantics: purgeable and external
        // (file-backed cache) pages are reclaimable and must not inflate usage.
        let used_pages = used_pages(
            u64::from(stats.active_count),
            u64::from(stats.inactive_count),
            u64::from(stats.speculative_count),
            u64::from(stats.wire_count),
            u64::from(stats.compressor_page_count),
            u64::from(stats.purgeable_count),
            u64::from(stats.external_page_count),
        );
        let (percent, used_gb, total_gb) = values_from_pages(used_pages, page_size as u64, total);
        let pressure_level = memory_pressure_level();
        let (swap_used_gb, swap_total_gb) = swap_usage_gb();
        MemorySample {
            percent,
            used_gb,
            total_gb,
            pressure: pressure_name(pressure_level).to_string(),
            pressure_level,
            swap_used_gb,
            swap_total_gb,
        }
    }

    fn used_pages(
        active: u64,
        inactive: u64,
        speculative: u64,
        wired: u64,
        compressed: u64,
        purgeable: u64,
        external: u64,
    ) -> u64 {
        active
            .saturating_add(inactive)
            .saturating_add(speculative)
            .saturating_add(wired)
            .saturating_add(compressed)
            .saturating_sub(purgeable.saturating_add(external))
    }

    fn memory_pressure_level() -> i32 {
        let mut level = 0i32;
        let mut len = std::mem::size_of::<i32>() as libc::size_t;
        let result = unsafe {
            libc::sysctlbyname(
                b"kern.memorystatus_vm_pressure_level\0".as_ptr().cast(),
                (&mut level as *mut i32).cast(),
                &mut len,
                std::ptr::null_mut(),
                0,
            )
        };
        if result == 0 {
            level
        } else {
            0
        }
    }

    fn pressure_name(level: i32) -> &'static str {
        match level {
            2 => "warning",
            4 => "critical",
            _ => "normal",
        }
    }

    fn swap_usage_gb() -> (f32, f32) {
        let mut swap: libc::xsw_usage = unsafe { std::mem::zeroed() };
        let mut len = std::mem::size_of::<libc::xsw_usage>() as libc::size_t;
        let result = unsafe {
            libc::sysctlbyname(
                b"vm.swapusage\0".as_ptr().cast(),
                (&mut swap as *mut libc::xsw_usage).cast(),
                &mut len,
                std::ptr::null_mut(),
                0,
            )
        };
        if result != 0 {
            return (0.0, 0.0);
        }
        let gib = 1024.0 * 1024.0 * 1024.0;
        (swap.xsu_used as f32 / gib, swap.xsu_total as f32 / gib)
    }

    fn unavailable_memory() -> MemorySample {
        MemorySample {
            percent: 0.0,
            used_gb: 0.0,
            total_gb: 0.0,
            pressure: "unknown".to_string(),
            pressure_level: 0,
            swap_used_gb: 0.0,
            swap_total_gb: 0.0,
        }
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
        use super::{pressure_name, usage_from_ticks, used_pages, values_from_pages};

        #[test]
        fn cpu_usage_uses_only_the_latest_tick_delta() {
            assert_eq!(
                usage_from_ticks([1_000, 500, 8_000, 20], [1_050, 550, 8_100, 20]),
                Some(50.0)
            );
            assert_eq!(
                usage_from_ticks([1_050, 550, 8_100, 20], [1_050, 550, 8_100, 20]),
                None
            );
            assert_eq!(
                usage_from_ticks([1_050, 550, 8_100, 20], [1_000, 500, 8_000, 20]),
                None
            );
        }

        #[test]
        fn memory_usage_excludes_reclaimable_cache_pages() {
            assert_eq!(used_pages(100, 80, 10, 40, 30, 20, 50), 190);
        }

        #[test]
        fn pressure_names_match_macos_levels() {
            assert_eq!(pressure_name(0), "normal");
            assert_eq!(pressure_name(2), "warning");
            assert_eq!(pressure_name(4), "critical");
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
    use super::MemorySample;
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

    pub fn memory() -> MemorySample {
        let mut status = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..unsafe { std::mem::zeroed() }
        };
        if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
            return MemorySample {
                percent: 0.0,
                used_gb: 0.0,
                total_gb: 0.0,
                pressure: "unknown".to_string(),
                pressure_level: 0,
                swap_used_gb: 0.0,
                swap_total_gb: 0.0,
            };
        }
        let total = status.ullTotalPhys;
        let used = total.saturating_sub(status.ullAvailPhys);
        let gib = 1024.0 * 1024.0 * 1024.0;
        let pressure_level = if status.dwMemoryLoad >= 95 {
            4
        } else if status.dwMemoryLoad >= 80 {
            2
        } else {
            0
        };
        MemorySample {
            percent: status.dwMemoryLoad as f32,
            used_gb: used as f32 / gib,
            total_gb: total as f32 / gib,
            pressure: match pressure_level {
                4 => "critical",
                2 => "warning",
                _ => "normal",
            }
            .to_string(),
            pressure_level,
            swap_used_gb: 0.0,
            swap_total_gb: 0.0,
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::MemorySample;

    pub fn cpu_usage() -> f32 {
        0.0
    }
    pub fn memory() -> MemorySample {
        MemorySample {
            percent: 0.0,
            used_gb: 0.0,
            total_gb: 0.0,
            pressure: "unknown".to_string(),
            pressure_level: 0,
            swap_used_gb: 0.0,
            swap_total_gb: 0.0,
        }
    }
}

/// Synchronous sample for tray labels / short-lived callers (off UI thread preferred).
pub fn platform_cpu_memory_sync() -> SystemStats {
    let cpu = platform::cpu_usage();
    let memory = platform::memory();
    SystemStats {
        cpu,
        memory: memory.percent,
        memory_used_gb: memory.used_gb,
        memory_total_gb: memory.total_gb,
        memory_pressure: memory.pressure,
        memory_pressure_level: memory.pressure_level,
        swap_used_gb: memory.swap_used_gb,
        swap_total_gb: memory.swap_total_gb,
        gpu: None,
    }
}

#[tauri::command]
pub async fn get_system_stats() -> Result<SystemStats, String> {
    tauri::async_runtime::spawn_blocking(platform_cpu_memory_sync)
        .await
        .map_err(|error| format!("system stats worker failed: {error}"))
}

#[cfg(all(test, target_os = "macos"))]
mod native_tests {
    use super::platform_cpu_memory_sync;
    use std::time::Duration;

    #[test]
    fn native_snapshot_reports_physical_memory_and_a_bounded_cpu_delta() {
        let first = platform_cpu_memory_sync();
        std::thread::sleep(Duration::from_millis(800));
        let second = platform_cpu_memory_sync();

        assert!(first.memory_total_gb > 0.0);
        assert!((0.0..=100.0).contains(&first.memory));
        assert!((0.0..=100.0).contains(&second.cpu));
        assert!(matches!(
            first.memory_pressure.as_str(),
            "normal" | "warning" | "critical"
        ));
        assert!(first.swap_used_gb <= first.swap_total_gb);
    }
}
