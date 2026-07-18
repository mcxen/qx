use super::*;

#[derive(Debug, Serialize)]
pub struct ClipboardFileMetadata {
    path: String,
    name: String,
    extension: String,
    kind: String,
    size: u64,
    width: Option<u32>,
    height: Option<u32>,
    duration_seconds: Option<f64>,
    preview_path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ClipboardMediaProgress {
    job_id: String,
    operation: String,
    progress: f64,
    message: String,
    output_path: Option<String>,
    error: Option<String>,
}

fn media_kind(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "tif" | "tiff" | "heic" => "image",
        "mp4" | "mov" | "m4v" | "avi" | "mkv" | "webm" | "mpeg" | "mpg" => "video",
        "mp3" | "m4a" | "wav" | "aac" | "flac" | "ogg" => "audio",
        "pdf" => "pdf",
        _ if path.is_dir() => "folder",
        _ => "file",
    }
}

fn media_tool(name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(macos_dir) = executable.parent() {
            if let Some(contents_dir) = macos_dir.parent() {
                candidates.push(contents_dir.join("Resources/resources/media").join(name));
                candidates.push(contents_dir.join("Resources/resources/search").join(name));
            }
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join(name)));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin").join(name));
    candidates.push(PathBuf::from("/usr/local/bin").join(name));
    candidates.into_iter().find(|path| path.is_file())
}

fn ffprobe_duration(path: &Path) -> Option<f64> {
    let output = std::process::Command::new(media_tool("ffprobe")?)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=nw=1:nk=1",
        ])
        .arg(path)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().parse().ok())
        .flatten()
}

fn preview_cache_dir() -> Option<PathBuf> {
    let cache = get_image_dir().join("previews");
    fs::create_dir_all(&cache).ok()?;
    Some(cache)
}

const MAX_FILE_PREVIEW_BYTES: u64 = 128 * 1024 * 1024;
const MAX_FILE_PREVIEW_PIXELS: u64 = 32_000_000;

fn preview_worker_lock() -> &'static Mutex<()> {
    static LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn media_probe_lock() -> &'static Mutex<()> {
    static LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn image_preview(path: &Path) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if metadata.len() > MAX_FILE_PREVIEW_BYTES {
        return None;
    }
    let (width, height) = image::image_dimensions(path).ok()?;
    if u64::from(width).saturating_mul(u64::from(height)) > MAX_FILE_PREVIEW_PIXELS {
        return None;
    }

    let cache = preview_cache_dir()?;
    let key = compute_id(&path.to_string_lossy());
    let output = cache.join(format!("{key}.png"));
    if !output.exists() {
        let decoded = image::open(path).ok()?;
        decoded.thumbnail(1280, 1280).save(&output).ok()?;
    }
    Some(output.to_string_lossy().to_string())
}

fn video_preview(path: &Path) -> Option<String> {
    let cache = preview_cache_dir()?;
    let key = compute_id(&path.to_string_lossy());
    let output = cache.join(format!("{key}.jpg"));
    if !output.exists() {
        let status = std::process::Command::new(media_tool("ffmpeg")?)
            .args(["-y", "-loglevel", "error", "-ss", "0.2", "-i"])
            .arg(path)
            .args(["-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "3"])
            .arg(&output)
            .status()
            .ok()?;
        if !status.success() {
            return None;
        }
    }
    Some(output.to_string_lossy().to_string())
}

/// First-page PDF thumbnail. macOS uses Quick Look (`qlmanage`); other platforms best-effort.
fn pdf_preview(path: &Path) -> Option<String> {
    let cache = preview_cache_dir()?;
    let key = compute_id(&path.to_string_lossy());
    let output = cache.join(format!("{key}.png"));
    if output.exists() {
        return Some(output.to_string_lossy().to_string());
    }

    #[cfg(target_os = "macos")]
    {
        // qlmanage -t writes "<basename>.png" into -o directory.
        let status = std::process::Command::new("qlmanage")
            .args(["-t", "-s", "960", "-o"])
            .arg(&cache)
            .arg(path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .ok()?;
        if !status.success() {
            return None;
        }
        let generated = cache.join(format!("{}.png", path.file_name()?.to_string_lossy()));
        if generated.exists() {
            if generated != output {
                let _ = fs::rename(&generated, &output);
            }
            if output.exists() {
                return Some(output.to_string_lossy().to_string());
            }
        }
        // Some QL generators append extra suffixes — pick newest png matching basename.
        if let Ok(entries) = fs::read_dir(&cache) {
            let stem = path.file_stem()?.to_string_lossy().to_string();
            let mut candidates: Vec<_> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.extension().and_then(|e| e.to_str()) == Some("png")
                        && p.file_name()
                            .and_then(|n| n.to_str())
                            .is_some_and(|n| n.starts_with(&stem))
                })
                .collect();
            candidates.sort_by_key(|p| {
                std::cmp::Reverse(
                    p.metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .unwrap_or(std::time::SystemTime::UNIX_EPOCH),
                )
            });
            if let Some(found) = candidates.into_iter().next() {
                let _ = fs::rename(&found, &output);
                if output.exists() {
                    return Some(output.to_string_lossy().to_string());
                }
            }
        }
        return None;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (path, output);
        None
    }
}

/// Heavy preview generation (video frame / PDF page). Call off the UI path.
fn generate_file_preview(path: &Path) -> Option<String> {
    match media_kind(path) {
        "image" => image_preview(path),
        "video" => video_preview(path),
        "pdf" => pdf_preview(path),
        _ => None,
    }
}

/// Fast metadata only — stat + kind. No image decode, ffmpeg, or Quick Look.
fn inspect_file(path: PathBuf) -> Result<ClipboardFileMetadata, String> {
    // Prefer the path as given so selection stays snappy on slow/network volumes;
    // fall back to canonicalize only when the original cannot be statted.
    let raw = path;
    let (resolved, metadata) = match fs::metadata(&raw) {
        Ok(meta) => (raw.canonicalize().unwrap_or_else(|_| raw.clone()), meta),
        Err(_) => {
            let canon = raw
                .canonicalize()
                .map_err(|e| format!("file unavailable: {e}"))?;
            let meta = fs::metadata(&canon).map_err(|e| format!("read file metadata: {e}"))?;
            (canon, meta)
        }
    };
    let kind = media_kind(&resolved).to_string();
    Ok(ClipboardFileMetadata {
        path: resolved.to_string_lossy().to_string(),
        name: resolved
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("File")
            .to_string(),
        extension: resolved
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase(),
        kind,
        size: metadata.len(),
        width: None,
        height: None,
        duration_seconds: None,
        preview_path: None,
    })
}

#[command]
pub async fn clipboard_file_metadata(path: String) -> Result<ClipboardFileMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || inspect_file(PathBuf::from(path)))
        .await
        .map_err(|e| format!("metadata task failed: {e}"))?
}

/// Async preview path for image / video / PDF (cached under clipboard image dir).
#[command]
pub async fn clipboard_file_preview(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(path)
            .canonicalize()
            .map_err(|e| format!("file unavailable: {e}"))?;
        let _permit = match preview_worker_lock().try_lock() {
            Ok(permit) => permit,
            Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(std::sync::TryLockError::WouldBlock) => {
                return Err("preview worker busy".to_string());
            }
        };
        Ok(generate_file_preview(&path))
    })
    .await
    .map_err(|e| format!("preview task failed: {e}"))?
}

/// Optional media probe (dimensions / duration) — never blocks the info panel first paint.
#[command]
pub async fn clipboard_file_media_probe(path: String) -> Result<ClipboardFileMetadata, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut meta = inspect_file(PathBuf::from(&path))?;
        let p = PathBuf::from(&meta.path);
        let probe_permit = match media_probe_lock().try_lock() {
            Ok(permit) => Some(permit),
            Err(std::sync::TryLockError::Poisoned(poisoned)) => Some(poisoned.into_inner()),
            Err(std::sync::TryLockError::WouldBlock) => None,
        };
        if let Some(_permit) = probe_permit {
            if meta.kind == "image" {
                if let Ok((w, h)) = image::image_dimensions(&p) {
                    meta.width = Some(w);
                    meta.height = Some(h);
                }
            }
            if matches!(meta.kind.as_str(), "video" | "audio") {
                meta.duration_seconds = ffprobe_duration(&p);
            }
        }
        // Attach preview path if already cached (no generation).
        let key = compute_id(&meta.path);
        if let Some(cache) = preview_cache_dir() {
            let jpg = cache.join(format!("{key}.jpg"));
            let png = cache.join(format!("{key}.png"));
            if meta.kind == "image" {
                meta.preview_path = Some(meta.path.clone());
            } else if jpg.exists() {
                meta.preview_path = Some(jpg.to_string_lossy().to_string());
            } else if png.exists() {
                meta.preview_path = Some(png.to_string_lossy().to_string());
            }
        } else if meta.kind == "image" {
            meta.preview_path = Some(meta.path.clone());
        }
        Ok(meta)
    })
    .await
    .map_err(|e| format!("media probe failed: {e}"))?
}

#[cfg(target_os = "macos")]
fn write_file_to_clipboard(path: &Path) -> Result<(), String> {
    let script = "on run argv\nset the clipboard to POSIX file (item 1 of argv)\nend run";
    let status = std::process::Command::new("osascript")
        .args(["-e", script, "--"])
        .arg(path)
        .status()
        .map_err(|e| format!("write file clipboard: {e}"))?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| "write file clipboard failed".to_string())
}

/// Copy a generated media file as a native file reference without creating a
/// second history entry. Used by screenshot/recording post-capture actions.
pub(crate) fn write_file_path_to_clipboard(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err("the generated file no longer exists".to_string());
    }
    write_file_to_clipboard(path)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn write_file_to_clipboard(_path: &Path) -> Result<(), String> {
    Err("file clipboard is currently supported on macOS".to_string())
}

#[cfg(target_os = "windows")]
fn write_file_to_clipboard(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };
    use windows_sys::Win32::UI::Shell::DROPFILES;

    const CF_HDROP: u32 = 15;
    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    wide.push(0);
    wide.push(0);
    let header_size = std::mem::size_of::<DROPFILES>();
    let total_size = header_size + wide.len() * std::mem::size_of::<u16>();

    unsafe {
        let allocation = GlobalAlloc(GMEM_MOVEABLE, total_size);
        if allocation.is_null() {
            return Err("allocate Windows file clipboard data failed".to_string());
        }
        let data = GlobalLock(allocation);
        if data.is_null() {
            GlobalFree(allocation);
            return Err("lock Windows file clipboard data failed".to_string());
        }
        let header = DROPFILES {
            pFiles: header_size as u32,
            pt: windows_sys::Win32::Foundation::POINT { x: 0, y: 0 },
            fNC: 0,
            fWide: 1,
        };
        std::ptr::write_unaligned(data.cast::<DROPFILES>(), header);
        std::ptr::copy_nonoverlapping(
            wide.as_ptr().cast::<u8>(),
            data.cast::<u8>().add(header_size),
            wide.len() * std::mem::size_of::<u16>(),
        );
        GlobalUnlock(allocation);

        if OpenClipboard(std::ptr::null_mut()) == 0 {
            GlobalFree(allocation);
            return Err("open Windows clipboard failed".to_string());
        }
        EmptyClipboard();
        let result = SetClipboardData(CF_HDROP, allocation);
        CloseClipboard();
        if result.is_null() {
            GlobalFree(allocation);
            return Err("set Windows file clipboard data failed".to_string());
        }
    }
    Ok(())
}

#[command]
pub fn write_clipboard_file_entry(
    state: tauri::State<'_, ClipboardDb>,
    id: String,
) -> Result<(), String> {
    let (path, snapshot): (String, Option<String>) = {
        let mut guard = lock_db(&state.0);
        let conn = ensure_connection(&mut guard).map_err(|e| format!("{e}"))?;
        conn.query_row(
            "SELECT file_path, image_pasteboard_path FROM clipboard_history WHERE id = ?1 AND file_path IS NOT NULL",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|e| format!("clipboard file entry not found: {e}"))?
    };
    if let Some(snapshot) = snapshot {
        if restore_pasteboard_snapshot(&snapshot).is_ok() {
            return Ok(());
        }
    }
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("the original file no longer exists".to_string());
    }
    write_file_to_clipboard(&path)
}

fn generated_media_dir() -> PathBuf {
    let base = dirs::picture_dir().unwrap_or_else(|| get_image_dir());
    let dir = base.join("Qx");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn insert_generated_file(app: &AppHandle, path: &Path) -> Result<(), String> {
    write_file_to_clipboard(path)?;
    let path_string = path.to_string_lossy().to_string();
    let id = compute_id(&path_string);
    let snapshot = snapshot_current_pasteboard(&id);
    let state = app.state::<ClipboardDb>();
    store(&state.0, "", None, snapshot.as_deref(), Some(&path_string));
    let _ = app.emit("clipboard-updated", ());
    Ok(())
}

fn emit_media_progress(app: &AppHandle, payload: ClipboardMediaProgress) {
    let _ = app.emit("clipboard-media-progress", payload);
}

#[command]
pub fn clipboard_compress_image(
    app: AppHandle,
    path: String,
    quality: Option<u8>,
) -> Result<String, String> {
    let input = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| format!("image unavailable: {e}"))?;
    if media_kind(&input) != "image" {
        return Err("selected file is not an image".to_string());
    }
    let job_id = format!("image-{}", chrono::Utc::now().timestamp_millis());
    let thread_job_id = job_id.clone();
    std::thread::spawn(move || {
        emit_media_progress(
            &app,
            ClipboardMediaProgress {
                job_id: thread_job_id.clone(),
                operation: "compress-image".into(),
                progress: 5.0,
                message: "Reading image".into(),
                output_path: None,
                error: None,
            },
        );
        let result = (|| -> Result<PathBuf, String> {
            let image = image::open(&input).map_err(|e| format!("decode image: {e}"))?;
            emit_media_progress(
                &app,
                ClipboardMediaProgress {
                    job_id: thread_job_id.clone(),
                    operation: "compress-image".into(),
                    progress: 45.0,
                    message: "Compressing image".into(),
                    output_path: None,
                    error: None,
                },
            );
            let stem = input
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("image");
            let output = generated_media_dir().join(format!("{stem}-qx-compressed.jpg"));
            let file =
                fs::File::create(&output).map_err(|e| format!("create compressed image: {e}"))?;
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
                file,
                quality.unwrap_or(78).clamp(20, 95),
            );
            encoder
                .encode_image(&image)
                .map_err(|e| format!("encode jpeg: {e}"))?;
            insert_generated_file(&app, &output)?;
            Ok(output)
        })();
        match result {
            Ok(output) => emit_media_progress(
                &app,
                ClipboardMediaProgress {
                    job_id: thread_job_id,
                    operation: "compress-image".into(),
                    progress: 100.0,
                    message: "Compressed image copied".into(),
                    output_path: Some(output.to_string_lossy().to_string()),
                    error: None,
                },
            ),
            Err(error) => emit_media_progress(
                &app,
                ClipboardMediaProgress {
                    job_id: thread_job_id,
                    operation: "compress-image".into(),
                    progress: 0.0,
                    message: "Compression failed".into(),
                    output_path: None,
                    error: Some(error),
                },
            ),
        }
    });
    Ok(job_id)
}

#[command]
pub fn clipboard_video_to_gif(app: AppHandle, path: String) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    let input = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| format!("video unavailable: {e}"))?;
    if media_kind(&input) != "video" {
        return Err("selected file is not a video".to_string());
    }
    let job_id = format!("video-{}", chrono::Utc::now().timestamp_millis());
    let thread_job_id = job_id.clone();
    std::thread::spawn(move || {
        let result = (|| -> Result<PathBuf, String> {
            let duration = ffprobe_duration(&input).unwrap_or(1.0).max(0.1);
            let stem = input
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("video");
            let output = generated_media_dir().join(format!("{stem}-qx.gif"));
            let ffmpeg = media_tool("ffmpeg").ok_or_else(|| {
                "ffmpeg is required for video conversion; install it with Homebrew or bundle it in Qx resources".to_string()
            })?;
            let mut child = std::process::Command::new(ffmpeg)
                .args(["-y", "-i"])
                .arg(&input)
                .args([
                    "-vf",
                    "fps=12,scale=720:-2:flags=lanczos",
                    "-progress",
                    "pipe:1",
                    "-nostats",
                ])
                .arg(&output)
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("start ffmpeg: {e}"))?;
            if let Some(stdout) = child.stdout.take() {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if let Some(value) = line
                        .strip_prefix("out_time_ms=")
                        .and_then(|value| value.parse::<f64>().ok())
                    {
                        let progress = ((value / 1_000_000.0) / duration * 96.0).clamp(1.0, 96.0);
                        emit_media_progress(
                            &app,
                            ClipboardMediaProgress {
                                job_id: thread_job_id.clone(),
                                operation: "video-to-gif".into(),
                                progress,
                                message: "Converting video to GIF".into(),
                                output_path: None,
                                error: None,
                            },
                        );
                    }
                }
            }
            let status = child.wait().map_err(|e| format!("wait for ffmpeg: {e}"))?;
            if !status.success() {
                return Err("ffmpeg conversion failed".to_string());
            }
            insert_generated_file(&app, &output)?;
            Ok(output)
        })();
        match result {
            Ok(output) => emit_media_progress(
                &app,
                ClipboardMediaProgress {
                    job_id: thread_job_id,
                    operation: "video-to-gif".into(),
                    progress: 100.0,
                    message: "GIF copied to clipboard".into(),
                    output_path: Some(output.to_string_lossy().to_string()),
                    error: None,
                },
            ),
            Err(error) => emit_media_progress(
                &app,
                ClipboardMediaProgress {
                    job_id: thread_job_id,
                    operation: "video-to-gif".into(),
                    progress: 0.0,
                    message: "GIF conversion failed".into(),
                    output_path: None,
                    error: Some(error),
                },
            ),
        }
    });
    Ok(job_id)
}

#[command]
pub fn read_image_file(path: String) -> Result<Vec<u8>, String> {
    use std::fs;
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read image file: {e}"))?;
    if is_supported_image_bytes(&bytes) {
        Ok(bytes)
    } else {
        Err("File is not a supported clipboard image".to_string())
    }
}

fn is_supported_image_bytes(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a])
        || bytes.starts_with(&[0xff, 0xd8, 0xff])
        || bytes.starts_with(b"GIF87a")
        || bytes.starts_with(b"GIF89a")
        || (bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP")
}
