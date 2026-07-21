//! Qx system OCR capability.
//!
//! - Platform engines: Apple Vision (macOS), Windows.Media.Ocr (Windows)
//! - Optional OAR model packs under `~/.oar` (download only; runtime uses platform
//!   engines until a bundled ONNX pipeline is wired)
//! - Persistent history for Settings → OCR

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{command, AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

const OAR_HOME: &str = ".oar";
const MODELSCOPE_REPO: &str = "greatv/oar-ocr";
const MODELSCOPE_API: &str = "https://www.modelscope.cn/api/v1/models";
const REVISION: &str = "master";
const HISTORY_LIMIT_DEFAULT: u32 = 80;
const HISTORY_LIMIT_MAX: u32 = 200;

struct ModelPack {
    det: &'static str,
    rec: &'static str,
    dict: &'static str,
}

static PACKS: &[(&str, ModelPack)] = &[
    (
        "tiny",
        ModelPack {
            det: "pp-ocrv6_tiny_det.onnx",
            rec: "pp-ocrv6_tiny_rec.onnx",
            dict: "ppocrv6_tiny_dict.txt",
        },
    ),
    (
        "small",
        ModelPack {
            det: "pp-ocrv6_small_det.onnx",
            rec: "pp-ocrv6_small_rec.onnx",
            dict: "ppocrv6_dict.txt",
        },
    ),
    (
        "medium",
        ModelPack {
            det: "pp-ocrv6_medium_det.onnx",
            rec: "pp-ocrv6_medium_rec.onnx",
            dict: "ppocrv6_dict.txt",
        },
    ),
];

static DB: OnceLock<Mutex<Option<Connection>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrHistoryEntry {
    pub id: String,
    pub text: String,
    pub source: String,
    pub source_path: Option<String>,
    pub engine: String,
    pub created_at: String,
    pub char_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRecognizeResult {
    pub id: String,
    pub text: String,
    pub engine: String,
    pub source: String,
    pub source_path: Option<String>,
    pub char_count: usize,
    pub created_at: String,
}

fn oar_home() -> PathBuf {
    if let Ok(val) = std::env::var("OAR_HOME") {
        PathBuf::from(val)
    } else {
        crate::paths::home_dir().join(OAR_HOME)
    }
}

fn history_db_path() -> PathBuf {
    crate::paths::data_dir().join("ocr_history.db")
}

fn open_db() -> Result<Connection, String> {
    let path = history_db_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("ocr history dir: {e}"))?;
    }
    let conn = Connection::open(&path).map_err(|e| format!("open ocr history: {e}"))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS ocr_history (
           id TEXT PRIMARY KEY NOT NULL,
           text TEXT NOT NULL,
           source TEXT NOT NULL,
           source_path TEXT,
           engine TEXT NOT NULL,
           created_at TEXT NOT NULL,
           char_count INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_ocr_history_created
           ON ocr_history(created_at DESC);",
    )
    .map_err(|e| format!("ocr history schema: {e}"))?;
    Ok(conn)
}

fn with_db<T>(f: impl FnOnce(&Connection) -> Result<T, String>) -> Result<T, String> {
    let slot = DB.get_or_init(|| Mutex::new(None));
    let mut guard = slot
        .lock()
        .map_err(|_| "ocr history lock poisoned".to_string())?;
    if guard.is_none() {
        *guard = Some(open_db()?);
    }
    let conn = guard
        .as_ref()
        .ok_or_else(|| "ocr history unavailable".to_string())?;
    f(conn)
}

fn insert_history(
    text: &str,
    source: &str,
    source_path: Option<&str>,
    engine: &str,
) -> Result<OcrHistoryEntry, String> {
    let hash = blake3::hash(format!("{text}{source}{}", Local::now()).as_bytes());
    let id = hash.to_hex()[..16].to_string();
    let created_at = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let char_count = text.chars().count() as i64;
    with_db(|conn| {
        conn.execute(
            "INSERT INTO ocr_history (id, text, source, source_path, engine, created_at, char_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                text,
                source,
                source_path,
                engine,
                created_at,
                char_count
            ],
        )
        .map_err(|e| format!("insert ocr history: {e}"))?;
        // Cap growth.
        let _ = conn.execute(
            "DELETE FROM ocr_history WHERE id NOT IN (
               SELECT id FROM ocr_history ORDER BY created_at DESC LIMIT ?1
             )",
            params![HISTORY_LIMIT_MAX as i64],
        );
        Ok(())
    })?;
    Ok(OcrHistoryEntry {
        id,
        text: text.to_string(),
        source: source.to_string(),
        source_path: source_path.map(|s| s.to_string()),
        engine: engine.to_string(),
        created_at,
        char_count,
    })
}

fn resolve_engine_name() -> (String, String) {
    let settings = crate::settings::read_settings();
    let enabled = settings.advanced.ocr_enabled;
    let engine = settings.advanced.ocr_engine;
    (
        if enabled { engine } else { String::new() },
        settings.advanced.ocr_model_size,
    )
}

fn ensure_ocr_enabled() -> Result<(), String> {
    let settings = crate::settings::read_settings();
    if !settings.advanced.ocr_enabled {
        return Err("OCR is disabled. Enable it in Settings → OCR.".to_string());
    }
    Ok(())
}

fn download_file(
    app: &AppHandle,
    filename: &str,
    target_dir: &PathBuf,
    total_bytes: &mut u64,
    grand_total: u64,
) -> Result<(), String> {
    let url = format!(
        "{}/{}/repo?Revision={}&FilePath={}",
        MODELSCOPE_API, MODELSCOPE_REPO, REVISION, filename
    );
    let target_path = target_dir.join(filename);

    if target_path.exists() {
        *total_bytes += target_path.metadata().map(|m| m.len()).unwrap_or(0);
        let pct = if grand_total > 0 {
            (*total_bytes * 100 / grand_total).min(99)
        } else {
            0
        };
        let _ = app.emit(
            "ocr-download-progress",
            serde_json::json!({
                "percent": pct,
                "status": format!("Already cached: {}", filename),
            }),
        );
        return Ok(());
    }

    let _ = app.emit(
        "ocr-download-progress",
        serde_json::json!({
            "percent": if grand_total > 0 { (*total_bytes * 100 / grand_total).min(99) } else { 0 },
            "status": format!("Downloading: {}...", filename),
        }),
    );

    let client = crate::http_client::blocking_client(
        "Qx/0.2 (OCR Download; +https://github.com/mcxen/qx)",
        Duration::from_secs(120),
        None,
    )
    .map_err(|e| format!("HTTP client: {}", e))?;

    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("HTTP request failed for {}: {}", filename, e))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {} for {}", resp.status(), filename));
    }

    let content_length = resp.content_length().unwrap_or(0);
    let mut response_bytes = Vec::new();
    let mut downloaded: u64 = 0;
    let mut stream = resp;
    let mut buf = [0u8; 8192];
    loop {
        use std::io::Read;
        let n = stream
            .read(&mut buf)
            .map_err(|e| format!("Read error for {}: {}", filename, e))?;
        if n == 0 {
            break;
        }
        response_bytes.extend_from_slice(&buf[..n]);
        downloaded += n as u64;

        if downloaded % 32768 < n as u64 {
            let file_done = downloaded.min(content_length);
            let file_pct = if content_length > 0 {
                (file_done * 100 / content_length).min(99)
            } else {
                0
            };
            let total_done = *total_bytes + file_done;
            let overall_pct = if grand_total > 0 {
                (total_done * 100 / grand_total).min(99)
            } else {
                0
            };
            let _ = app.emit(
                "ocr-download-progress",
                serde_json::json!({
                    "percent": overall_pct,
                    "status": format!("Downloading: {} ({}%)", filename, file_pct),
                }),
            );
        }
    }

    std::fs::create_dir_all(target_dir).map_err(|e| format!("Create models dir: {}", e))?;
    std::fs::write(&target_path, &response_bytes)
        .map_err(|e| format!("Write {}: {}", filename, e))?;

    *total_bytes += downloaded;
    let overall_pct = if grand_total > 0 {
        (*total_bytes * 100 / grand_total).min(99)
    } else {
        99
    };
    let _ = app.emit(
        "ocr-download-progress",
        serde_json::json!({
            "percent": overall_pct,
            "status": format!("Downloaded: {} ({:.1} MB)", filename, downloaded as f64 / 1_048_576.0),
        }),
    );

    Ok(())
}

#[command]
pub async fn download_ocr_model(app: AppHandle, size: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let pack = PACKS
            .iter()
            .find(|(name, _)| *name == size)
            .ok_or_else(|| format!("Unknown model size: {}. Use tiny/small/medium", size))?;
        let models = &pack.1;
        let target_dir = oar_home();
        let grand_total = match size.as_str() {
            "tiny" => 1780590 + 4462639 + 27156,
            "small" => 9880512 + 21159378 + 74947,
            "medium" => 62032837 + 76554979 + 74947,
            _ => 6_000_000,
        };
        let mut total_bytes: u64 = 0;
        download_file(&app, models.det, &target_dir, &mut total_bytes, grand_total)?;
        download_file(&app, models.rec, &target_dir, &mut total_bytes, grand_total)?;
        download_file(
            &app,
            models.dict,
            &target_dir,
            &mut total_bytes,
            grand_total,
        )?;
        let _ = app.emit(
            "ocr-download-progress",
            serde_json::json!({
                "percent": 100,
                "status": "Download complete!",
            }),
        );
        Ok(format!(
            "oar-ocr-{} models downloaded to {}",
            size,
            target_dir.display()
        ))
    })
    .await
    .map_err(|e| format!("OCR download task panicked: {e}"))?
}

#[command]
pub fn check_ocr_models(size: String) -> Result<serde_json::Value, String> {
    let pack = PACKS
        .iter()
        .find(|(name, _)| *name == size)
        .ok_or_else(|| format!("Unknown size: {}", size))?;
    let models = &pack.1;
    let dir = oar_home();
    let det_ok = dir.join(models.det).exists();
    let rec_ok = dir.join(models.rec).exists();
    let dict_ok = dir.join(models.dict).exists();
    Ok(serde_json::json!({
        "downloaded": det_ok && rec_ok && dict_ok,
        "det": det_ok,
        "rec": rec_ok,
        "dict": dict_ok,
    }))
}

/// Recognize text from an image on disk. Records history on success.
pub(crate) fn recognize_image_path(
    path: &Path,
    source: &str,
) -> Result<OcrRecognizeResult, String> {
    ensure_ocr_enabled()?;
    if !path.is_file() {
        return Err(format!("OCR image not found: {}", path.display()));
    }
    let (engine_pref, _model_size) = resolve_engine_name();
    if engine_pref.is_empty() {
        return Err("OCR is disabled. Enable it in Settings → OCR.".to_string());
    }

    let (text, engine_used) = recognize_with_engine(path, &engine_pref)?;
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err("No text recognized in the image".to_string());
    }
    let path_str = path.to_string_lossy().to_string();
    let entry = insert_history(&text, source, Some(&path_str), &engine_used)?;
    Ok(OcrRecognizeResult {
        id: entry.id,
        text,
        engine: engine_used,
        source: source.to_string(),
        source_path: Some(path_str),
        char_count: entry.char_count as usize,
        created_at: entry.created_at,
    })
}

fn recognize_with_engine(path: &Path, engine_pref: &str) -> Result<(String, String), String> {
    // Prefer the configured host engine. OAR model packs are downloadable for
    // future ONNX inference; recognition currently uses OS OCR (reliable, offline).
    match engine_pref {
        "apple-vision" => {
            #[cfg(target_os = "macos")]
            {
                recognize_apple_vision(path).map(|t| (t, "apple-vision".to_string()))
            }
            #[cfg(not(target_os = "macos"))]
            {
                Err("Apple Vision OCR is only available on macOS. Switch engine to OAR-OCR (uses Windows OCR on this platform).".to_string())
            }
        }
        _ => {
            #[cfg(target_os = "macos")]
            {
                recognize_apple_vision(path).map(|t| {
                    let label = if engine_pref == "oar-ocr" {
                        "apple-vision"
                    } else {
                        engine_pref
                    };
                    (t, label.to_string())
                })
            }
            #[cfg(target_os = "windows")]
            {
                recognize_windows_ocr(path).map(|t| (t, "windows-ocr".to_string()))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            {
                let _ = path;
                Err("OCR is not supported on this platform".to_string())
            }
        }
    }
}

#[cfg(target_os = "macos")]
#[link(name = "Vision", kind = "framework")]
extern "C" {}

#[cfg(target_os = "macos")]
fn recognize_apple_vision(path: &Path) -> Result<String, String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2_foundation::NSString;

    let bytes = std::fs::read(path).map_err(|e| format!("read OCR image: {e}"))?;
    if bytes.is_empty() {
        return Err("OCR image is empty".to_string());
    }

    unsafe {
        // NSData from bytes
        let data_cls = AnyClass::get(c"NSData").ok_or("NSData class missing")?;
        let data: *mut AnyObject = msg_send![
            data_cls,
            dataWithBytes: bytes.as_ptr()
            length: bytes.len()
        ];
        if data.is_null() {
            return Err("failed to wrap image bytes for OCR".to_string());
        }

        let handler_cls =
            AnyClass::get(c"VNImageRequestHandler").ok_or("VNImageRequestHandler missing")?;
        let handler_alloc: *mut AnyObject = msg_send![handler_cls, alloc];
        // Empty options dictionary
        let dict_cls = AnyClass::get(c"NSDictionary").ok_or("NSDictionary class missing")?;
        let options: *mut AnyObject = msg_send![dict_cls, dictionary];
        let handler: *mut AnyObject = msg_send![
            handler_alloc,
            initWithData: data
            options: options
        ];
        if handler.is_null() {
            return Err(format!(
                "failed to create VNImageRequestHandler for {}",
                path.display()
            ));
        }

        let request_cls =
            AnyClass::get(c"VNRecognizeTextRequest").ok_or("VNRecognizeTextRequest missing")?;
        let request: *mut AnyObject = msg_send![request_cls, new];
        if request.is_null() {
            return Err("failed to create VNRecognizeTextRequest".to_string());
        }
        // VNRequestTextRecognitionLevelAccurate = 0
        let _: () = msg_send![request, setRecognitionLevel: 0i64];
        let _: () = msg_send![request, setUsesLanguageCorrection: Bool::YES];

        let array_cls = AnyClass::get(c"NSArray").ok_or("NSArray class missing")?;
        let requests: *mut AnyObject = msg_send![array_cls, arrayWithObject: request];
        let mut error: *mut AnyObject = std::ptr::null_mut();
        let ok: Bool = msg_send![handler, performRequests: requests error: &mut error];
        if !ok.as_bool() {
            return Err("Apple Vision OCR request failed".to_string());
        }

        let results: *mut AnyObject = msg_send![request, results];
        if results.is_null() {
            return Ok(String::new());
        }
        let count: usize = msg_send![results, count];
        let mut lines = Vec::with_capacity(count);
        for i in 0..count {
            let observation: *mut AnyObject = msg_send![results, objectAtIndex: i];
            if observation.is_null() {
                continue;
            }
            let candidates: *mut AnyObject = msg_send![observation, topCandidates: 1usize];
            if candidates.is_null() {
                continue;
            }
            let cand_count: usize = msg_send![candidates, count];
            if cand_count == 0 {
                continue;
            }
            let candidate: *mut AnyObject = msg_send![candidates, objectAtIndex: 0usize];
            if candidate.is_null() {
                continue;
            }
            let string: *mut AnyObject = msg_send![candidate, string];
            if string.is_null() {
                continue;
            }
            let ns: &NSString = &*(string as *const NSString);
            let line = ns.to_string();
            if !line.trim().is_empty() {
                lines.push(line);
            }
        }
        Ok(lines.join("\n"))
    }
}

#[cfg(target_os = "windows")]
fn recognize_windows_ocr(path: &Path) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    // Ensure PNG/JPEG path is absolute for PowerShell.
    let abs = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let path_str = abs.to_string_lossy().replace('\'', "''");

    // Windows.Media.Ocr via WinRT interop in PowerShell.
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
function Await($WinRtTask, $ResultType) {{
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {{
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  }})[0]
  $netTask = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}}
$path = '{path}'
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {{ throw 'Windows OCR engine unavailable' }}
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$result.Text
"#,
        path = path_str
    );

    let output = std::process::Command::new(crate::windows_process::powershell_binary())
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Windows OCR process: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Windows OCR failed: {stderr}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[command]
pub async fn ocr_recognize_path(
    path: String,
    source: Option<String>,
) -> Result<OcrRecognizeResult, String> {
    let source = source.unwrap_or_else(|| "file".to_string());
    crate::runtime::blocking(move || recognize_image_path(Path::new(&path), &source))
        .await
        .map_err(|e| format!("OCR worker: {e}"))?
}

#[command]
pub async fn ocr_recognize_clipboard_image(
    app: AppHandle,
    id: String,
) -> Result<OcrRecognizeResult, String> {
    let app_for_store = app.clone();
    let entry_id = id.clone();
    let result = crate::runtime::blocking(move || {
        ensure_ocr_enabled()?;
        let db = app
            .try_state::<crate::clipboard::ClipboardDb>()
            .ok_or_else(|| "Clipboard database unavailable".to_string())?;
        let path = crate::clipboard::image_path_for_entry(&db, &id)?
            .ok_or_else(|| "Selected clipboard item has no image".to_string())?;
        recognize_image_path(Path::new(&path), "clipboard")
    })
    .await
    .map_err(|e| format!("OCR worker: {e}"))??;
    if let Some(db) = app_for_store.try_state::<crate::clipboard::ClipboardDb>() {
        let _ = crate::clipboard::set_entry_ocr_text(&db, &entry_id, &result.text);
        let _ = app_for_store.emit("clipboard-updated", ());
    }
    Ok(result)
}

/// OCR all clipboard images that do not yet have cached text (bounded batch).
#[command]
pub async fn clipboard_ocr_pending(
    app: AppHandle,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    ensure_ocr_enabled()?;
    let limit = limit.unwrap_or(20).min(50);
    let db = app
        .try_state::<crate::clipboard::ClipboardDb>()
        .ok_or_else(|| "Clipboard database unavailable".to_string())?;
    let candidates = crate::clipboard::list_entries_needing_ocr(&db, limit)?;
    let total = candidates.len();
    let mut done = 0usize;
    let mut failed = 0usize;
    for (id, path) in candidates {
        let path_buf = PathBuf::from(&path);
        let entry_id = id.clone();
        let recognize =
            crate::runtime::blocking(move || recognize_image_path(&path_buf, "clipboard")).await;
        match recognize {
            Ok(Ok(result)) => {
                let _ = crate::clipboard::set_entry_ocr_text(&db, &entry_id, &result.text);
                done += 1;
            }
            _ => failed += 1,
        }
    }
    if done > 0 {
        let _ = app.emit("clipboard-updated", ());
    }
    Ok(serde_json::json!({
        "total": total,
        "done": done,
        "failed": failed,
    }))
}

#[command]
pub fn ocr_list_history(limit: Option<u32>) -> Result<Vec<OcrHistoryEntry>, String> {
    let limit = limit
        .unwrap_or(HISTORY_LIMIT_DEFAULT)
        .min(HISTORY_LIMIT_MAX);
    with_db(|conn| {
        let mut stmt = conn
            .prepare(
                "SELECT id, text, source, source_path, engine, created_at, char_count
                 FROM ocr_history
                 ORDER BY created_at DESC
                 LIMIT ?1",
            )
            .map_err(|e| format!("ocr history query: {e}"))?;
        let rows = stmt
            .query_map(params![limit as i64], |row| {
                Ok(OcrHistoryEntry {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    source: row.get(2)?,
                    source_path: row.get(3)?,
                    engine: row.get(4)?,
                    created_at: row.get(5)?,
                    char_count: row.get(6)?,
                })
            })
            .map_err(|e| format!("ocr history rows: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.map_err(|e| format!("ocr history row: {e}"))?);
        }
        Ok(out)
    })
}

#[command]
pub fn ocr_delete_history(id: String) -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM ocr_history WHERE id = ?1", params![id])
            .map_err(|e| format!("delete ocr history: {e}"))?;
        Ok(())
    })
}

#[command]
pub fn ocr_clear_history() -> Result<(), String> {
    with_db(|conn| {
        conn.execute("DELETE FROM ocr_history", [])
            .map_err(|e| format!("clear ocr history: {e}"))?;
        Ok(())
    })
}

#[command]
pub async fn ocr_copy_result_text(app: AppHandle, text: String) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("Nothing to copy".to_string());
    }
    let app_ui = app.clone();
    crate::runtime::ui(&app, move || {
        app_ui
            .clipboard()
            .write_text(text)
            .map_err(|e| format!("copy OCR text: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[command]
pub fn ocr_status() -> Result<serde_json::Value, String> {
    let settings = crate::settings::read_settings();
    let size = settings.advanced.ocr_model_size.clone();
    let models = check_ocr_models(size.clone()).unwrap_or_else(
        |_| serde_json::json!({ "downloaded": false, "det": false, "rec": false, "dict": false }),
    );
    Ok(serde_json::json!({
        "enabled": settings.advanced.ocr_enabled,
        "engine": settings.advanced.ocr_engine,
        "modelSize": size,
        "models": models,
        "platform": std::env::consts::OS,
    }))
}
