use std::ffi::c_void;
use std::mem::{size_of, zeroed};
use std::net::Ipv4Addr;
use std::ptr::{null, null_mut};
use std::slice;

use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_BUFFER_OVERFLOW, INVALID_HANDLE_VALUE, NO_ERROR,
};
use windows_sys::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GetAdaptersAddresses, GetIfTable2, GAA_FLAG_SKIP_ANYCAST,
    GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST, IF_TYPE_SOFTWARE_LOOPBACK,
    IP_ADAPTER_ADDRESSES_LH, MIB_IF_TABLE2,
};
use windows_sys::Win32::NetworkManagement::Ndis::IfOperStatusUp;
use windows_sys::Win32::Networking::WinSock::{IpDadStatePreferred, AF_INET, SOCKADDR_IN};
use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
use windows_sys::Win32::System::Registry::{
    RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
};
use windows_sys::Win32::System::SystemInformation::{
    CacheData, CacheInstruction, CacheUnified, ComputerNamePhysicalDnsHostname, GetComputerNameExW,
    GetLogicalProcessorInformationEx, GlobalMemoryStatusEx, RelationAll, RelationCache,
    RelationProcessorCore, MEMORYSTATUSEX, SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
};

use super::{
    format_gb, QxCpuCacheInfo, QxNetworkCounter, QxNetworkCounters, QxNetworkDevice, QxNetworkInfo,
    QxProcessInfo, QxProcessList, QxStorageInfo, QxSystemInfo,
};

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn wide_slice(value: &[u16]) -> String {
    let length = value
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..length])
}

unsafe fn wide_ptr(value: *const u16) -> String {
    if value.is_null() {
        return String::new();
    }
    let mut length = 0usize;
    while *value.add(length) != 0 {
        length += 1;
    }
    String::from_utf16_lossy(slice::from_raw_parts(value, length))
}

fn registry_string(subkey: &str, value_name: &str) -> Option<String> {
    let subkey = wide(subkey);
    let value_name = wide(value_name);
    let mut byte_count = 0u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value_name.as_ptr(),
            RRF_RT_REG_SZ,
            null_mut(),
            null_mut(),
            &mut byte_count,
        )
    };
    if status != NO_ERROR || byte_count < 2 {
        return None;
    }
    let mut buffer = vec![0u16; byte_count as usize / 2];
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value_name.as_ptr(),
            RRF_RT_REG_SZ,
            null_mut(),
            buffer.as_mut_ptr().cast::<c_void>(),
            &mut byte_count,
        )
    };
    (status == NO_ERROR)
        .then(|| wide_slice(&buffer).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn registry_dword(subkey: &str, value_name: &str) -> Option<u32> {
    let subkey = wide(subkey);
    let value_name = wide(value_name);
    let mut value = 0u32;
    let mut byte_count = size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value_name.as_ptr(),
            RRF_RT_REG_DWORD,
            null_mut(),
            (&mut value as *mut u32).cast::<c_void>(),
            &mut byte_count,
        )
    };
    (status == NO_ERROR).then_some(value)
}

fn memory_status() -> Result<MEMORYSTATUSEX, String> {
    let mut status: MEMORYSTATUSEX = unsafe { zeroed() };
    status.dwLength = size_of::<MEMORYSTATUSEX>() as u32;
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return Err("GlobalMemoryStatusEx failed".to_string());
    }
    Ok(status)
}

fn hostname() -> String {
    let mut length = 0u32;
    unsafe {
        GetComputerNameExW(ComputerNamePhysicalDnsHostname, null_mut(), &mut length);
    }
    if length == 0 {
        return std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Unknown".to_string());
    }
    let mut buffer = vec![0u16; length as usize + 1];
    if unsafe {
        GetComputerNameExW(
            ComputerNamePhysicalDnsHostname,
            buffer.as_mut_ptr(),
            &mut length,
        )
    } == 0
    {
        return std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Unknown".to_string());
    }
    wide_slice(&buffer)
}

fn processor_topology() -> (Option<u32>, Option<u64>, Vec<QxCpuCacheInfo>) {
    let mut byte_count = 0u32;
    unsafe {
        GetLogicalProcessorInformationEx(RelationAll, null_mut(), &mut byte_count);
    }
    if byte_count == 0 {
        return (None, None, Vec::new());
    }
    let word_size = size_of::<usize>();
    let mut buffer = vec![0usize; (byte_count as usize + word_size - 1) / word_size];
    if unsafe {
        GetLogicalProcessorInformationEx(
            RelationAll,
            buffer
                .as_mut_ptr()
                .cast::<SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>(),
            &mut byte_count,
        )
    } == 0
    {
        return (None, None, Vec::new());
    }

    let mut offset = 0usize;
    let mut physical_cores = 0u32;
    let mut cache_line_bytes = None;
    let mut caches = Vec::new();
    while offset + size_of::<SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>() <= byte_count as usize {
        let info = unsafe {
            &*(buffer.as_ptr().cast::<u8>().add(offset)
                as *const SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX)
        };
        if info.Size == 0 {
            break;
        }
        if info.Relationship == RelationProcessorCore {
            physical_cores = physical_cores.saturating_add(1);
        } else if info.Relationship == RelationCache {
            let cache = unsafe { info.Anonymous.Cache };
            let kind = if cache.Type == CacheUnified {
                "unified"
            } else if cache.Type == CacheInstruction {
                "instruction"
            } else if cache.Type == CacheData {
                "data"
            } else {
                "trace"
            };
            if cache.LineSize > 0 {
                cache_line_bytes =
                    Some(cache_line_bytes.unwrap_or(0).max(u64::from(cache.LineSize)));
            }
            caches.push(QxCpuCacheInfo {
                level: cache.Level,
                kind: kind.to_string(),
                size_bytes: u64::from(cache.CacheSize),
                scope: None,
            });
        }
        offset = offset.saturating_add(info.Size as usize);
    }
    caches.sort_by(|left, right| {
        left.level
            .cmp(&right.level)
            .then_with(|| left.kind.cmp(&right.kind))
    });
    (
        (physical_cores > 0).then_some(physical_cores),
        cache_line_bytes,
        caches,
    )
}

pub(super) fn system_info() -> Result<QxSystemInfo, String> {
    const CPU_KEY: &str = r"HARDWARE\DESCRIPTION\System\CentralProcessor\0";
    const OS_KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion";
    const BIOS_KEY: &str = r"HARDWARE\DESCRIPTION\System\BIOS";

    let memory_total_bytes = memory_status()?.ullTotalPhys;
    let (physical_cores, cpu_cache_line_bytes, cpu_caches) = processor_topology();
    let product = registry_string(OS_KEY, "ProductName").unwrap_or_else(|| "Windows".to_string());
    let release =
        registry_string(OS_KEY, "DisplayVersion").or_else(|| registry_string(OS_KEY, "ReleaseId"));
    let build =
        registry_string(OS_KEY, "CurrentBuildNumber").unwrap_or_else(|| "Unknown".to_string());
    let update_revision = registry_dword(OS_KEY, "UBR");
    let kernel_version = update_revision
        .map(|revision| format!("{build}.{revision}"))
        .unwrap_or(build);
    let os = release
        .map(|release| format!("{product} {release} ({kernel_version})"))
        .unwrap_or_else(|| format!("{product} ({kernel_version})"));

    Ok(QxSystemInfo {
        hostname: hostname(),
        chip: registry_string(CPU_KEY, "ProcessorNameString")
            .unwrap_or_else(|| "Unknown".to_string()),
        cpu_physical_cores: physical_cores,
        cpu_logical_cores: std::thread::available_parallelism()
            .ok()
            .and_then(|count| u32::try_from(count.get()).ok()),
        cpu_performance_cores: None,
        cpu_efficiency_cores: None,
        cpu_max_frequency_mhz: registry_dword(CPU_KEY, "~MHz"),
        cpu_cache_line_bytes,
        cpu_caches,
        memory: format_gb(memory_total_bytes),
        memory_total_bytes,
        platform: "windows".to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        os: os.clone(),
        mac_os: os,
        kernel: format!("Windows NT {kernel_version}"),
        kernel_name: "Windows NT".to_string(),
        kernel_version,
        serial_number: registry_string(BIOS_KEY, "SystemSerialNumber")
            .unwrap_or_else(|| "Not available".to_string()),
    })
}

pub(super) fn storage_info() -> Result<QxStorageInfo, String> {
    let root = std::env::var("SystemDrive")
        .map(|drive| format!("{}\\", drive.trim_end_matches('\\')))
        .unwrap_or_else(|_| "C:\\".to_string());
    let root = wide(&root);
    let mut available = 0u64;
    let mut total = 0u64;
    let mut free = 0u64;
    if unsafe { GetDiskFreeSpaceExW(root.as_ptr(), &mut available, &mut total, &mut free) } == 0 {
        return Err("GetDiskFreeSpaceExW failed".to_string());
    }
    let used = total.saturating_sub(free);
    let percent = if total == 0 {
        0.0
    } else {
        used as f64 / total as f64 * 100.0
    };
    let total_s = format_gb(total);
    let used_s = format_gb(used);
    let free_s = format_gb(free);
    Ok(QxStorageInfo {
        total: total_s.clone(),
        used: used_s.clone(),
        free: free_s.clone(),
        percent_used: format!("{percent:.2}%"),
        summary: format!("{used_s} used of {total_s} ({free_s} available)"),
    })
}

pub(super) fn network_info() -> Result<QxNetworkInfo, String> {
    let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
    let mut byte_count = 16 * 1024u32;
    let mut buffer = vec![0usize; byte_count as usize / size_of::<usize>()];
    let mut result = unsafe {
        GetAdaptersAddresses(
            u32::from(AF_INET),
            flags,
            null(),
            buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>(),
            &mut byte_count,
        )
    };
    if result == ERROR_BUFFER_OVERFLOW {
        buffer.resize(
            (byte_count as usize + size_of::<usize>() - 1) / size_of::<usize>(),
            0,
        );
        result = unsafe {
            GetAdaptersAddresses(
                u32::from(AF_INET),
                flags,
                null(),
                buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>(),
                &mut byte_count,
            )
        };
    }
    if result != NO_ERROR {
        return Err(format!("GetAdaptersAddresses failed with {result}"));
    }

    let mut devices = Vec::new();
    let mut adapter = buffer.as_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
    while !adapter.is_null() {
        let item = unsafe { &*adapter };
        if item.OperStatus == IfOperStatusUp && item.IfType != IF_TYPE_SOFTWARE_LOOPBACK {
            let name = unsafe { wide_ptr(item.FriendlyName) };
            let mut address = item.FirstUnicastAddress;
            while !address.is_null() {
                let unicast = unsafe { &*address };
                let socket = unicast.Address.lpSockaddr;
                if !socket.is_null()
                    && unsafe { (*socket).sa_family } == AF_INET
                    && unicast.DadState == IpDadStatePreferred
                {
                    let address = unsafe { &*(socket.cast::<SOCKADDR_IN>()) };
                    let octets = unsafe { address.sin_addr.S_un.S_addr }.to_ne_bytes();
                    let ip = Ipv4Addr::from(octets);
                    if !ip.is_loopback() && !ip.is_unspecified() {
                        devices.push(QxNetworkDevice {
                            name: if name.is_empty() {
                                "Network".to_string()
                            } else {
                                name.clone()
                            },
                            ip: ip.to_string(),
                        });
                    }
                }
                address = unicast.Next;
            }
        }
        adapter = item.Next;
    }
    Ok(QxNetworkInfo {
        count: devices.len(),
        devices,
    })
}

pub(super) fn network_counters() -> Result<QxNetworkCounters, String> {
    let mut table: *mut MIB_IF_TABLE2 = null_mut();
    let result = unsafe { GetIfTable2(&mut table) };
    if result != NO_ERROR || table.is_null() {
        return Err(format!("GetIfTable2 failed with {result}"));
    }
    let rows =
        unsafe { slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize) };
    let interfaces = rows
        .iter()
        .filter(|row| row.OperStatus == IfOperStatusUp && row.Type != IF_TYPE_SOFTWARE_LOOPBACK)
        .map(|row| QxNetworkCounter {
            name: wide_slice(&row.Alias),
            bytes_in: row.InOctets,
            bytes_out: row.OutOctets,
        })
        .collect::<Vec<_>>();
    unsafe {
        FreeMibTable(table.cast::<c_void>());
    }
    let total_bytes_in = interfaces.iter().map(|item| item.bytes_in).sum();
    let total_bytes_out = interfaces.iter().map(|item| item.bytes_out).sum();
    Ok(QxNetworkCounters {
        interfaces,
        total_bytes_in,
        total_bytes_out,
    })
}

fn process_memory_percent(pid: u32, total_memory: u64) -> f32 {
    if total_memory == 0 {
        return 0.0;
    }
    let handle = unsafe { OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid) };
    if handle.is_null() {
        return 0.0;
    }
    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { zeroed() };
    counters.cb = size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    let success = unsafe { K32GetProcessMemoryInfo(handle, &mut counters, counters.cb) } != 0;
    unsafe {
        CloseHandle(handle);
    }
    if !success {
        return 0.0;
    }
    (counters.WorkingSetSize as f64 / total_memory as f64 * 100.0) as f32
}

pub(super) fn process_list() -> Result<QxProcessList, String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("CreateToolhelp32Snapshot failed".to_string());
    }
    let total_memory = memory_status()
        .map(|status| status.ullTotalPhys)
        .unwrap_or(0);
    let mut entry: PROCESSENTRY32W = unsafe { zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
    let mut processes = Vec::new();
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    while has_entry {
        let pid = entry.th32ProcessID;
        let name = wide_slice(&entry.szExeFile);
        if pid > 0 && !name.is_empty() {
            processes.push(QxProcessInfo {
                pid,
                name,
                cpu: 0.0,
                mem: process_memory_percent(pid, total_memory),
            });
        }
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
    }
    unsafe {
        CloseHandle(snapshot);
    }
    Ok(QxProcessList {
        count: processes.len(),
        processes,
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_windows_collectors_return_usable_snapshots() {
        let system = super::system_info().expect("collect native Windows system information");
        assert!(!system.hostname.is_empty());
        assert!(system.memory_total_bytes > 0);

        let storage = super::storage_info().expect("collect native Windows storage information");
        assert_ne!(storage.total, "0 B");

        super::network_info().expect("collect native Windows network addresses");
        super::network_counters().expect("collect native Windows network counters");

        let processes = super::process_list().expect("collect native Windows process list");
        assert!(processes.count > 0);
    }
}
