use super::AppEntry;
use std::collections::hash_map::DefaultHasher;
use std::collections::BTreeMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter};

type CandidateSnapshot = BTreeMap<PathBuf, u64>;

static LAST_CANDIDATES: Mutex<Option<CandidateSnapshot>> = Mutex::new(None);
static REFRESH_RUNNING: AtomicBool = AtomicBool::new(false);

struct RefreshGuard;

impl Drop for RefreshGuard {
    fn drop(&mut self) {
        REFRESH_RUNNING.store(false, Ordering::Release);
    }
}

fn hash_metadata(path: &Path, hasher: &mut DefaultHasher) {
    path.hash(hasher);
    let Ok(metadata) = fs::symlink_metadata(path) else {
        false.hash(hasher);
        return;
    };
    true.hash(hasher);
    metadata.len().hash(hasher);
    if let Ok(modified) = metadata.modified().and_then(|value| {
        value
            .duration_since(UNIX_EPOCH)
            .map_err(std::io::Error::other)
    }) {
        modified.as_secs().hash(hasher);
        modified.subsec_nanos().hash(hasher);
    }
}

fn candidate_signature(path: &Path) -> u64 {
    let mut hasher = DefaultHasher::new();
    hash_metadata(path, &mut hasher);
    #[cfg(target_os = "macos")]
    hash_metadata(&path.join("Contents").join("Info.plist"), &mut hasher);
    hasher.finish()
}

#[cfg(target_os = "macos")]
fn app_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push(PathBuf::from(home).join("Applications"));
    }
    roots
}

#[cfg(target_os = "windows")]
fn app_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(app_data) = std::env::var_os("APPDATA") {
        roots.push(
            PathBuf::from(app_data)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    if let Some(program_data) = std::env::var_os("PROGRAMDATA") {
        roots.push(
            PathBuf::from(program_data)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    roots
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn app_roots() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn collect_candidates(root: &Path, candidates: &mut CandidateSnapshot) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|extension| extension == "app") {
            candidates.insert(path.clone(), candidate_signature(&path));
        }
    }
}

#[cfg(target_os = "windows")]
fn collect_candidates(root: &Path, candidates: &mut CandidateSnapshot) {
    let mut stack = vec![root.to_path_buf()];
    while let Some(current) = stack.pop() {
        let Ok(entries) = fs::read_dir(current) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
            {
                candidates.insert(path.clone(), candidate_signature(&path));
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn collect_candidates(_root: &Path, _candidates: &mut CandidateSnapshot) {}

pub(super) fn candidate_snapshot() -> CandidateSnapshot {
    let mut candidates = CandidateSnapshot::new();
    for root in app_roots() {
        collect_candidates(&root, &mut candidates);
    }
    candidates
}

fn changed_paths(previous: &CandidateSnapshot, current: &CandidateSnapshot) -> Vec<PathBuf> {
    current
        .iter()
        .filter_map(|(path, signature)| {
            (previous.get(path) != Some(signature)).then_some(path.clone())
        })
        .collect()
}

fn replace_changed_entries(
    previous_entries: &[AppEntry],
    previous_candidates: &CandidateSnapshot,
    current_candidates: &CandidateSnapshot,
) -> Vec<AppEntry> {
    let changed = changed_paths(previous_candidates, current_candidates);
    let affected_previous_roots = previous_candidates
        .iter()
        .filter_map(|(path, signature)| {
            (current_candidates.get(path) != Some(signature)).then_some(path)
        })
        .collect::<Vec<_>>();
    let mut entries = previous_entries
        .iter()
        .filter(|entry| {
            let entry_path = Path::new(&entry.path);
            !affected_previous_roots
                .iter()
                .any(|root| entry_path == root.as_path() || entry_path.starts_with(root))
        })
        .cloned()
        .collect::<Vec<_>>();

    let refreshed = changed
        .iter()
        .filter_map(|path| super::scan_app_candidate(path))
        .collect::<Vec<_>>();
    entries.extend(super::preserve_icons_from_previous(
        refreshed,
        previous_entries,
    ));
    super::sort_and_dedupe_apps(&mut entries);
    entries
}

fn run_refresh(app: AppHandle, force: bool) {
    let _guard = RefreshGuard;
    let current_candidates = candidate_snapshot();
    let previous_candidates = LAST_CANDIDATES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();

    if !force && previous_candidates.as_ref() == Some(&current_candidates) {
        return;
    }

    let previous_entries = super::app_cache_lock()
        .map(|cache| cache.clone())
        .unwrap_or_default();
    let fresh = if force || previous_candidates.is_none() || previous_entries.is_empty() {
        super::preserve_icons_from_previous(
            super::scan_app_candidates(current_candidates.keys()),
            &previous_entries,
        )
    } else {
        replace_changed_entries(
            &previous_entries,
            previous_candidates.as_ref().expect("checked above"),
            &current_candidates,
        )
    };

    super::sync_db(&fresh);
    if let Some(mut cache) = super::app_cache_lock() {
        *cache = fresh;
    }
    *LAST_CANDIDATES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(current_candidates);
    let _ = app.emit("apps:updated", ());

    // Keep icon work after catalogue publication. Search results become visible
    // immediately; missing icon conversion remains a lower-priority follow-up.
    super::fill_missing_icons(&app);
}

fn schedule(app: AppHandle, force: bool) -> bool {
    if REFRESH_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return false;
    }

    let scheduled = crate::runtime::pool::try_spawn(move || run_refresh(app, force));
    if !scheduled {
        REFRESH_RUNNING.store(false, Ordering::Release);
    }
    scheduled
}

pub(super) fn schedule_full(app: AppHandle) -> bool {
    schedule(app, true)
}

pub(super) fn schedule_if_changed(app: AppHandle) -> bool {
    schedule(app, false)
}

#[cfg(test)]
mod tests {
    use super::{changed_paths, CandidateSnapshot};
    use std::path::PathBuf;

    #[test]
    fn candidate_diff_detects_add_and_replace_without_rescanning_unchanged_apps() {
        let previous = CandidateSnapshot::from([
            (PathBuf::from("/Applications/Keep.app"), 1),
            (PathBuf::from("/Applications/Replace.app"), 2),
        ]);
        let current = CandidateSnapshot::from([
            (PathBuf::from("/Applications/Keep.app"), 1),
            (PathBuf::from("/Applications/Replace.app"), 3),
            (PathBuf::from("/Applications/New.app"), 4),
        ]);

        assert_eq!(
            changed_paths(&previous, &current),
            vec![
                PathBuf::from("/Applications/New.app"),
                PathBuf::from("/Applications/Replace.app"),
            ]
        );
    }
}
