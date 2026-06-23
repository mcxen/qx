use std::path::PathBuf;
use tauri::{command, AppHandle, Emitter};

/// Simulated download of an OCR model.
/// In the future this will download from HuggingFace / oar-ocr model repo.
/// For now it emits progress events and returns without actually downloading.
#[command]
pub fn download_ocr_model(app: AppHandle, size: String) -> Result<String, String> {
    let data_dir = dirs_data_dir();
    let models_dir = data_dir.join("ocr-models");
    std::fs::create_dir_all(&models_dir)
        .map_err(|e| format!("Failed to create models directory: {e}"))?;

    let model_name = format!("oar-ocr-{size}");
    let model_path = models_dir.join(&model_name);

    println!("Starting OCR model download: {model_name} -> {}", model_path.display());

    // Simulate download steps with progress events
    let steps = [
        (10, "Initializing download..."),
        (30, "Downloading model weights..."),
        (50, "Downloading config..."),
        (70, "Verifying checksum..."),
        (90, "Extracting model files..."),
        (100, "Download complete!"),
    ];

    for (percent, status) in &steps {
        let _ = app.emit(
            "ocr-download-progress",
            serde_json::json!({
                "percent": percent,
                "status": status,
            }),
        );

        // Small sleep to simulate work
        std::thread::sleep(std::time::Duration::from_millis(300));
    }

    println!("OCR model download complete: {} at {}", model_name, model_path.display());

    eprintln!(
        "Note: oar-ocr crate is not yet integrated. Model stub created at {}",
        model_path.display()
    );

    Ok(format!("download complete: {model_name}"))
}

fn dirs_data_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(format!("{}/.qx", home))
}
