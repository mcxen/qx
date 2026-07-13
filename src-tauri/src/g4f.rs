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
        |chunk| chunks.push(chunk.to_string()),
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
                },
                ProviderModel {
                    id: "deepseek-v4-pro".to_string(),
                    name: "DeepSeek V4 Pro".to_string(),
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
pub fn qxai_stream_chat(
    provider: Option<String>,
    model: Option<String>,
    messages: Vec<ChatMessage>,
) -> Result<Vec<String>, String> {
    let providers = qxai_provider_catalog();
    let selection = resolve_model_selection(&providers, provider, model)?;

    g4f_stream_chat(selection.provider, Some(selection.model), messages)
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

            let endpoint = provider_endpoint(&selection.provider)?;
            provider_openai_chat_stream(
                &endpoint.base_url,
                &endpoint.api_key,
                &selection.model,
                &messages,
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
