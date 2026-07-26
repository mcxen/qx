//! Windows system executable discovery for GUI-launched Qx processes.
//!
//! Desktop processes can inherit a deliberately thin PATH. Callers that need
//! inbox Windows tools depend on this adapter instead of assuming `C:\Windows`
//! or spawning a bare executable name in each feature module.

use std::ffi::c_void;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::ptr::null_mut;
use std::thread;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::NO_ERROR;
use windows_sys::Win32::System::Registry::{
    RegGetValueW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ,
};
use windows_sys::Win32::System::Threading::{CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW};

pub(crate) fn system_root() -> Option<PathBuf> {
    std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .filter(|root| root.is_absolute())
}

fn system_executable(relative: &Path, fallback: &str) -> PathBuf {
    system_root()
        .map(|root| root.join(relative))
        .filter(|candidate| candidate.is_file())
        .unwrap_or_else(|| PathBuf::from(fallback))
}

pub(crate) fn powershell_binary() -> PathBuf {
    system_executable(
        Path::new(r"System32\WindowsPowerShell\v1.0\powershell.exe"),
        "powershell.exe",
    )
}

pub(crate) fn explorer_binary() -> PathBuf {
    system_executable(Path::new("explorer.exe"), "explorer.exe")
}

pub(crate) fn taskkill_binary() -> PathBuf {
    system_executable(Path::new(r"System32\taskkill.exe"), "taskkill.exe")
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn registry_string(root: HKEY, subkey: &str, value_name: &str) -> Option<String> {
    let subkey = wide(subkey);
    let value_name = wide(value_name);
    let flags = RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ;
    let mut byte_count = 0u32;
    let status = unsafe {
        RegGetValueW(
            root,
            subkey.as_ptr(),
            value_name.as_ptr(),
            flags,
            null_mut(),
            null_mut(),
            &mut byte_count,
        )
    };
    if status != NO_ERROR || byte_count < 2 {
        return None;
    }
    let mut buffer = vec![0u16; byte_count as usize / 2];
    let status = unsafe {
        RegGetValueW(
            root,
            subkey.as_ptr(),
            value_name.as_ptr(),
            flags,
            null_mut(),
            buffer.as_mut_ptr().cast::<c_void>(),
            &mut byte_count,
        )
    };
    if status != NO_ERROR {
        return None;
    }
    let length = buffer
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(buffer.len());
    let value = String::from_utf16_lossy(&buffer[..length])
        .trim()
        .to_string();
    (!value.is_empty()).then_some(value)
}

/// Read the machine and user PATH directly from the Windows environment
/// registry. This mirrors an interactive desktop process without starting a
/// shell merely to ask .NET for the same registry values.
pub(crate) fn desktop_path_env() -> Option<String> {
    let machine = registry_string(
        HKEY_LOCAL_MACHINE,
        r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        "Path",
    );
    let user = registry_string(HKEY_CURRENT_USER, "Environment", "Path");
    let joined = [machine, user]
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(";");
    (!joined.is_empty()).then_some(joined)
}

/// Run an inbox Windows helper off the UI thread with a hard deadline.
///
/// stdout/stderr are drained concurrently so a verbose OCR result cannot fill
/// a pipe and prevent the child from exiting. Timeout kills the whole process
/// tree before returning.
pub(crate) fn output_with_timeout(command: &mut Command, timeout: Duration) -> io::Result<Output> {
    use std::os::windows::process::CommandExt;

    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    let mut child = command.spawn()?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut stream) = stdout {
            stream.read_to_end(&mut bytes)?;
        }
        Ok::<_, io::Error>(bytes)
    });
    let stderr_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut stream) = stderr {
            stream.read_to_end(&mut bytes)?;
        }
        Ok::<_, io::Error>(bytes)
    });

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= timeout {
            let mut taskkill = Command::new(taskkill_binary());
            taskkill
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW);
            let _ = taskkill.status();
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("Windows helper exceeded {} seconds", timeout.as_secs()),
            ));
        }
        thread::sleep(Duration::from_millis(20));
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| io::Error::other("stdout reader panicked"))??;
    let stderr = stderr_reader
        .join()
        .map_err(|_| io::Error::other("stderr reader panicked"))??;
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}
