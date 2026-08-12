//! User-managed MCP server configuration for QxAI.
//!
//! Config is a plain JSON file under the Qx state directory so users and the
//! agent can audit and edit it. Full MCP stdio transport remains additive —
//! this module owns durable config I/O and discovery only.

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::command;

const MAX_MCP_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QxAiMcpServer {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub notes: String,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QxAiMcpConfig {
    #[serde(default)]
    pub servers: Vec<QxAiMcpServer>,
}

fn mcp_path() -> PathBuf {
    crate::paths::state_dir().join("mcp.json")
}

fn ensure_mcp_file() -> Result<PathBuf, String> {
    let path = mcp_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create mcp parent: {e}"))?;
    }
    if !path.exists() {
        let empty = serde_json::to_string_pretty(&QxAiMcpConfig::default())
            .map_err(|e| format!("serialize default mcp config: {e}"))?;
        fs::write(&path, empty).map_err(|e| format!("write default mcp config: {e}"))?;
    }
    Ok(path)
}

fn read_config() -> Result<(PathBuf, QxAiMcpConfig, String), String> {
    let path = ensure_mcp_file()?;
    let metadata = fs::metadata(&path).map_err(|e| format!("inspect mcp config: {e}"))?;
    if metadata.len() > MAX_MCP_BYTES {
        return Err(format!(
            "mcp config exceeds the {} KiB limit",
            MAX_MCP_BYTES / 1024
        ));
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read mcp config: {e}"))?;
    let config: QxAiMcpConfig = if raw.trim().is_empty() {
        QxAiMcpConfig::default()
    } else {
        serde_json::from_str(&raw).map_err(|e| format!("parse mcp config: {e}"))?
    };
    Ok((path, config, raw))
}

#[command]
pub async fn qxai_mcp_config_path() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        ensure_mcp_file().map(|path| path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("mcp path task failed: {e}"))?
}

#[command]
pub async fn qxai_read_mcp_config() -> Result<QxAiMcpConfig, String> {
    tauri::async_runtime::spawn_blocking(|| read_config().map(|(_, config, _)| config))
        .await
        .map_err(|e| format!("read mcp task failed: {e}"))?
}

#[command]
pub async fn qxai_write_mcp_config(config: QxAiMcpConfig) -> Result<QxAiMcpConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = ensure_mcp_file()?;
        for server in &config.servers {
            if server.id.trim().is_empty() {
                return Err("each MCP server needs a non-empty id".to_string());
            }
        }
        let raw = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("serialize mcp config: {e}"))?;
        if raw.as_bytes().len() as u64 > MAX_MCP_BYTES {
            return Err(format!(
                "mcp config exceeds the {} KiB limit",
                MAX_MCP_BYTES / 1024
            ));
        }
        fs::write(&path, raw).map_err(|e| format!("write mcp config: {e}"))?;
        Ok(config)
    })
    .await
    .map_err(|e| format!("write mcp task failed: {e}"))?
}

#[command]
pub async fn qxai_write_mcp_config_raw(content: String) -> Result<QxAiMcpConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = ensure_mcp_file()?;
        if content.as_bytes().len() as u64 > MAX_MCP_BYTES {
            return Err(format!(
                "mcp config exceeds the {} KiB limit",
                MAX_MCP_BYTES / 1024
            ));
        }
        let config: QxAiMcpConfig =
            serde_json::from_str(&content).map_err(|e| format!("parse mcp config: {e}"))?;
        let pretty = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("serialize mcp config: {e}"))?;
        fs::write(&path, pretty).map_err(|e| format!("write mcp config: {e}"))?;
        Ok(config)
    })
    .await
    .map_err(|e| format!("write mcp raw task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::{QxAiMcpConfig, QxAiMcpServer};

    #[test]
    fn round_trips_server_list() {
        let config = QxAiMcpConfig {
            servers: vec![QxAiMcpServer {
                id: "fs".into(),
                name: "Filesystem".into(),
                command: "npx".into(),
                args: vec![
                    "-y".into(),
                    "@modelcontextprotocol/server-filesystem".into(),
                ],
                env: vec![],
                enabled: true,
                notes: String::new(),
            }],
        };
        let raw = serde_json::to_string(&config).unwrap();
        let parsed: QxAiMcpConfig = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed.servers.len(), 1);
        assert_eq!(parsed.servers[0].id, "fs");
    }
}
