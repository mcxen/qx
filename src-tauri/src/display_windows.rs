//! Windows still-frame fallback for the root display capture service.
//!
//! xcap's WGC backend is the primary path. GDI remains necessary for Remote
//! Desktop, virtual display drivers, and machines where WGC/D3D initialization
//! is unavailable. Feature modules must call `display::capture_region` instead.

use std::ffi::c_void;
use std::mem::size_of;
use std::sync::atomic::{AtomicBool, Ordering};

use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits,
    GetWindowDC, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
    DIB_RGB_COLORS, SRCCOPY,
};
use windows_sys::Win32::UI::WindowsAndMessaging::GetDesktopWindow;

static WGC_HEALTHY: AtomicBool = AtomicBool::new(true);

pub(crate) fn should_try_wgc() -> bool {
    WGC_HEALTHY.load(Ordering::Relaxed)
}

pub(crate) fn disable_wgc() {
    // A WGC frame can take up to three seconds to time out in xcap. Once the
    // current process proves incompatible, do not pay that timeout per frame
    // in the recording polling fallback. Restarting Qx probes WGC again.
    WGC_HEALTHY.store(false, Ordering::Relaxed);
}

struct DesktopDc {
    window: windows_sys::Win32::Foundation::HWND,
    dc: windows_sys::Win32::Graphics::Gdi::HDC,
}

impl Drop for DesktopDc {
    fn drop(&mut self) {
        unsafe {
            ReleaseDC(self.window, self.dc);
        }
    }
}

struct MemoryDc(windows_sys::Win32::Graphics::Gdi::HDC);

impl Drop for MemoryDc {
    fn drop(&mut self) {
        unsafe {
            DeleteDC(self.0);
        }
    }
}

struct Bitmap(windows_sys::Win32::Graphics::Gdi::HBITMAP);

impl Drop for Bitmap {
    fn drop(&mut self) {
        unsafe {
            DeleteObject(self.0);
        }
    }
}

fn last_error(operation: &str) -> String {
    format!("{operation}: {}", std::io::Error::last_os_error())
}

pub(crate) fn capture_region_gdi(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<image::RgbaImage, String> {
    let width_i32 = i32::try_from(width).map_err(|_| "capture width is too large".to_string())?;
    let height_i32 =
        i32::try_from(height).map_err(|_| "capture height is too large".to_string())?;
    let byte_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "capture buffer is too large".to_string())?;
    if width_i32 <= 0 || height_i32 <= 0 {
        return Err("capture region must have a positive size".to_string());
    }

    unsafe {
        let window = GetDesktopWindow();
        let desktop_raw = GetWindowDC(window);
        if desktop_raw.is_null() {
            return Err(last_error("GetWindowDC"));
        }
        let desktop = DesktopDc {
            window,
            dc: desktop_raw,
        };
        let memory_raw = CreateCompatibleDC(desktop.dc);
        if memory_raw.is_null() {
            return Err(last_error("CreateCompatibleDC"));
        }
        let memory = MemoryDc(memory_raw);
        let bitmap_raw = CreateCompatibleBitmap(desktop.dc, width_i32, height_i32);
        if bitmap_raw.is_null() {
            return Err(last_error("CreateCompatibleBitmap"));
        }
        let bitmap = Bitmap(bitmap_raw);
        let previous = SelectObject(memory.0, bitmap.0);
        if previous.is_null() {
            return Err(last_error("SelectObject"));
        }

        let copied = BitBlt(
            memory.0,
            0,
            0,
            width_i32,
            height_i32,
            desktop.dc,
            x,
            y,
            SRCCOPY | CAPTUREBLT,
        );
        if copied == 0 {
            SelectObject(memory.0, previous);
            return Err(last_error("BitBlt"));
        }

        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width_i32,
            biHeight: -height_i32,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: u32::try_from(byte_len)
                .map_err(|_| "capture buffer is too large".to_string())?,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        };
        let mut pixels = vec![0u8; byte_len];
        let rows = GetDIBits(
            memory.0,
            bitmap.0,
            0,
            height,
            pixels.as_mut_ptr().cast::<c_void>(),
            &mut info,
            DIB_RGB_COLORS,
        );
        SelectObject(memory.0, previous);
        if rows != height_i32 {
            return Err(last_error("GetDIBits"));
        }

        // Desktop frames are opaque. Compatible bitmaps commonly leave alpha
        // at zero on current Windows, which otherwise saves a fully transparent
        // PNG even though RGB capture succeeded.
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            pixel[3] = 255;
        }
        image::RgbaImage::from_raw(width, height, pixels)
            .ok_or_else(|| "create image from GDI capture".to_string())
    }
}
