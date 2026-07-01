use serde::Serialize;

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

#[derive(Debug, Serialize, Clone)]
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

fn v2ex_settings() -> crate::settings::V2exSettings {
    crate::settings::read_settings().v2ex
}

fn v2ex_get(endpoint: &str) -> Result<String, String> {
    let client = crate::http_client::blocking_client(
        "Qx/0.2 (V2EX Plugin; +https://github.com/mcxen/qx)",
        std::time::Duration::from_secs(10),
        Some(std::time::Duration::from_secs(5)),
    )
    .map_err(|e| format!("HTTP client: {e}"))?;

    let url = format!("https://www.v2ex.com{}", endpoint);
    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("HTTP request: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("V2EX API error: HTTP {}", resp.status()));
    }

    resp.text().map_err(|e| format!("Read response: {e}"))
}

fn v2ex_get_authed(endpoint: &str) -> Result<String, String> {
    let s = v2ex_settings();
    if s.token.trim().is_empty() {
        return Err("V2EX token not set. Please go to https://v2ex.com/settings/tokens to obtain a token and configure it in Settings > V2EX.".to_string());
    }

    let client = crate::http_client::blocking_client(
        "Qx/0.2 (V2EX Plugin; +https://github.com/mcxen/qx)",
        std::time::Duration::from_secs(10),
        Some(std::time::Duration::from_secs(5)),
    )
    .map_err(|e| format!("HTTP client: {e}"))?;

    let url = format!("https://www.v2ex.com{}", endpoint);
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", s.token))
        .send()
        .map_err(|e| format!("HTTP request: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("V2EX API v2 error: HTTP {}", resp.status()));
    }

    resp.text().map_err(|e| format!("Read response: {e}"))
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
                url: format!("https://www.v2ex.com/t/{}", id),
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

#[tauri::command]
pub fn v2ex_fetch_topics(mode: Option<String>) -> Result<Vec<V2exTopic>, String> {
    let mode = mode.unwrap_or_else(|| "latest".to_string());
    let endpoint = match mode.as_str() {
        "hot" => "/api/topics/hot.json",
        _ => "/api/topics/latest.json",
    };

    let json = v2ex_get(endpoint)?;
    parse_topics_legacy(&json)
}

#[tauri::command]
pub fn v2ex_search_topics(query: String) -> Result<Vec<V2exTopic>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return v2ex_fetch_topics(Some("latest".to_string()));
    }

    let mut topics = Vec::new();
    for mode in ["latest", "hot"] {
        topics.extend(v2ex_fetch_topics(Some(mode.to_string()))?);
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
}

#[tauri::command]
pub fn v2ex_fetch_node_topics(node: String) -> Result<Vec<V2exTopic>, String> {
    let node = node.trim();
    if node.is_empty() {
        return Err("Node name is empty".to_string());
    }

    let json = v2ex_get_authed(&format!("/api/v2/nodes/{}/topics", node))?;
    let resp: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("Parse JSON: {e}"))?;

    let result = resp
        .get("result")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Missing result array in v2 response".to_string())?;

    let topics = result
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
                url: format!("https://www.v2ex.com/t/{}", id),
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

#[tauri::command]
pub fn v2ex_fetch_topic_replies(topic_id: u64) -> Result<Vec<V2exReply>, String> {
    let json = v2ex_get_authed(&format!("/api/v2/topics/{}/replies", topic_id))?;
    let resp: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("Parse JSON: {e}"))?;

    let result = resp
        .get("result")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Missing result array in v2 response".to_string())?;

    let replies = result
        .into_iter()
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
        .collect();

    Ok(replies)
}

#[tauri::command]
pub fn v2ex_fetch_token_info() -> Result<V2exTokenInfo, String> {
    let json = v2ex_get_authed("/api/v2/token")?;
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
pub fn v2ex_fetch_notifications() -> Result<Vec<V2exNotification>, String> {
    let json = v2ex_get_authed("/api/v2/notifications")?;
    let resp: serde_json::Value =
        serde_json::from_str(&json).map_err(|e| format!("Parse JSON: {e}"))?;

    let result = resp
        .get("result")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Missing result array in v2 response".to_string())?;

    let notifications = result
        .into_iter()
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
