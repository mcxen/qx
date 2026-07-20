//! Plugin CLI port: argv/bash run, async jobs, and system helpers.
//!
//! - `plugin_cli_run` / `bash` / `which`: fire-and-wait (spawn_blocking)
//! - `plugin_cli_start` / `poll` / `cancel` / `list_jobs`: concurrent jobs with
//!   live stdout/stderr, cancel, and per-plugin concurrency limits

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// Plugin CLI port (argv + full bash; not gated by AI Agent bash toggle)
//
// GUI-launched apps inherit a thin PATH. Plugins therefore resolve programs
// against a *user login-shell PATH* plus known brew/system bins, and child
// processes always receive that enriched PATH unless the plugin overrides it.
// ---------------------------------------------------------------------------

pub(crate) fn default_cli_timeout_ms() -> u64 {
    60_000
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCliRunRequest {
    /// Program path or bare name to resolve on PATH / known locations.
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    /// Extra env vars (merged over process env). Keys cannot be empty.
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, String>>,
    #[serde(default = "default_cli_timeout_ms")]
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCliRunResult {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    /// Resolved absolute (or original) program path used for spawn.
    pub program: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCliWhichRequest {
    pub program: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCliBashRequest {
    /// Full shell script executed with `bash -lc` (login-interactive PATH).
    pub script: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, String>>,
    #[serde(default = "default_cli_timeout_ms")]
    pub timeout_ms: u64,
}

pub(crate) fn validate_cli_program_name(program: &str) -> Result<(), String> {
    let program = program.trim();
    if program.is_empty() {
        return Err("cli program is empty".to_string());
    }
    if program.contains('\0') {
        return Err("cli program must not contain NUL".to_string());
    }
    // Block shell metacharacters for bare names; absolute/relative paths are fine.
    if !program.contains('/') && !program.contains('\\') {
        if program
            .chars()
            .any(|c| "|&;<>$`(){}[]!*?\n\r\t".contains(c))
        {
            return Err("cli program name contains unsafe characters".to_string());
        }
    }
    Ok(())
}

fn path_sep() -> char {
    #[cfg(windows)]
    {
        return ';';
    }
    #[cfg(not(windows))]
    {
        ':'
    }
}

/// Directories that GUI apps almost never inherit but interactive shells do.
fn known_cli_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(target_os = "macos")]
    {
        dirs.extend(
            [
                "/opt/homebrew/bin",
                "/opt/homebrew/sbin",
                "/usr/local/bin",
                "/usr/local/sbin",
                "/usr/bin",
                "/bin",
                "/usr/sbin",
                "/sbin",
            ]
            .map(PathBuf::from),
        );
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(PathBuf::from(&home).join(".local/bin"));
            dirs.push(PathBuf::from(&home).join("bin"));
            // fnm / nvm / cargo common shims
            dirs.push(PathBuf::from(&home).join(".cargo/bin"));
            dirs.push(PathBuf::from(&home).join(".fnm"));
        }
    }
    #[cfg(target_os = "linux")]
    {
        dirs.extend(
            [
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
                "/usr/sbin",
                "/sbin",
                "/snap/bin",
            ]
            .map(PathBuf::from),
        );
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(PathBuf::from(&home).join(".local/bin"));
            dirs.push(PathBuf::from(&home).join(".cargo/bin"));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(system_root) = crate::windows_process::system_root() {
            dirs.push(system_root.join("System32"));
            dirs.push(system_root.join("System32\\WindowsPowerShell\\v1.0"));
            dirs.push(system_root);
        }
        if let Ok(pf) = std::env::var("ProgramFiles") {
            dirs.push(PathBuf::from(&pf).join("Git\\cmd"));
            dirs.push(PathBuf::from(&pf).join("Git\\bin"));
            dirs.push(PathBuf::from(&pf).join("Git\\usr\\bin"));
        }
        if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
            dirs.push(PathBuf::from(&pf86).join("Git\\cmd"));
            dirs.push(PathBuf::from(&pf86).join("Git\\bin"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            dirs.push(PathBuf::from(&local).join("Programs\\Git\\cmd"));
            dirs.push(PathBuf::from(&local).join("Microsoft\\WindowsApps"));
        }
        if let Ok(user) = std::env::var("USERPROFILE") {
            dirs.push(PathBuf::from(&user).join("bin"));
            dirs.push(PathBuf::from(&user).join(".cargo\\bin"));
            dirs.push(PathBuf::from(&user).join("scoop\\shims"));
            dirs.push(PathBuf::from(&user).join("AppData\\Roaming\\npm"));
        }
    }
    dirs
}

/// Read PATH as a login shell would see it (cached). Best-effort; never blocks forever.
fn login_shell_path() -> Option<String> {
    use std::sync::OnceLock;
    static CACHE: OnceLock<Option<String>> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            #[cfg(unix)]
            {
                // Prefer the user shell for rbenv/nvm/fnm hooks; fall back to bash -lc.
                let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
                let mut cmd = std::process::Command::new(&shell);
                // -l: login (loads profile); -c: run and exit. Avoid -i (prompts / job control).
                cmd.args(["-lc", "printf %s \"$PATH\""])
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .stdin(std::process::Stdio::null());
                let Ok(mut child) = cmd.spawn() else {
                    return None;
                };
                let start = std::time::Instant::now();
                loop {
                    match child.try_wait() {
                        Ok(Some(status)) if status.success() => {
                            let output = child.wait_with_output().ok()?;
                            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                            return (!path.is_empty()).then_some(path);
                        }
                        Ok(Some(_)) => return None,
                        Ok(None) if start.elapsed() > Duration::from_secs(3) => {
                            let _ = child.kill();
                            let _ = child.wait();
                            return None;
                        }
                        Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                        Err(_) => return None,
                    }
                }
            }
            #[cfg(windows)]
            {
                // Machine + User PATH from the registry is closer to an interactive shell
                // than the truncated GUI process env. Resolve Windows PowerShell
                // from SystemRoot first because the very PATH being repaired may
                // not yet contain its standard installation directory.
                let mut command =
                    std::process::Command::new(crate::windows_process::powershell_binary());
                command
                    .args([
                        "-NoProfile",
                        "-NonInteractive",
                        "-Command",
                        "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
                    ])
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .stdin(std::process::Stdio::null());
                configure_child_process_group(&mut command);
                let mut child = command
                    .spawn()
                    .ok()?;
                let start = Instant::now();
                let output = loop {
                    match child.try_wait() {
                        Ok(Some(_)) => break child.wait_with_output().ok()?,
                        Ok(None) if start.elapsed() >= Duration::from_secs(3) => {
                            kill_child_tree(&mut child);
                            return None;
                        }
                        Ok(None) => std::thread::sleep(Duration::from_millis(20)),
                        Err(_) => {
                            kill_child_tree(&mut child);
                            return None;
                        }
                    }
                };
                if !output.status.success() {
                    return None;
                }
                let path = String::from_utf8(output.stdout).ok()?.trim().to_string();
                (!path.is_empty()).then_some(path)
            }
            #[cfg(not(any(unix, windows)))]
            {
                None
            }
        })
        .clone()
}

/// Enriched PATH for plugin CLI resolution and child processes.
pub(crate) fn plugin_cli_path_env() -> String {
    use std::collections::HashSet;
    let mut seen = HashSet::new();
    let mut ordered: Vec<String> = Vec::new();
    let push = |value: &str, ordered: &mut Vec<String>, seen: &mut HashSet<String>| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return;
        }
        if seen.insert(trimmed.to_string()) {
            ordered.push(trimmed.to_string());
        }
    };

    for dir in known_cli_bin_dirs() {
        push(&dir.to_string_lossy(), &mut ordered, &mut seen);
    }
    if let Some(login) = login_shell_path() {
        for part in login.split(path_sep()) {
            push(part, &mut ordered, &mut seen);
        }
    }
    if let Ok(process_path) = std::env::var("PATH") {
        for part in std::env::split_paths(&process_path) {
            push(&part.to_string_lossy(), &mut ordered, &mut seen);
        }
    }
    ordered.join(&path_sep().to_string())
}

fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(true)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn candidate_program_names(program: &str) -> Vec<String> {
    #[cfg(windows)]
    {
        let mut names = vec![program.to_string()];
        let lower = program.to_ascii_lowercase();
        if !lower.ends_with(".exe")
            && !lower.ends_with(".cmd")
            && !lower.ends_with(".bat")
            && !lower.ends_with(".com")
        {
            names.push(format!("{program}.exe"));
            names.push(format!("{program}.cmd"));
            names.push(format!("{program}.bat"));
        }
        return names;
    }
    #[cfg(not(windows))]
    {
        vec![program.to_string()]
    }
}

pub(crate) fn resolve_cli_program(program: &str) -> Result<PathBuf, String> {
    validate_cli_program_name(program)?;
    let program = program.trim();
    let candidate = PathBuf::from(program);
    if candidate.is_absolute() || program.contains('/') || program.contains('\\') {
        if is_executable_file(&candidate) {
            return Ok(candidate);
        }
        // Expand ~ for author convenience.
        if let Some(rest) = program
            .strip_prefix("~/")
            .or_else(|| program.strip_prefix("~\\"))
        {
            if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
                let expanded = PathBuf::from(home).join(rest);
                if is_executable_file(&expanded) {
                    return Ok(expanded);
                }
            }
        }
        return Err(format!("cli program not found: {program}"));
    }

    let names = candidate_program_names(program);
    let path_env = plugin_cli_path_env();
    for dir in std::env::split_paths(&path_env) {
        for name in &names {
            let path = dir.join(name);
            if is_executable_file(&path) {
                return Ok(path);
            }
        }
    }

    Err(format!(
        "cli program not found on PATH: {program} (GUI PATH is thin; host uses login-shell PATH + brew bins)"
    ))
}

pub(crate) fn resolve_bash_binary() -> Result<PathBuf, String> {
    #[cfg(unix)]
    {
        for candidate in ["/bin/bash", "/usr/bin/bash", "/opt/homebrew/bin/bash"] {
            let path = PathBuf::from(candidate);
            if is_executable_file(&path) {
                return Ok(path);
            }
        }
        resolve_cli_program("bash")
    }
    #[cfg(windows)]
    {
        // Git for Windows ships a real bash; prefer that over WSL for speed.
        if let Ok(path) = resolve_cli_program("bash") {
            return Ok(path);
        }
        Err(
            "Git Bash was not found. Install Git for Windows with `winget install --id Git.Git -e`, or download it from https://gitforwindows.org/. Then restart Qx so the GUI process receives the updated PATH. Plugins that do not require POSIX syntax should use context.cli.run with argv instead."
                .to_string(),
        )
    }
    #[cfg(not(any(unix, windows)))]
    {
        Err("bash is not supported on this platform".to_string())
    }
}

pub(crate) fn validate_cli_env(
    env: &std::collections::HashMap<String, String>,
) -> Result<(), String> {
    for (key, _) in env {
        if key.trim().is_empty() || key.contains('\0') {
            return Err("cli env key is invalid".to_string());
        }
    }
    Ok(())
}

pub(crate) fn apply_plugin_cli_env(
    cmd: &mut std::process::Command,
    extra: &std::collections::HashMap<String, String>,
) {
    // Always inject the enriched PATH first so nested tools (git hooks, brew, node)
    // resolve like a normal terminal — unless the plugin overrides PATH explicitly.
    if !extra.keys().any(|k| k.eq_ignore_ascii_case("PATH")) {
        cmd.env("PATH", plugin_cli_path_env());
    }
    // Ensure HOME/USERPROFILE exist for tools that expand ~
    if std::env::var_os("HOME").is_none() {
        if let Ok(user) = std::env::var("USERPROFILE") {
            cmd.env("HOME", user);
        }
    }
    for (key, value) in extra {
        cmd.env(key, value);
    }
}

pub(crate) fn run_process_with_timeout(
    mut cmd: std::process::Command,
    timeout_ms: u64,
    program_display: String,
) -> Result<PluginCliRunResult, String> {
    let timeout = Duration::from_millis(timeout_ms);
    configure_child_process_group(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("spawn {program_display}: {e}"))?;
    let stdout_reader = child.stdout.take().and_then(spawn_capped_pipe_reader);
    let stderr_reader = child.stderr.take().and_then(spawn_capped_pipe_reader);
    let start = std::time::Instant::now();

    loop {
        let wait = child.try_wait().map_err(|e| {
            kill_child_tree(&mut child);
            format!("wait cli: {e}")
        })?;
        if let Some(status) = wait {
            let stdout = finish_pipe_reader(stdout_reader);
            let stderr = finish_pipe_reader(stderr_reader);
            return Ok(PluginCliRunResult {
                status: status.code(),
                stdout,
                stderr,
                timed_out: false,
                program: program_display,
            });
        }

        if start.elapsed() >= timeout {
            kill_child_tree(&mut child);
            let stdout = finish_pipe_reader(stdout_reader);
            let stderr = finish_pipe_reader(stderr_reader);
            return Ok(PluginCliRunResult {
                status: None,
                stdout,
                stderr,
                timed_out: true,
                program: program_display,
            });
        }

        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Argv-style process run for plugins (`context.cli.run`).
/// Not gated by Settings → AI Agent bash; requires plugin permission `cli`.
#[tauri::command]
pub async fn plugin_cli_run(req: PluginCliRunRequest) -> Result<PluginCliRunResult, String> {
    let program = resolve_cli_program(&req.program)?;
    let program_display = program.display().to_string();
    let args = req.args;
    let cwd = req
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let env = req.env.unwrap_or_default();
    let timeout_ms = req.timeout_ms.clamp(1_000, 600_000);
    validate_cli_env(&env)?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&program);
        cmd.args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::null());
        if let Some(dir) = cwd.as_deref() {
            cmd.current_dir(dir);
        }
        apply_plugin_cli_env(&mut cmd, &env);
        run_process_with_timeout(cmd, timeout_ms, program_display)
    })
    .await
    .map_err(|e| format!("cli task failed: {e}"))?
}

/// Full bash script for plugins (`context.cli.bash`) — login shell PATH, no AI gate.
#[tauri::command]
pub async fn plugin_cli_bash(req: PluginCliBashRequest) -> Result<PluginCliRunResult, String> {
    let script = req.script;
    if script.trim().is_empty() {
        return Err("cli bash script is empty".to_string());
    }
    if script.contains('\0') {
        return Err("cli bash script must not contain NUL".to_string());
    }
    let bash = resolve_bash_binary()?;
    let program_display = format!("{} -lc", bash.display());
    let cwd = req
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let env = req.env.unwrap_or_default();
    let timeout_ms = req.timeout_ms.clamp(1_000, 600_000);
    validate_cli_env(&env)?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&bash);
        // -l: load profile/PATH like Terminal; -c: run the script string.
        cmd.arg("-lc")
            .arg(script)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::null());
        if let Some(dir) = cwd.as_deref() {
            cmd.current_dir(dir);
        }
        apply_plugin_cli_env(&mut cmd, &env);
        run_process_with_timeout(cmd, timeout_ms, program_display)
    })
    .await
    .map_err(|e| format!("cli bash task failed: {e}"))?
}

/// Resolve a CLI program path without running it.
#[tauri::command]
pub async fn plugin_cli_which(req: PluginCliWhichRequest) -> Result<Option<String>, String> {
    match resolve_cli_program(&req.program) {
        Ok(path) => Ok(Some(path.display().to_string())),
        Err(_) => Ok(None),
    }
}

// ---------------------------------------------------------------------------
// Async / concurrent job registry
// ---------------------------------------------------------------------------

const MAX_JOBS_GLOBAL: usize = 32;
const MAX_JOBS_PER_PLUGIN: usize = 6;
const MAX_OUTPUT_BYTES: usize = 512 * 1024; // per stream; readers still drain after the cap
const JOB_RETENTION_MS: u128 = 10 * 60 * 1000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PluginCliJobState {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    TimedOut,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCliJobSnapshot {
    pub id: String,
    pub plugin_id: String,
    pub kind: String,
    pub state: PluginCliJobState,
    pub program: String,
    pub stdout: String,
    pub stderr: String,
    pub status: Option<i32>,
    pub timed_out: bool,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub error: Option<String>,
    /// True while process is still producing output / running.
    pub running: bool,
}

struct JobInner {
    snapshot: PluginCliJobSnapshot,
    cancel: Arc<AtomicBool>,
    /// Process id for kill (set once spawned).
    pid: Option<u32>,
    /// Platform-specific kill handle kept only while running.
    child: Option<Child>,
}

struct JobRegistry {
    jobs: HashMap<String, Arc<Mutex<JobInner>>>,
}

fn job_registry() -> &'static Mutex<JobRegistry> {
    static REG: OnceLock<Mutex<JobRegistry>> = OnceLock::new();
    REG.get_or_init(|| {
        Mutex::new(JobRegistry {
            jobs: HashMap::new(),
        })
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn next_job_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("cli-job-{}-{}", now_ms(), n)
}

fn gc_jobs_locked(reg: &mut JobRegistry) {
    let cutoff = now_ms() as u128;
    reg.jobs.retain(|_, job| {
        let Ok(guard) = job.lock() else { return true };
        let snap = &guard.snapshot;
        if snap.running {
            return true;
        }
        match snap.finished_at {
            Some(finished) => (cutoff.saturating_sub(finished as u128)) < JOB_RETENTION_MS,
            None => true,
        }
    });
}

fn count_plugin_running(reg: &JobRegistry, plugin_id: &str) -> usize {
    reg.jobs
        .values()
        .filter_map(|j| j.lock().ok())
        .filter(|g| g.snapshot.plugin_id == plugin_id && g.snapshot.running)
        .count()
}

fn append_capped(buf: &mut String, chunk: &str) {
    if buf.len() >= MAX_OUTPUT_BYTES {
        return;
    }
    let remain = MAX_OUTPUT_BYTES - buf.len();
    if chunk.len() <= remain {
        buf.push_str(chunk);
    } else {
        let mut end = remain.min(chunk.len());
        while end > 0 && !chunk.is_char_boundary(end) {
            end -= 1;
        }
        buf.push_str(&chunk[..end]);
        buf.push_str("\n…[output truncated]");
    }
}

fn configure_child_process_group(cmd: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::{CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW};
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }
}

fn kill_child_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;
        let mut taskkill = Command::new(crate::windows_process::taskkill_binary());
        taskkill
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW);
        let _ = taskkill.status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn spawn_capped_pipe_reader(
    mut pipe: impl Read + Send + 'static,
) -> Option<std::thread::JoinHandle<String>> {
    std::thread::Builder::new()
        .name("qx-cli-pipe".into())
        .spawn(move || {
            let mut stored = Vec::with_capacity(MAX_OUTPUT_BYTES.min(64 * 1024));
            let mut scratch = [0u8; 8192];
            let mut truncated = false;
            loop {
                match pipe.read(&mut scratch) {
                    Ok(0) => break,
                    Ok(n) => {
                        let remain = MAX_OUTPUT_BYTES.saturating_sub(stored.len());
                        stored.extend_from_slice(&scratch[..n.min(remain)]);
                        truncated |= n > remain;
                    }
                    Err(_) => break,
                }
            }
            let mut output = String::from_utf8_lossy(&stored).to_string();
            if truncated {
                output.push_str("\n…[output truncated]");
            }
            output
        })
        .ok()
}

fn finish_pipe_reader(reader: Option<std::thread::JoinHandle<String>>) -> String {
    reader
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default()
}

fn spawn_output_reader(
    mut pipe: impl Read + Send + 'static,
    job: Arc<Mutex<JobInner>>,
    is_stdout: bool,
) -> Result<(), String> {
    std::thread::Builder::new()
        .name("qx-cli-job-pipe".into())
        .spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match pipe.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]);
                        if let Ok(mut guard) = job.lock() {
                            if is_stdout {
                                append_capped(&mut guard.snapshot.stdout, &text);
                            } else {
                                append_capped(&mut guard.snapshot.stderr, &text);
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        })
        .map(|_| ())
        .map_err(|error| format!("spawn CLI output reader: {error}"))
}

fn run_job_process(
    mut cmd: Command,
    job: Arc<Mutex<JobInner>>,
    timeout_ms: u64,
    program_display: String,
) {
    {
        let mut guard = job.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.snapshot.state = PluginCliJobState::Running;
        guard.snapshot.program = program_display.clone();
    }

    let cancel = {
        let guard = job.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.cancel.clone()
    };

    configure_child_process_group(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            if let Ok(mut guard) = job.lock() {
                guard.snapshot.state = PluginCliJobState::Failed;
                guard.snapshot.running = false;
                guard.snapshot.finished_at = Some(now_ms());
                guard.snapshot.error = Some(format!("spawn {program_display}: {e}"));
            }
            return;
        }
    };

    let reader_error = child
        .stdout
        .take()
        .map(|out| spawn_output_reader(out, job.clone(), true))
        .or_else(|| Some(Ok(())))
        .and_then(Result::err)
        .or_else(|| {
            child
                .stderr
                .take()
                .map(|err| spawn_output_reader(err, job.clone(), false))
                .or_else(|| Some(Ok(())))
                .and_then(Result::err)
        });
    if let Some(error) = reader_error {
        kill_child_tree(&mut child);
        if let Ok(mut guard) = job.lock() {
            guard.snapshot.state = PluginCliJobState::Failed;
            guard.snapshot.running = false;
            guard.snapshot.finished_at = Some(now_ms());
            guard.snapshot.error = Some(error);
        }
        return;
    }

    {
        let mut guard = job.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.pid = Some(child.id());
        // Keep child in job for cancel path; we'll wait on a moved local.
    }

    // Move child into local; cancel path uses kill via re-open is hard — store in job.
    {
        let mut guard = job.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.child = Some(child);
    }

    let timeout = Duration::from_millis(timeout_ms);
    let start = Instant::now();

    loop {
        let cancelled = cancel.load(Ordering::SeqCst);
        let timed_out = start.elapsed() >= timeout;

        if cancelled || timed_out {
            let child = job.lock().ok().and_then(|mut guard| guard.child.take());
            if let Some(mut child) = child {
                kill_child_tree(&mut child);
            }
            if let Ok(mut guard) = job.lock() {
                guard.snapshot.running = false;
                guard.snapshot.finished_at = Some(now_ms());
                if cancelled {
                    guard.snapshot.state = PluginCliJobState::Cancelled;
                    guard.snapshot.timed_out = false;
                } else {
                    guard.snapshot.state = PluginCliJobState::TimedOut;
                    guard.snapshot.timed_out = true;
                    guard.snapshot.status = None;
                }
            }
            return;
        }

        // try_wait needs &mut Child
        let wait_result = {
            let mut guard = job.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            match guard.child.as_mut() {
                Some(child) => child.try_wait().map_err(|e| e.to_string()),
                None => Ok(None),
            }
        };

        match wait_result {
            Ok(Some(status)) => {
                // Drain: child finished; drop child
                let child = job.lock().ok().and_then(|mut guard| guard.child.take());
                if let Some(mut child) = child {
                    let _ = child.wait();
                }
                if let Ok(mut guard) = job.lock() {
                    // Give reader threads a brief moment; output mostly drained by now
                    guard.snapshot.status = status.code();
                    guard.snapshot.running = false;
                    guard.snapshot.finished_at = Some(now_ms());
                    if status.success() {
                        guard.snapshot.state = PluginCliJobState::Succeeded;
                    } else {
                        guard.snapshot.state = PluginCliJobState::Failed;
                    }
                }
                // Small sleep so pipe threads flush last chunks
                std::thread::sleep(Duration::from_millis(30));
                return;
            }
            Ok(None) => {
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(e) => {
                let child = job.lock().ok().and_then(|mut guard| guard.child.take());
                if let Some(mut child) = child {
                    kill_child_tree(&mut child);
                }
                if let Ok(mut guard) = job.lock() {
                    guard.snapshot.running = false;
                    guard.snapshot.finished_at = Some(now_ms());
                    guard.snapshot.state = PluginCliJobState::Failed;
                    guard.snapshot.error = Some(format!("wait cli: {e}"));
                }
                return;
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCliStartRequest {
    /// `"run"` (argv) or `"bash"` (login shell script).
    pub kind: String,
    #[serde(default)]
    pub program: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub script: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    #[serde(default = "default_cli_timeout_ms")]
    pub timeout_ms: u64,
}

fn snapshot_of(job: &Arc<Mutex<JobInner>>) -> Result<PluginCliJobSnapshot, String> {
    job.lock()
        .map(|g| g.snapshot.clone())
        .map_err(|_| "cli job lock poisoned".to_string())
}

/// Start a CLI job and return immediately. Output streams into the job snapshot.
#[tauri::command]
pub async fn plugin_cli_start(
    plugin_id: String,
    req: PluginCliStartRequest,
) -> Result<PluginCliJobSnapshot, String> {
    if plugin_id.trim().is_empty() {
        return Err("plugin_id is required".to_string());
    }
    let kind = req.kind.trim().to_ascii_lowercase();
    if kind != "run" && kind != "bash" {
        return Err("cli start kind must be \"run\" or \"bash\"".to_string());
    }
    let env = req.env.unwrap_or_default();
    validate_cli_env(&env)?;
    let timeout_ms = req.timeout_ms.clamp(1_000, 600_000);
    let cwd = req
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let (program_display, mut cmd) = if kind == "run" {
        let program_raw = req
            .program
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "cli start run requires program".to_string())?;
        let program = resolve_cli_program(program_raw)?;
        let display = program.display().to_string();
        let mut cmd = Command::new(&program);
        cmd.args(&req.args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        (display, cmd)
    } else {
        let script = req
            .script
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "cli start bash requires script".to_string())?
            .to_string();
        if script.contains('\0') {
            return Err("cli bash script must not contain NUL".to_string());
        }
        let bash = resolve_bash_binary()?;
        let display = format!("{} -lc", bash.display());
        let mut cmd = Command::new(&bash);
        cmd.arg("-lc")
            .arg(script)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null());
        (display, cmd)
    };

    if let Some(dir) = cwd.as_deref() {
        cmd.current_dir(dir);
    }
    apply_plugin_cli_env(&mut cmd, &env);

    let job_id = next_job_id();
    let cancel = Arc::new(AtomicBool::new(false));
    let inner = Arc::new(Mutex::new(JobInner {
        snapshot: PluginCliJobSnapshot {
            id: job_id.clone(),
            plugin_id: plugin_id.clone(),
            kind: kind.clone(),
            state: PluginCliJobState::Queued,
            program: program_display.clone(),
            stdout: String::new(),
            stderr: String::new(),
            status: None,
            timed_out: false,
            started_at: now_ms(),
            finished_at: None,
            error: None,
            running: true,
        },
        cancel: cancel.clone(),
        pid: None,
        child: None,
    }));

    {
        let mut reg = job_registry()
            .lock()
            .map_err(|_| "cli job registry lock poisoned".to_string())?;
        gc_jobs_locked(&mut reg);
        if reg.jobs.len() >= MAX_JOBS_GLOBAL {
            return Err(format!(
                "too many CLI jobs (max {MAX_JOBS_GLOBAL}); cancel or wait for others"
            ));
        }
        if count_plugin_running(&reg, &plugin_id) >= MAX_JOBS_PER_PLUGIN {
            return Err(format!(
                "plugin has too many concurrent CLI jobs (max {MAX_JOBS_PER_PLUGIN})"
            ));
        }
        reg.jobs.insert(job_id.clone(), inner.clone());
    }

    let job_for_thread = inner.clone();
    if let Err(error) = std::thread::Builder::new()
        .name(format!("qx-cli-{job_id}"))
        .spawn(move || {
            run_job_process(cmd, job_for_thread, timeout_ms, program_display);
        })
    {
        if let Ok(mut registry) = job_registry().lock() {
            registry.jobs.remove(&job_id);
        }
        return Err(format!("spawn cli job thread: {error}"));
    }

    snapshot_of(&inner)
}

fn job_owned_by(job: &Arc<Mutex<JobInner>>, plugin_id: &str) -> Result<(), String> {
    let guard = job
        .lock()
        .map_err(|_| "cli job lock poisoned".to_string())?;
    if guard.snapshot.plugin_id != plugin_id {
        return Err("cli job does not belong to this plugin".to_string());
    }
    Ok(())
}

#[tauri::command]
pub async fn plugin_cli_poll(
    plugin_id: String,
    job_id: String,
) -> Result<PluginCliJobSnapshot, String> {
    let reg = job_registry()
        .lock()
        .map_err(|_| "cli job registry lock poisoned".to_string())?;
    let job = reg
        .jobs
        .get(&job_id)
        .ok_or_else(|| format!("cli job not found: {job_id}"))?
        .clone();
    drop(reg);
    job_owned_by(&job, plugin_id.trim())?;
    snapshot_of(&job)
}

#[tauri::command]
pub async fn plugin_cli_cancel(
    plugin_id: String,
    job_id: String,
) -> Result<PluginCliJobSnapshot, String> {
    let reg = job_registry()
        .lock()
        .map_err(|_| "cli job registry lock poisoned".to_string())?;
    let job = reg
        .jobs
        .get(&job_id)
        .ok_or_else(|| format!("cli job not found: {job_id}"))?
        .clone();
    drop(reg);
    job_owned_by(&job, plugin_id.trim())?;

    let child = {
        let mut guard = job
            .lock()
            .map_err(|_| "cli job lock poisoned".to_string())?;
        guard.cancel.store(true, Ordering::SeqCst);
        guard.child.take()
    };
    if let Some(mut child) = child {
        kill_child_tree(&mut child);
        if let Ok(mut guard) = job.lock() {
            guard.snapshot.running = false;
            guard.snapshot.state = PluginCliJobState::Cancelled;
            guard.snapshot.finished_at = Some(now_ms());
        }
    }
    snapshot_of(&job)
}

#[tauri::command]
pub async fn plugin_cli_list_jobs(plugin_id: String) -> Result<Vec<PluginCliJobSnapshot>, String> {
    let mut reg = job_registry()
        .lock()
        .map_err(|_| "cli job registry lock poisoned".to_string())?;
    gc_jobs_locked(&mut reg);
    let mut out: Vec<PluginCliJobSnapshot> = reg
        .jobs
        .values()
        .filter_map(|j| j.lock().ok())
        .filter(|g| g.snapshot.plugin_id == plugin_id)
        .map(|g| g.snapshot.clone())
        .collect();
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::{append_capped, run_process_with_timeout, MAX_OUTPUT_BYTES};

    #[test]
    fn capped_output_never_slices_inside_utf8() {
        let mut output = "a".repeat(MAX_OUTPUT_BYTES - 1);
        append_capped(&mut output, "好");
        assert!(output.ends_with("…[output truncated]"));
        assert!(output.is_char_boundary(output.len()));
    }

    #[test]
    fn capped_output_stops_growing_after_limit() {
        let mut output = "a".repeat(MAX_OUTPUT_BYTES);
        append_capped(&mut output, "ignored");
        assert_eq!(output.len(), MAX_OUTPUT_BYTES);
    }

    #[cfg(unix)]
    #[test]
    fn synchronous_cli_drains_large_output_while_process_runs() {
        let mut command = std::process::Command::new("/bin/sh");
        command
            .args(["-c", "dd if=/dev/zero bs=1048576 count=2 2>/dev/null"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .stdin(std::process::Stdio::null());
        let result = run_process_with_timeout(command, 5_000, "/bin/sh".to_string())
            .expect("large-output command should finish");
        assert_eq!(result.status, Some(0));
        assert!(!result.timed_out);
        assert!(result.stdout.ends_with("…[output truncated]"));
    }
}
