use serde::{Deserialize, Serialize};
use std::io::{BufRead, Read};
use std::path::PathBuf;
use std::time::Duration;
use tauri::Emitter;

/// Frontend + Rust stream event channel.
/// Prefer a simple name (no `://`) so WebView2 property-key paths never treat
/// the event as a protocol/comment edge case under aggressive script injection.
const QXAI_STREAM_EVENT: &str = "qxai-stream";

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
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub reasoning: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub models: Vec<ProviderModel>,
    pub base_url: Option<String>,
    pub requires_api_key: bool,
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

/// Credentials for Qx-managed providers whose endpoints and models are fixed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltInProviderCredential {
    pub id: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxaiStreamEvent {
    pub request_id: String,
    pub kind: String,
    pub chunk: String,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<serde_json::Value>,
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

/// Streaming needs a long (or idle-friendly) body timeout. The 60s client above
/// aborts long Chinese/DeepSeek thinking streams mid-token on slow Windows
/// networks, which looks like "no output" once the read fails.
fn make_stream_client() -> Result<reqwest::blocking::Client, String> {
    crate::http_client::blocking_client(
        "Qx/1.0 (g4f)",
        Duration::from_secs(600),
        Some(Duration::from_secs(20)),
    )
}

/// Decode one SSE line. Prefer UTF-8; fall back to GB18030 (common on Chinese
/// Windows proxies / mislabeled responses) instead of aborting the stream.
fn decode_sse_line(raw: &[u8]) -> String {
    let bytes = raw.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(raw);
    let bytes = match bytes.strip_suffix(&[b'\r']) {
        Some(b) => b,
        None => bytes,
    };
    if bytes.is_empty() {
        return String::new();
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(_) => {
            let (cow, _enc, _had_errors) = encoding_rs::GB18030.decode(bytes);
            cow.into_owned()
        }
    }
}

/// Iterate SSE lines from a response body as lossy/decoded text.
/// `BufRead::lines()` errors on invalid UTF-8 and kills the whole stream —
/// that is a frequent Windows failure mode when a hop rewrites charset.
fn for_each_sse_line<R: Read>(
    reader: R,
    mut on_line: impl FnMut(&str) -> Result<(), String>,
) -> Result<(), String> {
    let mut reader = std::io::BufReader::new(reader);
    let mut raw = Vec::with_capacity(512);
    loop {
        raw.clear();
        let n = reader
            .read_until(b'\n', &mut raw)
            .map_err(|e| format!("failed to read response stream: {e}"))?;
        if n == 0 {
            break;
        }
        // read_until includes the delimiter when found; keep a final
        // partial line that had no trailing newline (n > 0 without `\n`).
        if raw.last() == Some(&b'\n') {
            raw.pop();
        }
        let line = decode_sse_line(&raw);
        on_line(line.trim_end_matches('\r'))?;
    }
    Ok(())
}

/// Extract assistant text from an OpenAI-style delta/message content field.
/// Supports plain strings and multi-part content arrays used by some providers.
fn content_delta_text(content: &serde_json::Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return if text.is_empty() {
            None
        } else {
            Some(text.to_string())
        };
    }
    let parts = content.as_array()?;
    let mut out = String::new();
    for part in parts {
        if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
            out.push_str(text);
        } else if let Some(text) = part.as_str() {
            out.push_str(text);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

const OPENROUTER_ID: &str = "openrouter";
const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";
const DEEPSEEK_ID: &str = "deepseek";
const DEEPSEEK_BASE_URL: &str = "https://api.deepseek.com";

struct ProviderEndpoint {
    base_url: String,
    api_key: String,
}

fn built_in_provider_endpoint(provider: &str) -> Option<ProviderEndpoint> {
    let base_url = match provider {
        OPENROUTER_ID => OPENROUTER_BASE_URL,
        DEEPSEEK_ID => DEEPSEEK_BASE_URL,
        _ => return None,
    };
    let api_key = qxai_get_builtin_provider_credentials()
        .into_iter()
        .find(|credential| credential.id == provider)
        .map(|credential| credential.api_key)
        .unwrap_or_default();
    Some(ProviderEndpoint {
        base_url: base_url.to_string(),
        api_key,
    })
}

fn provider_endpoint(provider: &str) -> Result<ProviderEndpoint, String> {
    let endpoint = if provider.starts_with("custom:") {
        qxai_get_custom_providers()
            .into_iter()
            .find(|item| item.id == provider)
            .map(|item| ProviderEndpoint {
                base_url: item.base_url,
                api_key: item.api_key,
            })
            .ok_or_else(|| format!("custom provider {provider} not found"))?
    } else {
        built_in_provider_endpoint(provider)
            .ok_or_else(|| format!("unknown provider: {provider}"))?
    };

    if endpoint.api_key.trim().is_empty() {
        return Err(format!(
            "API key missing for {provider}. Add it in QxAI Settings."
        ));
    }
    Ok(endpoint)
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
        .filter_map(|item| {
            let id = item.get("id").and_then(|id| id.as_str())?;
            let reasoning = item
                .get("supported_parameters")
                .and_then(|value| value.as_array())
                .is_some_and(|parameters| {
                    parameters.iter().any(|parameter| {
                        parameter.as_str().is_some_and(|name| {
                            matches!(name, "reasoning" | "reasoning_effort" | "include_reasoning")
                        })
                    })
                });
            Some(ProviderModel {
                id: id.to_string(),
                name: id.to_string(),
                reasoning,
            })
        })
        .collect::<Vec<_>>();
    models.sort_by(|a, b| a.id.cmp(&b.id));
    models.dedup_by(|a, b| a.id == b.id);

    if models.is_empty() {
        return Err("models response was empty".to_string());
    }

    Ok(models)
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
        .header("Content-Type", "application/json; charset=utf-8")
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

    content_delta_text(&json["choices"][0]["message"]["content"])
        .ok_or_else(|| "no content in API response".to_string())
}

fn provider_openai_chat_stream(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ChatMessage],
    reasoning: bool,
    mut on_delta: impl FnMut(&str, &str),
) -> Result<String, String> {
    let client = make_stream_client()?;
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });
    apply_reasoning_request(base_url, &mut body, reasoning);

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Accept", "text/event-stream")
        .header("Cache-Control", "no-cache")
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
    let mut done = false;
    for_each_sse_line(resp, |line| {
        if done {
            return Ok(());
        }
        let Some(data) = sse_data(line) else {
            return Ok(());
        };
        if data == "[DONE]" {
            done = true;
            return Ok(());
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
            return Ok(());
        };
        let delta = &value["choices"][0]["delta"];
        if let Some(reasoning) = delta["reasoning_content"]
            .as_str()
            .or_else(|| delta["reasoning"].as_str())
        {
            on_delta("reasoning", reasoning);
        }
        if let Some(content) = content_delta_text(&delta["content"]) {
            full.push_str(&content);
            on_delta("text", &content);
        }
        Ok(())
    })?;

    if full.is_empty() {
        return provider_openai_chat(base_url, api_key, model, messages);
    }
    Ok(full)
}

fn apply_reasoning_request(base_url: &str, body: &mut serde_json::Value, enabled: bool) {
    if base_url.contains("api.deepseek.com") {
        // DeepSeek defaults current models to thinking mode. Send the explicit
        // state so the per-conversation Qx toggle is authoritative.
        body["thinking"] = serde_json::json!({
            "type": if enabled { "enabled" } else { "disabled" }
        });
        return;
    }
    if !enabled {
        return;
    }
    if base_url.contains("openrouter.ai") {
        body["reasoning"] = serde_json::json!({ "enabled": true });
    } else {
        body["reasoning_effort"] = serde_json::Value::String("medium".to_string());
    }
}

fn should_send_tool_choice(base_url: &str, reasoning: bool) -> bool {
    // DeepSeek thinking-mode tool calls reject `tool_choice`; omission keeps
    // the provider's automatic selection while preserving tool schemas.
    !(reasoning && base_url.contains("api.deepseek.com"))
}

fn sse_data(line: &str) -> Option<&str> {
    // Tolerate BOM / leading whitespace some Windows proxies inject.
    let line = line.trim_start_matches('\u{feff}').trim_start();
    line.strip_prefix("data:").map(str::trim_start)
}

fn merge_stream_fragment(target: &mut serde_json::Value, fragment: &str) {
    if fragment.is_empty() {
        return;
    }
    let existing = target.as_str().unwrap_or_default();
    let merged = if existing.is_empty() {
        fragment.to_string()
    } else if fragment == existing {
        existing.to_string()
    } else if fragment.starts_with(existing) {
        // A few OpenAI-compatible providers emit cumulative values instead of
        // deltas. Replace the prefix rather than duplicating it.
        fragment.to_string()
    } else {
        format!("{existing}{fragment}")
    };
    *target = serde_json::Value::String(merged);
}

fn merge_stream_tool_calls(tool_calls: &mut Vec<serde_json::Value>, calls: &[serde_json::Value]) {
    for call in calls {
        let index = call["index"].as_u64().unwrap_or(0) as usize;
        while tool_calls.len() <= index {
            tool_calls.push(serde_json::json!({
                "id": "",
                "type": "function",
                "function": { "name": "", "arguments": "" }
            }));
        }
        let target = &mut tool_calls[index];
        if let Some(id) = call["id"].as_str() {
            merge_stream_fragment(&mut target["id"], id);
        }
        if let Some(kind) = call["type"].as_str() {
            target["type"] = serde_json::Value::String(kind.to_string());
        }
        if let Some(name) = call["function"]["name"].as_str() {
            // Function names are stream deltas too. Overwriting each fragment
            // leaves values such as `sh` (or the empty initializer) instead of
            // `bash`, causing every local tool to be rejected as unnamed.
            merge_stream_fragment(&mut target["function"]["name"], name);
        }
        if let Some(arguments) = call["function"]["arguments"].as_str() {
            merge_stream_fragment(&mut target["function"]["arguments"], arguments);
        } else if call["function"]["arguments"].is_object() {
            target["function"]["arguments"] =
                serde_json::Value::String(call["function"]["arguments"].to_string());
        }
    }
}

async fn provider_openai_chat_with_tools(
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<serde_json::Value>,
    tools: Vec<serde_json::Value>,
    tool_choice: String,
) -> Result<serde_json::Value, String> {
    let client = crate::http_client::client(
        "Qx/1.0 (g4f)",
        Duration::from_secs(60),
        Some(Duration::from_secs(10)),
    )
    .map_err(|e| format!("http client: {e}"))?;
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
    });
    if !tools.is_empty() {
        body["tools"] = serde_json::Value::Array(tools);
        body["tool_choice"] = serde_json::Value::String(tool_choice);
    }

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request to {url} failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("{url} returned HTTP {status}: {text}"));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("parse response from {url}: {e}"))?;

    json.get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .cloned()
        .ok_or_else(|| "no message in API response".to_string())
}

fn provider_openai_chat_with_tools_stream(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[serde_json::Value],
    tools: &[serde_json::Value],
    tool_choice: &str,
    reasoning: bool,
    mut on_delta: impl FnMut(&str, &str),
) -> Result<serde_json::Value, String> {
    let client = make_stream_client()?;
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });
    if !tools.is_empty() {
        body["tools"] = serde_json::Value::Array(tools.to_vec());
        if should_send_tool_choice(base_url, reasoning) {
            body["tool_choice"] = serde_json::Value::String(tool_choice.to_string());
        }
    }
    apply_reasoning_request(base_url, &mut body, reasoning);

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Accept", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send()
        .map_err(|e| format!("request to {url} failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().unwrap_or_default();
        return Err(format!("{url} returned HTTP {status}: {text}"));
    }

    let mut content = String::new();
    let mut reasoning_content = String::new();
    let mut reasoning_details = Vec::<serde_json::Value>::new();
    let mut tool_calls = Vec::<serde_json::Value>::new();
    let mut done = false;
    for_each_sse_line(resp, |line| {
        if done {
            return Ok(());
        }
        let Some(data) = sse_data(line) else {
            return Ok(());
        };
        if data == "[DONE]" {
            done = true;
            return Ok(());
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
            return Ok(());
        };
        let delta = &value["choices"][0]["delta"];
        if let Some(text) = delta["reasoning_content"]
            .as_str()
            .or_else(|| delta["reasoning"].as_str())
        {
            reasoning_content.push_str(text);
            on_delta("reasoning", text);
        }
        if let Some(details) = delta["reasoning_details"].as_array() {
            reasoning_details.extend(details.iter().cloned());
        }
        if let Some(text) = content_delta_text(&delta["content"]) {
            content.push_str(&text);
            on_delta("text", &text);
        }
        if let Some(calls) = delta["tool_calls"].as_array() {
            merge_stream_tool_calls(&mut tool_calls, calls);
        }
        Ok(())
    })?;

    let mut message = serde_json::json!({
        "role": "assistant",
        "content": if content.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::Value::String(content)
        },
    });
    if !tool_calls.is_empty() {
        message["tool_calls"] = serde_json::Value::Array(tool_calls);
    }
    if !reasoning_content.is_empty() {
        message["reasoning_content"] = serde_json::Value::String(reasoning_content);
    }
    if !reasoning_details.is_empty() {
        message["reasoning_details"] = serde_json::Value::Array(reasoning_details);
    }
    Ok(message)
}

/// Send a chat message to an AI provider and get a complete response.
#[tauri::command]
pub fn g4f_chat(
    provider: String,
    model: Option<String>,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let endpoint = provider_endpoint(&provider)?;
    let model = model.ok_or_else(|| format!("no model selected for {provider}"))?;
    provider_openai_chat(&endpoint.base_url, &endpoint.api_key, &model, &messages)
}

/// Send a chat message to an AI provider and return individual SSE chunks.
#[tauri::command]
pub fn g4f_stream_chat(
    provider: String,
    model: Option<String>,
    messages: Vec<ChatMessage>,
) -> Result<Vec<String>, String> {
    let endpoint = provider_endpoint(&provider)?;
    let model = model.ok_or_else(|| format!("no model selected for {provider}"))?;
    let mut chunks = Vec::new();
    provider_openai_chat_stream(
        &endpoint.base_url,
        &endpoint.api_key,
        &model,
        &messages,
        false,
        |kind, chunk| {
            if kind == "text" {
                chunks.push(chunk.to_string());
            }
        },
    )?;
    Ok(chunks)
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
    vec![
        ProviderInfo {
            id: OPENROUTER_ID.to_string(),
            name: "OpenRouter".to_string(),
            base_url: Some(OPENROUTER_BASE_URL.to_string()),
            requires_api_key: true,
            models: vec![ProviderModel {
                id: "openrouter/auto".to_string(),
                name: "Auto Router".to_string(),
                reasoning: true,
            }],
        },
        ProviderInfo {
            id: DEEPSEEK_ID.to_string(),
            name: "DeepSeek".to_string(),
            base_url: Some(DEEPSEEK_BASE_URL.to_string()),
            requires_api_key: true,
            models: vec![
                ProviderModel {
                    id: "deepseek-v4-flash".to_string(),
                    name: "DeepSeek V4 Flash".to_string(),
                    reasoning: true,
                },
                ProviderModel {
                    id: "deepseek-v4-pro".to_string(),
                    name: "DeepSeek V4 Pro".to_string(),
                    reasoning: true,
                },
            ],
        },
    ]
}

pub fn qxai_provider_catalog() -> Vec<ProviderInfo> {
    let mut providers = g4f_list_providers();
    providers.extend(
        qxai_get_custom_providers()
            .into_iter()
            .map(|provider| ProviderInfo {
                id: provider.id,
                name: provider.name,
                base_url: Some(provider.base_url.clone()),
                requires_api_key: true,
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

    let endpoint = provider_endpoint(&selection.provider)?;
    provider_openai_chat(
        &endpoint.base_url,
        &endpoint.api_key,
        &selection.model,
        &messages,
    )
}

fn prepare_qxai_chat_messages(
    messages: Vec<serde_json::Value>,
) -> Result<Vec<ChatMessage>, String> {
    crate::qx_ai_sessions::prepare_provider_messages(messages)?
        .into_iter()
        .map(|message| {
            serde_json::from_value(message)
                .map_err(|error| format!("invalid QxAI chat message: {error}"))
        })
        .collect()
}

/// OpenAI-style function calling for built-in and custom compatible providers.
/// Returns the raw `choices[0].message` JSON, including any `tool_calls`.
#[tauri::command]
pub async fn qxai_chat_with_tools(
    provider: Option<String>,
    model: Option<String>,
    messages: Vec<serde_json::Value>,
    tools: Vec<serde_json::Value>,
    tool_choice: Option<String>,
) -> Result<serde_json::Value, String> {
    let providers = qxai_provider_catalog();
    let selection = resolve_model_selection(&providers, provider, model)?;

    let endpoint = provider_endpoint(&selection.provider)?;

    let messages = crate::qx_ai_sessions::prepare_provider_messages(messages)?;
    let choice = tool_choice.unwrap_or_else(|| "auto".to_string());
    provider_openai_chat_with_tools(
        endpoint.base_url,
        endpoint.api_key,
        selection.model,
        messages,
        tools,
        choice,
    )
    .await
}

#[tauri::command]
pub fn qxai_stream_chat_with_tools_events(
    app: tauri::AppHandle,
    request_id: String,
    provider: Option<String>,
    model: Option<String>,
    messages: Vec<serde_json::Value>,
    tools: Vec<serde_json::Value>,
    tool_choice: Option<String>,
    reasoning: Option<bool>,
) -> Result<(), String> {
    if !crate::runtime::pool::try_spawn(move || {
        let stream_app = app.clone();
        let stream_request_id = request_id.clone();
        let emit_delta = |kind: &str, chunk: &str| {
            let _ = stream_app.emit(
                QXAI_STREAM_EVENT,
                QxaiStreamEvent {
                    request_id: stream_request_id.clone(),
                    kind: kind.to_string(),
                    chunk: chunk.to_string(),
                    done: false,
                    message: None,
                    error: None,
                },
            );
        };
        let result = (|| {
            let providers = qxai_provider_catalog();
            let selection = resolve_model_selection(&providers, provider, model)?;
            let endpoint = provider_endpoint(&selection.provider)?;
            let messages = crate::qx_ai_sessions::prepare_provider_messages(messages)?;
            provider_openai_chat_with_tools_stream(
                &endpoint.base_url,
                &endpoint.api_key,
                &selection.model,
                &messages,
                &tools,
                tool_choice.as_deref().unwrap_or("auto"),
                reasoning.unwrap_or(false),
                emit_delta,
            )
        })();
        let (message, error) = match result {
            Ok(message) => (Some(message), None),
            Err(error) => (None, Some(error)),
        };
        let _ = app.emit(
            QXAI_STREAM_EVENT,
            QxaiStreamEvent {
                request_id,
                kind: "done".to_string(),
                chunk: String::new(),
                done: true,
                message,
                error,
            },
        );
    }) {
        return Err("background worker pool is busy; retry the chat stream shortly".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn qxai_stream_chat(
    provider: Option<String>,
    model: Option<String>,
    messages: Vec<serde_json::Value>,
) -> Result<Vec<String>, String> {
    let providers = qxai_provider_catalog();
    let selection = resolve_model_selection(&providers, provider, model)?;

    g4f_stream_chat(
        selection.provider,
        Some(selection.model),
        prepare_qxai_chat_messages(messages)?,
    )
}

#[tauri::command]
pub fn qxai_stream_chat_events(
    app: tauri::AppHandle,
    request_id: String,
    provider: Option<String>,
    model: Option<String>,
    messages: Vec<serde_json::Value>,
    reasoning: Option<bool>,
) -> Result<(), String> {
    if !crate::runtime::pool::try_spawn(move || {
        let stream_app = app.clone();
        let stream_request_id = request_id.clone();
        let emit_chunk = |kind: &str, chunk: &str| {
            let _ = stream_app.emit(
                QXAI_STREAM_EVENT,
                QxaiStreamEvent {
                    request_id: stream_request_id.clone(),
                    kind: kind.to_string(),
                    chunk: chunk.to_string(),
                    done: false,
                    message: None,
                    error: None,
                },
            );
        };

        let work = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let providers = qxai_provider_catalog();
            let selection = resolve_model_selection(&providers, provider, model)?;

            let endpoint = provider_endpoint(&selection.provider)?;
            let messages = prepare_qxai_chat_messages(messages)?;
            provider_openai_chat_stream(
                &endpoint.base_url,
                &endpoint.api_key,
                &selection.model,
                &messages,
                reasoning.unwrap_or(false),
                emit_chunk,
            )
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
            QXAI_STREAM_EVENT,
            QxaiStreamEvent {
                request_id,
                kind: "done".to_string(),
                chunk,
                done: true,
                message: None,
                error,
            },
        );
    }) {
        return Err("background worker pool is busy; retry the chat stream shortly".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn qxai_list_providers() -> Vec<ProviderInfo> {
    tokio::task::spawn_blocking(move || qxai_provider_catalog())
        .await
        .unwrap_or_default()
}

#[tauri::command]
pub async fn qxai_fetch_models(
    base_url: String,
    api_key: String,
) -> Result<Vec<ProviderModel>, String> {
    tokio::task::spawn_blocking(move || openai_list_models(&base_url, &api_key))
        .await
        .map_err(|e| format!("Model fetch task panicked: {e}"))?
}

// ---------------------------------------------------------------------------
// Built-in provider credentials
// ---------------------------------------------------------------------------

fn built_in_provider_credentials_path() -> PathBuf {
    let dir = crate::paths::state_dir();
    let _ = std::fs::create_dir_all(&dir);
    dir.join("qxai-provider-credentials.json")
}

#[tauri::command]
pub fn qxai_get_builtin_provider_credentials() -> Vec<BuiltInProviderCredential> {
    let path = built_in_provider_credentials_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str::<Vec<BuiltInProviderCredential>>(&content)
            .unwrap_or_default()
            .into_iter()
            .filter(|credential| matches!(credential.id.as_str(), OPENROUTER_ID | DEEPSEEK_ID))
            .collect(),
        Err(_) => vec![],
    }
}

#[tauri::command]
pub fn qxai_save_builtin_provider_credentials(
    credentials: Vec<BuiltInProviderCredential>,
) -> Result<(), String> {
    let mut credentials = credentials
        .into_iter()
        .filter(|credential| matches!(credential.id.as_str(), OPENROUTER_ID | DEEPSEEK_ID))
        .collect::<Vec<_>>();
    credentials.sort_by(|a, b| a.id.cmp(&b.id));
    credentials.dedup_by(|a, b| a.id == b.id);

    let path = built_in_provider_credentials_path();
    let json = serde_json::to_string_pretty(&credentials).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, json).map_err(|e| format!("write {}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("secure {}: {e}", path.display()))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Custom provider persistence (BYOK)
// ---------------------------------------------------------------------------

fn custom_providers_path() -> PathBuf {
    let dir = crate::paths::state_dir();
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

#[cfg(test)]
mod tests {
    use super::{
        apply_reasoning_request, merge_stream_tool_calls, should_send_tool_choice, sse_data,
    };

    #[test]
    fn sse_data_accepts_standard_spacing_variants() {
        assert_eq!(sse_data("data: {\"ok\":true}"), Some("{\"ok\":true}"));
        assert_eq!(sse_data("data:{\"ok\":true}"), Some("{\"ok\":true}"));
        assert_eq!(sse_data("\u{feff}data: hi"), Some("hi"));
        assert_eq!(sse_data("  data: hi"), Some("hi"));
        assert_eq!(sse_data("event: message"), None);
    }

    #[test]
    fn decode_sse_line_recovers_gb18030_chinese() {
        // "你好" in GB18030.
        let bytes = [0xC4, 0xE3, 0xBA, 0xC3];
        let text = super::decode_sse_line(&bytes);
        assert_eq!(text, "你好");
    }

    #[test]
    fn content_delta_accepts_multipart_arrays() {
        let value = serde_json::json!([
            { "type": "text", "text": "你" },
            { "type": "text", "text": "好" }
        ]);
        assert_eq!(super::content_delta_text(&value).as_deref(), Some("你好"));
    }

    #[test]
    fn streamed_tool_call_arguments_are_reassembled_by_index() {
        let mut calls = Vec::new();
        merge_stream_tool_calls(
            &mut calls,
            &[serde_json::json!({
                "index": 0,
                "id": "call_bash",
                "type": "function",
                "function": { "name": "bash", "arguments": "{\"script\":\"p" }
            })],
        );
        merge_stream_tool_calls(
            &mut calls,
            &[serde_json::json!({
                "index": 0,
                "function": { "arguments": "wd\"}" }
            })],
        );
        assert_eq!(calls[0]["id"], "call_bash");
        assert_eq!(calls[0]["function"]["name"], "bash");
        assert_eq!(calls[0]["function"]["arguments"], "{\"script\":\"pwd\"}");
    }

    #[test]
    fn streamed_tool_call_name_and_id_fragments_are_reassembled() {
        let mut calls = Vec::new();
        merge_stream_tool_calls(
            &mut calls,
            &[serde_json::json!({
                "index": 0,
                "id": "call_",
                "type": "function",
                "function": { "name": "ba", "arguments": "{" }
            })],
        );
        merge_stream_tool_calls(
            &mut calls,
            &[serde_json::json!({
                "index": 0,
                "id": "bash",
                "function": { "name": "sh", "arguments": "}" }
            })],
        );
        assert_eq!(calls[0]["id"], "call_bash");
        assert_eq!(calls[0]["function"]["name"], "bash");
        assert_eq!(calls[0]["function"]["arguments"], "{}");
    }

    #[test]
    fn cumulative_stream_fragments_do_not_duplicate_tool_fields() {
        let mut calls = Vec::new();
        merge_stream_tool_calls(
            &mut calls,
            &[serde_json::json!({
                "index": 0,
                "id": "call_",
                "function": { "name": "ba", "arguments": "{\"script\":" }
            })],
        );
        merge_stream_tool_calls(
            &mut calls,
            &[serde_json::json!({
                "index": 0,
                "id": "call_bash",
                "function": { "name": "bash", "arguments": "{\"script\":\"pwd\"}" }
            })],
        );
        assert_eq!(calls[0]["id"], "call_bash");
        assert_eq!(calls[0]["function"]["name"], "bash");
        assert_eq!(calls[0]["function"]["arguments"], "{\"script\":\"pwd\"}");
    }

    #[test]
    fn object_tool_arguments_are_normalized_to_json_text() {
        let mut calls = Vec::new();
        merge_stream_tool_calls(
            &mut calls,
            &[serde_json::json!({
                "index": 0,
                "id": "call_bash",
                "function": { "name": "bash", "arguments": { "script": "pwd" } }
            })],
        );
        assert_eq!(calls[0]["function"]["arguments"], "{\"script\":\"pwd\"}");
    }

    #[test]
    fn deepseek_reasoning_state_and_tool_choice_are_compatible() {
        let mut enabled = serde_json::json!({});
        apply_reasoning_request("https://api.deepseek.com", &mut enabled, true);
        assert_eq!(enabled["thinking"]["type"], "enabled");
        assert!(!should_send_tool_choice("https://api.deepseek.com", true));

        let mut disabled = serde_json::json!({});
        apply_reasoning_request("https://api.deepseek.com", &mut disabled, false);
        assert_eq!(disabled["thinking"]["type"], "disabled");
        assert!(should_send_tool_choice("https://api.deepseek.com", false));
    }
}
