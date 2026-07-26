use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const SHUTTER_RESOURCE: &str = "resources/generated/screencap-shutter.wav";

fn shutter_path(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .resource_dir()
        .map_err(|error| format!("resolve capture sound resources: {error}"))?;
    let nested = root.join(SHUTTER_RESOURCE);
    if nested.is_file() {
        return Ok(nested);
    }
    let flattened = root.join("screencap-shutter.wav");
    if flattened.is_file() {
        return Ok(flattened);
    }
    Err("capture sound resource is unavailable".to_string())
}

pub(super) async fn play_screenshot_sound(app: &AppHandle, enabled: Option<bool>) {
    if !enabled.unwrap_or_else(|| {
        crate::settings::read_settings()
            .screencap
            .screenshot_sound_enabled
    }) {
        return;
    }
    let path = match shutter_path(app) {
        Ok(path) => path,
        Err(error) => {
            crate::diagnostics::log(
                crate::diagnostics::LogLevel::Warn,
                "screencap.feedback",
                "screenshot saved but shutter sound is unavailable",
                serde_json::json!({ "error": error }),
            );
            return;
        }
    };
    let result = play(app, path).await;
    if let Err(error) = result {
        crate::diagnostics::log(
            crate::diagnostics::LogLevel::Warn,
            "screencap.feedback",
            "screenshot saved but shutter sound playback failed",
            serde_json::json!({ "error": error }),
        );
    }
}

#[cfg(target_os = "macos")]
async fn play(app: &AppHandle, path: PathBuf) -> Result<(), String> {
    let path = path.to_string_lossy().to_string();
    crate::runtime::ui(app, move || {
        use std::cell::RefCell;

        use objc2::AnyThread;
        use objc2::rc::Retained;
        use objc2_app_kit::NSSound;
        use objc2_foundation::NSString;

        thread_local! {
            static ACTIVE_SHUTTER: RefCell<Option<Retained<NSSound>>> = const { RefCell::new(None) };
        }

        let path = NSString::from_str(&path);
        let sound = NSSound::initWithContentsOfFile_byReference(NSSound::alloc(), &path, false)
            .ok_or_else(|| "load bundled shutter sound".to_string())?;
        if !sound.play() {
            return Err("NSSound refused shutter playback".to_string());
        }
        ACTIVE_SHUTTER.with(|slot| *slot.borrow_mut() = Some(sound));
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(target_os = "windows")]
async fn play(_app: &AppHandle, path: PathBuf) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Media::Audio::{PlaySoundW, SND_FILENAME, SND_NODEFAULT};

    let path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // This function already runs through an async capture completion path. Keep
    // the UTF-16 buffer alive until WinMM has consumed it rather than handing an
    // ephemeral pointer to SND_ASYNC.
    let result = crate::runtime::blocking(move || unsafe {
        PlaySoundW(
            path.as_ptr(),
            std::ptr::null_mut(),
            SND_FILENAME | SND_NODEFAULT,
        )
    })
    .await;
    if result == 0 {
        Err("PlaySoundW refused shutter playback".to_string())
    } else {
        Ok(())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
async fn play(_app: &AppHandle, _path: PathBuf) -> Result<(), String> {
    Ok(())
}
