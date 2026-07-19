use super::*;

pub(super) fn update_cache_dir() -> PathBuf {
    let dir = crate::paths::cache_dir().join("updates");
    let _ = fs::create_dir_all(&dir);
    dir
}

/// Remove leftover update artifacts from the platform Qx cache directory.
///
/// Keeps `last-update-status.json`. When `keep_version` is set, also keeps that
/// version directory (useful while downloading or diagnosing a failed install).
pub(super) fn prune_update_cache(keep_version: Option<&str>) {
    let root = update_cache_dir();
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == STATUS_FILE {
            continue;
        }
        if let Some(keep) = keep_version {
            if name == keep {
                continue;
            }
        }
        let path = entry.path();
        if path.is_dir() {
            let _ = fs::remove_dir_all(&path);
        } else {
            let _ = fs::remove_file(&path);
        }
    }
}

pub(super) fn current_binary_name() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| format!("resolve current exe: {e}"))?
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
        .ok_or_else(|| "current executable has no valid filename".to_string())
}

pub(super) fn compare_versions(left: &str, right: &str) -> i32 {
    let a = version_parts(left);
    let b = version_parts(right);
    let len = a.len().max(b.len());
    for index in 0..len {
        let diff =
            a.get(index).copied().unwrap_or(0) as i32 - b.get(index).copied().unwrap_or(0) as i32;
        if diff != 0 {
            return diff;
        }
    }
    0
}

fn version_parts(version: &str) -> Vec<u32> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .map(|part| part.parse::<u32>().unwrap_or(0))
        .collect()
}
