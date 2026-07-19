//! Native clipboard observation.
//!
//! The domain listener consumes one stable file-list result on every platform.
//! Platform handles, retryable clipboard-open failures, UTF-16 paths and
//! pasteboard type probing stay below this boundary.

use std::path::PathBuf;

pub(super) fn is_file_reference_type(type_name: &str) -> bool {
    let lower = type_name.to_ascii_lowercase();
    lower.contains("file-url") || lower.contains("filename")
}

#[cfg(target_os = "macos")]
fn decode_file_reference_path(value: &str) -> Option<PathBuf> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let raw = value
        .strip_prefix("file://localhost")
        .or_else(|| value.strip_prefix("file://"))
        .unwrap_or(value);
    let decoded = urlencoding::decode(raw).ok()?.into_owned();
    Some(PathBuf::from(decoded))
}

#[cfg(target_os = "macos")]
pub(super) fn change_count() -> Option<i64> {
    use objc2::msg_send;
    use objc2::runtime::AnyClass;
    use std::ffi::CStr;

    let cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSPasteboard\0").ok()?)?;
    unsafe {
        let pasteboard: *mut objc2::runtime::NSObject = msg_send![cls, generalPasteboard];
        if pasteboard.is_null() {
            return None;
        }
        let count: i64 = msg_send![pasteboard, changeCount];
        Some(count)
    }
}

#[cfg(target_os = "windows")]
pub(super) fn change_count() -> Option<i64> {
    let value = unsafe { windows_sys::Win32::System::DataExchange::GetClipboardSequenceNumber() };
    (value != 0).then_some(i64::from(value))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(super) fn change_count() -> Option<i64> {
    None
}

#[cfg(target_os = "macos")]
pub(super) fn read_file_paths() -> Result<Vec<String>, String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, NSObject};
    use std::collections::HashSet;
    use std::ffi::{CStr, CString};

    unsafe fn string_value(value: *mut NSObject) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let ptr: *const std::os::raw::c_char = unsafe { msg_send![value, UTF8String] };
        if ptr.is_null() {
            return None;
        }
        Some(
            unsafe { CStr::from_ptr(ptr) }
                .to_string_lossy()
                .into_owned(),
        )
    }

    fn push_path(paths: &mut Vec<String>, seen: &mut HashSet<String>, value: &str) {
        let Some(path) = decode_file_reference_path(value) else {
            return;
        };
        // Capture the native reference even if it is a disconnected volume or
        // a file that is moved later. Existence is validated when the user uses it.
        let value = path.to_string_lossy().to_string();
        if !value.is_empty() && seen.insert(value.clone()) {
            paths.push(value);
        }
    }

    unsafe {
        let pasteboard_cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSPasteboard\0").unwrap())
            .ok_or_else(|| "NSPasteboard class missing".to_string())?;
        let string_cls = AnyClass::get(CStr::from_bytes_with_nul(b"NSString\0").unwrap())
            .ok_or_else(|| "NSString class missing".to_string())?;
        let pasteboard: *mut NSObject = msg_send![pasteboard_cls, generalPasteboard];
        if pasteboard.is_null() {
            return Err("general pasteboard missing".to_string());
        }

        let mut paths = Vec::new();
        let mut seen = HashSet::new();

        let type_name = CString::new("public.file-url").unwrap();
        let pasteboard_type: *mut NSObject =
            msg_send![string_cls, stringWithUTF8String: type_name.as_ptr()];
        let value: *mut NSObject = msg_send![pasteboard, stringForType: pasteboard_type];
        if let Some(value) = string_value(value) {
            push_path(&mut paths, &mut seen, &value);
        }

        let items: *mut NSObject = msg_send![pasteboard, pasteboardItems];
        if !items.is_null() {
            let item_count: usize = msg_send![items, count];
            for item_index in 0..item_count {
                let item: *mut NSObject = msg_send![items, objectAtIndex: item_index];
                if item.is_null() {
                    continue;
                }
                let types: *mut NSObject = msg_send![item, types];
                if types.is_null() {
                    continue;
                }
                let type_count: usize = msg_send![types, count];
                for type_index in 0..type_count {
                    let item_type: *mut NSObject = msg_send![types, objectAtIndex: type_index];
                    let Some(item_type_name) = string_value(item_type) else {
                        continue;
                    };
                    if !is_file_reference_type(&item_type_name) {
                        continue;
                    }
                    let item_value: *mut NSObject = msg_send![item, stringForType: item_type];
                    if let Some(value) = string_value(item_value) {
                        push_path(&mut paths, &mut seen, &value);
                    }
                }
            }
        }

        let legacy_name = CString::new("NSFilenamesPboardType").unwrap();
        let legacy_type: *mut NSObject =
            msg_send![string_cls, stringWithUTF8String: legacy_name.as_ptr()];
        let file_names: *mut NSObject = msg_send![pasteboard, propertyListForType: legacy_type];
        if !file_names.is_null() {
            let count: usize = msg_send![file_names, count];
            for index in 0..count {
                let value: *mut NSObject = msg_send![file_names, objectAtIndex: index];
                if let Some(value) = string_value(value) {
                    push_path(&mut paths, &mut seen, &value);
                }
            }
        }
        Ok(paths)
    }
}

#[cfg(target_os = "windows")]
pub(super) fn read_file_paths() -> Result<Vec<String>, String> {
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows_sys::Win32::UI::Shell::DragQueryFileW;

    const CF_HDROP: u32 = 15;
    const QUERY_FILE_COUNT: u32 = u32::MAX;

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe { CloseClipboard() };
        }
    }

    unsafe {
        if IsClipboardFormatAvailable(CF_HDROP) == 0 {
            return Ok(Vec::new());
        }
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return Err(format!(
                "open Windows clipboard failed ({})",
                GetLastError()
            ));
        }
        let _guard = ClipboardGuard;
        let handle = GetClipboardData(CF_HDROP);
        if handle.is_null() {
            return Err(format!("read Windows CF_HDROP failed ({})", GetLastError()));
        }

        let count = DragQueryFileW(handle, QUERY_FILE_COUNT, std::ptr::null_mut(), 0);
        let mut paths = Vec::with_capacity(count as usize);
        for index in 0..count {
            let length = DragQueryFileW(handle, index, std::ptr::null_mut(), 0);
            if length == 0 {
                continue;
            }
            let mut buffer = vec![0u16; length as usize + 1];
            let copied = DragQueryFileW(handle, index, buffer.as_mut_ptr(), buffer.len() as u32);
            if copied == 0 {
                continue;
            }
            buffer.truncate(copied as usize);
            let path = PathBuf::from(String::from_utf16_lossy(&buffer));
            let value = path.to_string_lossy().to_string();
            if !value.is_empty() {
                paths.push(value);
            }
        }
        Ok(paths)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(super) fn read_file_paths() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}
