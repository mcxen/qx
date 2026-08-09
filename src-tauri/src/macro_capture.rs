//! A stoppable, platform-native input capture session for macro recording.
//!
//! The screenshot pointer listener is intentionally not used here.  A capture
//! session owns its native hook/event tap for its whole lifetime and has one
//! narrow callback responsibility: copy a small raw event into a bounded
//! queue.  Event interpretation is performed by the worker thread.

use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const CAPTURE_QUEUE_CAPACITY: usize = 4096;
const START_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum CaptureEventKind {
    KeyDown {
        code: u32,
    },
    KeyUp {
        code: u32,
    },
    /// macOS modifier events are emitted as flags changes.  The worker turns
    /// them into a press/release after the callback has returned.
    KeyFlagsChanged {
        code: u32,
        flags: u64,
    },
    MouseMove {
        x: f64,
        y: f64,
    },
    MouseButton {
        button: u32,
        pressed: bool,
        x: f64,
        y: f64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CaptureEvent {
    pub(crate) kind: CaptureEventKind,
    pub(crate) captured_at: Instant,
}

pub(crate) struct MacroCaptureSession<T: Send + 'static> {
    native: Box<dyn NativeCaptureSession>,
    worker: JoinHandle<T>,
}

trait NativeCaptureSession: Send {
    /// Disable the native source, release its resources, and wait for the
    /// native thread to finish before returning.
    fn stop_and_join(self: Box<Self>) -> Result<(), String>;
}

impl<T: Send + 'static> MacroCaptureSession<T> {
    pub(crate) fn stop(self) -> Result<T, String> {
        let native_result = self.native.stop_and_join();
        let worker_result = self
            .worker
            .join()
            .map_err(|_| "macro capture worker thread panicked".to_string());

        native_result?;
        worker_result
    }
}

pub(crate) fn start<T, F>(process: F) -> Result<MacroCaptureSession<T>, String>
where
    T: Send + 'static,
    F: FnOnce(Receiver<CaptureEvent>) -> T + Send + 'static,
{
    let (sender, receiver) = mpsc::sync_channel(CAPTURE_QUEUE_CAPACITY);
    let native = platform::start(sender)?;
    let worker = match thread::Builder::new()
        .name("qx-macro-capture-worker".to_string())
        .spawn(|| process(receiver))
    {
        Ok(worker) => worker,
        Err(error) => {
            let _ = native.stop_and_join();
            return Err(format!("start macro capture worker: {error}"));
        }
    };

    Ok(MacroCaptureSession { native, worker })
}

fn enqueue(sender: &SyncSender<CaptureEvent>, kind: CaptureEventKind) {
    // A hook callback must never wait for the worker.  Dropping the newest
    // high-frequency event when the bounded queue is full keeps input hooks
    // responsive and is preferable to blocking the OS event thread.
    let _ = sender.try_send(CaptureEvent {
        kind,
        captured_at: Instant::now(),
    });
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};

    const CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = u32::MAX - 1;
    const CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = u32::MAX;

    const CG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
    const CG_EVENT_LEFT_MOUSE_UP: u32 = 2;
    const CG_EVENT_RIGHT_MOUSE_DOWN: u32 = 3;
    const CG_EVENT_RIGHT_MOUSE_UP: u32 = 4;
    const CG_EVENT_MOUSE_MOVED: u32 = 5;
    const CG_EVENT_LEFT_MOUSE_DRAGGED: u32 = 6;
    const CG_EVENT_RIGHT_MOUSE_DRAGGED: u32 = 7;
    const CG_EVENT_KEY_DOWN: u32 = 10;
    const CG_EVENT_KEY_UP: u32 = 11;
    const CG_EVENT_FLAGS_CHANGED: u32 = 12;
    const CG_EVENT_SCROLL_WHEEL: u32 = 22;
    const CG_EVENT_OTHER_MOUSE_DOWN: u32 = 25;
    const CG_EVENT_OTHER_MOUSE_UP: u32 = 26;
    const CG_EVENT_OTHER_MOUSE_DRAGGED: u32 = 27;

    const CG_EVENT_KEYBOARD_EVENT_KEYCODE: u32 = 9;
    const CG_EVENT_MOUSE_EVENT_BUTTON_NUMBER: u32 = 3;

    const EVENT_MASK: u64 = (1u64 << CG_EVENT_LEFT_MOUSE_DOWN)
        | (1u64 << CG_EVENT_LEFT_MOUSE_UP)
        | (1u64 << CG_EVENT_RIGHT_MOUSE_DOWN)
        | (1u64 << CG_EVENT_RIGHT_MOUSE_UP)
        | (1u64 << CG_EVENT_MOUSE_MOVED)
        | (1u64 << CG_EVENT_LEFT_MOUSE_DRAGGED)
        | (1u64 << CG_EVENT_RIGHT_MOUSE_DRAGGED)
        | (1u64 << CG_EVENT_KEY_DOWN)
        | (1u64 << CG_EVENT_KEY_UP)
        | (1u64 << CG_EVENT_FLAGS_CHANGED)
        | (1u64 << CG_EVENT_SCROLL_WHEEL)
        | (1u64 << CG_EVENT_OTHER_MOUSE_DOWN)
        | (1u64 << CG_EVENT_OTHER_MOUSE_UP)
        | (1u64 << CG_EVENT_OTHER_MOUSE_DRAGGED);

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    type CFMachPortRef = *mut c_void;
    type CFRunLoopSourceRef = *mut c_void;
    type CFRunLoopRef = *mut c_void;
    type CGEventRef = *const c_void;
    type CGEventTapCallback = unsafe extern "C" fn(
        proxy: *const c_void,
        event_type: u32,
        event: CGEventRef,
        user_info: *mut c_void,
    ) -> CGEventRef;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventTapCreate(
            tap: u32,
            placement: u32,
            options: u32,
            events_of_interest: u64,
            callback: CGEventTapCallback,
            user_info: *mut c_void,
        ) -> CFMachPortRef;
        fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
        fn CGEventGetFlags(event: CGEventRef) -> u64;
        fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
        fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        static kCFAllocatorDefault: *const c_void;
        static kCFRunLoopCommonModes: *const c_void;

        fn CFMachPortCreateRunLoopSource(
            allocator: *const c_void,
            port: CFMachPortRef,
            order: isize,
        ) -> CFRunLoopSourceRef;
        fn CFMachPortInvalidate(port: CFMachPortRef);
        fn CFRelease(value: *const c_void);
        fn CFRunLoopAddSource(
            run_loop: CFRunLoopRef,
            source: CFRunLoopSourceRef,
            mode: *const c_void,
        );
        fn CFRunLoopGetCurrent() -> CFRunLoopRef;
        fn CFRunLoopRemoveSource(
            run_loop: CFRunLoopRef,
            source: CFRunLoopSourceRef,
            mode: *const c_void,
        );
        fn CFRunLoopRun();
        fn CFRunLoopStop(run_loop: CFRunLoopRef);
        fn CFRunLoopWakeUp(run_loop: CFRunLoopRef);
    }

    struct MacControl {
        stopping: AtomicBool,
        tap: AtomicPtr<c_void>,
        run_loop: AtomicPtr<c_void>,
    }

    struct MacCallbackState {
        sender: SyncSender<CaptureEvent>,
        control: Arc<MacControl>,
    }

    struct MacCaptureSession {
        control: Arc<MacControl>,
        thread: Option<JoinHandle<Result<(), String>>>,
    }

    impl NativeCaptureSession for MacCaptureSession {
        fn stop_and_join(mut self: Box<Self>) -> Result<(), String> {
            self.control.stopping.store(true, Ordering::SeqCst);

            unsafe {
                let tap = self.control.tap.load(Ordering::SeqCst);
                if !tap.is_null() {
                    // Disable first so no more input is delivered while the
                    // run loop is being stopped.
                    CGEventTapEnable(tap, false);
                }
                let run_loop = self.control.run_loop.load(Ordering::SeqCst);
                if !run_loop.is_null() {
                    CFRunLoopStop(run_loop);
                    CFRunLoopWakeUp(run_loop);
                }
            }

            let result = self
                .thread
                .take()
                .expect("mac capture thread missing")
                .join()
                .map_err(|_| "macOS macro capture thread panicked".to_string())?;
            result
        }
    }

    pub(super) fn start(
        sender: SyncSender<CaptureEvent>,
    ) -> Result<Box<dyn NativeCaptureSession>, String> {
        if !crate::permissions::macro_capture_permission_granted() {
            return Err("macro_permission_denied:input-monitoring".to_string());
        }

        let control = Arc::new(MacControl {
            stopping: AtomicBool::new(false),
            tap: AtomicPtr::new(null_mut()),
            run_loop: AtomicPtr::new(null_mut()),
        });
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let thread_control = Arc::clone(&control);
        let thread = thread::Builder::new()
            .name("qx-macro-capture-macos".to_string())
            .spawn(move || run_capture(thread_control, sender, ready_tx))
            .map_err(|error| format!("start macOS macro capture thread: {error}"))?;

        let session = MacCaptureSession {
            control,
            thread: Some(thread),
        };

        match ready_rx.recv_timeout(START_TIMEOUT) {
            Ok(Ok(())) => Ok(Box::new(session)),
            Ok(Err(error)) => {
                let _ = Box::new(session).stop_and_join();
                Err(error)
            }
            Err(error) => {
                let _ = Box::new(session).stop_and_join();
                Err(format!("macOS macro capture did not start: {error}"))
            }
        }
    }

    fn run_capture(
        control: Arc<MacControl>,
        sender: SyncSender<CaptureEvent>,
        ready: SyncSender<Result<(), String>>,
    ) -> Result<(), String> {
        let callback_state = Box::new(MacCallbackState {
            sender,
            control: Arc::clone(&control),
        });
        let callback_info = Box::into_raw(callback_state);

        unsafe {
            // HID/head/listen-only gives us global raw events without
            // modifying or consuming the user's input stream.
            let tap = CGEventTapCreate(
                0,
                0,
                1,
                EVENT_MASK,
                event_tap_callback,
                callback_info.cast(),
            );
            if tap.is_null() {
                drop(Box::from_raw(callback_info));
                let error = "macro_permission_denied:input-monitoring".to_string();
                let _ = ready.send(Err(error.clone()));
                return Err(error);
            }
            control.tap.store(tap, Ordering::SeqCst);
            if control.stopping.load(Ordering::SeqCst) {
                CFMachPortInvalidate(tap);
                CFRelease(tap.cast());
                control.tap.store(null_mut(), Ordering::SeqCst);
                drop(Box::from_raw(callback_info));
                let error = "macOS macro capture stopped before the event tap started".to_string();
                let _ = ready.send(Err(error.clone()));
                return Err(error);
            }

            let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0);
            if source.is_null() {
                CFMachPortInvalidate(tap);
                CFRelease(tap.cast());
                control.tap.store(null_mut(), Ordering::SeqCst);
                drop(Box::from_raw(callback_info));
                let error =
                    "Macro recording event tap run-loop source could not be created.".to_string();
                let _ = ready.send(Err(error.clone()));
                return Err(error);
            }

            let run_loop = CFRunLoopGetCurrent();
            control.run_loop.store(run_loop, Ordering::SeqCst);
            if control.stopping.load(Ordering::SeqCst) {
                CFRelease(source.cast());
                CFMachPortInvalidate(tap);
                CFRelease(tap.cast());
                control.run_loop.store(null_mut(), Ordering::SeqCst);
                control.tap.store(null_mut(), Ordering::SeqCst);
                drop(Box::from_raw(callback_info));
                let error = "macOS macro capture stopped before the run loop started".to_string();
                let _ = ready.send(Err(error.clone()));
                return Err(error);
            }
            CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
            CGEventTapEnable(tap, true);
            let _ = ready.send(Ok(()));

            CFRunLoopRun();

            // The run loop is stopped only by the session's stop path.  Keep
            // all Core Foundation cleanup on this thread and in this order.
            CFRunLoopRemoveSource(run_loop, source, kCFRunLoopCommonModes);
            CFMachPortInvalidate(tap);
            CFRelease(source.cast());
            CFRelease(tap.cast());
            control.run_loop.store(null_mut(), Ordering::SeqCst);
            control.tap.store(null_mut(), Ordering::SeqCst);
            drop(Box::from_raw(callback_info));
        }

        Ok(())
    }

    unsafe extern "C" fn event_tap_callback(
        _proxy: *const c_void,
        event_type: u32,
        event: CGEventRef,
        user_info: *mut c_void,
    ) -> CGEventRef {
        if user_info.is_null() {
            return event;
        }
        let state = &*(user_info as *const MacCallbackState);

        if event_type == CG_EVENT_TAP_DISABLED_BY_TIMEOUT
            || event_type == CG_EVENT_TAP_DISABLED_BY_USER_INPUT
        {
            if !state.control.stopping.load(Ordering::SeqCst) {
                let tap = state.control.tap.load(Ordering::SeqCst);
                if !tap.is_null() {
                    CGEventTapEnable(tap, true);
                }
            }
            return event;
        }

        if event.is_null() || state.control.stopping.load(Ordering::Relaxed) {
            return event;
        }

        let kind = match event_type {
            CG_EVENT_KEY_DOWN => Some(CaptureEventKind::KeyDown {
                code: CGEventGetIntegerValueField(event, CG_EVENT_KEYBOARD_EVENT_KEYCODE) as u32,
            }),
            CG_EVENT_KEY_UP => Some(CaptureEventKind::KeyUp {
                code: CGEventGetIntegerValueField(event, CG_EVENT_KEYBOARD_EVENT_KEYCODE) as u32,
            }),
            CG_EVENT_FLAGS_CHANGED => Some(CaptureEventKind::KeyFlagsChanged {
                code: CGEventGetIntegerValueField(event, CG_EVENT_KEYBOARD_EVENT_KEYCODE) as u32,
                flags: CGEventGetFlags(event),
            }),
            CG_EVENT_MOUSE_MOVED | CG_EVENT_LEFT_MOUSE_DRAGGED | CG_EVENT_RIGHT_MOUSE_DRAGGED => {
                let point = CGEventGetLocation(event);
                Some(CaptureEventKind::MouseMove {
                    x: point.x,
                    y: point.y,
                })
            }
            CG_EVENT_LEFT_MOUSE_DOWN | CG_EVENT_LEFT_MOUSE_UP => {
                let point = CGEventGetLocation(event);
                Some(CaptureEventKind::MouseButton {
                    button: 0,
                    pressed: event_type == CG_EVENT_LEFT_MOUSE_DOWN,
                    x: point.x,
                    y: point.y,
                })
            }
            CG_EVENT_RIGHT_MOUSE_DOWN | CG_EVENT_RIGHT_MOUSE_UP => {
                let point = CGEventGetLocation(event);
                Some(CaptureEventKind::MouseButton {
                    button: 1,
                    pressed: event_type == CG_EVENT_RIGHT_MOUSE_DOWN,
                    x: point.x,
                    y: point.y,
                })
            }
            CG_EVENT_OTHER_MOUSE_DOWN | CG_EVENT_OTHER_MOUSE_UP | CG_EVENT_OTHER_MOUSE_DRAGGED => {
                let point = CGEventGetLocation(event);
                Some(CaptureEventKind::MouseButton {
                    button: CGEventGetIntegerValueField(event, CG_EVENT_MOUSE_EVENT_BUTTON_NUMBER)
                        as u32,
                    pressed: event_type == CG_EVENT_OTHER_MOUSE_DOWN,
                    x: point.x,
                    y: point.y,
                })
            }
            // MacroStep has no scroll representation yet.  Still include
            // scroll in the tap mask so the event tap remains a complete
            // keyboard/mouse source without trying to reinterpret it here.
            CG_EVENT_SCROLL_WHEEL => None,
            _ => None,
        };

        if let Some(kind) = kind {
            enqueue(&state.sender, kind);
        }
        event
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use std::mem::MaybeUninit;
    use std::ptr::{null, null_mut};
    use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering};

    use windows_sys::Win32::Foundation::{GetLastError, HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, PeekMessageW, PostThreadMessageW, SetWindowsHookExW,
        UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT, PM_NOREMOVE,
        WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP,
        WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEMOVE, WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP,
        WM_SYSKEYDOWN, WM_SYSKEYUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
    };

    struct WindowsControl {
        stopping: AtomicBool,
        thread_id: AtomicU32,
        keyboard_hook: AtomicPtr<c_void>,
        mouse_hook: AtomicPtr<c_void>,
    }

    struct WindowsCallbackState {
        sender: SyncSender<CaptureEvent>,
        control: Arc<WindowsControl>,
    }

    struct WindowsCaptureSession {
        control: Arc<WindowsControl>,
        thread: Option<JoinHandle<Result<(), String>>>,
    }

    static CALLBACK_STATE: AtomicPtr<c_void> = AtomicPtr::new(null_mut());

    impl NativeCaptureSession for WindowsCaptureSession {
        fn stop_and_join(mut self: Box<Self>) -> Result<(), String> {
            self.control.stopping.store(true, Ordering::SeqCst);
            // The hook thread performs the final cleanup as well, but doing
            // this before posting WM_QUIT makes the stop contract explicit:
            // both independent hooks are unregistered before we join.
            unhook_saved_hooks(&self.control);

            let thread_id = self.control.thread_id.load(Ordering::SeqCst);
            if thread_id != 0 {
                unsafe {
                    let _ = PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
                }
            }

            self.thread
                .take()
                .expect("Windows capture thread missing")
                .join()
                .map_err(|_| "Windows macro capture thread panicked".to_string())?
        }
    }

    pub(super) fn start(
        sender: SyncSender<CaptureEvent>,
    ) -> Result<Box<dyn NativeCaptureSession>, String> {
        let control = Arc::new(WindowsControl {
            stopping: AtomicBool::new(false),
            thread_id: AtomicU32::new(0),
            keyboard_hook: AtomicPtr::new(null_mut()),
            mouse_hook: AtomicPtr::new(null_mut()),
        });
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let thread_control = Arc::clone(&control);
        let thread = thread::Builder::new()
            .name("qx-macro-capture-windows".to_string())
            .spawn(move || run_capture(thread_control, sender, ready_tx))
            .map_err(|error| format!("start Windows macro capture thread: {error}"))?;

        let session = WindowsCaptureSession {
            control,
            thread: Some(thread),
        };

        match ready_rx.recv_timeout(START_TIMEOUT) {
            Ok(Ok(())) => Ok(Box::new(session)),
            Ok(Err(error)) => {
                let _ = Box::new(session).stop_and_join();
                Err(error)
            }
            Err(error) => {
                let _ = Box::new(session).stop_and_join();
                Err(format!("Windows macro capture did not start: {error}"))
            }
        }
    }

    fn run_capture(
        control: Arc<WindowsControl>,
        sender: SyncSender<CaptureEvent>,
        ready: SyncSender<Result<(), String>>,
    ) -> Result<(), String> {
        unsafe {
            let thread_id = GetCurrentThreadId();
            control.thread_id.store(thread_id, Ordering::SeqCst);
            let mut message = MaybeUninit::<MSG>::zeroed().assume_init();
            // A thread message queue is created lazily.  Create it before the
            // caller can attempt to wake this thread with WM_QUIT.
            let _ = PeekMessageW(&mut message, null_mut(), 0, 0, PM_NOREMOVE);

            // `stop_and_join` may race with thread startup. If it observed a
            // zero thread id before this point, the stopping flag is the
            // second wake-up path; never enter GetMessageW after it is set.
            if control.stopping.load(Ordering::SeqCst) {
                let error = "Windows macro capture stopped before hooks started".to_string();
                let _ = ready.send(Err(error));
                return Ok(());
            }

            let callback_state = Box::new(WindowsCallbackState {
                sender,
                control: Arc::clone(&control),
            });
            let callback_info = Box::into_raw(callback_state);
            CALLBACK_STATE.store(callback_info.cast(), Ordering::SeqCst);

            let module: HINSTANCE = GetModuleHandleW(null());
            let keyboard_hook =
                SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook_callback), module, 0);
            if keyboard_hook.is_null() {
                return fail_start(
                    &control,
                    callback_info,
                    &ready,
                    format!("macro_permission_denied:keyboard-hook:{}", GetLastError()),
                );
            }
            control.keyboard_hook.store(keyboard_hook, Ordering::SeqCst);
            if control.stopping.load(Ordering::SeqCst) {
                unhook_saved_hooks(&control);
                CALLBACK_STATE.store(null_mut(), Ordering::SeqCst);
                drop(Box::from_raw(callback_info));
                let error =
                    "Windows macro capture stopped before the mouse hook started".to_string();
                let _ = ready.send(Err(error));
                return Ok(());
            }

            let mouse_hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_callback), module, 0);
            if mouse_hook.is_null() {
                let error_code = GetLastError();
                unhook_saved_hooks(&control);
                CALLBACK_STATE.store(null_mut(), Ordering::SeqCst);
                drop(Box::from_raw(callback_info));
                let error = format!("macro_permission_denied:mouse-hook:{}", error_code);
                let _ = ready.send(Err(error.clone()));
                return Err(error);
            }
            control.mouse_hook.store(mouse_hook, Ordering::SeqCst);
            if control.stopping.load(Ordering::SeqCst) {
                unhook_saved_hooks(&control);
                CALLBACK_STATE.store(null_mut(), Ordering::SeqCst);
                drop(Box::from_raw(callback_info));
                let error =
                    "Windows macro capture stopped before the message loop started".to_string();
                let _ = ready.send(Err(error));
                return Ok(());
            }
            let _ = ready.send(Ok(()));

            loop {
                let result = GetMessageW(&mut message, null_mut(), 0, 0);
                if result <= 0 {
                    break;
                }
            }

            unhook_saved_hooks(&control);
            CALLBACK_STATE.store(null_mut(), Ordering::SeqCst);
            drop(Box::from_raw(callback_info));
            Ok(())
        }
    }

    unsafe fn fail_start(
        control: &WindowsControl,
        callback_info: *mut WindowsCallbackState,
        ready: &SyncSender<Result<(), String>>,
        error: String,
    ) -> Result<(), String> {
        unhook_saved_hooks(control);
        CALLBACK_STATE.store(null_mut(), Ordering::SeqCst);
        drop(Box::from_raw(callback_info));
        let _ = ready.send(Err(error.clone()));
        Err(error)
    }

    fn unhook_saved_hooks(control: &WindowsControl) {
        let keyboard = control.keyboard_hook.swap(null_mut(), Ordering::SeqCst);
        let mouse = control.mouse_hook.swap(null_mut(), Ordering::SeqCst);
        unsafe {
            if !keyboard.is_null() {
                let _ = UnhookWindowsHookEx(keyboard);
            }
            if !mouse.is_null() {
                let _ = UnhookWindowsHookEx(mouse);
            }
        }
    }

    unsafe extern "system" fn keyboard_hook_callback(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code >= HC_ACTION as i32 {
            if let Some(state) = callback_state() {
                if !state.control.stopping.load(Ordering::Relaxed) && lparam != 0 {
                    let data = &*(lparam as *const KBDLLHOOKSTRUCT);
                    let kind = match wparam as u32 {
                        WM_KEYDOWN | WM_SYSKEYDOWN => {
                            Some(CaptureEventKind::KeyDown { code: data.vkCode })
                        }
                        WM_KEYUP | WM_SYSKEYUP => {
                            Some(CaptureEventKind::KeyUp { code: data.vkCode })
                        }
                        _ => None,
                    };
                    if let Some(kind) = kind {
                        enqueue(&state.sender, kind);
                    }
                }
            }
        }
        CallNextHookEx(null_mut(), code, wparam, lparam)
    }

    unsafe extern "system" fn mouse_hook_callback(
        code: i32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if code >= HC_ACTION as i32 {
            if let Some(state) = callback_state() {
                if !state.control.stopping.load(Ordering::Relaxed) && lparam != 0 {
                    let data = &*(lparam as *const MSLLHOOKSTRUCT);
                    let event_type = wparam as u32;
                    let point = data.pt;
                    let kind = match event_type {
                        WM_MOUSEMOVE => Some(CaptureEventKind::MouseMove {
                            x: point.x as f64,
                            y: point.y as f64,
                        }),
                        WM_LBUTTONDOWN | WM_LBUTTONUP => Some(CaptureEventKind::MouseButton {
                            button: 0,
                            pressed: event_type == WM_LBUTTONDOWN,
                            x: point.x as f64,
                            y: point.y as f64,
                        }),
                        WM_RBUTTONDOWN | WM_RBUTTONUP => Some(CaptureEventKind::MouseButton {
                            button: 1,
                            pressed: event_type == WM_RBUTTONDOWN,
                            x: point.x as f64,
                            y: point.y as f64,
                        }),
                        WM_MBUTTONDOWN | WM_MBUTTONUP => Some(CaptureEventKind::MouseButton {
                            button: 2,
                            pressed: event_type == WM_MBUTTONDOWN,
                            x: point.x as f64,
                            y: point.y as f64,
                        }),
                        WM_XBUTTONDOWN | WM_XBUTTONUP => Some(CaptureEventKind::MouseButton {
                            button: data.mouseData >> 16,
                            pressed: event_type == WM_XBUTTONDOWN,
                            x: point.x as f64,
                            y: point.y as f64,
                        }),
                        _ => None,
                    };
                    if let Some(kind) = kind {
                        enqueue(&state.sender, kind);
                    }
                }
            }
        }
        CallNextHookEx(null_mut(), code, wparam, lparam)
    }

    unsafe fn callback_state<'a>() -> Option<&'a WindowsCallbackState> {
        let pointer = CALLBACK_STATE.load(Ordering::Acquire);
        if pointer.is_null() {
            None
        } else {
            Some(&*(pointer as *const WindowsCallbackState))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_queue_is_bounded_and_non_blocking() {
        let (sender, receiver) = mpsc::sync_channel(1);
        enqueue(&sender, CaptureEventKind::KeyDown { code: 42 });
        enqueue(&sender, CaptureEventKind::KeyUp { code: 42 });

        let first = receiver.try_recv().expect("first event should be queued");
        assert_eq!(first.kind, CaptureEventKind::KeyDown { code: 42 });
        assert!(receiver.try_recv().is_err());
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::*;

    pub(super) fn start(
        _sender: SyncSender<CaptureEvent>,
    ) -> Result<Box<dyn NativeCaptureSession>, String> {
        Err("Macro recording is only supported on macOS and Windows.".to_string())
    }
}
