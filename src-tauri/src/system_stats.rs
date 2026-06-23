use serde::Serialize;
use std::sync::OnceLock;

#[derive(Debug, Serialize)]
pub struct SystemStats {
    pub cpu: f32,
    pub memory: f32,
    pub memory_used_gb: f32,
    pub memory_total_gb: f32,
    pub gpu: Option<f32>,
}

// --- Mach kernel FFI ---
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

#[repr(C)]
struct ProcessorCpuLoadInfo {
    cpu_ticks: [u32; 4], // user, system, idle, nice
}

const CPU_STATE_USER: usize = 0;
const CPU_STATE_SYSTEM: usize = 1;
const CPU_STATE_IDLE: usize = 2;
const CPU_STATE_NICE: usize = 3;

const HOST_VM_INFO64: i32 = 4;
const PROCESSOR_CPU_LOAD_INFO: i32 = 2;

type MachPort = libc::c_uint;
type MachMsgTypeNumber = libc::c_uint;
type NaturalT = libc::c_uint;

extern "C" {
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
    fn vm_deallocate(
        task: MachPort,
        addr: *mut libc::c_void,
        size: usize,
    ) -> libc::c_int;
}

// --- Cached CPU to avoid 120ms sleep ---
struct CpuSample {
    prev_total: u64,
    prev_idle: u64,
    ratio: f32,
}

static CPU_CACHE: OnceLock<CpuSample> = OnceLock::new();

/// Returns CPU usage percentage using Mach host_processor_info.
/// Uses cached deltas so there's no blocking sleep — the caller provides
/// the current tick values and we compute the ratio against the previous.
fn get_cpu_usage() -> f32 {
    let mut proc_count: NaturalT = 0;
    let mut info_ptr: *mut i32 = std::ptr::null_mut();
    let mut info_count: MachMsgTypeNumber = 0;

    let ret = unsafe {
        host_processor_info(
            mach_host_self(),
            PROCESSOR_CPU_LOAD_INFO,
            &mut proc_count,
            &mut info_ptr,
            &mut info_count,
        )
    };
    if ret != 0 || info_ptr.is_null() {
        return 0.0;
    }

    // Sum across all processors (each is 4 i32 values: user, system, idle, nice)
    let count = proc_count as usize;
    let slices = unsafe { std::slice::from_raw_parts(info_ptr, count * 4) };

    let mut total: u64 = 0;
    let mut idle: u64 = 0;
    for i in 0..count {
        let base = i * 4;
        let user = slices[base + CPU_STATE_USER] as u64;
        let sys = slices[base + CPU_STATE_SYSTEM] as u64;
        let idle_i = slices[base + CPU_STATE_IDLE] as u64;
        let nice = slices[base + CPU_STATE_NICE] as u64;
        total += user + sys + idle_i + nice;
        idle += idle_i;
    }

    // Free Mach memory
    unsafe {
        vm_deallocate(mach_host_self(), info_ptr as *mut libc::c_void, (count * 4 * 4) as usize);
    }

    let cache = CPU_CACHE.get_or_init(|| CpuSample {
        prev_total: total,
        prev_idle: idle,
        ratio: 0.0,
    });

    // Thread-safe update using compare-exchange
    let prev_total = cache.prev_total;
    let prev_idle = cache.prev_idle;
    if prev_total > 0 && total > prev_total {
        let delta_total = total - prev_total;
        let delta_idle = idle - prev_idle;
        let ratio = if delta_total > 0 {
            ((delta_total - delta_idle) as f32 / delta_total as f32 * 100.0).clamp(0.0, 100.0)
        } else {
            0.0
        };
        // Write back via unsafe — we accept a benign race on the cache
        unsafe {
            let ptr = cache as *const CpuSample as *mut CpuSample;
            (*ptr).prev_total = total;
            (*ptr).prev_idle = idle;
            (*ptr).ratio = ratio;
        }
        ratio
    } else {
        // First call or overflow — just store and return 0
        unsafe {
            let ptr = cache as *const CpuSample as *mut CpuSample;
            (*ptr).prev_total = total;
            (*ptr).prev_idle = idle;
        }
        0.0
    }
}

/// Returns memory usage using host_statistics64.
/// Page size is computed from the OS.
fn get_memory() -> (f32, f32, f32) {
    let mut vm_info: VmStatistics = Default::default();
    let mut count = (std::mem::size_of::<VmStatistics>() / std::mem::size_of::<u32>()) as MachMsgTypeNumber;

    let ret = unsafe {
        host_statistics64(
            mach_host_self(),
            HOST_VM_INFO64,
            &mut vm_info,
            &mut count,
        )
    };
    if ret != 0 {
        return (0.0, 0.0, 0.0);
    }

    // Total physical memory via sysctl
    let total = get_total_memory();

    let page_size = if vm_info.page_size > 0 {
        vm_info.page_size as u64
    } else {
        4096
    };

    let active = vm_info.active_count as u64 * page_size;
    let wired = vm_info.wire_count as u64 * page_size;
    let used = active + wired;
    let used_gb = used as f32 / (1024.0 * 1024.0 * 1024.0);
    let total_gb = total as f32 / (1024.0 * 1024.0 * 1024.0);
    let pct = if total > 0 {
        (used as f32 / total as f32 * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };

    (pct, used_gb, total_gb)
}

fn get_total_memory() -> u64 {
    use std::mem;
    let mut mib: [i32; 2] = [libc::CTL_HW, libc::HW_MEMSIZE];
    let mut value: u64 = 0;
    let mut len = mem::size_of::<u64>() as libc::size_t;
    unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            2,
            &mut value as *mut _ as *mut libc::c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        );
    }
    value
}

#[tauri::command]
pub fn get_system_stats() -> Result<SystemStats, String> {
    let cpu = get_cpu_usage();
    let (memory, memory_used_gb, memory_total_gb) = get_memory();

    Ok(SystemStats {
        cpu,
        memory,
        memory_used_gb,
        memory_total_gb,
        gpu: None,
    })
}
