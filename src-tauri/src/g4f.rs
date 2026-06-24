use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub models: Vec<ProviderModel>,
}

/// A user-configured custom provider (BYOK — Bring Your Own Key).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomProviderConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub models: Vec<ProviderModel>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Create a blocking HTTP client respecting proxy settings.
fn make_client() -> Result<reqwest::blocking::Client, String> {
    crate::http_client::blocking_client(
        "Qx/1.0 (g4f)",
        Duration::from_secs(60),
        Some(Duration::from_secs(10)),
    )
}

/// Obtain an x-vqd-4 token from DuckDuckGo (required for chat).
fn duckduckgo_get_vqd(client: &reqwest::blocking::Client) -> Result<String, String> {
    let resp = client
        .get("https://duckduckgo.com/duckchat/v1/status")
        .header("x-vqd-accept", "1")
        .send()
        .map_err(|e| format!("failed to get DDG status: {e}"))?;

    let status = resp.status();
    if let Some(vqd) = resp.headers().get("x-vqd-4").and_then(|v| v.to_str().ok()) {
        return Ok(vqd.to_string());
    }

    let body = resp.text().unwrap_or_default();
    Err(format!("missing x-vqd-4 header (status {status}): {body}"))
}

/// Post a chat request to DuckDuckGo and return the raw SSE body.
fn duckduckgo_post_chat(
    client: &reqwest::blocking::Client,
    vqd: &str,
    messages: &[ChatMessage],
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": "gpt-4o-mini",
        "messages": messages,
    });

    let resp = client
        .post("https://duckduckgo.com/duckchat/v1/chat")
        .header("Content-Type", "application/json")
        .header("x-vqd-4", vqd)
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .map_err(|e| format!("duckduckgo chat request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().unwrap_or_default();
        return Err(format!("duckduckgo returned HTTP {status}: {text}"));
    }

    resp.text()
        .map_err(|e| format!("failed to read response body: {e}"))
}

/// Parse an SSE response into a single concatenated message string.
///
/// DuckDuckGo sends lines in the format `data: {"message":"..."}`.
fn parse_sse(text: &str) -> Result<String, String> {
    let mut full = String::new();
    for line in text.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if data == "[DONE]" {
                break;
            }
            // Try DDG format: {"message":"..."}
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(msg) = val.get("message").and_then(|m| m.as_str()) {
                    full.push_str(msg);
                    continue;
                }
            }
            // Fallback: push raw data line
            full.push_str(data);
        }
    }
    if full.is_empty() {
        return Err("no content received from duckduckgo".to_string());
    }
    Ok(full)
}

/// Parse an SSE response into individual message chunks.
fn parse_sse_chunks(text: &str) -> Result<Vec<String>, String> {
    let mut chunks = Vec::new();
    for line in text.lines() {
        if let Some(data) = line.strip_prefix("data: ") {
            if data == "[DONE]" {
                break;
            }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(msg) = val.get("message").and_then(|m| m.as_str()) {
                    chunks.push(msg.to_string());
                    continue;
                }
            }
            chunks.push(data.to_string());
        }
    }
    if chunks.is_empty() {
        return Err("no content received from duckduckgo".to_string());
    }
    Ok(chunks)
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

fn provider_duckduckgo(messages: &[ChatMessage]) -> Result<String, String> {
    let client = make_client()?;
    let vqd = duckduckgo_get_vqd(&client)?;
    let body = duckduckgo_post_chat(&client, &vqd, messages)?;
    parse_sse(&body)
}

fn provider_duckduckgo_stream(messages: &[ChatMessage]) -> Result<Vec<String>, String> {
    let client = make_client()?;
    let vqd = duckduckgo_get_vqd(&client)?;
    let body = duckduckgo_post_chat(&client, &vqd, messages)?;
    parse_sse_chunks(&body)
}

// ---------------------------------------------------------------------------
// OpenAI-compatible provider (BYOK)
// ---------------------------------------------------------------------------

fn provider_openai_chat(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ChatMessage],
) -> Result<String, String> {
    let client = make_client()?;
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
    });

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .map_err(|e| format!("request to {url} failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().unwrap_or_default();
        return Err(format!("{url} returned HTTP {status}: {text}"));
    }

    let json: serde_json::Value = resp
        .json()
        .map_err(|e| format!("parse response from {url}: {e}"))?;

    json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "no content in API response".to_string())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Send a chat message to an AI provider and get a complete response.
#[tauri::command]
pub fn g4f_chat(
    provider: String,
    model: Option<String>,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let _ = model; // reserved for future use per-provider model selection

    match provider.as_str() {
        "duckduckgo" => provider_duckduckgo(&messages),
        _ => Err(format!("unknown provider: {provider}")),
    }
}

/// Send a chat message to an AI provider and return individual SSE chunks.
#[tauri::command]
pub fn g4f_stream_chat(
    provider: String,
    model: Option<String>,
    messages: Vec<ChatMessage>,
) -> Result<Vec<String>, String> {
    let _ = model; // reserved for future use per-provider model selection

    match provider.as_str() {
        "duckduckgo" => provider_duckduckgo_stream(&messages),
        _ => Err(format!("unknown provider: {provider}")),
    }
}

/// Send a chat message to an OpenAI-compatible custom provider (BYOK).
#[tauri::command]
pub fn g4f_chat_custom(
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    provider_openai_chat(&base_url, &api_key, &model, &messages)
}

/// List all available AI providers and their models.
#[tauri::command]
pub fn g4f_list_providers() -> Vec<ProviderInfo> {
    vec![ProviderInfo {
        id: "duckduckgo".to_string(),
        name: "DuckDuckGo AI Chat".to_string(),
        models: vec![ProviderModel {
            id: "gpt-4o-mini".to_string(),
            name: "GPT-4o Mini".to_string(),
        }],
    }]
}

// ---------------------------------------------------------------------------
// Custom provider persistence (BYOK)
// ---------------------------------------------------------------------------

fn custom_providers_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/.qx", home));
    let _ = std::fs::create_dir_all(&dir);
    dir.join("qxai-custom-providers.json")
}

/// Load persisted custom providers.
#[tauri::command]
pub fn qxai_get_custom_providers() -> Vec<CustomProviderConfig> {
    let path = custom_providers_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => vec![],
    }
}

/// Save custom providers to disk.
#[tauri::command]
pub fn qxai_save_custom_providers(providers: Vec<CustomProviderConfig>) -> Result<(), String> {
    let path = custom_providers_path();
    let json = serde_json::to_string_pretty(&providers).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))
}
