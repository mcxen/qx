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

    #[repr(C)]
    #[derive(Default)]
    struct VmStatistics {
        free_count: u32,
        active_count: u32,
        inactive_count: u32,
        wire_count: u32,
        zero_fill_count: u64,
        reactivations: u64,
        pageins: u64,
        pageouts: u64,
        faults: u64,
        cow_faults: u64,
        lookups: u64,
        hits: u64,
        purges: u64,
        purgable_count: u32,
        speculative_count: u32,
        page_size: u32,
    }

    const HOST_VM_INFO64: i32 = 4;
    const PROCESSOR_CPU_LOAD_INFO: i32 = 2;
    type MachPort = libc::c_uint;
    type MachMsgTypeNumber = libc::c_uint;
    type NaturalT = libc::c_uint;

    unsafe extern "C" {
        fn mach_host_self() -> MachPort;
        fn host_statistics64(
            host: MachPort,
            flavor: i32,
            info: *mut VmStatistics,
            count: *mut MachMsgTypeNumber,
        ) -> libc::c_int;
        fn host_processor_info(
            host: MachPort,
            flavor: i32,
            out_processor_count: *mut NaturalT,
            out_processor_info: *mut *mut i32,
            out_processor_info_cnt: *mut MachMsgTypeNumber,
        ) -> libc::c_int;
        fn vm_deallocate(task: MachPort, addr: *mut libc::c_void, size: usize) -> libc::c_int;
    }

    #[derive(Default)]
    struct CpuSample {
        total: u64,
        idle: u64,
    }

    static CPU_SAMPLE: Mutex<CpuSample> = Mutex::new(CpuSample { total: 0, idle: 0 });

    pub fn cpu_usage() -> f32 {
        let mut processor_count = 0;
        let mut info = std::ptr::null_mut();
        let mut info_count = 0;
        let result = unsafe {
            host_processor_info(
                mach_host_self(),
                PROCESSOR_CPU_LOAD_INFO,
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
            vm_deallocate(
                mach_host_self(),
                info.cast(),
                count * 4 * std::mem::size_of::<i32>(),
            );
        }
        let mut previous = CPU_SAMPLE.lock().unwrap_or_else(|value| value.into_inner());
        let delta_total = total.saturating_sub(previous.total);
        let delta_idle = idle.saturating_sub(previous.idle);
        previous.total = total;
        previous.idle = idle;
        if delta_total == 0 {
            0.0
        } else {
            ((delta_total.saturating_sub(delta_idle)) as f32 / delta_total as f32 * 100.0)
                .clamp(0.0, 100.0)
        }
    }

    pub fn memory() -> (f32, f32, f32) {
        let mut stats = VmStatistics::default();
        let mut count = (std::mem::size_of::<VmStatistics>() / 4) as MachMsgTypeNumber;
        if unsafe { host_statistics64(mach_host_self(), HOST_VM_INFO64, &mut stats, &mut count) }
            != 0
        {
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
        let page_size = u64::from(stats.page_size.max(4096));
        let used = u64::from(stats.active_count.saturating_add(stats.wire_count)) * page_size;
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
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
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

#[tauri::command]
pub fn get_system_stats() -> Result<SystemStats, String> {
    let cpu = platform::cpu_usage();
    let (memory, memory_used_gb, memory_total_gb) = platform::memory();
    Ok(SystemStats {
        cpu,
        memory,
        memory_used_gb,
        memory_total_gb,
        gpu: None,
    })
}
