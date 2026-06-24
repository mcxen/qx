use serde::{Deserialize, Serialize};
use std::time::Duration;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
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
    if let Some(vqd) = resp
        .headers()
        .get("x-vqd-4")
        .and_then(|v| v.to_str().ok())
    {
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

    resp.text().map_err(|e| format!("failed to read response body: {e}"))
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

fn provider_nexra() -> Result<String, String> {
    Err("nexra is not implemented in the Rust backend; implement it on the JS side".to_string())
}

fn provider_nexra_stream() -> Result<Vec<String>, String> {
    Err("nexra is not implemented in the Rust backend; implement it on the JS side".to_string())
}

fn provider_blackbox() -> Result<String, String> {
    Err("blackbox is not implemented in the Rust backend; implement it on the JS side".to_string())
}

fn provider_blackbox_stream() -> Result<Vec<String>, String> {
    Err("blackbox is not implemented in the Rust backend; implement it on the JS side".to_string())
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
        "nexra" => provider_nexra(),
        "blackbox" => provider_blackbox(),
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
        "nexra" => provider_nexra_stream(),
        "blackbox" => provider_blackbox_stream(),
        _ => Err(format!("unknown provider: {provider}")),
    }
}

/// List all available AI providers and their models.
#[tauri::command]
pub fn g4f_list_providers() -> Vec<ProviderInfo> {
    vec![
        ProviderInfo {
            id: "duckduckgo".to_string(),
            name: "DuckDuckGo AI Chat".to_string(),
            models: vec![ProviderModel {
                id: "gpt-4o-mini".to_string(),
                name: "GPT-4o Mini".to_string(),
            }],
        },
        ProviderInfo {
            id: "nexra".to_string(),
            name: "Nexra".to_string(),
            models: vec![ProviderModel {
                id: "gpt-4o-mini".to_string(),
                name: "GPT-4o Mini".to_string(),
            }],
        },
        ProviderInfo {
            id: "blackbox".to_string(),
            name: "Blackbox AI".to_string(),
            models: vec![ProviderModel {
                id: "blackbox-llm".to_string(),
                name: "Blackbox AI".to_string(),
            }],
        },
    ]
}
