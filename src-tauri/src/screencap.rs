use chrono::Local;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::command;

const FPS: u32 = 15;
const MAX_RECORDING_SECONDS: u64 = 180;
const MAX_FRAME_COUNT: u64 = FPS as u64 * MAX_RECORDING_SECONDS;
const MAX_TEMP_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordArea {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Serialize)]
pub struct GifEntry {
    pub id: i64,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub frame_count: u32,
    pub duration_ms: u64,
    pub created_at: i64,
}

struct RecordingState {
    temp_dir: PathBuf,
    stop_flag: std::sync::Arc<AtomicBool>,
    thread_handle: Option<std::thread::JoinHandle<()>>,
    started_at: std::time::Instant,
}

static RECORDING: OnceLock<Mutex<Option<RecordingState>>> = OnceLock::new();

fn recording_state() -> &'static Mutex<Option<RecordingState>> {
    RECORDING.get_or_init(|| Mutex::new(None))
}

fn gifs_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/Pictures/Qx", home));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn db_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/Library/Application Support/qx", home));
    let _ = fs::create_dir_all(&dir);
    dir.join("screencap.db")
}

fn open_db() -> rusqlite::Result<Connection> {
    let conn = Connection::open(db_path())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS gif_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            frame_count INTEGER,
            duration_ms INTEGER,
            created_at INTEGER NOT NULL
        );",
    )?;
    Ok(conn)
}

fn insert_history(
    path: &std::path::Path,
    w: u32,
    h: u32,
    frames: u32,
    duration_ms: u64,
) -> rusqlite::Result<i64> {
    let conn = open_db()?;
    let now = Local::now().timestamp();
    conn.execute(
        "INSERT INTO gif_history (file_path, width, height, frame_count, duration_ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![path.to_string_lossy(), w, h, frames, duration_ms, now],
    )?;
    Ok(conn.last_insert_rowid())
}

fn bgra_to_rgba(bgra: &[u8]) -> Vec<u8> {
    let mut rgba = Vec::with_capacity(bgra.len());
    for chunk in bgra.chunks_exact(4) {
        rgba.push(chunk[2]);
        rgba.push(chunk[1]);
        rgba.push(chunk[0]);
        rgba.push(chunk[3]);
    }
    rgba
}

fn recording_loop(
    temp_dir: PathBuf,
    area: Option<RecordArea>,
    stop_flag: std::sync::Arc<AtomicBool>,
) {
    use scrap::{Capturer, Display};

    let display = match Display::primary() {
        Ok(d) => d,
        Err(_) => return,
    };
    let mut capturer = match Capturer::new(display) {
        Ok(c) => c,
        Err(_) => return,
    };
    let (full_w, full_h) = (capturer.width() as u32, capturer.height() as u32);

    let delay = std::time::Duration::from_millis(1000 / FPS as u64);

    let mut frame_idx: u64 = 0;
    let mut temp_bytes: u64 = 0;
    let started_at = std::time::Instant::now();
    while !stop_flag.load(Ordering::Relaxed) {
        if frame_idx >= MAX_FRAME_COUNT
            || temp_bytes >= MAX_TEMP_BYTES
            || started_at.elapsed() >= std::time::Duration::from_secs(MAX_RECORDING_SECONDS)
        {
            break;
        }

        match capturer.frame() {
            Ok(frame) => {
                let rgba = bgra_to_rgba(&frame);
                if let Some(img) = image::RgbaImage::from_raw(full_w, full_h, rgba) {
                    let final_img = if let Some(a) = &area {
                        let cw = a.w.min(full_w.saturating_sub(a.x));
                        let ch = a.h.min(full_h.saturating_sub(a.y));
                        if cw == 0 || ch == 0 {
                            img
                        } else {
                            image::imageops::crop_imm(&img, a.x, a.y, cw, ch).to_image()
                        }
                    } else {
                        img
                    };
                    let path = temp_dir.join(format!("frame_{:06}.png", frame_idx));
                    if final_img.save(&path).is_ok() {
                        if let Ok(meta) = fs::metadata(&path) {
                            temp_bytes = temp_bytes.saturating_add(meta.len());
                        }
                    }
                }
                frame_idx += 1;
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(delay);
                continue;
            }
            Err(_) => break,
        }
        std::thread::sleep(delay);
    }
}

#[command]
pub fn start_recording(area: Option<RecordArea>) -> Result<(), String> {
    let mut guard = recording_state().lock().map_err(|e| format!("lock: {e}"))?;
    if guard.is_some() {
        return Err("Already recording".to_string());
    }
    let ts = Local::now().timestamp();
    let temp_dir = std::env::temp_dir().join(format!("qx_recording_{}", ts));
    fs::create_dir_all(&temp_dir).map_err(|e| format!("create temp dir: {e}"))?;

    let stop_flag = std::sync::Arc::new(AtomicBool::new(false));
    let stop_clone = stop_flag.clone();
    let temp_clone = temp_dir.clone();

    let handle = std::thread::spawn(move || {
        recording_loop(temp_clone, area, stop_clone);
    });

    *guard = Some(RecordingState {
        temp_dir,
        stop_flag,
        thread_handle: Some(handle),
        started_at: std::time::Instant::now(),
    });
    Ok(())
}

#[command]
pub fn stop_recording() -> Result<String, String> {
    let mut guard = recording_state().lock().map_err(|e| format!("lock: {e}"))?;
    let mut state = guard.take().ok_or("Not recording")?;

    state.stop_flag.store(true, Ordering::Relaxed);
    if let Some(handle) = state.thread_handle.take() {
        let _ = handle.join();
    }

    let duration_ms = state.started_at.elapsed().as_millis() as u64;

    let mut frames: Vec<PathBuf> = fs::read_dir(&state.temp_dir)
        .map_err(|e| format!("read temp dir: {e}"))?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().map(|e| e == "png").unwrap_or(false))
        .collect();
    frames.sort();

    if frames.is_empty() {
        let _ = fs::remove_dir_all(&state.temp_dir);
        return Err("No frames captured".to_string());
    }

    let first = image::open(&frames[0]).map_err(|e| format!("open frame: {e}"))?;
    let (w, h) = (first.width(), first.height());
    let frame_count = frames.len() as u32;

    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let gif_path = gifs_dir().join(format!("recording_{}.gif", timestamp));

    let settings = gifski::Settings {
        width: Some(w),
        height: Some(h),
        quality: 80,
        fast: false,
        repeat: gifski::Repeat::Infinite,
    };

    let (collector, writer) = gifski::new(settings).map_err(|e| format!("gifski new: {e}"))?;

    let fps = FPS as f64;
    let frames_for_thread = frames.clone();

    std::thread::scope(|s| -> Result<(), String> {
        let frames_thread = s.spawn(move || -> Result<(), String> {
            for (i, path) in frames_for_thread.iter().enumerate() {
                let rgba_img = image::open(path)
                    .map_err(|e| format!("open frame: {e}"))?
                    .to_rgba8();
                let (fw, fh) = (rgba_img.width() as usize, rgba_img.height() as usize);
                let raw: Vec<u8> = rgba_img.into_raw();
                let mut pixels: Vec<gifski::collector::RGBA8> = Vec::with_capacity(raw.len() / 4);
                for chunk in raw.chunks_exact(4) {
                    pixels.push(gifski::collector::RGBA8 {
                        r: chunk[0],
                        g: chunk[1],
                        b: chunk[2],
                        a: chunk[3],
                    });
                }
                let img = gifski::collector::ImgVec::new(pixels, fw, fh);
                collector
                    .add_frame_rgba(i, img, i as f64 / fps)
                    .map_err(|e| format!("add frame: {e}"))?;
            }
            drop(collector);
            Ok(())
        });

        let mut file = fs::File::create(&gif_path).map_err(|e| format!("create gif: {e}"))?;
        let mut progress = gifski::progress::NoProgress {};
        writer
            .write(&mut file, &mut progress)
            .map_err(|e| format!("write gif: {e}"))?;
        let _ = frames_thread.join();
        Ok(())
    })?;

    let _ = fs::remove_dir_all(&state.temp_dir);

    let _ = insert_history(&gif_path, w, h, frame_count, duration_ms);

    Ok(gif_path.to_string_lossy().to_string())
}

#[command]
pub fn save_gif(source_path: String, dest_path: String) -> Result<String, String> {
    fs::copy(&source_path, &dest_path).map_err(|e| format!("copy: {e}"))?;
    Ok(dest_path)
}

#[command]
pub fn list_gif_history(limit: Option<u32>) -> Vec<GifEntry> {
    let limit = limit.unwrap_or(50) as i64;
    let conn = match open_db() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut stmt = match conn.prepare(
        "SELECT id, file_path, width, height, frame_count, duration_ms, created_at FROM gif_history ORDER BY created_at DESC LIMIT ?1",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map(params![limit], |row| {
        Ok(GifEntry {
            id: row.get(0)?,
            path: row.get(1)?,
            width: row.get::<_, Option<i64>>(2)?.unwrap_or(0) as u32,
            height: row.get::<_, Option<i64>>(3)?.unwrap_or(0) as u32,
            frame_count: row.get::<_, Option<i64>>(4)?.unwrap_or(0) as u32,
            duration_ms: row.get::<_, Option<i64>>(5)?.unwrap_or(0) as u64,
            created_at: row.get(6)?,
        })
    });
    let mut out = Vec::new();
    if let Ok(rows) = rows {
        for r in rows.flatten() {
            out.push(r);
        }
    }
    out
}

#[command]
pub fn is_recording() -> bool {
    let Ok(guard) = recording_state().lock() else {
        return false;
    };
    guard.is_some()
}

#[command]
pub fn get_screencap_history(limit: Option<u32>) -> Vec<GifEntry> {
    list_gif_history(limit)
}

#[command]
pub fn delete_screencap(id: i64) -> Result<(), String> {
    let conn = open_db().map_err(|e| format!("db: {e}"))?;
    let file_path: String = conn
        .query_row(
            "SELECT file_path FROM gif_history WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("not found: {e}"))?;
    conn.execute("DELETE FROM gif_history WHERE id = ?1", params![id])
        .map_err(|e| format!("delete: {e}"))?;
    let _ = fs::remove_file(&file_path);
    Ok(())
}
