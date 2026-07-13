use std::path::PathBuf;

pub(crate) fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(std::env::temp_dir)
}

/// Persistent Qx databases and application data. Keep the existing macOS
/// location stable; use the native local-app-data root on Windows.
pub(crate) fn data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        return home_dir()
            .join("Library")
            .join("Application Support")
            .join("qx");
    }
    #[cfg(target_os = "windows")]
    {
        return dirs::data_local_dir().unwrap_or_else(home_dir).join("Qx");
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        dirs::data_local_dir().unwrap_or_else(home_dir).join("qx")
    }
}

/// User-editable settings, plugins and portable Qx state.
pub(crate) fn state_dir() -> PathBuf {
    home_dir().join(".qx")
}

pub(crate) fn cache_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        return state_dir().join("cache");
    }
    #[cfg(not(target_os = "macos"))]
    {
        dirs::cache_dir().unwrap_or_else(home_dir).join("Qx")
    }
}

pub(crate) fn pictures_dir() -> PathBuf {
    dirs::picture_dir().unwrap_or_else(|| home_dir().join("Pictures"))
}
