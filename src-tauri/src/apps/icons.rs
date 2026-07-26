use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
#[cfg(target_os = "macos")]
use std::process::Command;

pub(super) const CACHED_ICON_EDGE: u32 = 128;

#[cfg(target_os = "macos")]
fn cache_dir() -> PathBuf {
    let dir = crate::paths::state_dir().join("icons");
    let _ = fs::create_dir_all(&dir);
    dir
}

#[cfg(not(target_os = "macos"))]
fn cache_dir() -> PathBuf {
    let dir = crate::paths::cache_dir().join("icons");
    let _ = fs::create_dir_all(&dir);
    dir
}

pub(super) fn cache_path(app_path: &Path, app_name: &str) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    app_path.to_string_lossy().hash(&mut hasher);
    let path_hash = hasher.finish();
    let safe_name = app_name
        .chars()
        .map(|character| match character {
            '/' | ':' => '-',
            _ => character,
        })
        .collect::<String>();
    cache_dir().join(format!("{safe_name}-{path_hash:016x}.png"))
}

pub(super) fn legacy_cache_path(app_name: &str) -> PathBuf {
    cache_dir().join(format!("{}.png", app_name.replace('/', "-")))
}

pub(super) fn has_current_cache(app_path: &Path, app_name: &str, icon: &str) -> bool {
    if icon.is_empty() {
        return false;
    }
    let current_path = cache_path(app_path, app_name);
    icon == current_path.to_string_lossy() && current_path.exists() && compact_cache(&current_path)
}

#[cfg(target_os = "macos")]
fn compact_cache(path: &Path) -> bool {
    let Ok((width, height)) = image::image_dimensions(path) else {
        return false;
    };
    if width <= CACHED_ICON_EDGE && height <= CACHED_ICON_EDGE {
        return true;
    }
    let temp = path.with_extension("compact.png");
    let output = Command::new("sips")
        .args([
            "-Z",
            "128",
            path.to_str().unwrap_or(""),
            "--out",
            temp.to_str().unwrap_or(""),
        ])
        .output();
    match output {
        Ok(result) if result.status.success() && temp.is_file() => {
            let replaced = fs::rename(&temp, path).is_ok();
            if !replaced {
                let _ = fs::remove_file(&temp);
            }
            replaced
        }
        _ => {
            let _ = fs::remove_file(temp);
            false
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn compact_cache(path: &Path) -> bool {
    let Ok((width, height)) = image::image_dimensions(path) else {
        return false;
    };
    if width <= CACHED_ICON_EDGE && height <= CACHED_ICON_EDGE {
        return true;
    }
    let Ok(decoded) = image::open(path) else {
        return false;
    };
    decoded
        .thumbnail(CACHED_ICON_EDGE, CACHED_ICON_EDGE)
        .save_with_format(path, image::ImageFormat::Png)
        .is_ok()
}

/// Convert an icon resource to a compact PNG using the macOS system converter.
/// Windows obtains icons from the Shell instead, so this is intentionally empty there.
#[cfg(target_os = "macos")]
pub(super) fn icon_file_to_png(icon_path: &Path, app_path: &Path, app_name: &str) -> String {
    let png_path = cache_path(app_path, app_name);

    if png_path.exists() {
        let png_modified = fs::metadata(&png_path)
            .ok()
            .and_then(|metadata| metadata.modified().ok());
        let icon_modified = fs::metadata(icon_path)
            .ok()
            .and_then(|metadata| metadata.modified().ok());
        if let (Some(png_modified), Some(icon_modified)) = (png_modified, icon_modified) {
            if png_modified >= icon_modified && compact_cache(&png_path) {
                return png_path.to_string_lossy().to_string();
            }
        }
    }

    let output = Command::new("sips")
        .args([
            "-s",
            "format",
            "png",
            "-Z",
            "128",
            icon_path.to_str().unwrap_or(""),
            "--out",
            png_path.to_str().unwrap_or(""),
        ])
        .output();

    match output {
        Ok(result) if result.status.success() && png_path.exists() && compact_cache(&png_path) => {
            png_path.to_string_lossy().to_string()
        }
        _ => String::new(),
    }
}

#[cfg(not(target_os = "macos"))]
pub(super) fn icon_file_to_png(_icon_path: &Path, _app_path: &Path, _app_name: &str) -> String {
    String::new()
}

#[cfg(target_os = "macos")]
pub(super) fn platform_icon_to_png(app_path: &Path, app_name: &str) -> String {
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSSize, NSString};

    let png_path = cache_path(app_path, app_name);
    if png_path.exists() && compact_cache(&png_path) {
        return png_path.to_string_lossy().to_string();
    }

    let app_path_string = app_path.to_string_lossy();
    let ns_path = NSString::from_str(&app_path_string);
    let empty_properties = NSDictionary::new();
    let write_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let workspace = NSWorkspace::sharedWorkspace();
        let image = workspace.iconForFile(&ns_path);
        image.setSize(NSSize::new(
            CACHED_ICON_EDGE as f64,
            CACHED_ICON_EDGE as f64,
        ));
        let tiff = image.TIFFRepresentation()?;
        let bitmap = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)?;
        let png = unsafe {
            bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &empty_properties)
        }?;
        fs::write(&png_path, unsafe { png.as_bytes_unchecked() }).ok()?;
        Some(())
    }));

    match write_result {
        Ok(Some(())) if png_path.exists() && compact_cache(&png_path) => {
            png_path.to_string_lossy().to_string()
        }
        _ => String::new(),
    }
}

#[cfg(any(target_os = "windows", test))]
fn bgra_to_rgba(pixels: &[u8]) -> Vec<u8> {
    let has_alpha = pixels.chunks_exact(4).any(|pixel| pixel[3] != 0);
    let mut rgba = Vec::with_capacity(pixels.len());
    for pixel in pixels.chunks_exact(4) {
        let (blue, green, red, alpha) = (pixel[0], pixel[1], pixel[2], pixel[3]);
        let alpha = if has_alpha {
            alpha
        } else if red != 0 || green != 0 || blue != 0 {
            u8::MAX
        } else {
            0
        };
        rgba.extend_from_slice(&[red, green, blue, alpha]);
    }
    rgba
}

/// Resolve a Start-menu shortcut through Windows Shell, rasterize its HICON,
/// and cache the result as a WebView-compatible PNG.
#[cfg(target_os = "windows")]
pub(super) fn platform_icon_to_png(app_path: &Path, app_name: &str) -> String {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Graphics::Gdi::{
            CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
            BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        },
        UI::{
            Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON},
            WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL},
        },
    };

    let png_path = cache_path(app_path, app_name);
    if png_path.is_file() && compact_cache(&png_path) {
        return png_path.to_string_lossy().to_string();
    }

    let wide_path: Vec<u16> = app_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut file_info: SHFILEINFOW = unsafe { std::mem::zeroed() };
    let found = unsafe {
        SHGetFileInfoW(
            wide_path.as_ptr(),
            0,
            &mut file_info,
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if found == 0 || file_info.hIcon.is_null() {
        eprintln!(
            "[apps] Windows Shell returned no icon for {}",
            app_path.display()
        );
        return String::new();
    }

    let edge = CACHED_ICON_EDGE as i32;
    let mut bitmap_info: BITMAPINFO = unsafe { std::mem::zeroed() };
    bitmap_info.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: edge,
        // Negative height requests top-down pixels, matching PNG row order.
        biHeight: -edge,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        ..unsafe { std::mem::zeroed() }
    };

    let memory_dc = unsafe { CreateCompatibleDC(std::ptr::null_mut()) };
    if memory_dc.is_null() {
        unsafe { DestroyIcon(file_info.hIcon) };
        return String::new();
    }

    let mut bits = std::ptr::null_mut();
    let bitmap = unsafe {
        CreateDIBSection(
            memory_dc,
            &bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            std::ptr::null_mut(),
            0,
        )
    };
    if bitmap.is_null() || bits.is_null() {
        unsafe {
            DeleteDC(memory_dc);
            DestroyIcon(file_info.hIcon);
        }
        return String::new();
    }

    let previous = unsafe { SelectObject(memory_dc, bitmap) };
    let byte_len = CACHED_ICON_EDGE as usize * CACHED_ICON_EDGE as usize * 4;
    unsafe { std::ptr::write_bytes(bits, 0, byte_len) };
    let drawn = unsafe {
        DrawIconEx(
            memory_dc,
            0,
            0,
            file_info.hIcon,
            edge,
            edge,
            0,
            std::ptr::null_mut(),
            DI_NORMAL,
        )
    };
    let rgba = if drawn != 0 {
        let bgra = unsafe { std::slice::from_raw_parts(bits.cast::<u8>(), byte_len) };
        bgra_to_rgba(bgra)
    } else {
        Vec::new()
    };

    unsafe {
        SelectObject(memory_dc, previous);
        DeleteObject(bitmap);
        DeleteDC(memory_dc);
        DestroyIcon(file_info.hIcon);
    }

    if rgba.is_empty() {
        eprintln!(
            "[apps] failed to rasterize Windows icon for {}",
            app_path.display()
        );
        return String::new();
    }
    match image::save_buffer_with_format(
        &png_path,
        &rgba,
        CACHED_ICON_EDGE,
        CACHED_ICON_EDGE,
        image::ColorType::Rgba8,
        image::ImageFormat::Png,
    ) {
        Ok(()) => png_path.to_string_lossy().to_string(),
        Err(error) => {
            eprintln!(
                "[apps] failed to cache Windows icon for {}: {error}",
                app_path.display()
            );
            String::new()
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(super) fn platform_icon_to_png(_app_path: &Path, _app_name: &str) -> String {
    String::new()
}

#[cfg(test)]
mod tests {
    use super::{bgra_to_rgba, compact_cache, CACHED_ICON_EDGE};

    #[test]
    fn cached_application_icons_are_compacted() {
        let path = std::env::temp_dir().join(format!(
            "qx-app-icon-test-{}-{}.png",
            std::process::id(),
            CACHED_ICON_EDGE
        ));
        image::DynamicImage::new_rgba8(512, 384)
            .save_with_format(&path, image::ImageFormat::Png)
            .expect("write icon fixture");
        assert!(compact_cache(&path));
        let (width, height) = image::image_dimensions(&path).expect("compacted dimensions");
        let _ = std::fs::remove_file(path);
        assert!(width <= CACHED_ICON_EDGE);
        assert!(height <= CACHED_ICON_EDGE);
    }

    #[test]
    fn windows_bgra_icon_pixels_become_webview_rgba() {
        assert_eq!(
            bgra_to_rgba(&[10, 20, 30, 40, 1, 2, 3, 255]),
            vec![30, 20, 10, 40, 3, 2, 1, 255]
        );
        assert_eq!(
            bgra_to_rgba(&[10, 20, 30, 0, 0, 0, 0, 0]),
            vec![30, 20, 10, 255, 0, 0, 0, 0]
        );
    }
}
