use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

const M1DDC_URL: &str = "https://github.com/waydabber/m1ddc";
const DDCCTL_URL: &str = "https://github.com/kfix/ddcctl";

#[derive(Clone, Debug, Serialize)]
pub struct ExternalDisplayDriver {
    name: String,
    label: String,
    path: String,
    install_url: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ExternalDisplayControl {
    current: u8,
    max: u16,
    raw: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ExternalDisplay {
    id: u8,
    name: String,
    raw: String,
    brightness: Option<ExternalDisplayControl>,
    contrast: Option<ExternalDisplayControl>,
    volume: Option<ExternalDisplayControl>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDisplayInstallRequest {
    driver: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalDisplayInstallResult {
    driver: String,
    command: String,
    stdout: String,
    stderr: String,
    detected: Option<ExternalDisplayDriver>,
}

fn candidate_paths(binary: &str) -> Vec<PathBuf> {
    [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ]
    .iter()
    .map(|dir| PathBuf::from(dir).join(binary))
    .collect()
}

fn find_binary(binary: &str) -> Option<PathBuf> {
    candidate_paths(binary)
        .into_iter()
        .find(|path| path.is_file())
}

fn brew_binary() -> Option<PathBuf> {
    candidate_paths("brew")
        .into_iter()
        .find(|path| path.is_file())
}

fn supported_install_driver(input: &str) -> Result<&'static str, String> {
    match input.trim() {
        "m1ddc" => Ok("m1ddc"),
        "ddcctl" => Ok("ddcctl"),
        other => Err(format!(
            "Unsupported DDC CLI install target: {other}. Expected m1ddc or ddcctl."
        )),
    }
}

fn detected_driver() -> Option<ExternalDisplayDriver> {
    find_binary("m1ddc")
        .map(|path| ExternalDisplayDriver {
            name: "m1ddc".to_string(),
            label: "m1ddc".to_string(),
            path: path.to_string_lossy().to_string(),
            install_url: M1DDC_URL.to_string(),
        })
        .or_else(|| {
            find_binary("ddcctl").map(|path| ExternalDisplayDriver {
                name: "ddcctl".to_string(),
                label: "ddcctl".to_string(),
                path: path.to_string_lossy().to_string(),
                install_url: DDCCTL_URL.to_string(),
            })
        })
}

fn run_driver(driver: &ExternalDisplayDriver, args: &[&str]) -> Result<String, String> {
    let output = Command::new(&driver.path)
        .args(args)
        .output()
        .map_err(|e| format!("run {}: {e}", driver.label))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        Ok(if stdout.is_empty() { stderr } else { stdout })
    } else {
        Err(if stderr.is_empty() {
            stdout
        } else {
            format!("{stderr}\n{stdout}").trim().to_string()
        })
    }
}

fn pick_number(text: &str, patterns: &[&'static str]) -> Option<u16> {
    patterns.iter().find_map(|pattern| {
        Regex::new(pattern)
            .ok()?
            .captures(text)
            .and_then(|captures| captures.get(1))
            .and_then(|value| value.as_str().parse::<u16>().ok())
    })
}

fn parse_control_value(text: &str) -> Option<ExternalDisplayControl> {
    let current = pick_number(
        text,
        &[
            r"(?i)current\s+value\s*[:=]\s*(\d+)",
            r"(?i)current\s*[:=]\s*(\d+)",
            r"(?i)value\s*[:=]\s*(\d+)",
            r"\b(\d{1,3})\s*/\s*\d{1,3}\b",
            r"\b(\d{1,3})\b",
        ],
    )?;
    let max = pick_number(
        text,
        &[
            r"(?i)max(?:imum)?\s+value\s*[:=]\s*(\d+)",
            r"(?i)max(?:imum)?\s*[:=]\s*(\d+)",
            r"\d{1,3}\s*/\s*(\d{1,3})\b",
        ],
    )
    .filter(|value| *value > 0)
    .unwrap_or(100);
    let percent = if max > 0 {
        ((current as f32 / max as f32) * 100.0).round() as u16
    } else {
        current
    };
    Some(ExternalDisplayControl {
        current: percent.min(100) as u8,
        max,
        raw: text.trim().to_string(),
    })
}

fn display_ids_from_m1ddc_list(text: &str) -> Vec<u8> {
    let mut ids = Vec::new();
    for pattern in [
        r"(?im)(?:^|\n)\s*(?:display|id)\s*[:#]?\s*(\d+)\b",
        r"(?m)(?:^|\n)\s*(\d+)\s*[:.)-]\s*.+",
    ] {
        let Ok(regex) = Regex::new(pattern) else {
            continue;
        };
        for captures in regex.captures_iter(text) {
            if let Some(id) = captures
                .get(1)
                .and_then(|value| value.as_str().parse::<u8>().ok())
                .filter(|id| *id > 0 && *id < 32)
            {
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
    }
    ids.sort_unstable();
    ids
}

fn block_for_display(text: &str, id: u8) -> String {
    let id_pattern =
        Regex::new(&format!(r"(?i)(?:display|id)\s*[:#]?\s*{}\b", id)).expect("valid id regex");
    text.split("\n\n")
        .find(|block| id_pattern.is_match(block))
        .unwrap_or("")
        .trim()
        .to_string()
}

fn display_name_from_block(block: &str, id: u8) -> String {
    for line in block.lines().map(str::trim).filter(|line| !line.is_empty()) {
        for pattern in [
            r"(?i)(?:name|model|product)\s*[:=]\s*(.+)$",
            r"(?i)display\s+\d+\s*[:=-]\s*(.+)$",
        ] {
            if let Some(name) = numberless_capture(pattern, line) {
                return name;
            }
        }
    }
    format!("Display {id}")
}

fn numberless_capture(pattern: &str, text: &str) -> Option<String> {
    Regex::new(pattern)
        .ok()?
        .captures(text)?
        .get(1)
        .map(|value| value.as_str().trim().to_string())
        .filter(|value| !value.is_empty())
}

fn m1ddc_get_control(
    driver: &ExternalDisplayDriver,
    id: u8,
    control: &str,
) -> Option<ExternalDisplayControl> {
    run_driver(driver, &["display", &id.to_string(), "get", control])
        .ok()
        .and_then(|output| parse_control_value(&output))
}

fn list_m1ddc_displays(driver: &ExternalDisplayDriver) -> Result<Vec<ExternalDisplay>, String> {
    let listing = run_driver(driver, &["display", "list", "detailed"])
        .or_else(|_| run_driver(driver, &["display", "list"]))
        .unwrap_or_default();
    let listed_ids = display_ids_from_m1ddc_list(&listing);
    let ids: Vec<u8> = if listed_ids.is_empty() {
        (1..=8).collect()
    } else {
        listed_ids.clone()
    };
    let mut displays = Vec::new();
    for id in ids {
        let brightness = m1ddc_get_control(driver, id, "luminance");
        if brightness.is_none() && !listed_ids.contains(&id) {
            continue;
        }
        let contrast = m1ddc_get_control(driver, id, "contrast");
        let volume = m1ddc_get_control(driver, id, "volume");
        let block = block_for_display(&listing, id);
        displays.push(ExternalDisplay {
            id,
            name: display_name_from_block(&block, id),
            raw: if block.is_empty() {
                listing.clone()
            } else {
                block
            },
            brightness,
            contrast,
            volume,
        });
    }
    Ok(displays)
}

fn parse_ddcctl_probe(text: &str, id: u8) -> Option<ExternalDisplay> {
    if Regex::new("(?i)invalid display|failed to find|no display")
        .expect("valid regex")
        .is_match(text)
    {
        return None;
    }
    let name = numberless_capture(r"(?im)D:\s*(.+)$", text)
        .or_else(|| numberless_capture(r"(?im)display\s+\d+\s*[:=-]\s*(.+)$", text))
        .unwrap_or_else(|| format!("Display {id}"));
    let brightness = Regex::new("(?is)brightness.{0,160}")
        .ok()
        .and_then(|regex| regex.find(text).map(|m| m.as_str().to_string()))
        .and_then(|value| parse_control_value(&value))
        .or_else(|| parse_control_value(text));
    let contrast = Regex::new("(?is)contrast.{0,160}")
        .ok()
        .and_then(|regex| regex.find(text).map(|m| m.as_str().to_string()))
        .and_then(|value| parse_control_value(&value));
    Some(ExternalDisplay {
        id,
        name,
        raw: text.trim().to_string(),
        brightness,
        contrast,
        volume: None,
    })
}

fn list_ddcctl_displays(driver: &ExternalDisplayDriver) -> Vec<ExternalDisplay> {
    let mut displays = Vec::new();
    for id in 1..=8 {
        if let Ok(output) = run_driver(driver, &["-d", &id.to_string()]) {
            if let Some(display) = parse_ddcctl_probe(&output, id) {
                displays.push(display);
            }
        }
    }
    displays
}

#[tauri::command]
pub fn qx_external_displays_driver() -> Result<Option<ExternalDisplayDriver>, String> {
    Ok(detected_driver())
}

#[tauri::command]
pub fn qx_external_displays_list() -> Result<Vec<ExternalDisplay>, String> {
    let driver = detected_driver().ok_or_else(|| {
        "No DDC CLI found. Install m1ddc or ddcctl in /opt/homebrew/bin or /usr/local/bin."
            .to_string()
    })?;
    if driver.name == "m1ddc" {
        list_m1ddc_displays(&driver)
    } else {
        Ok(list_ddcctl_displays(&driver))
    }
}

#[tauri::command]
pub fn qx_external_displays_set_control(
    display_id: u8,
    control: String,
    value: u8,
) -> Result<(), String> {
    let driver = detected_driver().ok_or_else(|| {
        "No DDC CLI found. Install m1ddc or ddcctl in /opt/homebrew/bin or /usr/local/bin."
            .to_string()
    })?;
    let value = value.min(100).to_string();
    if driver.name == "m1ddc" {
        let control = match control.as_str() {
            "brightness" | "luminance" => "luminance",
            "contrast" => "contrast",
            "volume" => "volume",
            _ => return Err("Unsupported display control".to_string()),
        };
        run_driver(
            &driver,
            &["display", &display_id.to_string(), "set", control, &value],
        )?;
        return Ok(());
    }
    let flag = match control.as_str() {
        "brightness" | "luminance" => "-b",
        "contrast" => "-c",
        _ => return Err("ddcctl supports brightness and contrast in this command".to_string()),
    };
    run_driver(&driver, &["-d", &display_id.to_string(), flag, &value])?;
    Ok(())
}

#[tauri::command]
pub async fn qx_external_displays_install_driver(
    req: ExternalDisplayInstallRequest,
) -> Result<ExternalDisplayInstallResult, String> {
    let driver = supported_install_driver(&req.driver)?.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(existing) = detected_driver().filter(|item| item.name == driver) {
            return Ok(ExternalDisplayInstallResult {
                driver,
                command: "already installed".to_string(),
                stdout: String::new(),
                stderr: String::new(),
                detected: Some(existing),
            });
        }

        let brew = brew_binary().ok_or_else(|| {
            "Homebrew is required to install DDC/CI tools automatically. Install Homebrew first, then retry."
                .to_string()
        })?;
        let command = format!("{} install {driver}", brew.display());
        let output = Command::new(&brew)
            .arg("install")
            .arg(&driver)
            .output()
            .map_err(|e| format!("run brew install {driver}: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detected = detected_driver().filter(|item| item.name == driver);

        if output.status.success() || detected.is_some() {
            return Ok(ExternalDisplayInstallResult {
                driver,
                command,
                stdout,
                stderr,
                detected,
            });
        }

        Err(if stderr.is_empty() {
            format!("brew install failed: {stdout}")
        } else {
            format!("brew install failed: {stderr}")
        })
    })
    .await
    .map_err(|e| format!("install task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_control_value_from_fraction() {
        let parsed = parse_control_value("Brightness: 32/100").unwrap();
        assert_eq!(parsed.current, 32);
        assert_eq!(parsed.max, 100);
    }

    #[test]
    fn parses_control_value_from_current_max() {
        let parsed = parse_control_value("current value = 128, max value = 255").unwrap();
        assert_eq!(parsed.current, 50);
        assert_eq!(parsed.max, 255);
    }

    #[test]
    fn parses_m1ddc_display_ids() {
        let ids = display_ids_from_m1ddc_list("Display 1: Dell\nDisplay 2: LG\n");
        assert_eq!(ids, vec![1, 2]);
    }

    #[test]
    fn validates_supported_install_drivers() {
        assert_eq!(supported_install_driver("m1ddc").unwrap(), "m1ddc");
        assert_eq!(supported_install_driver("ddcctl").unwrap(), "ddcctl");
        assert!(supported_install_driver("rm -rf").is_err());
    }
}
