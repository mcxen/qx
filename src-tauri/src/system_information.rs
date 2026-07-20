use serde::Serialize;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::process::Command;
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxSystemInfo {
    hostname: String,
    chip: String,
    memory: String,
    memory_total_bytes: u64,
    platform: String,
    architecture: String,
    os: String,
    #[serde(rename = "macOS")]
    /// Deprecated display-name alias retained for existing plugins.
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

#[cfg(not(target_os = "windows"))]
fn command_output(program: &str, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command
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

#[cfg(not(target_os = "windows"))]
fn trim_local_hostname(hostname: String) -> String {
    hostname.trim().trim_end_matches(".local").to_string()
}

#[cfg(not(target_os = "windows"))]
fn hostname() -> String {
    command_output("/bin/hostname", &[])
        .map(trim_local_hostname)
        .unwrap_or_else(|_| "Unknown".to_string())
}

#[cfg(not(target_os = "windows"))]
fn sysctl_string(name: &str) -> Option<String> {
    command_output("/usr/sbin/sysctl", &["-n", name])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(not(target_os = "windows"))]
fn total_memory_bytes() -> u64 {
    sysctl_string("hw.memsize")
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(0)
}

fn format_gb(bytes: u64) -> String {
    format!("{:.2} GB", bytes as f64 / 1024.0 / 1024.0 / 1024.0)
}

#[cfg(not(target_os = "windows"))]
fn macos_version() -> String {
    command_output("/usr/bin/sw_vers", &["-productVersion"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "Unknown".to_string())
}

#[cfg(not(target_os = "windows"))]
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

#[cfg(not(target_os = "windows"))]
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

#[cfg(target_os = "windows")]
fn powershell(script: &str) -> Result<String, String> {
    let program = crate::windows_process::powershell_binary();
    let script = format!(
        "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); {script}"
    );
    let mut command = Command::new(&program);
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW);
    let output = command
        .output()
        .map_err(|error| format!("run {}: {error}", program.display()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("{} exited with {}", program.display(), output.status)
        } else {
            stderr
        });
    }
    String::from_utf8(output.stdout)
        .map_err(|error| format!("decode Windows PowerShell output as UTF-8: {error}"))
}

fn check_system_info_blocking() -> Result<QxSystemInfo, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = powershell("$cpu=(Get-CimInstance Win32_Processor|Select-Object -First 1 -ExpandProperty Name);$os=Get-CimInstance Win32_OperatingSystem;$bios=Get-CimInstance Win32_BIOS;[pscustomobject]@{chip=$cpu;memory=[uint64]$os.TotalVisibleMemorySize*1024;caption=$os.Caption;version=$os.Version;serial=$bios.SerialNumber}|ConvertTo-Json -Compress")?;
        let value: serde_json::Value = serde_json::from_str(raw.trim())
            .map_err(|e| format!("parse Windows system information: {e}"))?;
        let memory_total_bytes = value["memory"].as_u64().unwrap_or(0);
        let os = format!(
            "{} ({})",
            value["caption"].as_str().unwrap_or("Windows"),
            value["version"].as_str().unwrap_or("Unknown")
        );
        return Ok(QxSystemInfo {
            hostname: std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Unknown".to_string()),
            chip: value["chip"]
                .as_str()
                .unwrap_or("Unknown")
                .trim()
                .to_string(),
            memory: format_gb(memory_total_bytes),
            memory_total_bytes,
            platform: "windows".to_string(),
            architecture: std::env::consts::ARCH.to_string(),
            os: os.clone(),
            mac_os: os,
            kernel: value["version"].as_str().unwrap_or("Unknown").to_string(),
            serial_number: value["serial"]
                .as_str()
                .unwrap_or("Not available")
                .trim()
                .to_string(),
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let version = macos_version();
        let kernel = command_output("/usr/bin/uname", &["-r"])
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| "Unknown".to_string());
        let chip = sysctl_string("machdep.cpu.brand_string")
            .or_else(|| sysctl_string("hw.model"))
            .unwrap_or_else(|| "Unknown".to_string());

        let memory_total_bytes = total_memory_bytes();
        let os = format!("macOS {} ({})", macos_name(&version), version);
        Ok(QxSystemInfo {
            hostname: hostname(),
            chip,
            memory: format_gb(memory_total_bytes),
            memory_total_bytes,
            platform: "macos".to_string(),
            architecture: std::env::consts::ARCH.to_string(),
            os: os.clone(),
            mac_os: os,
            kernel,
            serial_number: serial_number(),
        })
    }
}

fn check_storage_blocking() -> Result<QxStorageInfo, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = powershell("$drive=Get-CimInstance Win32_LogicalDisk -Filter \"DeviceID='$env:SystemDrive'\";[pscustomobject]@{size=[uint64]$drive.Size;free=[uint64]$drive.FreeSpace}|ConvertTo-Json -Compress")?;
        let value: serde_json::Value = serde_json::from_str(raw.trim())
            .map_err(|e| format!("parse Windows storage information: {e}"))?;
        let total = value["size"].as_u64().unwrap_or(0);
        let free = value["free"].as_u64().unwrap_or(0);
        let used = total.saturating_sub(free);
        let percent = if total == 0 {
            0.0
        } else {
            used as f64 / total as f64 * 100.0
        };
        let total_s = format_gb(total);
        let used_s = format_gb(used);
        let free_s = format_gb(free);
        return Ok(QxStorageInfo {
            total: total_s.clone(),
            used: used_s.clone(),
            free: free_s.clone(),
            percent_used: format!("{percent:.2}%"),
            summary: format!("{used_s} used of {total_s} ({free_s} available)"),
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
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
}

fn check_network_blocking() -> Result<QxNetworkInfo, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = powershell("@(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -ne '127.0.0.1' -and $_.AddressState -eq 'Preferred'} | Select-Object InterfaceAlias,IPAddress)|ConvertTo-Json -Compress")?;
        let value: serde_json::Value = serde_json::from_str(raw.trim())
            .map_err(|e| format!("parse Windows network information: {e}"))?;
        let items = value.as_array().cloned().unwrap_or_default();
        let devices = items
            .into_iter()
            .filter_map(|item| {
                Some(QxNetworkDevice {
                    name: item["InterfaceAlias"].as_str()?.to_string(),
                    ip: item["IPAddress"].as_str()?.to_string(),
                })
            })
            .collect::<Vec<_>>();
        return Ok(QxNetworkInfo {
            count: devices.len(),
            devices,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
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
}

fn network_counters_blocking() -> Result<QxNetworkCounters, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = powershell("@(Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes)|ConvertTo-Json -Compress")?;
        let value: serde_json::Value = serde_json::from_str(raw.trim())
            .map_err(|e| format!("parse Windows network counters: {e}"))?;
        let items = value.as_array().cloned().unwrap_or_else(|| {
            value
                .as_object()
                .map(|_| vec![value.clone()])
                .unwrap_or_default()
        });
        let interfaces = items
            .into_iter()
            .filter_map(|item| {
                Some(QxNetworkCounter {
                    name: item["Name"].as_str()?.to_string(),
                    bytes_in: item["ReceivedBytes"].as_u64().unwrap_or(0),
                    bytes_out: item["SentBytes"].as_u64().unwrap_or(0),
                })
            })
            .collect::<Vec<_>>();
        let total_bytes_in = interfaces.iter().map(|item| item.bytes_in).sum();
        let total_bytes_out = interfaces.iter().map(|item| item.bytes_out).sum();
        return Ok(QxNetworkCounters {
            interfaces,
            total_bytes_in,
            total_bytes_out,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
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
}

fn power_blocking() -> Result<QxPowerInfo, String> {
    use battery::units::ratio::percent;

    let manager = battery::Manager::new().map_err(|e| format!("battery manager: {e}"))?;
    let battery = manager
        .batteries()
        .map_err(|e| format!("list batteries: {e}"))?
        .next()
        .transpose()
        .map_err(|e| format!("read battery: {e}"))?;

    let Some(battery) = battery else {
        return Ok(QxPowerInfo {
            battery_level: None,
            is_charging: false,
            fully_charged: false,
            source: "No battery".to_string(),
            summary: "No battery detected".to_string(),
        });
    };

    let level = battery.state_of_charge().get::<percent>().round() as u8;
    let state = battery.state();
    let is_charging = matches!(state, battery::State::Charging | battery::State::Full);
    let fully_charged = matches!(state, battery::State::Full);
    let source = if is_charging {
        "AC Power"
    } else {
        "Battery Power"
    }
    .to_string();
    let summary = format!("{source}: {level}% ({state})");

    Ok(QxPowerInfo {
        battery_level: Some(level.min(100)),
        is_charging,
        fully_charged,
        source,
        summary,
    })
}

fn list_processes_blocking() -> Result<QxProcessList, String> {
    #[cfg(target_os = "windows")]
    {
        let raw = powershell("$total=[double](Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize*1024;@(Get-Process | ForEach-Object {[pscustomobject]@{pid=$_.Id;name=$_.ProcessName;cpu=0;mem=if($total -gt 0){[math]::Round($_.WorkingSet64/$total*100,2)}else{0}}})|ConvertTo-Json -Compress")?;
        let value: serde_json::Value = serde_json::from_str(raw.trim())
            .map_err(|e| format!("parse Windows process list: {e}"))?;
        let items = value.as_array().cloned().unwrap_or_else(|| {
            value
                .as_object()
                .map(|_| vec![value.clone()])
                .unwrap_or_default()
        });
        let processes = items
            .into_iter()
            .filter_map(|item| {
                Some(QxProcessInfo {
                    pid: item["pid"].as_u64()? as u32,
                    name: item["name"].as_str()?.to_string(),
                    cpu: item["cpu"].as_f64().unwrap_or(0.0) as f32,
                    mem: item["mem"].as_f64().unwrap_or(0.0) as f32,
                })
            })
            .collect::<Vec<_>>();
        return Ok(QxProcessList {
            count: processes.len(),
            processes,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
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
}

fn kill_process_blocking(pid: u32) -> Result<QxKillProcessResult, String> {
    if pid == 0 || pid == std::process::id() {
        return Err("Refusing to terminate this process".to_string());
    }
    #[cfg(target_os = "windows")]
    let status = {
        let mut command = Command::new(crate::windows_process::taskkill_binary());
        command
            .args(["/PID", &pid.to_string(), "/T"])
            .creation_flags(CREATE_NO_WINDOW);
        command.status().map_err(|e| format!("run taskkill: {e}"))?
    };
    #[cfg(not(target_os = "windows"))]
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

#[tauri::command]
pub async fn qx_system_information_check_system_info() -> Result<QxSystemInfo, String> {
    tauri::async_runtime::spawn_blocking(check_system_info_blocking)
        .await
        .map_err(|e| format!("system information worker failed: {e}"))?
}

#[tauri::command]
pub async fn qx_system_information_check_storage() -> Result<QxStorageInfo, String> {
    tauri::async_runtime::spawn_blocking(check_storage_blocking)
        .await
        .map_err(|e| format!("storage information worker failed: {e}"))?
}

#[tauri::command]
pub async fn qx_system_information_check_network() -> Result<QxNetworkInfo, String> {
    tauri::async_runtime::spawn_blocking(check_network_blocking)
        .await
        .map_err(|e| format!("network information worker failed: {e}"))?
}

/// Sync totals for tray net-rate sampling.
pub fn network_totals_sync() -> Result<(u64, u64), String> {
    let counters = network_counters_blocking()?;
    Ok((counters.total_bytes_in, counters.total_bytes_out))
}

#[tauri::command]
pub async fn qx_system_monitor_network_counters() -> Result<QxNetworkCounters, String> {
    tauri::async_runtime::spawn_blocking(network_counters_blocking)
        .await
        .map_err(|e| format!("network counters worker failed: {e}"))?
}

#[tauri::command]
pub async fn qx_system_monitor_power() -> Result<QxPowerInfo, String> {
    tauri::async_runtime::spawn_blocking(power_blocking)
        .await
        .map_err(|e| format!("power information worker failed: {e}"))?
}

#[tauri::command]
pub async fn qx_system_information_list_processes() -> Result<QxProcessList, String> {
    tauri::async_runtime::spawn_blocking(list_processes_blocking)
        .await
        .map_err(|e| format!("process list worker failed: {e}"))?
}

#[tauri::command]
pub async fn qx_system_information_kill_process(pid: u32) -> Result<QxKillProcessResult, String> {
    tauri::async_runtime::spawn_blocking(move || kill_process_blocking(pid))
        .await
        .map_err(|e| format!("kill process worker failed: {e}"))?
}
