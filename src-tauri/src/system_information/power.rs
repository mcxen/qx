use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxPowerInfo {
    battery_present: bool,
    battery_level: Option<u8>,
    is_charging: bool,
    fully_charged: bool,
    external_connected: Option<bool>,
    cycle_count: Option<u32>,
    condition: Option<String>,
    maximum_capacity_percent: Option<u8>,
    temperature_celsius: Option<f32>,
    time_remaining_minutes: Option<u32>,
    time_to_full_minutes: Option<u32>,
    design_capacity: Option<u32>,
    full_charge_capacity: Option<u32>,
    remaining_capacity: Option<u32>,
    capacity_unit: Option<String>,
    power_watts: Option<f32>,
    source: String,
    summary: String,
}

#[cfg(target_os = "macos")]
fn ioreg_value<'a>(output: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("\"{key}\" = ");
    output
        .lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix(&prefix))
        .map(str::trim)
}

#[cfg(target_os = "macos")]
fn ioreg_u32(output: &str, key: &str) -> Option<u32> {
    ioreg_value(output, key)?.parse().ok()
}

#[cfg(target_os = "macos")]
fn ioreg_bool(output: &str, key: &str) -> Option<bool> {
    match ioreg_value(output, key)? {
        "Yes" | "true" => Some(true),
        "No" | "false" => Some(false),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn profiler_value(output: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    output
        .lines()
        .map(str::trim)
        .find_map(|line| line.strip_prefix(&prefix))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

#[cfg(target_os = "macos")]
fn macos_battery_health() -> (Option<String>, Option<u8>) {
    type CacheValue = (std::time::Instant, Option<String>, Option<u8>);
    static CACHE: std::sync::OnceLock<std::sync::Mutex<Option<CacheValue>>> =
        std::sync::OnceLock::new();
    let cache = CACHE.get_or_init(|| std::sync::Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some((saved_at, condition, capacity)) = guard.as_ref() {
            if saved_at.elapsed() < std::time::Duration::from_secs(10 * 60) {
                return (condition.clone(), *capacity);
            }
        }
    }

    // The upstream System Monitor also caches these slow-changing values.
    // Never hold this mutex while system_profiler is running.
    let profiler = super::command_output("/usr/sbin/system_profiler", &["SPPowerDataType"])
        .unwrap_or_default();
    let condition = profiler_value(&profiler, "Condition");
    let capacity = profiler_value(&profiler, "Maximum Capacity")
        .and_then(|value| value.trim_end_matches('%').trim().parse::<u8>().ok());
    if let Ok(mut guard) = cache.lock() {
        *guard = Some((std::time::Instant::now(), condition.clone(), capacity));
    }
    (condition, capacity)
}

#[cfg(target_os = "macos")]
fn collect_platform() -> Result<QxPowerInfo, String> {
    let ioreg = super::command_output("/usr/sbin/ioreg", &["-r", "-c", "AppleSmartBattery", "-l"])?;
    if ioreg.trim().is_empty() {
        return Ok(no_battery());
    }

    let battery_level = ioreg_u32(&ioreg, "CurrentCapacity").map(|value| value.min(100) as u8);
    let is_charging = ioreg_bool(&ioreg, "IsCharging").unwrap_or(false);
    let fully_charged = ioreg_bool(&ioreg, "FullyCharged").unwrap_or(false);
    let external_connected =
        ioreg_bool(&ioreg, "ExternalConnected").or(Some(is_charging || fully_charged));
    let cycle_count = ioreg_u32(&ioreg, "CycleCount");
    let design_capacity = ioreg_u32(&ioreg, "DesignCapacity");
    let full_charge_capacity = ioreg_u32(&ioreg, "AppleRawMaxCapacity");
    let remaining_capacity = ioreg_u32(&ioreg, "AppleRawCurrentCapacity");
    let temperature_celsius = ioreg_u32(&ioreg, "Temperature").map(|value| value as f32 / 100.0);
    let time_remaining_minutes =
        ioreg_u32(&ioreg, "TimeRemaining").filter(|value| *value < u16::MAX as u32);
    let time_to_full_minutes =
        ioreg_u32(&ioreg, "AvgTimeToFull").filter(|value| *value < u16::MAX as u32);
    let power_watts = ioreg_value(&ioreg, "AdapterDetails").and_then(|details| {
        let marker = "\"Watts\"=";
        let start = details.find(marker)? + marker.len();
        details[start..]
            .chars()
            .take_while(|character| character.is_ascii_digit())
            .collect::<String>()
            .parse::<f32>()
            .ok()
    });

    let (condition, profiled_capacity) = macos_battery_health();
    let maximum_capacity_percent = profiled_capacity.or_else(|| {
        Some(
            (full_charge_capacity? as f64 / design_capacity? as f64 * 100.0)
                .round()
                .clamp(0.0, 100.0) as u8,
        )
    });
    let source = if external_connected == Some(true) {
        "AC Power"
    } else {
        "Battery Power"
    }
    .to_string();
    let state = if is_charging {
        "charging"
    } else if fully_charged {
        "charged"
    } else {
        "discharging"
    };
    let summary = battery_level.map_or_else(
        || format!("{source} ({state})"),
        |level| format!("{source}: {level}% ({state})"),
    );

    Ok(QxPowerInfo {
        battery_present: true,
        battery_level,
        is_charging,
        fully_charged,
        external_connected,
        cycle_count,
        condition,
        maximum_capacity_percent,
        temperature_celsius,
        time_remaining_minutes,
        time_to_full_minutes,
        design_capacity,
        full_charge_capacity,
        remaining_capacity,
        capacity_unit: Some("mAh".into()),
        power_watts,
        source,
        summary,
    })
}

#[cfg(target_os = "windows")]
fn collect_platform() -> Result<QxPowerInfo, String> {
    let raw = super::powershell(
        "$b=Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue|Select-Object -First 1;\
         if($null -eq $b){[pscustomobject]@{present=$false}|ConvertTo-Json -Compress;exit};\
         $s=Get-CimInstance -Namespace root/WMI -Class BatteryStatus -ErrorAction SilentlyContinue|Select-Object -First 1;\
         $d=Get-CimInstance -Namespace root/WMI -Class BatteryStaticData -ErrorAction SilentlyContinue|Select-Object -First 1;\
         $f=Get-CimInstance -Namespace root/WMI -Class BatteryFullChargedCapacity -ErrorAction SilentlyContinue|Select-Object -First 1;\
         $c=Get-CimInstance -Namespace root/WMI -Class BatteryCycleCount -ErrorAction SilentlyContinue|Select-Object -First 1;\
         $level=if($null -ne $b.EstimatedChargeRemaining){[int]$b.EstimatedChargeRemaining}else{$null};\
         $online=if($null -ne $s){[bool]$s.PowerOnline}else{$null};\
         $charging=if($null -ne $s){[bool]$s.Charging}else{[int]$b.BatteryStatus -in 6,7,8,9};\
         $runtime=if($null -ne $b.EstimatedRunTime -and [uint64]$b.EstimatedRunTime -lt 71582788){[uint32]$b.EstimatedRunTime}else{$null};\
         [pscustomobject]@{present=$true;level=$level;charging=$charging;online=$online;\
         full=($level -ge 100 -and $online -eq $true -and -not $charging);condition=[string]$b.Status;\
         runtime=$runtime;design=if($null -ne $d){[uint32]$d.DesignedCapacity}else{$null};\
         capacity=if($null -ne $f){[uint32]$f.FullChargedCapacity}else{$null};\
         remaining=if($null -ne $s){[uint32]$s.RemainingCapacity}else{$null};\
         cycle=if($null -ne $c){[uint32]$c.CycleCount}else{$null};\
         rate=if($null -ne $s){[double]$s.Rate}else{$null}}|ConvertTo-Json -Compress",
    )?;
    let value: serde_json::Value = serde_json::from_str(raw.trim())
        .map_err(|error| format!("parse Windows power information: {error}"))?;
    if !value["present"].as_bool().unwrap_or(false) {
        return Ok(no_battery());
    }

    let battery_level = value["level"].as_u64().map(|level| level.min(100) as u8);
    let is_charging = value["charging"].as_bool().unwrap_or(false);
    let fully_charged = value["full"].as_bool().unwrap_or(false);
    let external_connected = value["online"].as_bool();
    let design_capacity = value["design"].as_u64().map(|value| value as u32);
    let full_charge_capacity = value["capacity"].as_u64().map(|value| value as u32);
    let remaining_capacity = value["remaining"].as_u64().map(|value| value as u32);
    let maximum_capacity_percent = match (full_charge_capacity, design_capacity) {
        (Some(full), Some(design)) if design > 0 => Some(
            (full as f64 / design as f64 * 100.0)
                .round()
                .clamp(0.0, 100.0) as u8,
        ),
        _ => None,
    };
    let source = if external_connected == Some(true) || is_charging {
        "AC Power"
    } else {
        "Battery Power"
    }
    .to_string();
    let state = if is_charging {
        "charging"
    } else if fully_charged {
        "charged"
    } else {
        "discharging"
    };
    let summary = battery_level.map_or_else(
        || format!("{source} ({state})"),
        |level| format!("{source}: {level}% ({state})"),
    );

    Ok(QxPowerInfo {
        battery_present: true,
        battery_level,
        is_charging,
        fully_charged,
        external_connected,
        cycle_count: value["cycle"].as_u64().map(|value| value as u32),
        condition: value["condition"]
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        maximum_capacity_percent,
        temperature_celsius: None,
        time_remaining_minutes: value["runtime"].as_u64().map(|value| value as u32),
        time_to_full_minutes: None,
        design_capacity,
        full_charge_capacity,
        remaining_capacity,
        capacity_unit: Some("mWh".into()),
        power_watts: value["rate"]
            .as_f64()
            .map(|rate| (rate.abs() / 1000.0) as f32),
        source,
        summary,
    })
}

fn no_battery() -> QxPowerInfo {
    QxPowerInfo {
        battery_present: false,
        battery_level: None,
        is_charging: false,
        fully_charged: false,
        external_connected: None,
        cycle_count: None,
        condition: None,
        maximum_capacity_percent: None,
        temperature_celsius: None,
        time_remaining_minutes: None,
        time_to_full_minutes: None,
        design_capacity: None,
        full_charge_capacity: None,
        remaining_capacity: None,
        capacity_unit: None,
        power_watts: None,
        source: "No battery".to_string(),
        summary: "No battery detected".to_string(),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn collect_platform() -> Result<QxPowerInfo, String> {
    use battery::units::ratio::percent;

    let manager = battery::Manager::new().map_err(|error| format!("battery manager: {error}"))?;
    let battery = manager
        .batteries()
        .map_err(|error| format!("list batteries: {error}"))?
        .next()
        .transpose()
        .map_err(|error| format!("read battery: {error}"))?;
    let Some(battery) = battery else {
        return Ok(no_battery());
    };

    let level = battery.state_of_charge().get::<percent>().round() as u8;
    let state = battery.state();
    let is_charging = matches!(state, battery::State::Charging);
    let fully_charged = matches!(state, battery::State::Full);
    let external_connected = matches!(state, battery::State::Charging | battery::State::Full);
    let source = if external_connected {
        "AC Power"
    } else {
        "Battery Power"
    }
    .to_string();
    Ok(QxPowerInfo {
        battery_present: true,
        battery_level: Some(level.min(100)),
        is_charging,
        fully_charged,
        external_connected: Some(external_connected),
        cycle_count: None,
        condition: None,
        maximum_capacity_percent: None,
        temperature_celsius: None,
        time_remaining_minutes: None,
        time_to_full_minutes: None,
        design_capacity: None,
        full_charge_capacity: None,
        remaining_capacity: None,
        capacity_unit: None,
        power_watts: None,
        summary: format!("{source}: {level}% ({state})"),
        source,
    })
}

pub(super) fn collect() -> Result<QxPowerInfo, String> {
    collect_platform()
}

#[cfg(test)]
mod tests {
    #[test]
    fn no_battery_model_keeps_optional_metrics_empty() {
        let value = serde_json::to_value(super::no_battery()).expect("serialize power info");
        assert_eq!(value["batteryPresent"], false);
        assert_eq!(value["batteryLevel"], serde_json::Value::Null);
        assert_eq!(value["externalConnected"], serde_json::Value::Null);
        assert_eq!(value["cycleCount"], serde_json::Value::Null);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn parses_top_level_values_without_matching_nested_dictionary() {
        let output = r#"
          "BatteryData" = {"CycleCount"=999,"MaxCapacity"=77}
          "CurrentCapacity" = 84
          "CycleCount" = 118
          "ExternalConnected" = Yes
          "IsCharging" = No
          "AdapterDetails" = {"Watts"=30,"Description"="pd charger"}
        "#;
        assert_eq!(super::ioreg_u32(output, "CurrentCapacity"), Some(84));
        assert_eq!(super::ioreg_u32(output, "CycleCount"), Some(118));
        assert_eq!(super::ioreg_bool(output, "ExternalConnected"), Some(true));
        assert_eq!(super::ioreg_bool(output, "IsCharging"), Some(false));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_collector_returns_a_consistent_cross_platform_model() {
        let power = super::collect().expect("collect macOS power information");
        if power.battery_present {
            assert!(power.battery_level.is_some_and(|level| level <= 100));
            assert_ne!(power.source, "No battery");
            if power.is_charging {
                assert_eq!(power.external_connected, Some(true));
            }
        } else {
            assert_eq!(power.battery_level, None);
            assert_eq!(power.source, "No battery");
        }
    }
}
