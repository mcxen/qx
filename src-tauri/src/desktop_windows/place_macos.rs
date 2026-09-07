//! macOS Accessibility adapter: move an app's AX windows onto an NSScreen.

use std::ffi::{c_void, CStr, CString};
use std::path::Path;
use std::ptr;

use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject};
use objc2_foundation::{NSPoint, NSRect, NSString};
use tauri::AppHandle;
use tauri::Manager;

use super::place::{NativeWorkArea, PlaceResult, WindowRect};
use crate::floating_panel::MAIN_LABEL;
use crate::permissions::accessibility_granted;

const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
const AX_ERROR_SUCCESS: i32 = 0;
const AX_VALUE_CG_POINT: u32 = 1;
const AX_VALUE_CG_SIZE: u32 = 2;
const NS_APPLICATION_ACTIVATE_IGNORING_OTHER_APPS: usize = 1 << 1;

#[repr(C)]
#[derive(Clone, Copy)]
struct CgPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CgSize {
    width: f64,
    height: f64,
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> *mut c_void;
    fn AXUIElementCopyAttributeValue(
        element: *mut c_void,
        attribute: *const c_void,
        value: *mut *mut c_void,
    ) -> i32;
    fn AXUIElementSetAttributeValue(
        element: *mut c_void,
        attribute: *const c_void,
        value: *const c_void,
    ) -> i32;
    fn AXValueCreate(value_type: u32, value_ptr: *const c_void) -> *mut c_void;
    fn AXValueGetValue(value: *mut c_void, value_type: u32, value_ptr: *mut c_void) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFArrayGetCount(array: *const c_void) -> isize;
    fn CFArrayGetValueAtIndex(array: *const c_void, index: isize) -> *const c_void;
    fn CFRetain(cf: *const c_void) -> *const c_void;
    fn CFRelease(cf: *const c_void);
    fn CFStringCreateWithCString(
        alloc: *const c_void,
        c_str: *const i8,
        encoding: u32,
    ) -> *mut c_void;
    fn CFBooleanGetValue(boolean: *const c_void) -> bool;
}

pub(super) fn capture_launch_display(app: &AppHandle) -> Option<NativeWorkArea> {
    if let Some(win) = app.get_webview_window(MAIN_LABEL) {
        if win.is_visible().unwrap_or(false) {
            if let Ok(ptr) = win.ns_window() {
                let ns_window = ptr as *mut AnyObject;
                if !ns_window.is_null() {
                    let screen: *mut AnyObject = unsafe { msg_send![ns_window, screen] };
                    if let Some(area) = ns_screen_area(screen) {
                        return Some(area);
                    }
                }
            }
        }
    }
    screen_area_for_mouse()
}

pub(super) fn has_placeable_windows(path: &Path) -> bool {
    let Some(bundle_id) = bundle_identifier(path) else {
        return false;
    };
    pids_for_bundle(&bundle_id).into_iter().any(|pid| {
        let windows = collect_windows(pid);
        let found = !windows.is_empty();
        release_windows(&windows);
        found
    })
}

pub(super) fn place_app_bundle(path: &Path, target: NativeWorkArea) -> PlaceResult {
    if !accessibility_granted() {
        return PlaceResult::Unavailable;
    }
    let Some(bundle_id) = bundle_identifier(path) else {
        return PlaceResult::Unavailable;
    };
    let pids = pids_for_bundle(&bundle_id);
    if pids.is_empty() {
        return PlaceResult::NoWindows;
    }

    let mut windows = Vec::new();
    for pid in &pids {
        windows.extend(collect_windows(*pid));
    }
    if windows.is_empty() {
        return PlaceResult::NoWindows;
    }

    let finish = |result: PlaceResult, windows: &[AxWindow]| {
        release_windows(windows);
        result
    };

    let Some(primary) = super::place::largest_window(
        &windows
            .iter()
            .filter(|window| !window.rect.is_fullscreen_on(target))
            .map(|window| window.rect)
            .collect::<Vec<_>>(),
    )
    .or_else(|| super::place::largest_window(&windows.iter().map(|w| w.rect).collect::<Vec<_>>())) else {
        return finish(PlaceResult::NoWindows, &windows);
    };

    if target.contains_center(primary) {
        activate_bundle(&bundle_id);
        return finish(PlaceResult::AlreadyOnDisplay, &windows);
    }

    let source = screen_area_containing(primary).unwrap_or(target);
    let Some((dx, dy)) = super::place::translation_onto_display(primary, source, target) else {
        activate_bundle(&bundle_id);
        return finish(PlaceResult::AlreadyOnDisplay, &windows);
    };

    for window in &windows {
        if window.rect.is_fullscreen_on(source) || window.rect.is_fullscreen_on(target) {
            continue;
        }
        let moved = WindowRect {
            x: window.rect.x.saturating_add(dx),
            y: window.rect.y.saturating_add(dy),
            w: window.rect.w,
            h: window.rect.h,
        };
        let (x, y) = super::place::clamp_to_work(moved, target);
        set_window_position(window.element, x, y);
    }
    release_windows(&windows);
    activate_bundle(&bundle_id);
    PlaceResult::Moved
}

struct AxWindow {
    element: *mut c_void,
    rect: WindowRect,
}

fn class(name: &[u8]) -> Option<&'static AnyClass> {
    AnyClass::get(CStr::from_bytes_with_nul(name).ok()?)
}

fn bundle_identifier(path: &Path) -> Option<String> {
    let bundle_cls = class(b"NSBundle\0")?;
    let ns_path = NSString::from_str(&path.to_string_lossy());
    let bundle: *mut AnyObject = unsafe { msg_send![bundle_cls, bundleWithPath: &*ns_path] };
    if bundle.is_null() {
        return None;
    }
    let ident: *mut AnyObject = unsafe { msg_send![bundle, bundleIdentifier] };
    nsstring_to_rust(ident)
}

fn pids_for_bundle(bundle_id: &str) -> Vec<i32> {
    let Some(cls) = class(b"NSRunningApplication\0") else {
        return Vec::new();
    };
    let ns_id = NSString::from_str(bundle_id);
    let apps: *mut AnyObject =
        unsafe { msg_send![cls, runningApplicationsWithBundleIdentifier: &*ns_id] };
    if apps.is_null() {
        return Vec::new();
    }
    let count: usize = unsafe { msg_send![apps, count] };
    let mut pids = Vec::new();
    for index in 0..count {
        let app: *mut AnyObject = unsafe { msg_send![apps, objectAtIndex: index] };
        if app.is_null() {
            continue;
        }
        let pid: i32 = unsafe { msg_send![app, processIdentifier] };
        if pid > 0 {
            pids.push(pid);
        }
    }
    pids
}

fn activate_bundle(bundle_id: &str) {
    let Some(cls) = class(b"NSRunningApplication\0") else {
        return;
    };
    let ns_id = NSString::from_str(bundle_id);
    let apps: *mut AnyObject =
        unsafe { msg_send![cls, runningApplicationsWithBundleIdentifier: &*ns_id] };
    if apps.is_null() {
        return;
    }
    let count: usize = unsafe { msg_send![apps, count] };
    for index in 0..count {
        let app: *mut AnyObject = unsafe { msg_send![apps, objectAtIndex: index] };
        if app.is_null() {
            continue;
        }
        unsafe {
            let _: bool = msg_send![app, unhide];
            let _: bool =
                msg_send![app, activateWithOptions: NS_APPLICATION_ACTIVATE_IGNORING_OTHER_APPS];
        }
        break;
    }
}

fn collect_windows(pid: i32) -> Vec<AxWindow> {
    let app = unsafe { AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return Vec::new();
    }
    let mut windows = Vec::new();
    unsafe {
        let Some(attr) = cf_string("AXWindows") else {
            CFRelease(app);
            return Vec::new();
        };
        let mut value: *mut c_void = ptr::null_mut();
        let status = AXUIElementCopyAttributeValue(app, attr, &mut value);
        CFRelease(attr);
        if status != AX_ERROR_SUCCESS || value.is_null() {
            CFRelease(app);
            return Vec::new();
        }
        let count = CFArrayGetCount(value);
        for index in 0..count {
            let element = CFArrayGetValueAtIndex(value, index) as *mut c_void;
            if element.is_null() {
                continue;
            }
            if ax_bool(element, "AXMinimized") {
                let _ = ax_set_bool(element, "AXMinimized", false);
            }
            if ax_bool(element, "AXFullScreen") {
                continue;
            }
            let Some(rect) = ax_window_rect(element) else {
                continue;
            };
            windows.push(AxWindow {
                element: CFRetain(element) as *mut c_void,
                rect,
            });
        }
        CFRelease(value);
        CFRelease(app);
    }
    windows
}

fn release_windows(windows: &[AxWindow]) {
    for window in windows {
        if !window.element.is_null() {
            unsafe { CFRelease(window.element) };
        }
    }
}

fn ax_window_rect(element: *mut c_void) -> Option<WindowRect> {
    let position = ax_copy(element, "AXPosition")?;
    let size = ax_copy(element, "AXSize")?;
    let mut point = CgPoint { x: 0.0, y: 0.0 };
    let mut extent = CgSize {
        width: 0.0,
        height: 0.0,
    };
    let ok_pos = unsafe {
        AXValueGetValue(
            position,
            AX_VALUE_CG_POINT,
            &mut point as *mut _ as *mut c_void,
        )
    };
    let ok_size =
        unsafe { AXValueGetValue(size, AX_VALUE_CG_SIZE, &mut extent as *mut _ as *mut c_void) };
    unsafe {
        CFRelease(position);
        CFRelease(size);
    }
    if !ok_pos || !ok_size || extent.width < 2.0 || extent.height < 2.0 {
        return None;
    }
    Some(WindowRect {
        x: point.x.round() as i32,
        y: point.y.round() as i32,
        w: extent.width.round() as i32,
        h: extent.height.round() as i32,
    })
}

fn set_window_position(element: *mut c_void, x: i32, y: i32) {
    let point = CgPoint {
        x: x as f64,
        y: y as f64,
    };
    unsafe {
        let value = AXValueCreate(AX_VALUE_CG_POINT, &point as *const _ as *const c_void);
        if value.is_null() {
            return;
        }
        let Some(attr) = cf_string("AXPosition") else {
            CFRelease(value);
            return;
        };
        let _ = AXUIElementSetAttributeValue(element, attr, value);
        CFRelease(attr);
        CFRelease(value);
    }
}

fn ax_copy(element: *mut c_void, name: &str) -> Option<*mut c_void> {
    let attr = cf_string(name)?;
    let mut value: *mut c_void = ptr::null_mut();
    let status = unsafe { AXUIElementCopyAttributeValue(element, attr, &mut value) };
    unsafe { CFRelease(attr) };
    if status != AX_ERROR_SUCCESS || value.is_null() {
        None
    } else {
        Some(value)
    }
}

fn ax_bool(element: *mut c_void, name: &str) -> bool {
    let Some(value) = ax_copy(element, name) else {
        return false;
    };
    let result = unsafe { CFBooleanGetValue(value) };
    unsafe { CFRelease(value) };
    result
}

fn ax_set_bool(element: *mut c_void, name: &str, value: bool) -> bool {
    let Some(attr) = cf_string(name) else {
        return false;
    };
    let boolean = if value {
        k_cf_boolean_true()
    } else {
        k_cf_boolean_false()
    };
    let status = unsafe { AXUIElementSetAttributeValue(element, attr, boolean) };
    unsafe { CFRelease(attr) };
    status == AX_ERROR_SUCCESS
}

fn k_cf_boolean_true() -> *const c_void {
    unsafe extern "C" {
        static kCFBooleanTrue: *const c_void;
    }
    unsafe { kCFBooleanTrue }
}

fn k_cf_boolean_false() -> *const c_void {
    unsafe extern "C" {
        static kCFBooleanFalse: *const c_void;
    }
    unsafe { kCFBooleanFalse }
}

fn cf_string(value: &str) -> Option<*mut c_void> {
    let c_str = CString::new(value).ok()?;
    let cf = unsafe {
        CFStringCreateWithCString(ptr::null(), c_str.as_ptr(), K_CF_STRING_ENCODING_UTF8)
    };
    if cf.is_null() {
        None
    } else {
        Some(cf)
    }
}

fn ns_screen_area(screen: *mut AnyObject) -> Option<NativeWorkArea> {
    if screen.is_null() {
        return None;
    }
    let visible: NSRect = unsafe { msg_send![screen, visibleFrame] };
    let frame: NSRect = unsafe { msg_send![screen, frame] };
    Some(NativeWorkArea {
        x: visible.origin.x.round() as i32,
        y: visible.origin.y.round() as i32,
        w: visible.size.width.round() as i32,
        h: visible.size.height.round() as i32,
        frame_x: frame.origin.x.round() as i32,
        frame_y: frame.origin.y.round() as i32,
        frame_w: frame.size.width.round() as i32,
        frame_h: frame.size.height.round() as i32,
    })
}

fn screen_area_for_mouse() -> Option<NativeWorkArea> {
    let event_cls = class(b"NSEvent\0")?;
    let point: NSPoint = unsafe { msg_send![event_cls, mouseLocation] };
    screen_area_for_point(point)
}

fn screen_area_containing(window: WindowRect) -> Option<NativeWorkArea> {
    screen_area_for_point(NSPoint {
        x: window.x as f64 + window.w as f64 / 2.0,
        y: window.y as f64 + window.h as f64 / 2.0,
    })
}

fn screen_area_for_point(point: NSPoint) -> Option<NativeWorkArea> {
    let screen_cls = class(b"NSScreen\0")?;
    let screens: *mut AnyObject = unsafe { msg_send![screen_cls, screens] };
    if screens.is_null() {
        return None;
    }
    let count: usize = unsafe { msg_send![screens, count] };
    for index in 0..count {
        let screen: *mut AnyObject = unsafe { msg_send![screens, objectAtIndex: index] };
        let frame: NSRect = unsafe { msg_send![screen, frame] };
        let max_x = frame.origin.x + frame.size.width;
        let max_y = frame.origin.y + frame.size.height;
        if point.x >= frame.origin.x
            && point.x < max_x
            && point.y >= frame.origin.y
            && point.y < max_y
        {
            return ns_screen_area(screen);
        }
    }
    None
}

fn nsstring_to_rust(value: *mut AnyObject) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let utf8: *const i8 = unsafe { msg_send![value, UTF8String] };
    if utf8.is_null() {
        return None;
    }
    let text = unsafe { CStr::from_ptr(utf8) }.to_str().ok()?.trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}
