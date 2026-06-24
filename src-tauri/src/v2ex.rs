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

fn v2ex_get(endpoint: &str) -> Result<String, String> {
    let client = crate::http_client::blocking_client(
        "Qx/0.2 (V2EX Plugin; +https://github.com/mcxen/qx)",
        std::time::Duration::from_secs(10),
        None,
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
    let client = crate::http_client::blocking_client(
        "Qx/0.2 (V2EX Plugin; +https://github.com/mcxen/qx)",
        std::time::Duration::from_secs(10),
        None,
    )
    .map_err(|e| format!("HTTP client: {e}"))?;

    let url = format!(
        "https://www.v2ex.com/api/topics/search.json?q={}",
        urlencoding(&query)
    );
    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("HTTP request: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("V2EX search error: HTTP {}", resp.status()));
    }

    let text = resp.text().map_err(|e| format!("Read response: {e}"))?;
    parse_topics_legacy(&text)
}

fn urlencoding(s: &str) -> String {
    let mut out = String::new();
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char);
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}
