use std::path::PathBuf;
use tauri::{command, AppHandle, Emitter};

const OAR_HOME: &str = ".oar";
const MODELSCOPE_REPO: &str = "greatv/oar-ocr";
const MODELSCOPE_API: &str = "https://www.modelscope.cn/api/v1/models";
const REVISION: &str = "master";

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

fn oar_home() -> PathBuf {
    if let Ok(val) = std::env::var("OAR_HOME") {
        PathBuf::from(val)
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
        PathBuf::from(format!("{}/{}", home, OAR_HOME))
    }
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

    // Skip if already downloaded
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

    // Real HTTP download with byte-level progress
    let client = crate::http_client::blocking_client(
        "Qx/0.2 (OCR Download; +https://github.com/mcxen/qx)",
        std::time::Duration::from_secs(120),
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

    // Get content length for progress calculation
    let content_length = resp.content_length().unwrap_or(0);

    // Stream download with progress
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

        // Emit progress every ~32KB
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

    // Write to disk
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
pub fn download_ocr_model(app: AppHandle, size: String) -> Result<String, String> {
    let pack = PACKS
        .iter()
        .find(|(name, _)| *name == size)
        .ok_or_else(|| format!("Unknown model size: {}. Use tiny/small/medium", size))?;
    let models = &pack.1;

    let target_dir = oar_home();

    // Calculate total size estimate for progress
    let sizes: Vec<u64> = vec![
        // Rough sizes in bytes (PP-OCRv6)
        match size.as_str() {
            "tiny" => 1780590 + 4462639 + 27156,     // ~6.3 MB
            "small" => 9880512 + 21159378 + 74947,   // ~31 MB
            "medium" => 62032837 + 76554979 + 74947, // ~138 MB
            _ => 6_000_000,
        },
    ];
    let grand_total = sizes[0];

    let mut total_bytes: u64 = 0;

    // Download each model file sequentially with progress
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
    let all_ok = det_ok && rec_ok && dict_ok;

    Ok(serde_json::json!({
        "downloaded": all_ok,
        "det": det_ok,
        "rec": rec_ok,
        "dict": dict_ok,
    }))
}
