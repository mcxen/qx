use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiChatRequest {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub messages: Vec<crate::g4f::ChatMessage>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub system: Option<String>,
    #[serde(default)]
    pub images: Vec<String>,
    #[serde(default)]
    pub image_detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiBashRequest {
    pub script: String,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default = "default_ai_bash_timeout_ms")]
    pub timeout_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiBashResult {
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiGrepRequest {
    pub query: String,
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub max_results: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiGrepResult {
    pub path: String,
    pub line: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiMemoryEntry {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginAiMemoryInput {
    pub text: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_ai_bash_timeout_ms() -> u64 {
    30_000
}

// ---------------------------------------------------------------------------
// Plugin CLI port (argv-style, not gated by AI Agent bash toggle)
// ---------------------------------------------------------------------------

fn default_cli_timeout_ms() -> u64 {
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

fn validate_cli_program_name(program: &str) -> Result<(), String> {
    let program = program.trim();
    if program.is_empty() {
        return Err("cli program is empty".to_string());
    }
    if program.contains('\0') {
        return Err("cli program must not contain NUL".to_string());
    }
    // Block shell metacharacters for bare names; absolute paths are fine.
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

fn resolve_cli_program(program: &str) -> Result<PathBuf, String> {
    validate_cli_program_name(program)?;
    let program = program.trim();
    let candidate = PathBuf::from(program);
    if candidate.is_absolute() || program.contains('/') || program.contains('\\') {
        if candidate.is_file() {
            return Ok(candidate);
        }
        return Err(format!("cli program not found: {program}"));
    }

    // Known macOS Homebrew locations first (PATH inside GUI apps is often incomplete).
    #[cfg(target_os = "macos")]
    {
        for prefix in ["/opt/homebrew/bin", "/usr/local/bin"] {
            let path = PathBuf::from(prefix).join(program);
            if path.is_file() {
                return Ok(path);
            }
        }
    }

    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let path = dir.join(program);
            if path.is_file() {
                return Ok(path);
            }
        }
    }

    // Last resort: common system bins.
    for prefix in ["/usr/bin", "/bin", "/usr/sbin", "/sbin"] {
        let path = PathBuf::from(prefix).join(program);
        if path.is_file() {
            return Ok(path);
        }
    }

    Err(format!("cli program not found on PATH: {program}"))
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

    for (key, _) in &env {
        if key.trim().is_empty() || key.contains('\0') {
            return Err("cli env key is invalid".to_string());
        }
    }

    tauri::async_runtime::spawn_blocking(move || {
        let timeout = Duration::from_millis(timeout_ms);
        let mut cmd = std::process::Command::new(&program);
        cmd.args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        if let Some(dir) = cwd.as_deref() {
            cmd.current_dir(dir);
        }
        for (key, value) in &env {
            cmd.env(key, value);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("spawn {}: {e}", program.display()))?;
        let start = std::time::Instant::now();

        loop {
            if let Some(status) = child.try_wait().map_err(|e| format!("wait cli: {e}"))? {
                let output = child
                    .wait_with_output()
                    .map_err(|e| format!("read cli output: {e}"))?;
                return Ok(PluginCliRunResult {
                    status: status.code(),
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    timed_out: false,
                    program: program_display.clone(),
                });
            }

            if start.elapsed() >= timeout {
                let _ = child.kill();
                let output = child
                    .wait_with_output()
                    .map_err(|e| format!("read killed cli output: {e}"))?;
                return Ok(PluginCliRunResult {
                    status: None,
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    timed_out: true,
                    program: program_display.clone(),
                });
            }

            std::thread::sleep(Duration::from_millis(50));
        }
    })
    .await
    .map_err(|e| format!("cli task failed: {e}"))?
}

/// Resolve a CLI program path without running it.
#[tauri::command]
pub async fn plugin_cli_which(req: PluginCliWhichRequest) -> Result<Option<String>, String> {
    match resolve_cli_program(&req.program) {
        Ok(path) => Ok(Some(path.display().to_string())),
        Err(_) => Ok(None),
    }
}

static AI_MEMORY_COUNTER: AtomicU64 = AtomicU64::new(0);

fn plugin_files_dir(id: &str) -> Result<PathBuf, String> {
    // Align with marketplace durable data root (`~/.qx/plugin-data/<id>/files`).
    let dir = crate::marketplace::checked_plugin_data_dir(id)?.join("files");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create plugin files dir: {e}"))?;
    Ok(dir)
}

fn plugin_virtual_prefix(id: &str) -> String {
    format!("/qx-plugin-files/{id}")
}

fn home_dir() -> PathBuf {
    crate::paths::home_dir()
}

fn qx_home_alias() -> &'static str {
    "/qx-home"
}

fn clean_path(path: &Path) -> PathBuf {
    let mut cleaned = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => cleaned.push(prefix.as_os_str()),
            Component::RootDir => cleaned.push(Path::new("/")),
            Component::CurDir => {}
            Component::ParentDir => {
                cleaned.pop();
            }
            Component::Normal(part) => cleaned.push(part),
        }
    }
    cleaned
}

fn plugin_file_path(id: &str, path: &str) -> Result<PathBuf, String> {
    let base = plugin_files_dir(id)?;
    let prefix = plugin_virtual_prefix(id);
    let raw = path.trim();
    if raw.is_empty() || raw == prefix {
        return Ok(base);
    }
    if let Some(rest) = raw.strip_prefix(&(prefix.clone() + "/")) {
        return Ok(clean_path(&base.join(rest)));
    }
    let home = home_dir();
    if raw == "~" || raw == qx_home_alias() {
        return Ok(home);
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        return Ok(clean_path(&home.join(rest)));
    }
    if let Some(rest) = raw.strip_prefix(&(qx_home_alias().to_string() + "/")) {
        return Ok(clean_path(&home.join(rest)));
    }
    let candidate = PathBuf::from(raw);
    if candidate.is_absolute() {
        return Ok(clean_path(&candidate));
    }
    Ok(clean_path(&base.join(candidate)))
}

fn replace_plugin_virtual_paths(id: &str, script: &str) -> Result<String, String> {
    let base = plugin_files_dir(id)?;
    let home = home_dir();
    Ok(script
        .replace(&plugin_virtual_prefix(id), base.to_string_lossy().as_ref())
        .replace(qx_home_alias(), home.to_string_lossy().as_ref()))
}

fn is_dangerous_empty_dir(path: &Path) -> bool {
    let cleaned = clean_path(path);
    cleaned == Path::new("/")
        || cleaned == home_dir()
        || cleaned == Path::new("/Users")
        || cleaned == Path::new("/tmp")
        || cleaned == Path::new("/private/tmp")
}

#[tauri::command]
pub fn plugin_ai_list_providers() -> Result<Vec<crate::g4f::ProviderInfo>, String> {
    Ok(crate::g4f::qxai_provider_catalog())
}

#[tauri::command]
pub fn plugin_run_applescript(id: String, script: String) -> Result<String, String> {
    let expanded = replace_plugin_virtual_paths(&id, &script)?;
    let trimmed = expanded.trim();
    if trimmed.is_empty() {
        return Err("AppleScript is empty".to_string());
    }
    let mut child = std::process::Command::new("osascript")
        .arg("-")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn osascript: {e}"))?;
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "open osascript stdin failed".to_string())?;
        stdin
            .write_all(trimmed.as_bytes())
            .map_err(|e| format!("write osascript: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|e| format!("wait osascript: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub fn plugin_file_write_base64(
    id: String,
    path: String,
    data_base64: String,
) -> Result<(), String> {
    let target = plugin_file_path(&id, &path)?;
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create parent dir: {e}"))?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("decode base64: {e}"))?;
    std::fs::write(&target, bytes).map_err(|e| format!("write plugin file: {e}"))
}

#[tauri::command]
pub fn plugin_file_read_base64(id: String, path: String) -> Result<String, String> {
    let target = plugin_file_path(&id, &path)?;
    let bytes = std::fs::read(&target).map_err(|e| format!("read plugin file: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn plugin_file_exists(id: String, path: String) -> Result<bool, String> {
    let target = plugin_file_path(&id, &path)?;
    Ok(target.exists())
}

#[tauri::command]
pub fn plugin_file_ensure_dir(id: String, path: String) -> Result<(), String> {
    let target = plugin_file_path(&id, &path)?;
    std::fs::create_dir_all(&target).map_err(|e| format!("create plugin dir: {e}"))
}

#[tauri::command]
pub fn plugin_file_empty_dir(id: String, path: String) -> Result<(), String> {
    let target = plugin_file_path(&id, &path)?;
    if is_dangerous_empty_dir(&target) {
        return Err(format!(
            "refuse to empty broad directory: {}",
            target.display()
        ));
    }
    if target.exists() {
        std::fs::remove_dir_all(&target).map_err(|e| format!("clear plugin dir: {e}"))?;
    }
    std::fs::create_dir_all(&target).map_err(|e| format!("create plugin dir: {e}"))
}

#[tauri::command]
pub fn plugin_file_list(id: String, path: String) -> Result<Vec<String>, String> {
    let target = plugin_file_path(&id, &path)?;
    if !target.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&target).map_err(|e| format!("read plugin dir: {e}"))? {
        let entry = entry.map_err(|e| format!("read plugin dir entry: {e}"))?;
        if let Some(name) = entry.file_name().to_str() {
            files.push(name.to_string());
        }
    }
    Ok(files)
}

#[tauri::command]
pub fn plugin_ai_default_model() -> Result<Option<crate::g4f::ModelSelection>, String> {
    let settings = crate::settings::read_settings();
    let provider = settings.agent.default_provider.trim();
    let model = settings.agent.default_model.trim();
    if !provider.is_empty() && !model.is_empty() && provider_catalog_contains(provider, model) {
        return Ok(Some(crate::g4f::ModelSelection {
            provider: provider.to_string(),
            model: model.to_string(),
        }));
    }
    Ok(crate::g4f::qxai_default_model_selection())
}

#[tauri::command]
pub fn plugin_ai_agent_settings() -> Result<crate::settings::AgentSettings, String> {
    Ok(crate::settings::read_settings().agent)
}

#[tauri::command]
pub fn plugin_ai_chat(req: PluginAiChatRequest) -> Result<String, String> {
    let (provider, model, messages) = normalize_ai_chat_request(req)?;
    crate::g4f::qxai_chat(provider, model, messages)
}

#[tauri::command]
pub fn plugin_ai_stream_chat(req: PluginAiChatRequest) -> Result<Vec<String>, String> {
    let (provider, model, messages) = normalize_ai_chat_request(req)?;
    crate::g4f::qxai_stream_chat(provider, model, messages)
}

fn normalize_ai_chat_request(
    req: PluginAiChatRequest,
) -> Result<(Option<String>, Option<String>, Vec<crate::g4f::ChatMessage>), String> {
    let mut messages = req.messages;

    if let Some(system) = req.system {
        let trimmed = system.trim();
        if !trimmed.is_empty() {
            messages.insert(
                0,
                crate::g4f::ChatMessage {
                    role: "system".to_string(),
                    content: serde_json::Value::String(trimmed.to_string()),
                },
            );
        }
    }

    if let Some(prompt) = req.prompt {
        let trimmed = prompt.trim();
        if !trimmed.is_empty() {
            let content = if req.images.is_empty() {
                serde_json::Value::String(trimmed.to_string())
            } else {
                let mut parts = vec![serde_json::json!({
                    "type": "text",
                    "text": trimmed,
                })];
                for image in req.images {
                    let url = image.trim();
                    if url.is_empty() {
                        continue;
                    }
                    parts.push(serde_json::json!({
                        "type": "image_url",
                        "image_url": {
                            "url": url,
                            "detail": req.image_detail.as_deref().unwrap_or("auto"),
                        },
                    }));
                }
                serde_json::Value::Array(parts)
            };
            messages.push(crate::g4f::ChatMessage {
                role: "user".to_string(),
                content,
            });
        }
    }

    if messages.is_empty() {
        return Err("AI chat requires messages or prompt".to_string());
    }

    let (provider, model) = configured_ai_selection(req.provider, req.model);
    Ok((provider, model, messages))
}

fn configured_ai_selection(
    provider: Option<String>,
    model: Option<String>,
) -> (Option<String>, Option<String>) {
    if provider
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return (provider, model);
    }

    let settings = crate::settings::read_settings();
    let configured_provider = settings.agent.default_provider.trim();
    let configured_model = settings.agent.default_model.trim();
    if configured_provider.is_empty()
        || configured_model.is_empty()
        || !provider_catalog_contains(configured_provider, configured_model)
    {
        return (provider, model);
    }

    (
        Some(configured_provider.to_string()),
        Some(configured_model.to_string()),
    )
}

fn provider_catalog_contains(provider_id: &str, model_id: &str) -> bool {
    crate::g4f::qxai_provider_catalog()
        .into_iter()
        .any(|provider| {
            provider.id == provider_id && provider.models.iter().any(|model| model.id == model_id)
        })
}

#[tauri::command]
pub async fn plugin_ai_run_bash(req: PluginAiBashRequest) -> Result<PluginAiBashResult, String> {
    let settings = crate::settings::read_settings().agent;
    ensure_agent_tool_enabled(&settings)?;
    if !settings.bash_enabled {
        return Err("AI bash tool is disabled in Settings > Agent".to_string());
    }

    let configured_timeout = u64::from(settings.bash_timeout_ms).clamp(1000, 300_000);
    let timeout_ms = req.timeout_ms.clamp(1000, configured_timeout);
    let script = req.script;
    let cwd = req
        .cwd
        .as_deref()
        .unwrap_or(settings.bash_cwd.as_str())
        .trim()
        .to_string();

    tauri::async_runtime::spawn_blocking(move || {
        let timeout = Duration::from_millis(timeout_ms);
        let mut cmd = std::process::Command::new("/bin/bash");
        cmd.arg("-lc")
            .arg(script)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        if !cwd.is_empty() {
            cmd.current_dir(cwd);
        }

        let mut child = cmd.spawn().map_err(|e| format!("spawn bash: {e}"))?;
        let start = std::time::Instant::now();

        loop {
            if let Some(status) = child.try_wait().map_err(|e| format!("wait bash: {e}"))? {
                let output = child
                    .wait_with_output()
                    .map_err(|e| format!("read bash output: {e}"))?;
                return Ok(PluginAiBashResult {
                    status: status.code(),
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    timed_out: false,
                });
            }

            if start.elapsed() >= timeout {
                let _ = child.kill();
                let output = child
                    .wait_with_output()
                    .map_err(|e| format!("read killed bash output: {e}"))?;
                return Ok(PluginAiBashResult {
                    status: None,
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    timed_out: true,
                });
            }

            std::thread::sleep(Duration::from_millis(50));
        }
    })
    .await
    .map_err(|e| format!("bash task failed: {e}"))?
}

#[tauri::command]
pub async fn plugin_ai_grep_search(
    req: PluginAiGrepRequest,
) -> Result<Vec<PluginAiGrepResult>, String> {
    let settings = crate::settings::read_settings().agent;
    ensure_agent_tool_enabled(&settings)?;
    if !settings.grep_search_enabled {
        return Err("AI grep search is disabled in Settings > Agent".to_string());
    }

    let query = req.query.trim();
    if query.is_empty() {
        return Err("grep search query is empty".to_string());
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let root = req
        .root
        .as_deref()
        .unwrap_or(settings.grep_root.as_str())
        .trim()
        .to_string();
    let root = if root.is_empty() { home } else { root };
    let max_results = req
        .max_results
        .unwrap_or(settings.grep_max_results)
        .clamp(1, 500);
    let grep_command = settings.grep_command;
    let query = query.to_string();

    let output = tauri::async_runtime::spawn_blocking(move || {
        run_grep_command(grep_command.as_str(), &query, root.as_str(), max_results)
    })
    .await
    .map_err(|e| format!("grep task failed: {e}"))?;
    Ok(parse_grep_output(&output?, max_results))
}

fn ensure_agent_tool_enabled(settings: &crate::settings::AgentSettings) -> Result<(), String> {
    if !settings.agent_mode_enabled {
        return Err("AI Agent mode is disabled in Settings > Agent".to_string());
    }
    if !settings.tools_enabled {
        return Err("AI tools are disabled in Settings > Agent".to_string());
    }
    Ok(())
}

fn run_grep_command(
    configured_command: &str,
    query: &str,
    root: &str,
    max_results: u32,
) -> Result<String, String> {
    let command = match configured_command.trim() {
        "grep" => "grep",
        _ => "rg",
    };
    if command == "rg" {
        match run_single_grep_command("rg", query, root, max_results) {
            Ok(output) => return Ok(output),
            Err(err) if err.contains("not found") || err.contains("No such file") => {
                return run_single_grep_command("grep", query, root, max_results);
            }
            Err(err) => return Err(err),
        }
    }
    run_single_grep_command("grep", query, root, max_results)
}

fn run_single_grep_command(
    command: &str,
    query: &str,
    root: &str,
    max_results: u32,
) -> Result<String, String> {
    let mut cmd = std::process::Command::new(command);
    if command == "grep" {
        cmd.arg("-RIn")
            .arg("-m")
            .arg(max_results.to_string())
            .arg("--")
            .arg(query)
            .arg(root);
    } else {
        cmd.arg("--line-number")
            .arg("--no-heading")
            .arg("--color")
            .arg("never")
            .arg("--max-count")
            .arg(max_results.to_string())
            .arg("--")
            .arg(query)
            .arg(root);
    }
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("{command} search executable not found")
        } else {
            format!("spawn {command} search: {e}")
        }
    })?;
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(20);
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("wait {command} search: {e}"))?
        {
            let output = child
                .wait_with_output()
                .map_err(|e| format!("read {command} output: {e}"))?;
            if status.success() || status.code() == Some(1) {
                return Ok(String::from_utf8_lossy(&output.stdout).to_string());
            }
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("{command} search failed: {stderr}"));
        }

        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{command} search timed out"));
        }

        std::thread::sleep(Duration::from_millis(50));
    }
}

fn parse_grep_output(output: &str, max_results: u32) -> Vec<PluginAiGrepResult> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, ':');
            let path = parts.next()?.trim();
            let line_no = parts.next().and_then(|value| value.parse::<u32>().ok());
            let text = parts.next().unwrap_or("").trim();
            if path.is_empty() {
                None
            } else {
                Some(PluginAiGrepResult {
                    path: path.to_string(),
                    line: line_no,
                    text: text.to_string(),
                })
            }
        })
        .take(max_results as usize)
        .collect()
}

fn ai_memory_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/.qx", home));
    let _ = std::fs::create_dir_all(&dir);
    dir.join("qxai-memory.json")
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn read_ai_memory() -> Vec<PluginAiMemoryEntry> {
    let path = ai_memory_path();
    match std::fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => vec![],
    }
}

fn write_ai_memory(entries: &[PluginAiMemoryEntry]) -> Result<(), String> {
    let path = ai_memory_path();
    let json =
        serde_json::to_string_pretty(entries).map_err(|e| format!("serialize memory: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    {
        let mut file =
            std::fs::File::create(&tmp).map_err(|e| format!("create memory tmp: {e}"))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("write memory tmp: {e}"))?;
    }
    std::fs::rename(&tmp, &path).map_err(|e| format!("replace memory file: {e}"))
}

#[tauri::command]
pub fn plugin_ai_memory_list() -> Result<Vec<PluginAiMemoryEntry>, String> {
    Ok(read_ai_memory())
}

#[tauri::command]
pub fn plugin_ai_memory_add(input: PluginAiMemoryInput) -> Result<PluginAiMemoryEntry, String> {
    let text = input.text.trim();
    if text.is_empty() {
        return Err("memory text is empty".to_string());
    }
    let now = now_millis();
    let suffix = AI_MEMORY_COUNTER.fetch_add(1, Ordering::Relaxed);
    let entry = PluginAiMemoryEntry {
        id: format!("mem-{now}-{suffix}"),
        text: text.to_string(),
        tags: input
            .tags
            .into_iter()
            .map(|tag| tag.trim().to_string())
            .filter(|tag| !tag.is_empty())
            .collect(),
        created_at: now,
        updated_at: now,
    };
    let mut entries = read_ai_memory();
    entries.push(entry.clone());
    write_ai_memory(&entries)?;
    Ok(entry)
}

#[tauri::command]
pub fn plugin_ai_memory_delete(id: String) -> Result<(), String> {
    let mut entries = read_ai_memory();
    let before = entries.len();
    entries.retain(|entry| entry.id != id);
    if entries.len() == before {
        return Err(format!("memory entry not found: {id}"));
    }
    write_ai_memory(&entries)
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ClipboardText {
    pub text: String,
}

#[tauri::command]
pub fn plugin_clipboard_read(app: AppHandle) -> Result<ClipboardText, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let text = app
        .clipboard()
        .read_text()
        .map_err(|e| format!("read clipboard: {e}"))?;
    Ok(ClipboardText { text })
}

#[tauri::command]
pub fn plugin_clipboard_write(app: AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(&text)
        .map_err(|e| format!("write clipboard: {e}"))
}

#[tauri::command]
pub fn plugin_perform_paste(app: AppHandle) -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    #[cfg(target_os = "macos")]
    if !crate::permissions::accessibility_granted() {
        return Err(
            "Accessibility permission is required to paste from Qx. Open Settings > Permissions and grant Accessibility."
                .to_string(),
        );
    }
    crate::floating_panel::hide_restore_focus_and_wait(&app, Duration::from_millis(700));
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {e}"))?;
    enigo
        .key(Key::Meta, Direction::Press)
        .map_err(|e| format!("press command: {e}"))?;
    let key_result = enigo.key(Key::Unicode('v'), Direction::Click);
    let release_result = enigo.key(Key::Meta, Direction::Release);
    key_result.map_err(|e| format!("press v: {e}"))?;
    release_result.map_err(|e| format!("release command: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn plugin_perform_paste_at_cursor() -> Result<(), String> {
    use enigo::{Button, Direction, Enigo, Key, Keyboard, Mouse, Settings};
    #[cfg(target_os = "macos")]
    if !crate::permissions::accessibility_granted() {
        return Err(
            "Accessibility permission is required to paste from Qx. Open Settings > Permissions and grant Accessibility."
                .to_string(),
        );
    }
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {e}"))?;
    enigo
        .button(Button::Left, Direction::Click)
        .map_err(|e| format!("click target: {e}"))?;
    std::thread::sleep(std::time::Duration::from_millis(35));
    enigo
        .key(Key::Meta, Direction::Press)
        .map_err(|e| format!("press command: {e}"))?;
    let key_result = enigo.key(Key::Unicode('v'), Direction::Click);
    let release_result = enigo.key(Key::Meta, Direction::Release);
    key_result.map_err(|e| format!("press v: {e}"))?;
    release_result.map_err(|e| format!("release command: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// HTTP fetch
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct HttpFetchRequest {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_method() -> String {
    "GET".to_string()
}

fn default_timeout_ms() -> u64 {
    // Wallpaper / asset downloads benefit from a longer default than API JSON calls.
    30000
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub ok: bool,
    pub headers: std::collections::BTreeMap<String, String>,
    /// UTF-8 text body when the payload is valid UTF-8; empty for binary.
    pub body: String,
    /// Always present raw response bytes (base64). Use for images / arrayBuffer.
    pub body_base64: String,
    pub binary: bool,
}

fn content_type_is_text(headers: &std::collections::BTreeMap<String, String>) -> bool {
    let Some(raw) = headers
        .get("content-type")
        .or_else(|| headers.get("Content-Type"))
    else {
        return false;
    };
    let lower = raw.to_ascii_lowercase();
    lower.starts_with("text/")
        || lower.contains("application/json")
        || lower.contains("application/xml")
        || lower.contains("application/javascript")
        || lower.contains("+json")
        || lower.contains("+xml")
}

#[tauri::command]
pub async fn plugin_http_fetch(req: HttpFetchRequest) -> Result<HttpResponse, String> {
    let url = reqwest::Url::parse(&req.url).map_err(|e| format!("invalid URL: {e}"))?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("unsupported URL scheme: {scheme}")),
    }

    let client = crate::http_client::client(
        "Qx/0.1 (Plugin HTTP; +https://github.com/mcxen/qx)",
        std::time::Duration::from_millis(req.timeout_ms.max(1000).min(120_000)),
        None,
    )?;

    let method = req.method.to_uppercase();
    let mut builder = match method.as_str() {
        "GET" => client.get(url.clone()),
        "POST" => client.post(url.clone()),
        "PUT" => client.put(url.clone()),
        "PATCH" => client.patch(url.clone()),
        "DELETE" => client.delete(url.clone()),
        "HEAD" => client.head(url.clone()),
        _ => return Err(format!("unsupported HTTP method: {method}")),
    };

    for (key, value) in &req.headers {
        builder = builder.header(key.as_str(), value.as_str());
    }

    if let Some(body) = &req.body {
        builder = builder.body(body.clone());
    }

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("http request: {e}"))?;

    let status = resp.status().as_u16();
    let ok = resp.status().is_success();

    let mut headers = std::collections::BTreeMap::new();
    for (name, value) in resp.headers().iter() {
        if let Ok(v) = value.to_str() {
            headers.insert(name.as_str().to_string(), v.to_string());
        }
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read body: {e}"))?
        .to_vec();
    let body_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let text_hint = content_type_is_text(&headers);
    let (body, binary) = match String::from_utf8(bytes) {
        Ok(text) => (text, false),
        Err(err) => {
            if text_hint {
                // Lossy only when the server claimed text; otherwise keep body empty
                // so callers use body_base64 / arrayBuffer instead of corrupted data.
                (String::from_utf8_lossy(err.as_bytes()).into_owned(), true)
            } else {
                (String::new(), true)
            }
        }
    };

    Ok(HttpResponse {
        status,
        ok,
        headers,
        body,
        body_base64,
        binary,
    })
}

// ---------------------------------------------------------------------------
// Plugin assets
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct PluginAsset {
    pub path: String,
}

fn safe_relative_path(rel: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for component in Path::new(rel).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

#[tauri::command]
pub fn plugin_resolve_asset(id: String, asset_path: String) -> Result<PluginAsset, String> {
    let rel = safe_relative_path(&asset_path)
        .ok_or_else(|| format!("invalid plugin asset path: {asset_path}"))?;
    let plugin_dir = crate::marketplace::checked_plugin_dir(&id)?;
    let path = plugin_dir.join(rel);
    let canonical_plugin_dir = plugin_dir
        .canonicalize()
        .map_err(|e| format!("resolve plugin dir for {id}: {e}"))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|e| format!("resolve plugin asset {}: {e}", path.display()))?;
    if !canonical_path.starts_with(&canonical_plugin_dir) || !canonical_path.is_file() {
        return Err(format!("plugin asset not found: {asset_path}"));
    }
    Ok(PluginAsset {
        path: canonical_path.to_string_lossy().to_string(),
    })
}

// ---------------------------------------------------------------------------
// System notification (macOS NSUserNotification via objc2)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct NotificationRequest {
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub subtitle: String,
}

#[tauri::command]
pub fn plugin_notification_show(_app: AppHandle, req: NotificationRequest) -> Result<(), String> {
    // Use macOS NSUserNotification via objc2
    #[cfg(target_os = "macos")]
    {
        send_macos_notification(&req.title, &req.body, &req.subtitle)?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = req;
        return Err("notifications are only supported on macOS".to_string());
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn send_macos_notification(title: &str, body: &str, subtitle: &str) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    // We use the simpler NSUserNotificationCenter approach (deprecated but works)
    // For modern UNUserNotificationCenter, we'd need entitlements + bundle ID.
    // Since Qx is a Tauri app with proper bundle ID, we try the NSUserNotification path.

    unsafe {
        // Get NSUserNotificationCenter default center
        let cls = objc2::runtime::AnyClass::get(c"NSUserNotificationCenter")
            .ok_or("NSUserNotificationCenter class not found")?;
        let default_center: *mut AnyObject = msg_send![cls, defaultUserNotificationCenter];

        if default_center.is_null() {
            return Err("failed to get default user notification center".to_string());
        }

        // Create NSUserNotification
        let notif_cls = objc2::runtime::AnyClass::get(c"NSUserNotification")
            .ok_or("NSUserNotification class not found")?;
        let notif: *mut AnyObject = msg_send![notif_cls, new];

        if notif.is_null() {
            return Err("failed to create NSUserNotification".to_string());
        }

        // Set title
        let title_str = objc2_foundation::NSString::from_str(title);
        let _: () = msg_send![notif, setTitle: &*title_str];

        // Set subtitle
        if !subtitle.is_empty() {
            let subtitle_str = objc2_foundation::NSString::from_str(subtitle);
            let _: () = msg_send![notif, setSubtitle: &*subtitle_str];
        }

        // Set body / informative text
        if !body.is_empty() {
            let body_str = objc2_foundation::NSString::from_str(body);
            let _: () = msg_send![notif, setInformativeText: &*body_str];
        }

        // Set sound name (default)
        let sound_str = objc2_foundation::NSString::from_str("NSUserNotificationDefaultSoundName");
        let _: () = msg_send![notif, setSoundName: &*sound_str];

        // Deliver
        let _: () = msg_send![default_center, deliverNotification: notif];
    }

    Ok(())
}
