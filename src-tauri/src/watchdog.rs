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
        OpenProcess, TerminateProcess, WaitForSingleObject, CREATE_NO_WINDOW,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsHungAppWindow,
    };

    const WATCHDOG_FLAG: &str = "--qx-watchdog";
    const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
    const HEARTBEAT_GRACE: Duration = Duration::from_secs(12);
    const HEARTBEAT_STALE: Duration = Duration::from_secs(12);
    const RESTART_WINDOW_SECS: u64 = 300;
    const MAX_RESTARTS_IN_WINDOW: usize = 3;

    static SESSION: OnceLock<Session> = OnceLock::new();

    struct Session {
        heartbeat: PathBuf,
        stop: PathBuf,
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
        let heartbeat = root.join(format!("qx-{pid}.heartbeat"));
        let stop = root.join(format!("qx-{pid}.stop"));
        let helper = root.join(format!("qx-watchdog-{pid}.exe"));
        let restart_state = root.join("restart-history.txt");

        let _ = fs::remove_file(&heartbeat);
        let _ = fs::remove_file(&stop);
        let _ = fs::remove_file(&helper);
        fs::copy(&target, &helper).map_err(|e| {
            format!(
                "copy watchdog helper from {} to {}: {e}",
                target.display(),
                helper.display()
            )
        })?;
        write_heartbeat(&heartbeat)?;

        let child = Command::new(&helper)
            .arg(WATCHDOG_FLAG)
            .arg("--pid")
            .arg(pid.to_string())
            .arg("--target-app")
            .arg(&target)
            .arg("--heartbeat")
            .arg(&heartbeat)
            .arg("--stop")
            .arg(&stop)
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
                heartbeat: heartbeat.clone(),
                stop,
            })
            .map_err(|_| "watchdog session initialized twice".to_string())?;

        let _ = thread::Builder::new()
            .name("qx-watchdog-heartbeat".to_string())
            .spawn(move || loop {
                if write_heartbeat(&heartbeat).is_err() {
                    // A failed write is intentionally retried. The helper will
                    // only restart after the configured stale interval.
                }
                thread::sleep(HEARTBEAT_INTERVAL);
            });

        Ok(())
    }

    pub(crate) fn mark_clean_shutdown() {
        let Some(session) = SESSION.get() else {
            return;
        };
        let _ = fs::write(&session.stop, b"clean");
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
        let heartbeat = PathBuf::from(
            arg_value(args, "--heartbeat")
                .ok_or_else(|| "watchdog missing --heartbeat".to_string())?,
        );
        let stop = PathBuf::from(
            arg_value(args, "--stop").ok_or_else(|| "watchdog missing --stop".to_string())?,
        );
        let restart_state = PathBuf::from(
            arg_value(args, "--restart-state")
                .ok_or_else(|| "watchdog missing --restart-state".to_string())?,
        );

        supervise(pid, &target, &heartbeat, &stop, &restart_state)
    }

    fn supervise(
        pid: u32,
        target: &Path,
        heartbeat: &Path,
        stop: &Path,
        restart_state: &Path,
    ) -> Result<(), String> {
        let Some(handle) = open_process(pid) else {
            return Err(format!("cannot open Qx process {pid}"));
        };

        let started = std::time::Instant::now();
        let mut restart_for_stall = false;
        loop {
            if stop.exists() {
                close_handle(handle);
                cleanup_files(heartbeat, stop);
                return Ok(());
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
            let stalled =
                beyond_grace && heartbeat_age(heartbeat).is_some_and(|age| age >= HEARTBEAT_STALE);
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
            thread::sleep(Duration::from_secs(2));
        }
        close_handle(handle);

        if stop.exists() {
            cleanup_files(heartbeat, stop);
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

    fn write_heartbeat(path: &Path) -> Result<(), String> {
        let parent = path
            .parent()
            .ok_or_else(|| "watchdog heartbeat has no parent directory".to_string())?;
        fs::create_dir_all(parent).map_err(|e| format!("create heartbeat directory: {e}"))?;
        fs::write(path, now_secs().to_string())
            .map_err(|e| format!("write heartbeat {}: {e}", path.display()))
    }

    fn heartbeat_age(path: &Path) -> Option<Duration> {
        let modified = fs::metadata(path).ok()?.modified().ok()?;
        SystemTime::now().duration_since(modified).ok()
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

    fn cleanup_files(heartbeat: &Path, stop: &Path) {
        let _ = fs::remove_file(heartbeat);
        let _ = fs::remove_file(stop);
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
