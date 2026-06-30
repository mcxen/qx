use serde::{Deserialize, Serialize};
use std::io::BufRead;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Emitter;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: serde_json::Value,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSelection {
    pub provider: String,
    pub model: String,
}

/// A user-configured custom provider (BYOK — Bring Your Own Key).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProviderConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub models: Vec<ProviderModel>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxaiStreamEvent {
    pub request_id: String,
    pub chunk: String,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
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
    let messages = duckduckgo_messages(messages)?;
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

fn duckduckgo_post_chat_stream(
    client: &reqwest::blocking::Client,
    vqd: &str,
    messages: &[ChatMessage],
    mut on_chunk: impl FnMut(&str),
) -> Result<String, String> {
    let messages = duckduckgo_messages(messages)?;
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

    let mut full = String::new();
    let reader = std::io::BufReader::new(resp);
    for line in reader.lines() {
        let line = line.map_err(|e| format!("failed to read duckduckgo stream: {e}"))?;
        if let Some(data) = line.strip_prefix("data: ") {
            if data == "[DONE]" {
                break;
            }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(msg) = val.get("message").and_then(|m| m.as_str()) {
                    full.push_str(msg);
                    on_chunk(msg);
                }
            }
        }
    }
    if full.is_empty() {
        return Err("no content received from duckduckgo".to_string());
    }
    Ok(full)
}

fn openai_list_models(base_url: &str, api_key: &str) -> Result<Vec<ProviderModel>, String> {
    let client = make_client()?;
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .map_err(|e| format!("request to {url} failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().unwrap_or_default();
        return Err(format!("{url} returned HTTP {status}: {text}"));
    }

    let json: serde_json::Value = resp
        .json()
        .map_err(|e| format!("parse models from {url}: {e}"))?;

    let mut models = json
        .get("data")
        .and_then(|data| data.as_array())
        .ok_or_else(|| "models response missing data array".to_string())?
        .iter()
        .filter_map(|item| item.get("id").and_then(|id| id.as_str()))
        .map(|id| ProviderModel {
            id: id.to_string(),
            name: id.to_string(),
        })
        .collect::<Vec<_>>();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models.dedup_by(|a, b| a.id == b.id);

    if models.is_empty() {
        return Err("models response was empty".to_string());
    }

    Ok(models)
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
                }
                continue;
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
                }
                continue;
            }
            chunks.push(data.to_string());
        }
    }
    if chunks.is_empty() {
        return Err("no content received from duckduckgo".to_string());
    }
    Ok(chunks)
}

fn duckduckgo_messages(messages: &[ChatMessage]) -> Result<Vec<ChatMessage>, String> {
    let mut system_prompt = Vec::new();
    let mut chat_messages = Vec::new();

    for message in messages {
        match message.role.as_str() {
            "system" => {
                let text = text_content(&message.content)?;
                if !text.trim().is_empty() {
                    system_prompt.push(text.trim().to_string());
                }
            }
            "user" | "assistant" => chat_messages.push(ChatMessage {
                role: message.role.clone(),
                content: serde_json::Value::String(text_content(&message.content)?),
            }),
            _ => {}
        }
    }

    if chat_messages.is_empty() {
        return Err("duckduckgo requires at least one user message".to_string());
    }

    if !system_prompt.is_empty() {
        let prompt = system_prompt.join("\n\n");
        if let Some(first_user) = chat_messages.iter_mut().find(|m| m.role == "user") {
            let content = first_user
                .content
                .as_str()
                .map(ToString::to_string)
                .unwrap_or_default();
            first_user.content = serde_json::Value::String(format!("{prompt}\n\n{content}"));
        }
    }

    Ok(chat_messages)
}

fn text_content(content: &serde_json::Value) -> Result<String, String> {
    if let Some(text) = content.as_str() {
        return Ok(text.to_string());
    }

    if let Some(parts) = content.as_array() {
        let mut text_parts = Vec::new();
        for part in parts {
            match part.get("type").and_then(|value| value.as_str()) {
                Some("text") => {
                    if let Some(text) = part.get("text").and_then(|value| value.as_str()) {
                        text_parts.push(text.to_string());
                    }
                }
                Some("image_url") | Some("input_image") | Some("image") => {
                    return Err(
                        "duckduckgo provider does not support image input; choose a multimodal custom provider"
                            .to_string(),
                    );
                }
                _ => {}
            }
        }
        return Ok(text_parts.join("\n"));
    }

    Err("unsupported message content format".to_string())
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

fn provider_duckduckgo_stream_events(
    messages: &[ChatMessage],
    on_chunk: impl FnMut(&str),
) -> Result<String, String> {
    let client = make_client()?;
    let vqd = duckduckgo_get_vqd(&client)?;
    duckduckgo_post_chat_stream(&client, &vqd, messages, on_chunk)
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

fn provider_openai_chat_stream(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ChatMessage],
    mut on_chunk: impl FnMut(&str),
) -> Result<String, String> {
    let client = make_client()?;
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
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

    let mut full = String::new();
    let reader = std::io::BufReader::new(resp);
    for line in reader.lines() {
        let line = line.map_err(|e| format!("failed to read response stream from {url}: {e}"))?;
        let Some(data) = line.strip_prefix("data: ") else {
            continue;
        };
        if data == "[DONE]" {
            break;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
            continue;
        };
        if let Some(content) = value["choices"][0]["delta"]["content"].as_str() {
            full.push_str(content);
            on_chunk(content);
        }
    }

    if full.is_empty() {
        return provider_openai_chat(base_url, api_key, model, messages);
    }
    Ok(full)
}

fn provider_openai_chat_with_tools(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[serde_json::Value],
    tools: &[serde_json::Value],
    tool_choice: &str,
) -> Result<serde_json::Value, String> {
    let client = make_client()?;
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
    });
    if !tools.is_empty() {
        body["tools"] = serde_json::Value::Array(tools.to_vec());
        body["tool_choice"] = serde_json::Value::String(tool_choice.to_string());
    }

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

    json.get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .cloned()
        .ok_or_else(|| "no message in API response".to_string())
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

pub fn qxai_provider_catalog() -> Vec<ProviderInfo> {
    let mut providers = g4f_list_providers();
    providers.extend(
        qxai_get_custom_providers()
            .into_iter()
            .map(|provider| ProviderInfo {
                id: provider.id,
                name: provider.name,
                models: openai_list_models(&provider.base_url, &provider.api_key)
                    .unwrap_or(provider.models),
            }),
    );
    providers
}

pub fn qxai_default_model_selection() -> Option<ModelSelection> {
    qxai_provider_catalog().into_iter().find_map(|provider| {
        provider.models.first().map(|model| ModelSelection {
            provider: provider.id,
            model: model.id.clone(),
        })
    })
}

fn resolve_model_selection(
    providers: &[ProviderInfo],
    provider: Option<String>,
    model: Option<String>,
) -> Result<ModelSelection, String> {
    let selected_provider = provider
        .as_deref()
        .and_then(|id| providers.iter().find(|p| p.id == id))
        .or_else(|| providers.first())
        .ok_or_else(|| "no AI providers available".to_string())?;

    let selected_model = model
        .as_deref()
        .and_then(|id| selected_provider.models.iter().find(|m| m.id == id))
        .or_else(|| selected_provider.models.first())
        .ok_or_else(|| format!("no models available for provider {}", selected_provider.id))?;

    Ok(ModelSelection {
        provider: selected_provider.id.clone(),
        model: selected_model.id.clone(),
    })
}

pub fn qxai_chat(
    provider: Option<String>,
    model: Option<String>,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let providers = qxai_provider_catalog();
    let selection = resolve_model_selection(&providers, provider, model)?;

    if selection.provider.starts_with("custom:") {
        let custom_provider = qxai_get_custom_providers()
            .into_iter()
            .find(|p| p.id == selection.provider)
            .ok_or_else(|| format!("custom provider {} not found", selection.provider))?;
        provider_openai_chat(
            &custom_provider.base_url,
            &custom_provider.api_key,
            &selection.model,
            &messages,
        )
    } else {
        g4f_chat(selection.provider, Some(selection.model), messages)
    }
}

/// OpenAI-style function calling for BYOK custom providers.
/// Returns the raw `choices[0].message` JSON, including any `tool_calls`.
#[tauri::command]
pub fn qxai_chat_with_tools(
    provider: Option<String>,
    model: Option<String>,
    messages: Vec<serde_json::Value>,
    tools: Vec<serde_json::Value>,
    tool_choice: Option<String>,
) -> Result<serde_json::Value, String> {
    let providers = qxai_provider_catalog();
    let selection = resolve_model_selection(&providers, provider, model)?;

    if !selection.provider.starts_with("custom:") {
        return Err(
            "function calling is only supported for custom OpenAI-compatible providers".to_string(),
        );
    }

    let custom_provider = qxai_get_custom_providers()
        .into_iter()
        .find(|p| p.id == selection.provider)
        .ok_or_else(|| format!("custom provider {} not found", selection.provider))?;

    let choice = tool_choice.unwrap_or_else(|| "auto".to_string());
    provider_openai_chat_with_tools(
        &custom_provider.base_url,
        &custom_provider.api_key,
        &selection.model,
        &messages,
        &tools,
        &choice,
    )
}

#[tauri::command]
pub fn qxai_stream_chat(
    provider: Option<String>,
    model: Option<String>,
    messages: Vec<ChatMessage>,
) -> Result<Vec<String>, String> {
    let providers = qxai_provider_catalog();
    let selection = resolve_model_selection(&providers, provider, model)?;

    if selection.provider.starts_with("custom:") {
        Ok(vec![qxai_chat(
            Some(selection.provider),
            Some(selection.model),
            messages,
        )?])
    } else {
        g4f_stream_chat(selection.provider, Some(selection.model), messages)
    }
}

#[tauri::command]
pub fn qxai_stream_chat_events(
    app: tauri::AppHandle,
    request_id: String,
    provider: Option<String>,
    model: Option<String>,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    std::thread::spawn(move || {
        let stream_app = app.clone();
        let stream_request_id = request_id.clone();
        let emit_chunk = |chunk: &str| {
            let _ = stream_app.emit(
                "qxai://stream",
                QxaiStreamEvent {
                    request_id: stream_request_id.clone(),
                    chunk: chunk.to_string(),
                    done: false,
                    error: None,
                },
            );
        };

        let work = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let providers = qxai_provider_catalog();
            let selection = resolve_model_selection(&providers, provider, model)?;

            if selection.provider.starts_with("custom:") {
                match qxai_get_custom_providers()
                    .into_iter()
                    .find(|p| p.id == selection.provider)
                {
                    Some(custom_provider) => provider_openai_chat_stream(
                        &custom_provider.base_url,
                        &custom_provider.api_key,
                        &selection.model,
                        &messages,
                        emit_chunk,
                    ),
                    None => Err(format!("custom provider {} not found", selection.provider)),
                }
            } else {
                match selection.provider.as_str() {
                    "duckduckgo" => provider_duckduckgo_stream_events(&messages, emit_chunk),
                    other => Err(format!("unknown provider: {other}")),
                }
            }
        }));

        let result: Result<String, String> = match work {
            Ok(inner) => inner,
            Err(panic) => {
                let msg = if let Some(s) = panic.downcast_ref::<&str>() {
                    (*s).to_string()
                } else if let Some(s) = panic.downcast_ref::<String>() {
                    s.clone()
                } else {
                    "qxai stream thread panicked".to_string()
                };
                Err(msg)
            }
        };

        let (chunk, error) = match result {
            Ok(text) => (text, None),
            Err(err) => (String::new(), Some(err)),
        };
        let _ = app.emit(
            "qxai://stream",
            QxaiStreamEvent {
                request_id,
                chunk,
                done: true,
                error,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub fn qxai_list_providers() -> Vec<ProviderInfo> {
    qxai_provider_catalog()
}

#[tauri::command]
pub fn qxai_fetch_models(base_url: String, api_key: String) -> Result<Vec<ProviderModel>, String> {
    openai_list_models(&base_url, &api_key)
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
