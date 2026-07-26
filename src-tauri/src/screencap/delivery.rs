use std::fs;
use std::path::{Path, PathBuf};

use super::CaptureExecutionOptions;

#[derive(Debug)]
pub(super) struct DeliveryResult {
    pub(super) delivered_path: PathBuf,
    pub(super) warning: Option<String>,
}

fn destination_directory(options: &CaptureExecutionOptions) -> Result<Option<PathBuf>, String> {
    match options.destination.as_deref().unwrap_or("library") {
        "library" | "clipboard" => Ok(None),
        "desktop" => dirs::desktop_dir()
            .map(Some)
            .ok_or_else(|| "Desktop directory is unavailable".to_string()),
        "documents" => dirs::document_dir()
            .map(Some)
            .ok_or_else(|| "Documents directory is unavailable".to_string()),
        "custom" => {
            let path = options
                .custom_directory
                .as_deref()
                .map(PathBuf::from)
                .filter(|path| path.is_absolute())
                .ok_or_else(|| "Custom capture directory is unavailable".to_string())?;
            Ok(Some(path))
        }
        value => Err(format!("Unsupported capture destination: {value}")),
    }
}

fn unique_destination(directory: &Path, file_name: &std::ffi::OsStr) -> PathBuf {
    let first = directory.join(file_name);
    if !first.exists() {
        return first;
    }
    let source = Path::new(file_name);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("capture");
    let extension = source.extension().and_then(|value| value.to_str());
    for index in 2..10_000 {
        let candidate = match extension {
            Some(extension) => directory.join(format!("{stem}-{index}.{extension}")),
            None => directory.join(format!("{stem}-{index}")),
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    first
}

#[cfg(target_os = "macos")]
fn open_capture(path: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("open exported capture: {error}"))
}

#[cfg(target_os = "windows")]
fn open_capture(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            std::ptr::null(),
            path.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;
    if result > 32 {
        Ok(())
    } else {
        Err(format!("open exported capture failed (code {result})"))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn open_capture(path: &Path) -> Result<(), String> {
    std::process::Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("open exported capture: {error}"))
}

pub(super) fn deliver_capture(source: &Path, options: &CaptureExecutionOptions) -> DeliveryResult {
    let delivered_path = match destination_directory(options) {
        Ok(Some(directory)) => {
            let result = (|| {
                fs::create_dir_all(&directory)
                    .map_err(|error| format!("create capture destination: {error}"))?;
                let file_name = source
                    .file_name()
                    .ok_or_else(|| "Capture output has no file name".to_string())?;
                let destination = unique_destination(&directory, file_name);
                fs::copy(source, &destination)
                    .map_err(|error| format!("export capture: {error}"))?;
                Ok::<PathBuf, String>(destination)
            })();
            match result {
                Ok(path) => path,
                Err(error) => {
                    return DeliveryResult {
                        delivered_path: source.to_path_buf(),
                        warning: Some(error),
                    };
                }
            }
        }
        Ok(None) => source.to_path_buf(),
        Err(error) => {
            return DeliveryResult {
                delivered_path: source.to_path_buf(),
                warning: Some(error),
            };
        }
    };
    let warning = match options.open_after.as_deref().unwrap_or("none") {
        "none" => None,
        "preview" | "player" => open_capture(&delivered_path).err(),
        value => Some(format!("Unsupported capture completion action: {value}")),
    };
    DeliveryResult {
        delivered_path,
        warning,
    }
}

#[cfg(test)]
mod tests {
    use super::unique_destination;

    #[test]
    fn duplicate_exports_receive_a_suffix() {
        let root = std::env::temp_dir().join(format!("qx-delivery-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("shot.png"), b"x").unwrap();
        assert_eq!(
            unique_destination(&root, std::ffi::OsStr::new("shot.png"))
                .file_name()
                .unwrap(),
            "shot-2.png"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
