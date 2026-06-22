use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use tauri::command;

const INDEX_URL: &str = "https://raw.githubusercontent.com/mcxen/qx-plugins/main/index.json";
const USER_AGENT: &str = "Qx/0.1 (Marketplace; +https://github.com/mcxen/qx)";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginIndexEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub download_url: String,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub checksum_sha256: String,
    #[serde(default)]
    pub required_permissions: Vec<String>,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub min_app_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginIndex {
    pub schema_version: u32,
    pub plugins: Vec<PluginIndexEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub path: String,
    pub enabled: bool,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub min_app_version: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub entry: String,
    #[serde(default)]
    pub shortcuts: std::collections::BTreeMap<String, String>,
}

fn plugins_root() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/.qx/plugins", home));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn http_get(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
    let resp = client
        .get(url)
        .send()
        .map_err(|e| format!("http request: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("http status {}", resp.status()));
    }
    resp.bytes()
        .map(|b| b.to_vec())
        .map_err(|e| format!("read body: {e}"))
}

#[command]
pub fn fetch_plugin_index() -> Result<PluginIndex, String> {
    let bytes = http_get(INDEX_URL)?;
    serde_json::from_slice::<PluginIndex>(&bytes).map_err(|e| format!("parse index: {e}"))
}

#[command]
pub fn download_plugin(url: String) -> Result<String, String> {
    let bytes = http_get(&url)?;
    let tmp = std::env::temp_dir().join(format!("qx-plugin-{}.qx", uuid_like()));
    let mut f = fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
    f.write_all(&bytes).map_err(|e| format!("write tmp: {e}"))?;
    Ok(tmp.to_string_lossy().to_string())
}

fn uuid_like() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{now:x}")
}

#[command]
pub fn install_plugin(path: String) -> Result<InstalledPlugin, String> {
    let pkg = Path::new(&path);
    if !pkg.exists() {
        return Err(format!("plugin package not found: {path}"));
    }
    let mut f = fs::File::open(pkg).map_err(|e| format!("open package: {e}"))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)
        .map_err(|e| format!("read package: {e}"))?;

    let mut archive =
        zip::ZipArchive::new(Cursor::new(&buf)).map_err(|e| format!("open zip: {e}"))?;

    let mut manifest_name = None;
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| format!("entry {i}: {e}"))?;
        if entry.name().ends_with("manifest.json") && !entry.is_dir() {
            manifest_name = Some(entry.name().to_string());
            break;
        }
    }
    let manifest_name =
        manifest_name.ok_or_else(|| "manifest.json not found in package".to_string())?;

    let mut archive =
        zip::ZipArchive::new(Cursor::new(&buf)).map_err(|e| format!("reopen zip: {e}"))?;
    let mut manifest_bytes = Vec::new();
    {
        let mut mf = archive
            .by_name(&manifest_name)
            .map_err(|e| format!("read manifest: {e}"))?;
        mf.read_to_end(&mut manifest_bytes)
            .map_err(|e| format!("read manifest body: {e}"))?;
    }
    let manifest: PluginManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|e| format!("parse manifest: {e}"))?;

    if manifest.id.trim().is_empty() {
        return Err("manifest.id is empty".to_string());
    }

    let dest = plugins_root().join(&manifest.id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("clear existing: {e}"))?;
    }
    fs::create_dir_all(&dest).map_err(|e| format!("create plugin dir: {e}"))?;

    let mut archive =
        zip::ZipArchive::new(Cursor::new(&buf)).map_err(|e| format!("reopen zip: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("entry {i}: {e}"))?;
        let entry_name = entry.name().to_string();
        if entry.is_dir() {
            let out = dest.join(&entry_name);
            fs::create_dir_all(&out).ok();
            continue;
        }
        let rel = strip_top_level(&entry_name);
        let out = dest.join(rel);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).ok();
        }
        let mut body = Vec::new();
        entry
            .read_to_end(&mut body)
            .map_err(|e| format!("read entry body: {e}"))?;
        fs::write(&out, &body).map_err(|e| format!("write {}: {e}", out.display()))?;
    }

    let _ = fs::remove_file(pkg);

    Ok(InstalledPlugin {
        id: manifest.id.clone(),
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        path: dest.to_string_lossy().to_string(),
        enabled: true,
        permissions: manifest.permissions,
        author: manifest.author,
    })
}

fn strip_top_level(name: &str) -> String {
    let normalized = name.replace('\\', "/");
    if let Some(idx) = normalized.find('/') {
        normalized[idx + 1..].to_string()
    } else {
        normalized
    }
}

#[command]
pub fn uninstall_plugin(id: String) -> Result<(), String> {
    let dir = plugins_root().join(&id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| format!("remove plugin dir: {e}"))?;
    }
    Ok(())
}

#[command]
pub fn list_installed_plugins() -> Result<Vec<InstalledPlugin>, String> {
    let root = plugins_root();
    let mut out = Vec::new();
    let entries = match fs::read_dir(&root) {
        Ok(e) => e,
        Err(_) => return Ok(out),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        let manifest = match fs::read_to_string(&manifest_path) {
            Ok(content) => serde_json::from_str::<PluginManifest>(&content).ok(),
            Err(_) => None,
        };
        let id = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if let Some(m) = manifest {
            out.push(InstalledPlugin {
                id: m.id,
                name: m.name,
                version: m.version,
                description: m.description,
                path: path.to_string_lossy().to_string(),
                enabled: true,
                permissions: m.permissions,
                author: m.author,
            });
        } else {
            out.push(InstalledPlugin {
                id: id.clone(),
                name: id.clone(),
                version: "0.0.0".to_string(),
                description: String::new(),
                path: path.to_string_lossy().to_string(),
                enabled: false,
                permissions: Vec::new(),
                author: String::new(),
            });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}
