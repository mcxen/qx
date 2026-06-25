use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::command;

const INDEX_URL: &str = "https://raw.githubusercontent.com/mcxen/qx-plugins/main/index.json";
const USER_AGENT: &str = "Qx/0.1 (Marketplace; +https://github.com/mcxen/qx)";
static PLUGIN_STORAGE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginCommand {
    pub name: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginPanel {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub keywords: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginPreference {
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub pref_type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub options: Vec<serde_json::Value>,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub preferences: Vec<PluginPreference>,
    #[serde(default)]
    pub commands: Vec<PluginCommand>,
    #[serde(default)]
    pub panel: Option<PluginPanel>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub min_app_version: String,
    #[serde(default = "default_entry")]
    pub entry: String,
    #[serde(default)]
    pub signature: String,
    #[serde(default)]
    pub pubkey: String,
}

fn default_entry() -> String {
    "index.js".to_string()
}

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
    #[serde(default)]
    pub manifest: Option<PluginManifest>,
}

#[derive(Debug)]
struct RaycastSource {
    owner: String,
    repo: String,
    reference: String,
    extension_path: String,
}

fn plugins_root() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = PathBuf::from(format!("{}/.qx/plugins", home));
    let _ = fs::create_dir_all(&dir);
    dir
}

fn plugin_dir(id: &str) -> PathBuf {
    plugins_root().join(id)
}

fn plugin_data_dir(id: &str) -> PathBuf {
    plugin_dir(id).join("data")
}

fn plugin_storage_path(id: &str) -> PathBuf {
    plugin_data_dir(id).join("storage.json")
}

fn plugin_storage_lock() -> &'static Mutex<()> {
    PLUGIN_STORAGE_LOCK.get_or_init(|| Mutex::new(()))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = path.with_extension(format!("tmp.{}", std::process::id()));
    {
        let mut file = fs::File::create(&tmp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp_path, path)?;
    if let Some(parent) = path.parent() {
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
    }
    Ok(())
}

fn plugin_enabled_path(id: &str) -> PathBuf {
    plugin_dir(id).join(".enabled")
}

fn is_plugin_enabled(id: &str) -> bool {
    plugin_enabled_path(id).exists()
}

fn set_plugin_enabled_fs(id: &str, enabled: bool) -> Result<(), String> {
    let path = plugin_enabled_path(id);
    if enabled {
        atomic_write(&path, b"true").map_err(|e| format!("write enabled flag: {e}"))?;
    } else if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("remove enabled flag: {e}"))?;
    }
    Ok(())
}

fn read_manifest(dir: &Path) -> Option<PluginManifest> {
    let content = fs::read_to_string(dir.join("manifest.json")).ok()?;
    serde_json::from_str::<PluginManifest>(&content).ok()
}

async fn http_get(url: &str) -> Result<Vec<u8>, String> {
    let client = crate::http_client::client(USER_AGENT, std::time::Duration::from_secs(30), None)?;
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("http request: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("http status {}", resp.status()));
    }
    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("read body: {e}"))
}

#[command]
pub async fn fetch_plugin_index() -> Result<PluginIndex, String> {
    let bytes = http_get(INDEX_URL).await?;
    serde_json::from_slice::<PluginIndex>(&bytes).map_err(|e| format!("parse index: {e}"))
}

#[command]
pub async fn download_plugin(url: String) -> Result<String, String> {
    let bytes = http_get(&url).await?;
    let tmp = std::env::temp_dir().join(format!("qx-plugin-{}.qx", uuid_like()));
    let mut f = fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
    f.write_all(&bytes).map_err(|e| format!("write tmp: {e}"))?;
    Ok(tmp.to_string_lossy().to_string())
}

#[command]
pub async fn install_plugin_from_url(url: String) -> Result<InstalledPlugin, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("plugin archive URL is empty".to_string());
    }
    let archive_url = normalize_plugin_archive_url(trimmed);
    let bytes = http_get(&archive_url).await?;
    install_plugin_archive(&bytes, None)
}

#[command]
pub async fn install_raycast_extension_from_url(url: String) -> Result<InstalledPlugin, String> {
    let source = parse_raycast_github_tree_url(url.trim())?;
    let package_url = source.raw_url("package.json");
    let package_bytes = http_get(&package_url).await?;
    let package_json: serde_json::Value = serde_json::from_slice(&package_bytes)
        .map_err(|e| format!("parse Raycast package.json: {e}"))?;
    let raycast_name = package_json
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("extension");
    let manifest = build_raycast_plugin_manifest(&package_json);
    let entry = if raycast_name == "system-information" {
        raycast_system_information_entry()
    } else {
        raycast_placeholder_entry(&manifest.name)
    };

    let dest = plugin_dir(&manifest.id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("clear existing Raycast plugin: {e}"))?;
    }
    fs::create_dir_all(&dest).map_err(|e| format!("create Raycast plugin dir: {e}"))?;
    let manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("serialize manifest: {e}"))?;
    atomic_write(&dest.join("manifest.json"), manifest_json.as_bytes())
        .map_err(|e| format!("write manifest: {e}"))?;
    atomic_write(&dest.join("index.js"), entry.as_bytes())
        .map_err(|e| format!("write entry: {e}"))?;

    if !manifest.icon.trim().is_empty() {
        let icon_name = manifest.icon.clone();
        let candidates = [format!("assets/{icon_name}"), icon_name.clone()];
        for candidate in candidates {
            if let Ok(bytes) = http_get(&source.raw_url(&candidate)).await {
                fs::write(dest.join(&icon_name), bytes).map_err(|e| format!("write icon: {e}"))?;
                break;
            }
        }
    }

    fs::create_dir_all(plugin_data_dir(&manifest.id)).ok();
    atomic_write(&plugin_enabled_path(&manifest.id), b"true")
        .map_err(|e| format!("write enabled flag: {e}"))?;

    Ok(InstalledPlugin {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        description: manifest.description.clone(),
        path: dest.to_string_lossy().to_string(),
        enabled: true,
        permissions: manifest.permissions.clone(),
        author: manifest.author.clone(),
        manifest: Some(manifest),
    })
}

impl RaycastSource {
    fn raw_url(&self, rel: &str) -> String {
        let rel = rel.trim_start_matches('/');
        format!(
            "https://raw.githubusercontent.com/{}/{}/{}/{}/{}",
            self.owner, self.repo, self.reference, self.extension_path, rel
        )
    }
}

fn parse_raycast_github_tree_url(input: &str) -> Result<RaycastSource, String> {
    if input.is_empty() {
        return Err("Raycast extension URL is empty".to_string());
    }
    let Some(path_start) = input.find("github.com/") else {
        return Err("Raycast conversion currently expects a GitHub tree URL".to_string());
    };
    let path = input[path_start + "github.com/".len()..]
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_matches('/');
    let parts: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();
    if parts.len() < 5 || parts[2] != "tree" {
        return Err(
            "Expected a GitHub URL like https://github.com/owner/repo/tree/<ref>/extensions/<name>"
                .to_string(),
        );
    }
    let extension_path = parts[4..].join("/");
    if !extension_path.starts_with("extensions/") {
        return Err(
            "Only Raycast extension paths under extensions/<name> are supported".to_string(),
        );
    }
    Ok(RaycastSource {
        owner: parts[0].to_string(),
        repo: parts[1].to_string(),
        reference: parts[3].to_string(),
        extension_path,
    })
}

fn json_string(value: &serde_json::Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

fn json_string_array(value: &serde_json::Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn title_case_id(id: &str) -> String {
    id.split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().to_string() + &chars.as_str().to_lowercase(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_raycast_plugin_manifest(package: &serde_json::Value) -> PluginManifest {
    let raycast_id = json_string(package, "name");
    let id_source = if raycast_id.is_empty() {
        "extension"
    } else {
        &raycast_id
    };
    let title = json_string(package, "title");
    let name = if title.is_empty() {
        title_case_id(id_source)
    } else {
        title
    };
    let icon = Path::new(&json_string(package, "icon"))
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let keywords = json_string_array(package, "keywords");
    let mut commands = Vec::new();
    if let Some(items) = package.get("commands").and_then(|v| v.as_array()) {
        for item in items {
            commands.push(PluginCommand {
                name: json_string(item, "name"),
                title: json_string(item, "title"),
                description: json_string(item, "description"),
                icon: icon.clone(),
                keywords: keywords.clone(),
            });
        }
    }
    if let Some(items) = package.get("tools").and_then(|v| v.as_array()) {
        for item in items {
            let tool_name = json_string(item, "name");
            let title = json_string(item, "title");
            commands.push(PluginCommand {
                name: tool_name.clone(),
                title: if title.is_empty() {
                    title_case_id(&tool_name)
                } else {
                    title
                },
                description: json_string(item, "description"),
                icon: icon.clone(),
                keywords: {
                    let mut out = vec![tool_name];
                    out.extend(keywords.clone());
                    out
                },
            });
        }
    }
    if commands.is_empty() {
        commands.push(PluginCommand {
            name: "index".to_string(),
            title: name.clone(),
            description: json_string(package, "description"),
            icon: icon.clone(),
            keywords: keywords.clone(),
        });
    }

    PluginManifest {
        id: format!("raycast-{id_source}"),
        name: name.clone(),
        version: json_string(package, "version")
            .chars()
            .next()
            .map(|_| json_string(package, "version"))
            .unwrap_or_else(|| "1.0.0".to_string()),
        description: json_string(package, "description"),
        author: json_string(package, "author"),
        icon: icon.clone(),
        keywords: keywords.clone(),
        permissions: vec![
            "qx_system_information_check_system_info".to_string(),
            "qx_system_information_check_storage".to_string(),
            "qx_system_information_check_network".to_string(),
            "qx_system_information_list_processes".to_string(),
            "qx_system_information_kill_process".to_string(),
        ],
        preferences: Vec::new(),
        commands,
        panel: Some(PluginPanel {
            title: name,
            icon,
            keywords,
        }),
        dependencies: Vec::new(),
        min_app_version: String::new(),
        entry: "index.js".to_string(),
        signature: String::new(),
        pubkey: String::new(),
    }
}

fn raycast_placeholder_entry(name: &str) -> String {
    format!(
        r#"export default {{
  commands: [
    {{
      name: "index",
      title: {title:?},
      async run(context) {{
        context.showToast({message:?});
      }}
    }}
  ],
  panel: {{
    title: {title:?},
    render(container) {{
      container.innerHTML = "<div style='padding:16px;color:var(--qx-text-secondary)'>This Raycast extension was imported, but it needs a custom Qx adapter before it can run fully.</div>";
    }}
  }}
}};
"#,
        title = name,
        message = format!("{name} was imported from Raycast and needs a custom adapter.")
    )
}

fn raycast_system_information_entry() -> String {
    r##"const call = (context, cmd, args) => context.invoke(cmd, args || {});
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function section(title, rows) {
  return '<section class="qx-raycast-section"><h2>' + escapeHtml(title) + '</h2>' + rows.join("") + '</section>';
}
function row(icon, title, detail) {
  return '<div class="qx-raycast-row"><div class="qx-raycast-icon">' + escapeHtml(icon) + '</div><div class="qx-raycast-main"><div class="qx-raycast-title">' + escapeHtml(title) + '</div><div class="qx-raycast-detail">' + escapeHtml(detail) + '</div></div></div>';
}
function styles() {
  return '<style>body{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--qx-text-primary,#111);background:transparent;margin:0}.qx-raycast-wrap{box-sizing:border-box;height:100%;overflow:auto;padding:14px 18px 28px}.qx-raycast-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.qx-raycast-header h1{font-size:18px;line-height:1.2;margin:0;font-weight:650}.qx-raycast-header button{border:1px solid var(--qx-border-1,#ddd);background:var(--qx-bg-component-1,#fff);color:inherit;border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer}.qx-raycast-section{border-top:1px solid var(--qx-border-1,#ddd);padding-top:10px;margin-top:12px}.qx-raycast-section h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--qx-text-tertiary,#888);margin:0 0 8px}.qx-raycast-row{min-height:38px;display:flex;align-items:center;gap:10px;border-radius:6px;padding:7px 8px}.qx-raycast-row:hover{background:var(--qx-bg-component-2,#f5f5f5)}.qx-raycast-icon{width:22px;text-align:center;flex:0 0 22px}.qx-raycast-main{min-width:0;flex:1}.qx-raycast-title{font-weight:560;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qx-raycast-detail{margin-top:2px;color:var(--qx-text-secondary,#666);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.qx-raycast-error{color:var(--qx-danger,#c00);padding:16px}</style>';
}
async function loadAll(context) {
  const [system, storage, network, processes] = await Promise.all([
    call(context, "qx_system_information_check_system_info"),
    call(context, "qx_system_information_check_storage"),
    call(context, "qx_system_information_check_network"),
    call(context, "qx_system_information_list_processes"),
  ]);
  return { system, storage, network, processes };
}
async function renderSystemInformation(container, context) {
  container.innerHTML = styles() + '<div class="qx-raycast-wrap">Loading system information...</div>';
  try {
    const data = await loadAll(context);
    const processRows = (data.processes.processes || []).slice(0, 80).map((proc) => row("A", proc.name, "PID: " + proc.pid + " | CPU: " + Number(proc.cpu || 0).toFixed(1) + "% | MEM: " + Number(proc.mem || 0).toFixed(1) + "%"));
    const networkRows = (data.network.devices || []).map((device) => row("N", device.name, device.ip));
    container.innerHTML = styles() + '<div class="qx-raycast-wrap"><div class="qx-raycast-header"><h1>System Information</h1><button id="qx-refresh">Refresh</button></div>' +
      section("About This Mac", [row("H", "Hostname", data.system.hostname), row("C", "Chip", data.system.chip), row("M", "Memory", data.system.memory), row("#", "Serial Number", data.system.serialNumber)]) +
      section("Storage", [row("D", "Macintosh HD", data.storage.summary)]) +
      section("macOS", [row("i", data.system.macOS, "Kernel " + data.system.kernel)]) +
      section("Network", networkRows.length ? networkRows : [row("N", "No active IPv4 network devices", "-")]) +
      section("Running Processes", processRows.length ? processRows : [row("A", "No processes", "-")]) + "</div>";
    container.querySelector("#qx-refresh")?.addEventListener("click", () => renderSystemInformation(container, context));
  } catch (error) {
    container.innerHTML = styles() + '<div class="qx-raycast-error">Failed to load system information: ' + escapeHtml(error) + '</div>';
  }
}
function toastJson(context, title, value) {
  const compact = typeof value === "string" ? value : JSON.stringify(value);
  context.showToast(title + ": " + compact.slice(0, 220));
}
export default {
  commands: [
    { name: "index", title: "View System Information", async run(context) { toastJson(context, "System Information", await call(context, "qx_system_information_check_system_info")); } },
    { name: "check-storage", title: "Check Storage", async run(context) { const result = await call(context, "qx_system_information_check_storage"); context.showToast(result.summary); } },
    { name: "check-system-info", title: "Check System Info", async run(context) { toastJson(context, "System", await call(context, "qx_system_information_check_system_info")); } },
    { name: "check-network", title: "Check Network", async run(context) { const result = await call(context, "qx_system_information_check_network"); context.showToast(result.count + " network device(s)"); } },
    { name: "list-processes", title: "List Processes", async run(context) { const result = await call(context, "qx_system_information_list_processes"); context.showToast(result.count + " running process(es)"); } },
    { name: "kill-process", title: "Kill Process", async run(context) { const pid = await context.prompt("PID to kill"); if (!pid) return; const result = await call(context, "qx_system_information_kill_process", { pid: Number(pid) }); context.showToast(result.message); } }
  ],
  panel: {
    title: "System Information",
    async render(container, context) { await renderSystemInformation(container, context); },
    destroy(container) { container.innerHTML = ""; }
  }
};
"##
    .to_string()
}

fn uuid_like() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{now:x}")
}

pub fn verify_plugin_signature(
    manifest: &PluginManifest,
    plugin_dir: &Path,
) -> Result<bool, String> {
    if manifest.pubkey.is_empty() || manifest.signature.is_empty() {
        return Ok(false); // No signature to verify
    }

    let pubkey_bytes =
        hex::decode(&manifest.pubkey).map_err(|e| format!("invalid pubkey hex: {e}"))?;
    if pubkey_bytes.len() != 32 {
        return Err("pubkey must be 32 bytes".to_string());
    }
    let mut key_arr = [0u8; 32];
    key_arr.copy_from_slice(&pubkey_bytes);
    let verifying_key =
        VerifyingKey::from_bytes(&key_arr).map_err(|e| format!("invalid pubkey: {e}"))?;

    let sig_bytes =
        hex::decode(&manifest.signature).map_err(|e| format!("invalid signature hex: {e}"))?;
    if sig_bytes.len() != 64 {
        return Err("signature must be 64 bytes".to_string());
    }
    let signature = Signature::from_bytes(sig_bytes.as_slice().try_into().unwrap());

    // Hash all plugin files (excluding manifest signature/pubkey fields) to create the message
    let message = compute_plugin_hash(plugin_dir, manifest)?;

    match verifying_key.verify(&message, &signature) {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

fn compute_plugin_hash(dir: &Path, manifest: &PluginManifest) -> Result<Vec<u8>, String> {
    // Read the entry file and hash it
    let entry = if manifest.entry.trim().is_empty() {
        "index.js"
    } else {
        &manifest.entry
    };
    let entry_path = dir.join(entry);
    let content = std::fs::read(&entry_path).map_err(|e| format!("read entry for hash: {e}"))?;
    let hash = blake3::hash(&content);
    Ok(hash.as_bytes().to_vec())
}

#[command]
pub fn install_plugin(path: String) -> Result<InstalledPlugin, String> {
    let expanded = expand_home_path(path.trim());
    let pkg = expanded.as_path();
    if !pkg.exists() {
        return Err(format!("plugin package not found: {path}"));
    }
    let mut f = fs::File::open(pkg).map_err(|e| format!("open package: {e}"))?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)
        .map_err(|e| format!("read package: {e}"))?;

    let cleanup_path = if should_cleanup_downloaded_package(pkg) {
        Some(pkg)
    } else {
        None
    };
    install_plugin_archive(&buf, cleanup_path)
}

fn install_plugin_archive(
    buf: &[u8],
    cleanup_path: Option<&Path>,
) -> Result<InstalledPlugin, String> {
    let mut archive =
        zip::ZipArchive::new(Cursor::new(buf)).map_err(|e| format!("open zip: {e}"))?;

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
    let manifest_root = archive_parent(&manifest_name);

    let mut archive =
        zip::ZipArchive::new(Cursor::new(buf)).map_err(|e| format!("reopen zip: {e}"))?;
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

    let dest = plugin_dir(&manifest.id);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("clear existing: {e}"))?;
    }
    fs::create_dir_all(&dest).map_err(|e| format!("create plugin dir: {e}"))?;

    let mut archive =
        zip::ZipArchive::new(Cursor::new(buf)).map_err(|e| format!("reopen zip: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("entry {i}: {e}"))?;
        let entry_name = entry.name().to_string();
        if entry.is_dir() {
            continue;
        }
        let Some(rel) = archive_relative_to_manifest_root(&entry_name, &manifest_root) else {
            continue;
        };
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

    fs::create_dir_all(plugin_data_dir(&manifest.id)).ok();

    // Verify signature if present
    if !manifest.pubkey.is_empty() && !manifest.signature.is_empty() {
        match verify_plugin_signature(&manifest, &dest) {
            Ok(true) => { /* signature valid */ }
            Ok(false) => return Err("Plugin signature verification failed".to_string()),
            Err(e) => return Err(format!("Signature error: {e}")),
        }
    }

    if let Some(path) = cleanup_path {
        let _ = fs::remove_file(path);
    }
    atomic_write(&plugin_enabled_path(&manifest.id), b"true")
        .map_err(|e| format!("write enabled flag: {e}"))?;

    Ok(InstalledPlugin {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: manifest.version.clone(),
        description: manifest.description.clone(),
        path: dest.to_string_lossy().to_string(),
        enabled: true,
        permissions: manifest.permissions.clone(),
        author: manifest.author.clone(),
        manifest: Some(manifest),
    })
}

fn normalize_plugin_archive_url(input: &str) -> String {
    let trimmed = input.trim();
    let Some(path_start) = trimmed.find("github.com/") else {
        return trimmed.to_string();
    };
    if trimmed.contains("/archive/") || trimmed.contains("/releases/download/") {
        return trimmed.to_string();
    }

    let path = &trimmed[path_start + "github.com/".len()..];
    let mut parts = path
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_matches('/')
        .split('/');
    let Some(owner) = parts.next().filter(|s| !s.is_empty()) else {
        return trimmed.to_string();
    };
    let Some(repo) = parts.next().filter(|s| !s.is_empty()) else {
        return trimmed.to_string();
    };
    let marker = parts.next();
    let branch = if marker == Some("tree") {
        parts.next().filter(|s| !s.is_empty()).unwrap_or("main")
    } else {
        "main"
    };

    format!("https://github.com/{owner}/{repo}/archive/refs/heads/{branch}.zip")
}

fn expand_home_path(input: &str) -> PathBuf {
    if input == "~" {
        return PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".to_string()));
    }
    if let Some(rest) = input.strip_prefix("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        return PathBuf::from(home).join(rest);
    }
    PathBuf::from(input)
}

fn should_cleanup_downloaded_package(path: &Path) -> bool {
    let Ok(temp_dir) = std::env::temp_dir().canonicalize() else {
        return false;
    };
    let Ok(parent) = path
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .canonicalize()
    else {
        return false;
    };
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    parent == temp_dir && file_name.starts_with("qx-plugin-")
}

fn archive_parent(name: &str) -> String {
    let normalized = name.replace('\\', "/");
    normalized
        .rsplit_once('/')
        .map(|(parent, _)| parent.to_string())
        .unwrap_or_default()
}

fn archive_relative_to_manifest_root(name: &str, root: &str) -> Option<PathBuf> {
    let normalized = name.replace('\\', "/");
    let rel = if root.is_empty() {
        normalized.as_str()
    } else {
        let prefix = format!("{root}/");
        normalized.strip_prefix(&prefix)?
    };
    if rel.is_empty() {
        return None;
    }
    safe_relative_path(rel)
}

fn safe_relative_path(rel: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for component in Path::new(rel).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

#[command]
pub fn uninstall_plugin(id: String) -> Result<(), String> {
    let dir = plugin_dir(&id);
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
        let manifest = read_manifest(&path);
        let id = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let enabled = is_plugin_enabled(&id);

        if let Some(m) = manifest {
            out.push(InstalledPlugin {
                id: m.id.clone(),
                name: m.name.clone(),
                version: m.version.clone(),
                description: m.description.clone(),
                path: path.to_string_lossy().to_string(),
                enabled,
                permissions: m.permissions.clone(),
                author: m.author.clone(),
                manifest: Some(m),
            });
        } else {
            out.push(InstalledPlugin {
                id: id.clone(),
                name: id.clone(),
                version: "0.0.0".to_string(),
                description: String::new(),
                path: path.to_string_lossy().to_string(),
                enabled,
                permissions: Vec::new(),
                author: String::new(),
                manifest: None,
            });
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

#[command]
pub fn read_plugin_entry(id: String) -> Result<String, String> {
    let dir = plugin_dir(&id);
    let manifest = read_manifest(&dir).ok_or_else(|| format!("manifest not found for {id}"))?;
    let entry_name = if manifest.entry.trim().is_empty() {
        "index.js"
    } else {
        &manifest.entry
    };
    let entry_path = dir.join(entry_name);
    fs::read_to_string(&entry_path)
        .map_err(|e| format!("read plugin entry {}: {e}", entry_path.display()))
}

#[command]
pub fn set_plugin_enabled(id: String, enabled: bool) -> Result<(), String> {
    set_plugin_enabled_fs(&id, enabled)
}

#[command]
pub fn plugin_storage_get(id: String, key: String) -> Result<Option<serde_json::Value>, String> {
    let path = plugin_storage_path(&id);
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("read storage for {id}: {e}"))?;
    let map: BTreeMap<String, serde_json::Value> =
        serde_json::from_str(&content).map_err(|e| format!("parse storage for {id}: {e}"))?;
    Ok(map.get(&key).cloned())
}

#[command]
pub fn plugin_storage_set(id: String, key: String, value: serde_json::Value) -> Result<(), String> {
    let _guard = plugin_storage_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = plugin_storage_path(&id);
    fs::create_dir_all(plugin_data_dir(&id)).ok();
    let mut map: BTreeMap<String, serde_json::Value> = if path.exists() {
        serde_json::from_str(
            &fs::read_to_string(&path).map_err(|e| format!("read storage for {id}: {e}"))?,
        )
        .map_err(|e| format!("parse storage for {id}: {e}"))?
    } else {
        BTreeMap::new()
    };
    map.insert(key, value);
    let json = serde_json::to_string_pretty(&map).map_err(|e| format!("serialize: {e}"))?;
    atomic_write(&path, json.as_bytes()).map_err(|e| format!("write storage for {id}: {e}"))
}

#[command]
pub fn plugin_storage_delete(id: String, key: String) -> Result<(), String> {
    let _guard = plugin_storage_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let path = plugin_storage_path(&id);
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("read storage for {id}: {e}"))?;
    let mut map: BTreeMap<String, serde_json::Value> =
        serde_json::from_str(&content).map_err(|e| format!("parse storage for {id}: {e}"))?;
    map.remove(&key);
    let json = serde_json::to_string_pretty(&map).map_err(|e| format!("serialize: {e}"))?;
    atomic_write(&path, json.as_bytes()).map_err(|e| format!("write storage for {id}: {e}"))
}

#[command]
pub fn plugin_preferences_get(id: String) -> Result<BTreeMap<String, serde_json::Value>, String> {
    let path = plugin_data_dir(&id).join("preferences.json");
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("read preferences for {id}: {e}"))?;
    serde_json::from_str(&content).map_err(|e| format!("parse preferences for {id}: {e}"))
}

#[command]
pub fn plugin_preferences_set(
    id: String,
    values: BTreeMap<String, serde_json::Value>,
) -> Result<(), String> {
    let dir = plugin_data_dir(&id);
    fs::create_dir_all(&dir).ok();
    let path = dir.join("preferences.json");
    let json = serde_json::to_string_pretty(&values).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write preferences for {id}: {e}"))
}

#[command]
pub fn sign_plugin(plugin_dir: String, private_key_hex: String) -> Result<String, String> {
    use ed25519_dalek::{Signer, SigningKey};

    let key_bytes =
        hex::decode(&private_key_hex).map_err(|e| format!("invalid private key hex: {e}"))?;
    if key_bytes.len() != 32 {
        return Err("private key must be 32 bytes".to_string());
    }
    let mut key_arr = [0u8; 32];
    key_arr.copy_from_slice(&key_bytes);
    let signing_key = SigningKey::from_bytes(&key_arr);

    let dir = Path::new(&plugin_dir);
    let manifest_path = dir.join("manifest.json");
    let manifest_content =
        std::fs::read_to_string(&manifest_path).map_err(|e| format!("read manifest: {e}"))?;
    let manifest: PluginManifest =
        serde_json::from_str(&manifest_content).map_err(|e| format!("parse manifest: {e}"))?;

    let entry = if manifest.entry.trim().is_empty() {
        "index.js"
    } else {
        &manifest.entry
    };
    let entry_path = dir.join(entry);
    let entry_content = std::fs::read(&entry_path).map_err(|e| format!("read entry: {e}"))?;
    let message = blake3::hash(&entry_content);

    let signature = signing_key.sign(message.as_bytes());
    let sig_hex = hex::encode(signature.to_bytes());
    let pubkey_hex = hex::encode(signing_key.verifying_key().to_bytes());

    Ok(format!("{}|{}", pubkey_hex, sig_hex))
}

#[command]
pub fn scaffold_plugin(name: String, output_dir: String) -> Result<String, String> {
    let plugin_dir = Path::new(&output_dir).join(&name);
    if plugin_dir.exists() {
        return Err(format!(
            "Directory already exists: {}",
            plugin_dir.display()
        ));
    }
    fs::create_dir_all(&plugin_dir).map_err(|e| format!("create dir: {e}"))?;

    // Write manifest.json
    let manifest = serde_json::json!({
        "id": name,
        "name": name.replace("-", " ").split(' ')
            .map(|w| {
                let mut c = w.chars();
                match c.next() {
                    None => String::new(),
                    Some(f) => f.to_uppercase().to_string() + &c.as_str().to_lowercase(),
                }
            })
            .collect::<Vec<_>>().join(" "),
        "version": "1.0.0",
        "description": format!("A Qx plugin: {}", name),
        "author": "",
        "icon": "icon.png",
        "keywords": [name.clone()],
        "permissions": [],
        "entry": "index.js",
        "commands": [
            {
                "name": "run",
                "title": format!("Run {}", name),
                "description": "Execute the main command",
                "keywords": [name.clone()]
            }
        ]
    });
    let manifest_json =
        serde_json::to_string_pretty(&manifest).map_err(|e| format!("serialize manifest: {e}"))?;
    fs::write(plugin_dir.join("manifest.json"), manifest_json)
        .map_err(|e| format!("write manifest: {e}"))?;

    // Write index.js
    let index_js = format!(
        r#"export default {{
  commands: [
    {{
      name: "run",
      title: "Run {name}",
      async run(context) {{
        context.showToast("{name} is running!");
      }}
    }}
  ]
}};
"#,
        name = name
    );
    fs::write(plugin_dir.join("index.js"), index_js).map_err(|e| format!("write index.js: {e}"))?;

    // Write a minimal README
    let readme = format!(
        "# {}\n\nA Qx plugin.\n\n## Development\n\nEdit `index.js` to add commands and panels.\n\n## Package\n\n```bash\ncd {}\nzip -r ../{name}.qx-plugin manifest.json index.js icon.png\n```\n",
        name.replace("-", " "),
        name,
        name = name
    );
    fs::write(plugin_dir.join("README.md"), readme).map_err(|e| format!("write README: {e}"))?;

    Ok(plugin_dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const RAYCAST_SYSTEM_INFORMATION_URL: &str = "https://github.com/raycast/extensions/tree/888d04008da11340e0a0fa98b32dde4465a33e72/extensions/system-information";

    #[test]
    fn parses_raycast_tree_url() {
        let source = parse_raycast_github_tree_url(RAYCAST_SYSTEM_INFORMATION_URL).unwrap();
        assert_eq!(source.owner, "raycast");
        assert_eq!(source.repo, "extensions");
        assert_eq!(source.reference, "888d04008da11340e0a0fa98b32dde4465a33e72");
        assert_eq!(source.extension_path, "extensions/system-information");
        assert_eq!(
            source.raw_url("package.json"),
            "https://raw.githubusercontent.com/raycast/extensions/888d04008da11340e0a0fa98b32dde4465a33e72/extensions/system-information/package.json"
        );
    }

    #[test]
    fn builds_system_information_manifest_from_raycast_package() {
        let package = serde_json::json!({
            "name": "system-information",
            "title": "System Information",
            "description": "Quick access to your system information",
            "icon": "command-icon.png",
            "author": "Visual-Studio-Coder",
            "keywords": ["system", "information"],
            "commands": [
                {
                    "name": "index",
                    "title": "View System Information",
                    "description": "View your system information"
                }
            ],
            "tools": [
                {
                    "name": "check-storage",
                    "title": "Check Storage",
                    "description": "See storage information"
                }
            ]
        });
        let manifest = build_raycast_plugin_manifest(&package);
        assert_eq!(manifest.id, "raycast-system-information");
        assert_eq!(manifest.name, "System Information");
        assert_eq!(manifest.entry, "index.js");
        assert_eq!(manifest.commands.len(), 2);
        assert!(manifest
            .permissions
            .contains(&"qx_system_information_check_storage".to_string()));
        assert_eq!(manifest.panel.unwrap().title, "System Information");
    }
}
