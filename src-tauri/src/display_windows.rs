//! Windows still-frame fallback for the root display capture service.
//!
//! xcap's WGC backend is the primary path. GDI remains necessary for Remote
//! Desktop, virtual display drivers, and machines where WGC/D3D initialization
//! is unavailable. Feature modules must call `display::capture_region` instead.

use std::ffi::c_void;
use std::mem::size_of;
use std::sync::atomic::{AtomicBool, Ordering};

use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetWindowDC,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS,
    SRCCOPY,
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

pub(crate) struct GdiCaptureSession {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    width_i32: i32,
    height_i32: i32,
    desktop: DesktopDc,
    memory: MemoryDc,
    _bitmap: Bitmap,
    previous: windows_sys::Win32::Graphics::Gdi::HGDIOBJ,
    dib_pixels: *mut u8,
    byte_len: usize,
    image: image::RgbaImage,
}

impl GdiCaptureSession {
    pub(crate) fn new(x: i32, y: i32, width: u32, height: u32) -> Result<Self, String> {
        let width_i32 =
            i32::try_from(width).map_err(|_| "capture width is too large".to_string())?;
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
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
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
                },
                bmiColors: [std::mem::zeroed()],
            };
            let mut dib_pixels = std::ptr::null_mut::<c_void>();
            let bitmap_raw = CreateDIBSection(
                desktop.dc,
                &info,
                DIB_RGB_COLORS,
                &mut dib_pixels,
                std::ptr::null_mut(),
                0,
            );
            if bitmap_raw.is_null() {
                return Err(last_error("CreateDIBSection"));
            }
            if dib_pixels.is_null() {
                DeleteObject(bitmap_raw);
                return Err("CreateDIBSection returned no pixel buffer".to_string());
            }
            let bitmap = Bitmap(bitmap_raw);
            let previous = SelectObject(memory.0, bitmap.0);
            if previous.is_null() {
                return Err(last_error("SelectObject"));
            }
            Ok(Self {
                x,
                y,
                width,
                height,
                width_i32,
                height_i32,
                desktop,
                memory,
                _bitmap: bitmap,
                previous,
                dib_pixels: dib_pixels.cast(),
                byte_len,
                image: image::RgbaImage::new(width, height),
            })
        }
    }

    pub(crate) fn capture(&mut self) -> Result<&image::RgbaImage, String> {
        unsafe {
            let copied = BitBlt(
                self.memory.0,
                0,
                0,
                self.width_i32,
                self.height_i32,
                self.desktop.dc,
                self.x,
                self.y,
                SRCCOPY | CAPTUREBLT,
            );
            if copied == 0 {
                return Err(last_error("BitBlt"));
            }
            // Direct DIB memory access must observe the preceding batched GDI
            // write before the CPU converts BGRA into the reusable RGBA image.
            if GdiFlush() == 0 {
                return Err(last_error("GdiFlush"));
            }

            let source = std::slice::from_raw_parts(self.dib_pixels, self.byte_len);
            // DIB sections expose BGRA. Desktop frames are opaque, so normalize
            // alpha instead of propagating driver-specific zero alpha into PNG.
            for (bgra, rgba) in source
                .chunks_exact(4)
                .zip(self.image.as_mut().chunks_exact_mut(4))
            {
                rgba.copy_from_slice(&[bgra[2], bgra[1], bgra[0], 255]);
            }
        }
        debug_assert_eq!(self.image.dimensions(), (self.width, self.height));
        Ok(&self.image)
    }

    fn capture_owned(mut self) -> Result<image::RgbaImage, String> {
        self.capture()?;
        Ok(std::mem::take(&mut self.image))
    }
}

impl Drop for GdiCaptureSession {
    fn drop(&mut self) {
        unsafe {
            // A selected bitmap must be removed from the memory DC before its
            // HBITMAP is deleted. The field RAII guards then release bitmap,
            // memory DC and desktop DC exactly once.
            SelectObject(self.memory.0, self.previous);
        }
    }
}

pub(crate) fn capture_region_gdi(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<image::RgbaImage, String> {
    GdiCaptureSession::new(x, y, width, height)?.capture_owned()
}
