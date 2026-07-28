//! Windows process watchdog.
//!
//! The update helper is intentionally short-lived and only waits for an
//! update-time exit. This watchdog is separate: it keeps a small heartbeat
//! from the running app and can relaunch Qx after an unexpected crash or a
//! process-wide stall. It is never started by the watchdog child itself.

#[cfg(target_os = "windows")]
mod windows {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};
    use std::sync::OnceLock;
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::Foundation::{
        CloseHandle, BOOL, HWND, LPARAM, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::System::Threading::{
        CreateEventW, OpenEventW, OpenProcess, SetEvent, TerminateProcess, WaitForSingleObject,
        CREATE_NO_WINDOW, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
        PROCESS_TERMINATE, SYNCHRONIZATION_SYNCHRONIZE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsHungAppWindow,
    };

    const WATCHDOG_FLAG: &str = "--qx-watchdog";
    // A recovery service is deliberately low-frequency. Thirty seconds is
    // soon enough for a background utility, while avoiding needless wakeups
    // from an otherwise idle helper process.
    const HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(30);
    const HEARTBEAT_GRACE: Duration = Duration::from_secs(30);
    const HEARTBEAT_STALE: Duration = Duration::from_secs(60);
    const RESTART_WINDOW_SECS: u64 = 300;
    const MAX_RESTARTS_IN_WINDOW: usize = 3;

    static SESSION: OnceLock<Session> = OnceLock::new();

    struct Session {
        heartbeat_event: usize,
        clean_event: usize,
    }

    pub(crate) fn maybe_run_from_args() -> bool {
        let args: Vec<String> = std::env::args().collect();
        if args.get(1).map(String::as_str) != Some(WATCHDOG_FLAG) {
            return false;
        }

        if let Err(error) = run_from_args(&args) {
            eprintln!("Qx watchdog failed: {error}");
        }
        true
    }

    pub(crate) fn start() -> Result<(), String> {
        if SESSION.get().is_some() {
            return Ok(());
        }

        let target = std::env::current_exe().map_err(|e| format!("resolve Qx executable: {e}"))?;
        let root = crate::paths::cache_dir().join("watchdog");
        fs::create_dir_all(&root)
            .map_err(|e| format!("create watchdog directory {}: {e}", root.display()))?;

        let pid = std::process::id();
        let nonce = now_millis();
        let heartbeat_name = format!("Local\\Qx-Watchdog-Heartbeat-{pid}-{nonce}");
        let clean_name = format!("Local\\Qx-Watchdog-Clean-{pid}-{nonce}");
        let helper = root.join(format!("qx-watchdog-{pid}.exe"));
        let restart_state = root.join("restart-history.txt");

        let _ = fs::remove_file(&helper);
        fs::copy(&target, &helper).map_err(|e| {
            format!(
                "copy watchdog helper from {} to {}: {e}",
                target.display(),
                helper.display()
            )
        })?;
        let heartbeat_event = create_named_event(&heartbeat_name)?;
        let clean_event = create_named_event(&clean_name)?;

        let child = Command::new(&helper)
            .arg(WATCHDOG_FLAG)
            .arg("--pid")
            .arg(pid.to_string())
            .arg("--target-app")
            .arg(&target)
            .arg("--heartbeat-event")
            .arg(&heartbeat_name)
            .arg("--clean-event")
            .arg(&clean_name)
            .arg("--restart-state")
            .arg(&restart_state)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("spawn watchdog helper {}: {e}", helper.display()))?;

        // The helper is detached and must survive the parent process. We only
        // use the child handle as a startup sanity check; after this point the
        // helper owns its own lifetime.
        drop(child);
        SESSION
            .set(Session {
                heartbeat_event,
                clean_event,
            })
            .map_err(|_| "watchdog session initialized twice".to_string())?;

        let _ = thread::Builder::new()
            .name("qx-watchdog-heartbeat".to_string())
            .spawn(move || loop {
                unsafe {
                    if SetEvent(heartbeat_event as *mut core::ffi::c_void) == 0 {
                        break;
                    }
                }
                thread::sleep(HEALTH_CHECK_INTERVAL);
            });

        Ok(())
    }

    pub(crate) fn mark_clean_shutdown() {
        let Some(session) = SESSION.get() else {
            return;
        };
        unsafe {
            let _ = SetEvent(session.clean_event as *mut core::ffi::c_void);
        }
    }

    fn run_from_args(args: &[String]) -> Result<(), String> {
        let pid = arg_value(args, "--pid")
            .ok_or_else(|| "watchdog missing --pid".to_string())?
            .parse::<u32>()
            .map_err(|e| format!("invalid watchdog pid: {e}"))?;
        let target = PathBuf::from(
            arg_value(args, "--target-app")
                .ok_or_else(|| "watchdog missing --target-app".to_string())?,
        );
        let heartbeat_name = arg_value(args, "--heartbeat-event")
            .ok_or_else(|| "watchdog missing --heartbeat-event".to_string())?;
        let clean_name = arg_value(args, "--clean-event")
            .ok_or_else(|| "watchdog missing --clean-event".to_string())?;
        let restart_state = PathBuf::from(
            arg_value(args, "--restart-state")
                .ok_or_else(|| "watchdog missing --restart-state".to_string())?,
        );

        let heartbeat_event = open_named_event(&heartbeat_name)?;
        let clean_event = open_named_event(&clean_name)?;
        let result = supervise(pid, &target, heartbeat_event, clean_event, &restart_state);
        close_handle(heartbeat_event);
        close_handle(clean_event);
        result
    }

    fn supervise(
        pid: u32,
        target: &Path,
        heartbeat_event: *mut core::ffi::c_void,
        clean_event: *mut core::ffi::c_void,
        restart_state: &Path,
    ) -> Result<(), String> {
        let Some(handle) = open_process(pid) else {
            return Err(format!("cannot open Qx process {pid}"));
        };

        let started = std::time::Instant::now();
        let mut last_heartbeat = started;
        let mut restart_for_stall = false;
        loop {
            if unsafe { WaitForSingleObject(clean_event, 0) } == WAIT_OBJECT_0 {
                close_handle(handle);
                return Ok(());
            }

            let heartbeat_status = unsafe {
                WaitForSingleObject(heartbeat_event, HEALTH_CHECK_INTERVAL.as_millis() as u32)
            };
            if heartbeat_status == WAIT_OBJECT_0 {
                last_heartbeat = std::time::Instant::now();
            } else if heartbeat_status != WAIT_TIMEOUT {
                close_handle(handle);
                return Err(format!(
                    "wait for Qx heartbeat failed with code {heartbeat_status}"
                ));
            }

            let status = unsafe { WaitForSingleObject(handle, 0) };
            if status == WAIT_OBJECT_0 {
                break;
            }
            if status != WAIT_TIMEOUT {
                close_handle(handle);
                return Err(format!(
                    "wait for Qx process {pid} failed with code {status}"
                ));
            }

            let beyond_grace = started.elapsed() >= HEARTBEAT_GRACE;
            let stalled = beyond_grace && last_heartbeat.elapsed() >= HEARTBEAT_STALE;
            if beyond_grace && (stalled || app_window_is_hung(pid)) {
                let terminated = unsafe { TerminateProcess(handle, 1) != 0 };
                if !terminated {
                    close_handle(handle);
                    return Err(format!(
                        "terminate hung Qx process {pid} failed: {}",
                        std::io::Error::last_os_error()
                    ));
                }
                restart_for_stall = true;
                break;
            }
        }
        close_handle(handle);

        if unsafe { WaitForSingleObject(clean_event, 0) } == WAIT_OBJECT_0 {
            return Ok(());
        }
        if !allow_restart(restart_state) {
            return Err("restart budget exhausted after repeated Qx failures".to_string());
        }
        if !target.is_file() {
            return Err(format!("Qx executable is missing: {}", target.display()));
        }

        Command::new(target)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| {
                if restart_for_stall {
                    format!("restart Qx after stalled heartbeat: {e}")
                } else {
                    format!("restart Qx after unexpected exit: {e}")
                }
            })?;
        Ok(())
    }

    fn open_process(pid: u32) -> Option<*mut core::ffi::c_void> {
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE | PROCESS_TERMINATE,
                0,
                pid,
            )
        };
        (!handle.is_null()).then_some(handle)
    }

    fn close_handle(handle: *mut core::ffi::c_void) {
        unsafe {
            CloseHandle(handle);
        }
    }

    fn create_named_event(name: &str) -> Result<usize, String> {
        let wide = wide_name(name);
        let handle = unsafe { CreateEventW(std::ptr::null(), 0, 0, wide.as_ptr()) };
        if handle.is_null() {
            return Err(format!(
                "create watchdog event {name}: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(handle as usize)
    }

    fn open_named_event(name: &str) -> Result<*mut core::ffi::c_void, String> {
        let wide = wide_name(name);
        let handle = unsafe { OpenEventW(SYNCHRONIZATION_SYNCHRONIZE, 0, wide.as_ptr()) };
        if handle.is_null() {
            return Err(format!(
                "open watchdog event {name}: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(handle)
    }

    fn wide_name(name: &str) -> Vec<u16> {
        name.encode_utf16().chain(std::iter::once(0)).collect()
    }

    struct WindowState {
        pid: u32,
        hung: bool,
    }

    unsafe extern "system" fn inspect_window(hwnd: HWND, state: LPARAM) -> BOOL {
        let state = &mut *(state as *mut WindowState);
        let mut window_pid = 0;
        GetWindowThreadProcessId(hwnd, &mut window_pid);
        if window_pid == state.pid && IsHungAppWindow(hwnd) != 0 {
            state.hung = true;
            return 0;
        }
        1
    }

    fn app_window_is_hung(pid: u32) -> bool {
        let mut state = WindowState { pid, hung: false };
        unsafe {
            let _ = EnumWindows(Some(inspect_window), &mut state as *mut _ as LPARAM);
        }
        state.hung
    }

    fn allow_restart(path: &Path) -> bool {
        let now = now_secs();
        let cutoff = now.saturating_sub(RESTART_WINDOW_SECS);
        let mut recent = fs::read_to_string(path)
            .unwrap_or_default()
            .lines()
            .filter_map(|line| line.parse::<u64>().ok())
            .filter(|timestamp| *timestamp >= cutoff)
            .collect::<Vec<_>>();
        if recent.len() >= MAX_RESTARTS_IN_WINDOW {
            return false;
        }
        recent.push(now);
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let content = recent
            .iter()
            .map(u64::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let _ = fs::write(path, content);
        true
    }

    fn arg_value(args: &[String], key: &str) -> Option<String> {
        args.windows(2)
            .find(|window| window[0] == key)
            .map(|window| window[1].clone())
    }

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or_default()
    }

    fn now_millis() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or_default()
    }
}

#[cfg(target_os = "windows")]
pub(crate) use windows::{mark_clean_shutdown, maybe_run_from_args, start};

#[cfg(not(target_os = "windows"))]
pub(crate) fn maybe_run_from_args() -> bool {
    false
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn start() -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn mark_clean_shutdown() {}
