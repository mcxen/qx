use super::*;
use std::os::windows::ffi::OsStrExt;
use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, WaitForSingleObject, INFINITE,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};
use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

pub(super) fn prepare_install(
    version: &str,
    asset_url: &str,
    expected_sha256: &str,
    expected_size: Option<u64>,
) -> Result<InstallPlan, String> {
    prune_update_cache(Some(version));
    let update_dir = update_cache_dir().join(version);
    let _ = fs::remove_dir_all(&update_dir);
    fs::create_dir_all(&update_dir).map_err(|e| format!("create update dir: {e}"))?;
    let payload = update_dir.join("Qx-update.exe");
    download_verified_file(asset_url, &payload, expected_sha256, expected_size)?;
    validate_installer(&payload)?;
    let target = std::env::current_exe().map_err(|e| format!("resolve current exe: {e}"))?;
    let helper = spawn_helper(&payload, &target, version)?;
    Ok(InstallPlan {
        payload,
        target,
        helper,
        message: "Update downloaded. Qx will quit, install the update, and relaunch. Windows may ask for administrator approval.".to_string(),
    })
}

fn validate_installer(installer: &Path) -> Result<(), String> {
    if installer.extension().and_then(|value| value.to_str()) != Some("exe") {
        return Err("Windows update asset is not an .exe installer".to_string());
    }
    let mut file = fs::File::open(installer)
        .map_err(|e| format!("open Windows update installer {}: {e}", installer.display()))?;
    let mut magic = [0u8; 2];
    file.read_exact(&mut magic)
        .map_err(|e| format!("read Windows update installer header: {e}"))?;
    if magic != *b"MZ" {
        return Err("Windows update installer has an invalid executable header".to_string());
    }
    Ok(())
}

fn spawn_helper(installer: &Path, target_exe: &Path, version: &str) -> Result<PathBuf, String> {
    let helper_path =
        update_cache_dir().join(format!("qx-update-helper-{}.exe", std::process::id()));
    let current_exe = std::env::current_exe().map_err(|e| format!("resolve current exe: {e}"))?;
    let _ = fs::remove_file(&helper_path);
    fs::copy(&current_exe, &helper_path).map_err(|e| {
        format!(
            "copy Windows update helper from {} to {}: {e}",
            current_exe.display(),
            helper_path.display()
        )
    })?;
    let mut child = Command::new(&helper_path)
        .arg(HELPER_FLAG)
        .arg("--pid")
        .arg(std::process::id().to_string())
        .arg("--version")
        .arg(version)
        .arg("--windows-installer")
        .arg(installer)
        .arg("--target-app")
        .arg(target_exe)
        .arg("--restart")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn Windows update helper {}: {e}", helper_path.display()))?;

    std::thread::sleep(Duration::from_millis(120));
    match child.try_wait() {
        Ok(Some(status)) => Err(format!(
            "Windows update helper exited immediately with {status}"
        )),
        Ok(None) => Ok(helper_path),
        Err(e) => Err(format!("poll Windows update helper: {e}")),
    }
}

pub(super) fn run_update_helper(
    pid: i32,
    version: Option<String>,
    installer: &Path,
    target_exe: &Path,
    restart: bool,
) -> Result<(), String> {
    wait_for_process_exit(pid, Duration::from_secs(90))?;
    run_installer_elevated(installer)?;
    if restart {
        Command::new(target_exe)
            .spawn()
            .map_err(|e| format!("restart Qx after Windows update: {e}"))?;
    }
    let _ = write_helper_status(HelperStatus {
        ok: true,
        version,
        message: "Windows update installed and Qx relaunched.".to_string(),
        target_app: target_exe.display().to_string(),
    });
    if let Some(version_dir) = installer.parent() {
        let _ = fs::remove_file(installer);
        let _ = fs::remove_dir(version_dir);
    }
    Ok(())
}

fn run_installer_elevated(installer: &Path) -> Result<(), String> {
    fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }
    let verb = wide(std::ffi::OsStr::new("runas"));
    let file = wide(installer.as_os_str());
    // Tauri's NSIS template uses /UPDATE to bypass the reinstall/uninstall
    // choice and preserve the existing installation while replacing files.
    let parameters = wide(std::ffi::OsStr::new("/S /UPDATE"));
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = parameters.as_ptr();
    info.nShow = SW_HIDE;

    if unsafe { ShellExecuteExW(&mut info) } == 0 {
        return Err(format!(
            "start elevated Windows installer: {}",
            std::io::Error::last_os_error()
        ));
    }
    if info.hProcess.is_null() {
        return Err("Windows installer did not return a process handle".to_string());
    }
    let wait_result = unsafe { WaitForSingleObject(info.hProcess, INFINITE) };
    if wait_result != WAIT_OBJECT_0 {
        unsafe { CloseHandle(info.hProcess) };
        return Err(format!(
            "wait for Windows installer failed with code {wait_result}"
        ));
    }
    let mut exit_code = 0u32;
    let got_exit_code = unsafe { GetExitCodeProcess(info.hProcess, &mut exit_code) };
    unsafe { CloseHandle(info.hProcess) };
    if got_exit_code == 0 {
        return Err(format!(
            "read Windows installer result: {}",
            std::io::Error::last_os_error()
        ));
    }
    if exit_code != 0 {
        return Err(format!("Windows installer exited with code {exit_code}"));
    }
    Ok(())
}

pub(super) fn process_exists(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
            0,
            pid as u32,
        )
    };
    if handle.is_null() {
        return false;
    }
    let result = unsafe { WaitForSingleObject(handle, 0) };
    unsafe { CloseHandle(handle) };
    result == WAIT_TIMEOUT
}

pub(super) fn install_location() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("resolve current exe: {e}"))?;
    let install_dir = exe
        .parent()
        .ok_or_else(|| "Qx executable has no installation directory".to_string())?;
    if !install_dir.join("uninstall.exe").is_file() {
        return Err("Qx is not running from an installed NSIS package".to_string());
    }
    Ok(exe)
}
