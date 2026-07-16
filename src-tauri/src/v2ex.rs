//! V2EX HTTP client used by the built-in panel **and** the marketplace plugin
//! (`invoke:v2ex_*`). Responses are cached in memory + on disk so reopen / plugin
//! panels paint instantly and only revalidate in the background TTL window.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Serialize, Clone)]
pub struct V2exTopic {
    pub id: u64,
    pub title: String,
    pub url: String,
    pub node: String,
    pub author: String,
    pub replies: u32,
    pub created: i64,
    pub content: String,
    pub last_modified: i64,
}

#[derive(Debug, Serialize, Clone)]
pub struct V2exNode {
    pub id: u64,
    pub name: String,
    pub title: String,
    pub topics: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct V2exReply {
    pub id: u64,
    pub content: String,
    pub author: String,
    pub created: i64,
    pub floor: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct V2exTokenInfo {
    pub scope: String,
    pub created: i64,
    pub expiration: i64,
    pub good_for_days: u32,
    pub last_used: i64,
    pub total_used: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct V2exNotification {
    pub id: u64,
    pub text: String,
    pub member: String,
    pub created: i64,
}

const TTL_TOPICS_SECS: u64 = 180;
const TTL_REPLIES_SECS: u64 = 120;
const TTL_AUTH_SECS: u64 = 60;
/// Soft cache: serve stale for this long while a refresh is allowed to fail.
const STALE_GRACE_SECS: u64 = 3600;

struct CacheEntry {
    body: String,
    /// Unix seconds when written.
    written_at: u64,
}

fn memory_cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cache_dir() -> PathBuf {
    let dir = crate::paths::cache_dir().join("v2ex");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn cache_file_key(key: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    key.hash(&mut hasher);
    format!("{:016x}.json", hasher.finish())
}

fn disk_read(key: &str) -> Option<CacheEntry> {
    let path = cache_dir().join(cache_file_key(key));
    let raw = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let body = value.get("body")?.as_str()?.to_string();
    let written_at = value.get("written_at")?.as_u64()?;
    Some(CacheEntry { body, written_at })
}

fn disk_write(key: &str, entry: &CacheEntry) {
    let path = cache_dir().join(cache_file_key(key));
    let payload = serde_json::json!({
        "body": entry.body,
        "written_at": entry.written_at,
    });
    let _ = std::fs::write(path, payload.to_string());
}

fn cache_get(key: &str, ttl_secs: u64) -> Option<String> {
    let now = now_secs();
    if let Ok(guard) = memory_cache().lock() {
        if let Some(entry) = guard.get(key) {
            if now.saturating_sub(entry.written_at) <= ttl_secs {
                return Some(entry.body.clone());
            }
        }
    }
    let entry = disk_read(key)?;
    if now.saturating_sub(entry.written_at) <= ttl_secs {
        if let Ok(mut guard) = memory_cache().lock() {
            guard.insert(key.to_string(), CacheEntry {
                body: entry.body.clone(),
                written_at: entry.written_at,
            });
        }
        return Some(entry.body);
    }
    None
}

/// Return body even if TTL expired, as long as within grace window.
fn cache_get_stale(key: &str) -> Option<String> {
    let now = now_secs();
    let max_age = TTL_TOPICS_SECS.max(TTL_AUTH_SECS) + STALE_GRACE_SECS;
    if let Ok(guard) = memory_cache().lock() {
        if let Some(entry) = guard.get(key) {
            if now.saturating_sub(entry.written_at) <= max_age {
                return Some(entry.body.clone());
            }
        }
    }
    let entry = disk_read(key)?;
    if now.saturating_sub(entry.written_at) <= max_age {
        Some(entry.body)
    } else {
        None
    }
}

fn cache_set(key: &str, body: String) {
    let entry = CacheEntry {
        body,
        written_at: now_secs(),
    };
    disk_write(key, &entry);
    if let Ok(mut guard) = memory_cache().lock() {
        guard.insert(key.to_string(), entry);
    }
}

fn v2ex_settings() -> crate::settings::V2exSettings {
    crate::settings::read_settings().v2ex
}

fn resolve_token(token_override: Option<&str>) -> String {
    token_override
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| v2ex_settings().token.trim().to_string())
}

fn v2ex_get(endpoint: &str) -> Result<String, String> {
    let cache_key = format!("get:{endpoint}");
    if let Some(hit) = cache_get(&cache_key, TTL_TOPICS_SECS) {
        return Ok(hit);
    }

    let client = crate::http_client::blocking_client(
        "Qx/0.2 (V2EX Plugin; +https://github.com/mcxen/qx)",
        Duration::from_secs(10),
        Some(Duration::from_secs(5)),
    )
    .map_err(|e| format!("HTTP client: {e}"))?;

    let url = format!("https://www.v2ex.com{endpoint}");
    let result = (|| {
        let resp = client
            .get(&url)
            .send()
            .map_err(|e| format!("HTTP request: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("V2EX API error: HTTP {}", resp.status()));
        }
        resp.text().map_err(|e| format!("Read response: {e}"))
    })();

    match result {
        Ok(body) => {
            cache_set(&cache_key, body.clone());
            Ok(body)
        }
        Err(err) => {
            if let Some(stale) = cache_get_stale(&cache_key) {
                Ok(stale)
            } else {
                Err(err)
            }
        }
    }
}

fn v2ex_get_authed(endpoint: &str, token_override: Option<&str>) -> Result<String, String> {
    let token = resolve_token(token_override);
    if token.is_empty() {
        return Err(
            "V2EX token not set. Create one at https://v2ex.com/settings/tokens and configure it in the V2EX plugin preferences (or Settings → V2EX)."
                .to_string(),
        );
    }

    let cache_key = format!("auth:{}:{endpoint}", {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        token.hash(&mut h);
        h.finish()
    });
    if let Some(hit) = cache_get(&cache_key, TTL_AUTH_SECS) {
        return Ok(hit);
    }

    let client = crate::http_client::blocking_client(
        "Qx/0.2 (V2EX Plugin; +https://github.com/mcxen/qx)",
        Duration::from_secs(10),
        Some(Duration::from_secs(5)),
    )
    .map_err(|e| format!("HTTP client: {e}"))?;

    let url = format!("https://www.v2ex.com{endpoint}");
    let result = (|| {
        let resp = client
            .get(&url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .map_err(|e| format!("HTTP request: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("V2EX API v2 error: HTTP {}", resp.status()));
        }
        resp.text().map_err(|e| format!("Read response: {e}"))
    })();

    match result {
        Ok(body) => {
            cache_set(&cache_key, body.clone());
            Ok(body)
        }
        Err(err) => {
            if let Some(stale) = cache_get_stale(&cache_key) {
                Ok(stale)
            } else {
                Err(err)
            }
        }
    }
}

fn parse_topics_legacy(json: &str) -> Result<Vec<V2exTopic>, String> {
    let arr: Vec<serde_json::Value> =
        serde_json::from_str(json).map_err(|e| format!("Parse JSON: {e}"))?;

    let topics = arr
        .into_iter()
        .filter_map(|v| {
            let id = v.get("id")?.as_u64()?;
            let title = v.get("title")?.as_str()?.to_string();
            let node = v
                .get("node")
                .and_then(|n| n.get("title"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            let author = v
                .get("member")
                .and_then(|m| m.get("username"))
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string();
            let replies = v.get("replies").and_then(|r| r.as_u64()).unwrap_or(0) as u32;
            let created = v.get("created").and_then(|c| c.as_i64()).unwrap_or(0);
            let last_modified = v.get("last_modified").and_then(|c| c.as_i64()).unwrap_or(0);
            let content = v
                .get("content_rendered")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();

            Some(V2exTopic {
                id,
                title,
                url: format!("https://www.v2ex.com/t/{id}"),
                node,
                author,
                replies,
                created,
                content,
                last_modified,
            })
        })
        .collect();

    Ok(topics)
}

fn parse_v2_topics(json: &str) -> Result<Vec<V2exTopic>, String> {
    let resp: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("Parse JSON: {e}"))?;

    let result = resp
        .get("result")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Missing result array in v2 response".to_string())?;

    Ok(result
        .iter()
        .filter_map(|v| {
            let id = v.get("id")?.as_u64()?;
            let title = v.get("title")?.as_str()?.to_string();
            let node = v
                .get("node")
                .and_then(|n| n.get("title"))
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            let author = v
                .get("member")
                .and_then(|m| m.get("username"))
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string();
            let replies = v.get("replies").and_then(|r| r.as_u64()).unwrap_or(0) as u32;
            let created = v.get("created").and_then(|c| c.as_i64()).unwrap_or(0);
            let last_modified = v.get("last_modified").and_then(|c| c.as_i64()).unwrap_or(0);
            let content = v
                .get("content_rendered")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();

            Some(V2exTopic {
                id,
                title,
                url: format!("https://www.v2ex.com/t/{id}"),
                node,
                author,
                replies,
                created,
                content,
                last_modified,
            })
        })
        .collect())
}

fn v2ex_fetch_topics_sync(mode: Option<String>) -> Result<Vec<V2exTopic>, String> {
    let mode = mode.unwrap_or_else(|| "latest".to_string());
    let endpoint = match mode.as_str() {
        "hot" => "/api/topics/hot.json",
        _ => "/api/topics/latest.json",
    };
    let json = v2ex_get(endpoint)?;
    parse_topics_legacy(&json)
}

/// Public (no token) replies — used when the plugin has no token.
fn parse_replies_legacy(json: &str) -> Result<Vec<V2exReply>, String> {
    let arr: Vec<serde_json::Value> =
        serde_json::from_str(json).map_err(|e| format!("Parse JSON: {e}"))?;
    Ok(arr
        .into_iter()
        .enumerate()
        .filter_map(|(index, v)| {
            let id = v.get("id")?.as_u64()?;
            let content = v
                .get("content_rendered")
                .or_else(|| v.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            let author = v
                .get("member")
                .and_then(|m| m.get("username"))
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string();
            let created = v.get("created").and_then(|c| c.as_i64()).unwrap_or(0);
            Some(V2exReply {
                id,
                content,
                author,
                created,
                floor: (index as u32).saturating_add(1),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn v2ex_fetch_topics(mode: Option<String>) -> Result<Vec<V2exTopic>, String> {
    tokio::task::spawn_blocking(move || v2ex_fetch_topics_sync(mode))
        .await
        .map_err(|e| format!("V2EX fetch topics panicked: {e}"))?
}

#[tauri::command]
pub async fn v2ex_search_topics(query: String) -> Result<Vec<V2exTopic>, String> {
    tokio::task::spawn_blocking(move || {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return v2ex_fetch_topics_sync(Some("latest".to_string()));
        }

        let mut topics = Vec::new();
        for mode in ["latest", "hot"] {
            topics.extend(v2ex_fetch_topics_sync(Some(mode.to_string()))?);
        }

        topics.sort_by_key(|topic| std::cmp::Reverse(topic.last_modified.max(topic.created)));
        topics.dedup_by_key(|topic| topic.id);

        Ok(topics
            .into_iter()
            .filter(|topic| {
                topic.title.to_lowercase().contains(&needle)
                    || topic.node.to_lowercase().contains(&needle)
                    || topic.author.to_lowercase().contains(&needle)
                    || topic.content.to_lowercase().contains(&needle)
            })
            .collect())
    })
    .await
    .map_err(|e| format!("V2EX search panicked: {e}"))?
}

#[tauri::command]
pub async fn v2ex_fetch_node_topics(
    node: String,
    token: Option<String>,
) -> Result<Vec<V2exTopic>, String> {
    tokio::task::spawn_blocking(move || {
        let node = node.trim();
        if node.is_empty() {
            return Err("Node name is empty".to_string());
        }
        let json = v2ex_get_authed(
            &format!("/api/v2/nodes/{node}/topics"),
            token.as_deref(),
        )?;
        parse_v2_topics(&json)
    })
    .await
    .map_err(|e| format!("V2EX node topics panicked: {e}"))?
}

#[tauri::command]
pub async fn v2ex_fetch_topic_replies(
    topic_id: u64,
    token: Option<String>,
) -> Result<Vec<V2exReply>, String> {
    tokio::task::spawn_blocking(move || {
        let cache_key = format!("replies:{topic_id}");
        if let Some(hit) = cache_get(&cache_key, TTL_REPLIES_SECS) {
            if let Ok(parsed) = serde_json::from_str::<Vec<V2exReply>>(&hit) {
                return Ok(parsed);
            }
        }

        // Prefer public legacy API (no token). Fall back to v2 authed.
        let replies = match v2ex_get(&format!("/api/replies/show.json?topic_id={topic_id}")) {
            Ok(json) => parse_replies_legacy(&json)?,
            Err(_) => {
                let json = v2ex_get_authed(
                    &format!("/api/v2/topics/{topic_id}/replies"),
                    token.as_deref(),
                )?;
                let resp: serde_json::Value =
                    serde_json::from_str(&json).map_err(|e| format!("Parse JSON: {e}"))?;
                let result = resp
                    .get("result")
                    .and_then(|v| v.as_array())
                    .ok_or_else(|| "Missing result array in v2 response".to_string())?;
                result
                    .iter()
                    .filter_map(|v| {
                        let id = v.get("id")?.as_u64()?;
                        let content = v
                            .get("content_rendered")
                            .and_then(|c| c.as_str())
                            .unwrap_or("")
                            .to_string();
                        let author = v
                            .get("member")
                            .and_then(|m| m.get("username"))
                            .and_then(|u| u.as_str())
                            .unwrap_or("")
                            .to_string();
                        let created = v.get("created").and_then(|c| c.as_i64()).unwrap_or(0);
                        let floor = v.get("no").and_then(|n| n.as_u64()).unwrap_or(0) as u32;
                        Some(V2exReply {
                            id,
                            content,
                            author,
                            created,
                            floor,
                        })
                    })
                    .collect()
            }
        };

        if let Ok(serialized) = serde_json::to_string(&replies) {
            cache_set(&cache_key, serialized);
        }
        Ok(replies)
    })
    .await
    .map_err(|e| format!("V2EX replies panicked: {e}"))?
}

#[tauri::command]
pub fn v2ex_fetch_token_info(token: Option<String>) -> Result<V2exTokenInfo, String> {
    let json = v2ex_get_authed("/api/v2/token", token.as_deref())?;
    let resp: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("Parse JSON: {e}"))?;

    let result = resp
        .get("result")
        .ok_or_else(|| "Missing result in v2 response".to_string())?;

    Ok(V2exTokenInfo {
        scope: result
            .get("scope")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        created: result.get("created").and_then(|v| v.as_i64()).unwrap_or(0),
        expiration: result
            .get("expiration")
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        good_for_days: result
            .get("good_for_days")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
        last_used: result
            .get("last_used")
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        total_used: result
            .get("total_used")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32,
    })
}

#[tauri::command]
pub fn v2ex_fetch_notifications(token: Option<String>) -> Result<Vec<V2exNotification>, String> {
    let json = v2ex_get_authed("/api/v2/notifications", token.as_deref())?;
    let resp: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("Parse JSON: {e}"))?;

    let result = resp
        .get("result")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Missing result array in v2 response".to_string())?;

    let notifications = result
        .iter()
        .filter_map(|v| {
            let id = v.get("id")?.as_u64()?;
            let text = v
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string();
            let member = v
                .get("member")
                .and_then(|m| m.get("username"))
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string();
            let created = v.get("created").and_then(|c| c.as_i64()).unwrap_or(0);

            Some(V2exNotification {
                id,
                text,
                member,
                created,
            })
        })
        .collect();

    Ok(notifications)
}
