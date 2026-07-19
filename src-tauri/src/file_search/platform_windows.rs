use super::*;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::os::windows::process::CommandExt;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

const EVERYTHING_INSTANCE: &str = "Qx";
const EVERYTHING_CONFIG: &str = "Everything-Qx.ini";
const EVERYTHING_IPC_TIMEOUT_MS: &str = "1500";
const CACHE_TTL: Duration = Duration::from_secs(20);
static EVERYTHING_READY: AtomicBool = AtomicBool::new(false);
static EVERYTHING_FAILURE_LOGGED: AtomicBool = AtomicBool::new(false);
static QUERY_CACHE: OnceLock<Mutex<HashMap<String, (Instant, Vec<AppEntry>)>>> = OnceLock::new();

const EVERYTHING_BACKGROUND_CONFIG: &str = r#"[Everything]
run_in_background=1
show_tray_icon=0
check_for_updates_on_startup=0
run_as_admin=0
allow_multiple_windows=0
minimized=1
"#;

#[derive(Debug)]
enum EverythingQueryError {
    CliMissing,
    Launch(String),
    Exit { code: Option<i32>, stderr: String },
}

impl EverythingQueryError {
    fn message(&self) -> String {
        match self {
            Self::CliMissing => "bundled es.exe is missing".to_string(),
            Self::Launch(error) => format!("could not launch bundled es.exe: {error}"),
            Self::Exit { code, stderr } => {
                let detail = stderr.trim();
                if detail.is_empty() {
                    format!("es.exe exited with status {}", code.unwrap_or(-1))
                } else {
                    format!("es.exe exited with status {}: {detail}", code.unwrap_or(-1))
                }
            }
        }
    }
}

fn background_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    // Qx is a GUI helper. Console-based sidecars such as es.exe must never
    // surface a terminal window while the user types a search query.
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn everything_config_path() -> PathBuf {
    crate::paths::data_dir()
        .join("search")
        .join(EVERYTHING_CONFIG)
}

fn write_everything_background_config() -> Result<PathBuf, String> {
    let path = everything_config_path();
    let parent = path
        .parent()
        .ok_or_else(|| "Everything config path has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("create Everything config directory: {error}"))?;
    std::fs::write(&path, EVERYTHING_BACKGROUND_CONFIG)
        .map_err(|error| format!("write Everything background config: {error}"))?;
    Ok(path)
}

fn log_everything_failure_once(message: impl Into<String>) {
    if EVERYTHING_FAILURE_LOGGED.swap(true, Ordering::AcqRel) {
        return;
    }
    crate::diagnostics::log(
        crate::diagnostics::LogLevel::Warn,
        "file_search.everything",
        message,
        serde_json::json!({ "instance": EVERYTHING_INSTANCE }),
    );
}

/// Filename-only Everything strategies (`nopath:`). No full-path / content.
fn everything_queries(query: &str) -> Vec<String> {
    let lower = query.to_ascii_lowercase();
    let has_type_filter = [
        "file:",
        "files:",
        "folder:",
        "folders:",
        "dir:",
        "directory:",
        "type:",
        "ext:",
        "path:",
        "nopath:",
        "parent:",
        "infolder:",
        "size:",
        "dm:",
        "dc:",
        "content:",
        "regex:",
        "attrib:",
        "attributes:",
        "ww:",
        "wfn:",
        "startwith:",
        "endwith:",
        "wildcards:",
        "case:",
    ]
    .iter()
    .any(|prefix| lower.contains(prefix));
    if has_type_filter {
        return vec![query.to_string()];
    }

    let quoted = query.replace('"', "");
    // nopath: restricts match to the leaf name only.
    let mut queries = vec![
        format!(r#"nopath:wfn:"{quoted}""#),
        format!(r#"nopath:startwith:{quoted}"#),
        format!(r#"nopath:"{quoted}""#),
    ];
    let tokens = super::search_tokens(&quoted);
    if tokens.len() > 1 {
        queries.push(format!(
            "nopath:{}",
            tokens
                .iter()
                .map(|token| format!("*{token}*"))
                .collect::<Vec<_>>()
                .join(" ")
        ));
    }
    if let Some(fuzzy) = super::fuzzy_wildcard(&quoted) {
        queries.push(format!("nopath:wildcards:{fuzzy}"));
    }
    queries
}

pub fn init_platform() {
    QUERY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    std::thread::Builder::new()
        .name("qx-everything-cache".to_string())
        .spawn(|| {
            let Some(everything) = find_everything_engine() else {
                log_everything_failure_once("bundled everything.exe is missing");
                return;
            };
            let config = match write_everything_background_config() {
                Ok(path) => path,
                Err(error) => {
                    log_everything_failure_once(error);
                    return;
                }
            };
            let mut command = background_command(&everything);
            command
                .args(["-instance", EVERYTHING_INSTANCE, "-config"])
                .arg(&config)
                .arg("-startup")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            if let Err(error) = command.spawn() {
                log_everything_failure_once(format!(
                    "could not start the bundled Everything background instance: {error}"
                ));
                return;
            }

            // Everything builds and persists its own filesystem database in
            // the background. Probe IPC without holding up Tauri setup.
            let mut last_error = None;
            for _ in 0..60 {
                match query_everything_raw("qx-ready-probe", 1) {
                    Ok(_) => {
                        EVERYTHING_READY.store(true, Ordering::Release);
                        EVERYTHING_FAILURE_LOGGED.store(false, Ordering::Release);
                        crate::diagnostics::log(
                            crate::diagnostics::LogLevel::Info,
                            "file_search.everything",
                            "Everything background instance is ready",
                            serde_json::json!({
                                "instance": EVERYTHING_INSTANCE,
                                "engine": everything.to_string_lossy(),
                                "config": config.to_string_lossy(),
                            }),
                        );
                        return;
                    }
                    Err(error) => last_error = Some(error),
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            let detail = last_error
                .map(|error| error.message())
                .unwrap_or_else(|| "unknown IPC error".to_string());
            log_everything_failure_once(format!(
                "Everything background instance did not become ready: {detail}"
            ));
        })
        .ok();
}

pub fn search_platform(
    query: &str,
    limit: usize,
    pass: u32,
    categories: &[FileSearchCategory],
    category_id: Option<&str>,
    cancellation: FileSearchCancellation,
) -> Vec<AppEntry> {
    if cancellation.is_cancelled() {
        return Vec::new();
    }
    let cache_key = format!(
        "{pass}\0{limit}\0{}\0{}",
        category_id.unwrap_or("*"),
        query.to_lowercase(),
    );
    if EVERYTHING_READY.load(Ordering::Acquire) {
        if let Some(cache) = QUERY_CACHE.get() {
            let guard = cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some((created, results)) = guard.get(&cache_key) {
                if created.elapsed() <= CACHE_TTL {
                    return results.clone();
                }
            }
        }
    }

    // A query can also make progress while the initial readiness probe is
    // running. ES returns immediately when IPC is unavailable.
    let results =
        search_everything_layered(query, limit, pass, categories, category_id, cancellation);
    if cancellation.is_cancelled() {
        return Vec::new();
    }
    if !results.is_empty() {
        EVERYTHING_READY.store(true, Ordering::Release);
    }
    if EVERYTHING_READY.load(Ordering::Acquire) {
        if let Some(cache) = QUERY_CACHE.get() {
            let mut guard = cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            guard.retain(|_, (created, _)| created.elapsed() <= CACHE_TTL);
            guard.insert(cache_key, (Instant::now(), results.clone()));
        }
    }
    results
}

fn search_everything_layered(
    query: &str,
    limit: usize,
    pass: u32,
    categories: &[FileSearchCategory],
    category_id: Option<&str>,
    cancellation: FileSearchCancellation,
) -> Vec<AppEntry> {
    let strategies = everything_queries(query);
    // Progressive passes: first strategies first, later passes chase broader recall.
    // Progressive name-only strategies (all already nopath:).
    let selected: Vec<(usize, String)> = match pass {
        0 => strategies.into_iter().enumerate().take(1).collect(),
        1 => strategies.into_iter().enumerate().skip(1).take(1).collect(),
        _ => strategies.into_iter().enumerate().skip(2).collect(),
    };
    if selected.is_empty() {
        return Vec::new();
    }

    let per_strategy = limit.saturating_mul(8).max(40);
    // path -> (strategy_rank)
    let mut candidates: HashMap<String, usize> = HashMap::new();
    let mut any_success = false;

    for (strategy_rank, strategy_query) in selected {
        if cancellation.is_cancelled() {
            return Vec::new();
        }
        let paths = match query_everything_raw(&strategy_query, per_strategy) {
            Ok(paths) => paths,
            Err(error) => {
                log_everything_failure_once(format!(
                    "Everything query is unavailable: {}",
                    error.message()
                ));
                continue;
            }
        };
        any_success = true;
        for path in paths {
            candidates
                .entry(path)
                .and_modify(|current| *current = (*current).min(strategy_rank))
                .or_insert(strategy_rank);
        }
    }

    if !any_success {
        return Vec::new();
    }
    EVERYTHING_READY.store(true, Ordering::Release);
    EVERYTHING_FAILURE_LOGGED.store(false, Ordering::Release);
    if cancellation.is_cancelled() {
        return Vec::new();
    }

    let ranked = candidates
        .into_iter()
        .filter(|(path, _)| super::name_matches_query(Path::new(path), query))
        .collect::<Vec<_>>();
    let entries = ranked
        .into_iter()
        .map(|(path, _)| super::entry_from_path(&path))
        .collect();
    super::limit_ranked_entries_for_category(entries, query, limit, categories, category_id)
}

fn query_everything_raw(query: &str, limit: usize) -> Result<Vec<String>, EverythingQueryError> {
    let es = find_everything_cli().ok_or(EverythingQueryError::CliMissing)?;
    let output = background_command(es)
        .args([
            "-instance",
            EVERYTHING_INSTANCE,
            "-timeout",
            EVERYTHING_IPC_TIMEOUT_MS,
            "-n",
            &limit.to_string(),
            "-utf8",
            query,
        ])
        .output()
        .map_err(|error| EverythingQueryError::Launch(error.to_string()))?;
    if !output.status.success() {
        return Err(EverythingQueryError::Exit {
            code: output.status.code(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn find_everything_cli() -> Option<PathBuf> {
    // Qx owns a bundled, named Everything instance. Falling back to a user's
    // installation would couple Qx lifecycle and upgrades to unrelated files.
    resource_bin("es.exe")
}

fn find_everything_engine() -> Option<PathBuf> {
    resource_bin("everything.exe")
}

#[cfg(test)]
mod tests {
    use super::{everything_queries, EVERYTHING_BACKGROUND_CONFIG};
    use crate::file_search::{is_hidden_path, relevance_rank};
    use std::path::Path;

    #[test]
    fn everything_uses_multiple_recall_strategies_for_plain_queries() {
        let queries = everything_queries("project notes");
        assert!(queries.len() >= 3);
        assert!(queries.iter().any(|q| q.contains("nopath:")));
        assert_eq!(
            everything_queries("ext:pdf report"),
            vec!["ext:pdf report".to_string()]
        );
    }

    #[test]
    fn everything_private_instance_is_configured_as_a_background_helper() {
        assert!(EVERYTHING_BACKGROUND_CONFIG.contains("run_in_background=1"));
        assert!(EVERYTHING_BACKGROUND_CONFIG.contains("show_tray_icon=0"));
        assert!(EVERYTHING_BACKGROUND_CONFIG.contains("run_as_admin=0"));
        assert!(EVERYTHING_BACKGROUND_CONFIG.contains("check_for_updates_on_startup=0"));
    }

    #[test]
    fn hidden_paths_are_detected() {
        assert!(is_hidden_path(Path::new(r"C:\Users\me\.config\app.json")));
        assert!(is_hidden_path(Path::new(
            r"C:\Users\me\project\node_modules\pkg\index.js"
        )));
        assert!(!is_hidden_path(Path::new(
            r"C:\Users\me\Documents\report.pdf"
        )));
    }

    #[test]
    fn exact_file_names_rank_before_fuzzy_paths() {
        assert!(
            relevance_rank(Path::new(r"C:\tmp\report.pdf"), "report.pdf")
                < relevance_rank(Path::new(r"C:\tmp\report-backup.pdf"), "report.pdf")
        );
    }
}
