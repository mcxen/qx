use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::screencap::AudioInput;

pub(crate) struct AudioCapture {
    child: Child,
    path: PathBuf,
}

fn executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "qx-ffmpeg.exe"
    } else {
        "qx-ffmpeg"
    }
}

fn development_binary_name() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "qx-ffmpeg-aarch64-apple-darwin";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "qx-ffmpeg-x86_64-apple-darwin";
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "qx-ffmpeg-x86_64-pc-windows-msvc.exe";
    #[allow(unreachable_code)]
    "qx-ffmpeg"
}

pub(crate) fn binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_exe() {
        if let Some(parent) = current.parent() {
            candidates.push(parent.join(executable_name()));
        }
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join(executable_name()));
        candidates.push(resources.join("binaries").join(executable_name()));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(development_binary_name()),
    );
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "Bundled FFmpeg is unavailable for this architecture".to_string())
}

fn ffmpeg_output(app: &AppHandle, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new(binary_path(app)?)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("run bundled FFmpeg: {error}"))
}

#[cfg(target_os = "macos")]
pub(crate) fn list_audio_inputs(app: &AppHandle) -> Result<Vec<AudioInput>, String> {
    let output = ffmpeg_output(
        app,
        &[
            "-hide_banner",
            "-f",
            "avfoundation",
            "-list_devices",
            "true",
            "-i",
            "",
        ],
    )?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut in_audio = false;
    let mut inputs = Vec::new();
    for line in stderr.lines() {
        if line.contains("AVFoundation audio devices") {
            in_audio = true;
            continue;
        }
        if !in_audio {
            continue;
        }
        let Some(open) = line.rfind('[') else {
            continue;
        };
        let Some(close_offset) = line[open + 1..].find(']') else {
            continue;
        };
        let close = open + 1 + close_offset;
        let id = line[open + 1..close].trim();
        if id.parse::<u32>().is_err() {
            continue;
        }
        let name = line[close + 1..].trim();
        if name.is_empty() {
            continue;
        }
        inputs.push(AudioInput {
            id: id.to_string(),
            name: name.to_string(),
            is_default: inputs.is_empty(),
            available: true,
        });
    }
    Ok(inputs)
}

#[cfg(target_os = "windows")]
pub(crate) fn list_audio_inputs(app: &AppHandle) -> Result<Vec<AudioInput>, String> {
    let output = ffmpeg_output(
        app,
        &[
            "-hide_banner",
            "-list_devices",
            "true",
            "-f",
            "dshow",
            "-i",
            "dummy",
        ],
    )?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut inputs = Vec::new();
    for line in stderr.lines().filter(|line| line.contains("(audio)")) {
        let Some(first) = line.find('"') else {
            continue;
        };
        let Some(last_offset) = line[first + 1..].find('"') else {
            continue;
        };
        let last = first + 1 + last_offset;
        let name = line[first + 1..last].trim();
        if name.is_empty() || inputs.iter().any(|item: &AudioInput| item.id == name) {
            continue;
        }
        inputs.push(AudioInput {
            id: name.to_string(),
            name: name.to_string(),
            is_default: inputs.is_empty(),
            available: true,
        });
    }
    Ok(inputs)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) fn list_audio_inputs(_app: &AppHandle) -> Result<Vec<AudioInput>, String> {
    Ok(Vec::new())
}

pub(crate) fn start_audio_capture(
    app: &AppHandle,
    microphone_id: &str,
    video_path: &Path,
) -> Result<AudioCapture, String> {
    let path = video_path.with_extension("capture-audio.m4a");
    let _ = fs::remove_file(&path);
    let mut command = Command::new(binary_path(app)?);
    command.args(["-hide_banner", "-loglevel", "warning", "-y"]);
    #[cfg(target_os = "macos")]
    command.args(["-f", "avfoundation", "-i", &format!(":{microphone_id}")]);
    #[cfg(target_os = "windows")]
    command.args(["-f", "dshow", "-i", &format!("audio={microphone_id}")]);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return Err("Microphone capture is unavailable on this platform".to_string());
    command
        .args(["-vn", "-c:a", "aac", "-b:a", "128k"])
        .arg(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = command
        .spawn()
        .map_err(|error| format!("start microphone capture: {error}"))?;
    Ok(AudioCapture { child, path })
}

fn stop_child(child: &mut Child) {
    if let Some(stdin) = child.stdin.as_mut() {
        let _ = stdin.write_all(b"q\n");
        let _ = stdin.flush();
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    let _ = child.kill();
    let _ = child.wait();
}

pub(crate) fn cancel_audio_capture(mut audio: AudioCapture) {
    stop_child(&mut audio.child);
    let _ = fs::remove_file(audio.path);
}

pub(crate) fn finish_audio_capture(
    app: &AppHandle,
    mut audio: AudioCapture,
    video_path: &Path,
) -> Result<(), String> {
    stop_child(&mut audio.child);
    let audio_size = fs::metadata(&audio.path)
        .map(|value| value.len())
        .unwrap_or(0);
    if audio_size < 256 {
        let _ = fs::remove_file(&audio.path);
        return Err("Microphone did not produce an audio track".to_string());
    }
    let extension = video_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4");
    let muxed = video_path.with_file_name(format!(
        "{}.muxing.{extension}",
        video_path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("recording")
    ));
    let _ = fs::remove_file(&muxed);
    let status = Command::new(binary_path(app)?)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(video_path)
        .arg("-i")
        .arg(&audio.path)
        .args([
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-shortest",
            "-movflags",
            "+faststart",
        ])
        .arg(&muxed)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("merge microphone audio: {error}"))?;
    let _ = fs::remove_file(&audio.path);
    if !status.success() || !muxed.is_file() {
        let _ = fs::remove_file(&muxed);
        return Err("Microphone audio could not be merged; the silent video was kept".to_string());
    }
    fs::copy(&muxed, video_path).map_err(|error| format!("install merged recording: {error}"))?;
    let _ = fs::remove_file(muxed);
    Ok(())
}
