use serde::Serialize;
use std::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxSystemInfo {
    hostname: String,
    chip: String,
    memory: String,
    #[serde(rename = "macOS")]
    mac_os: String,
    kernel: String,
    serial_number: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxStorageInfo {
    total: String,
    used: String,
    free: String,
    percent_used: String,
    summary: String,
}

#[derive(Debug, Serialize)]
pub struct QxNetworkDevice {
    name: String,
    ip: String,
}

#[derive(Debug, Serialize)]
pub struct QxNetworkInfo {
    devices: Vec<QxNetworkDevice>,
    count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxNetworkCounter {
    name: String,
    bytes_in: u64,
    bytes_out: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxNetworkCounters {
    interfaces: Vec<QxNetworkCounter>,
    total_bytes_in: u64,
    total_bytes_out: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxPowerInfo {
    battery_level: Option<u8>,
    is_charging: bool,
    fully_charged: bool,
    source: String,
    summary: String,
}

#[derive(Debug, Serialize)]
pub struct QxProcessInfo {
    pid: u32,
    name: String,
    cpu: f32,
    mem: f32,
}

#[derive(Debug, Serialize)]
pub struct QxProcessList {
    processes: Vec<QxProcessInfo>,
    count: usize,
}

#[derive(Debug, Serialize)]
pub struct QxKillProcessResult {
    success: bool,
    message: String,
}

fn command_output(program: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| format!("run {program}: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("{program} exited with {}", output.status)
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn trim_local_hostname(hostname: String) -> String {
    hostname.trim().trim_end_matches(".local").to_string()
}

fn hostname() -> String {
    command_output("/bin/hostname", &[])
        .map(trim_local_hostname)
        .unwrap_or_else(|_| "Unknown".to_string())
}

fn sysctl_string(name: &str) -> Option<String> {
    command_output("/usr/sbin/sysctl", &["-n", name])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn total_memory_bytes() -> u64 {
    sysctl_string("hw.memsize")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0)
}

fn format_gb(bytes: u64) -> String {
    format!("{:.2} GB", bytes as f64 / 1024.0 / 1024.0 / 1024.0)
}

fn macos_version() -> String {
    command_output("/usr/bin/sw_vers", &["-productVersion"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "Unknown".to_string())
}

fn macos_name(version: &str) -> &'static str {
    match version.split('.').next().unwrap_or("") {
        "15" => "Sequoia",
        "14" => "Sonoma",
        "13" => "Ventura",
        "12" => "Monterey",
        "11" => "Big Sur",
        "10" => "macOS",
        _ => "macOS",
    }
}

fn serial_number() -> String {
    let Ok(stdout) = command_output("/usr/sbin/system_profiler", &["SPHardwareDataType"]) else {
        return "Unable to retrieve".to_string();
    };
    stdout
        .lines()
        .find_map(|line| {
            let (_, value) = line.split_once("Serial Number (system):")?;
            Some(value.trim().to_string())
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Not available".to_string())
}

#[tauri::command]
pub fn qx_system_information_check_system_info() -> Result<QxSystemInfo, String> {
    let version = macos_version();
    let kernel = command_output("/usr/bin/uname", &["-r"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "Unknown".to_string());
    let chip = sysctl_string("machdep.cpu.brand_string")
        .or_else(|| sysctl_string("hw.model"))
        .unwrap_or_else(|| "Unknown".to_string());

    Ok(QxSystemInfo {
        hostname: hostname(),
        chip,
        memory: format_gb(total_memory_bytes()),
        mac_os: format!("macOS {} ({})", macos_name(&version), version),
        kernel,
        serial_number: serial_number(),
    })
}

#[tauri::command]
pub fn qx_system_information_check_storage() -> Result<QxStorageInfo, String> {
    let stdout = command_output("/bin/df", &["-k", "/"])?;
    let line = stdout
        .lines()
        .nth(1)
        .ok_or_else(|| "df output did not include root volume".to_string())?;
    let cols: Vec<&str> = line.split_whitespace().collect();
    if cols.len() < 4 {
        return Err("df output did not include storage columns".to_string());
    }
    let total = cols[1]
        .parse::<u64>()
        .map_err(|e| format!("parse total storage: {e}"))?
        * 1024;
    let used = cols[2]
        .parse::<u64>()
        .map_err(|e| format!("parse used storage: {e}"))?
        * 1024;
    let free = cols[3]
        .parse::<u64>()
        .map_err(|e| format!("parse free storage: {e}"))?
        * 1024;
    let percent = if total > 0 {
        used as f64 / total as f64 * 100.0
    } else {
        0.0
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

#[tauri::command]
pub fn qx_system_information_check_network() -> Result<QxNetworkInfo, String> {
    let stdout = command_output("/sbin/ifconfig", &[])?;
    let mut current_name = String::new();
    let mut devices = Vec::new();

    for line in stdout.lines() {
        if !line.starts_with('\t') && !line.starts_with(' ') {
            if let Some((name, _)) = line.split_once(':') {
                current_name = name.to_string();
            }
            continue;
        }
        let trimmed = line.trim();
        if !trimmed.starts_with("inet ") || current_name == "lo0" {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 2 && parts[1] != "127.0.0.1" {
            devices.push(QxNetworkDevice {
                name: current_name.clone(),
                ip: parts[1].to_string(),
            });
        }
    }

    Ok(QxNetworkInfo {
        count: devices.len(),
        devices,
    })
}

#[tauri::command]
pub fn qx_system_monitor_network_counters() -> Result<QxNetworkCounters, String> {
    let stdout = command_output("/usr/sbin/netstat", &["-ibn"])?;
    let mut interfaces = Vec::new();

    for line in stdout.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 10 || cols[0] == "lo0" || cols[2] != "<Link#>" {
            continue;
        }
        let bytes_in = cols.get(6).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
        let bytes_out = cols.get(9).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
        if bytes_in == 0 && bytes_out == 0 {
            continue;
        }
        interfaces.push(QxNetworkCounter {
            name: cols[0].to_string(),
            bytes_in,
            bytes_out,
        });
    }

    interfaces.sort_by(|a, b| {
        let a_total = a.bytes_in.saturating_add(a.bytes_out);
        let b_total = b.bytes_in.saturating_add(b.bytes_out);
        b_total.cmp(&a_total)
    });
    let total_bytes_in = interfaces.iter().map(|item| item.bytes_in).sum();
    let total_bytes_out = interfaces.iter().map(|item| item.bytes_out).sum();

    Ok(QxNetworkCounters {
        interfaces,
        total_bytes_in,
        total_bytes_out,
    })
}

#[tauri::command]
pub fn qx_system_monitor_power() -> Result<QxPowerInfo, String> {
    let stdout = command_output("/usr/bin/pmset", &["-g", "batt"])?;
    let source = stdout
        .lines()
        .next()
        .and_then(|line| line.split('\'').nth(1))
        .unwrap_or("Unknown")
        .to_string();
    let battery_line = stdout
        .lines()
        .find(|line| line.contains('%'))
        .unwrap_or("")
        .trim()
        .to_string();
    let battery_level = battery_line
        .split('%')
        .next()
        .and_then(|left| left.split_whitespace().last())
        .and_then(|value| value.parse::<u8>().ok());
    let lower = battery_line.to_lowercase();
    let fully_charged = lower.contains("charged");
    let is_charging = lower.contains("charging") || source.to_lowercase().contains("ac power");
    let summary = if battery_line.is_empty() {
        source.clone()
    } else {
        format!("{source}: {battery_line}")
    };

    Ok(QxPowerInfo {
        battery_level,
        is_charging,
        fully_charged,
        source,
        summary,
    })
}

#[tauri::command]
pub fn qx_system_information_list_processes() -> Result<QxProcessList, String> {
    let stdout = command_output("/bin/ps", &["-axo", "pid=,pcpu=,pmem=,comm="])?;
    let mut processes = Vec::new();
    for line in stdout.lines() {
        let mut parts = line.trim().split_whitespace();
        let Some(pid) = parts.next().and_then(|s| s.parse::<u32>().ok()) else {
            continue;
        };
        let cpu = parts
            .next()
            .and_then(|s| s.parse::<f32>().ok())
            .unwrap_or(0.0);
        let mem = parts
            .next()
            .and_then(|s| s.parse::<f32>().ok())
            .unwrap_or(0.0);
        let name = parts.collect::<Vec<_>>().join(" ");
        if name.is_empty() {
            continue;
        }
        processes.push(QxProcessInfo {
            pid,
            name,
            cpu,
            mem,
        });
    }

    Ok(QxProcessList {
        count: processes.len(),
        processes,
    })
}

#[tauri::command]
pub fn qx_system_information_kill_process(pid: u32) -> Result<QxKillProcessResult, String> {
    if pid == 0 || pid == std::process::id() {
        return Err("Refusing to terminate this process".to_string());
    }
    let status = Command::new("/bin/kill")
        .arg(pid.to_string())
        .status()
        .map_err(|e| format!("run kill: {e}"))?;
    if !status.success() {
        return Err(format!("kill exited with {status}"));
    }

    Ok(QxKillProcessResult {
        success: true,
        message: format!("Process with PID {pid} has been terminated successfully."),
    })
}
