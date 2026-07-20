//! Windows system executable discovery for GUI-launched Qx processes.
//!
//! Desktop processes can inherit a deliberately thin PATH. Callers that need
//! inbox Windows tools depend on this adapter instead of assuming `C:\Windows`
//! or spawning a bare executable name in each feature module.

use std::path::{Path, PathBuf};

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
