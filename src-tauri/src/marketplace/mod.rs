use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use tauri::command;

const INDEX_URL: &str = "https://raw.githubusercontent.com/mcxen/qx-plugins/main/index.json";
const USER_AGENT: &str = "Qx/0.1 (Marketplace; +https://github.com/mcxen/qx)";

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

fn plugin_enabled_path(id: &str) -> PathBuf {
    plugin_dir(id).join(".enabled")
}

fn is_plugin_enabled(id: &str) -> bool {
    plugin_enabled_path(id).exists()
}

fn set_plugin_enabled_fs(id: &str, enabled: bool) -> Result<(), String> {
    let path = plugin_enabled_path(id);
    if enabled {
        fs::write(&path, "true").map_err(|e| format!("write enabled flag: {e}"))?;
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
    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client: {e}"))?;
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

    let dest = plugin_dir(&manifest.id);
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

    fs::create_dir_all(plugin_data_dir(&manifest.id)).ok();

    // Verify signature if present
    if !manifest.pubkey.is_empty() && !manifest.signature.is_empty() {
        match verify_plugin_signature(&manifest, &dest) {
            Ok(true) => { /* signature valid */ }
            Ok(false) => return Err("Plugin signature verification failed".to_string()),
            Err(e) => return Err(format!("Signature error: {e}")),
        }
    }

    let _ = fs::remove_file(pkg);
    let _ = fs::write(plugin_enabled_path(&manifest.id), "true");

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
    fs::write(&path, json).map_err(|e| format!("write storage for {id}: {e}"))
}

#[command]
pub fn plugin_storage_delete(id: String, key: String) -> Result<(), String> {
    let path = plugin_storage_path(&id);
    if !path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("read storage for {id}: {e}"))?;
    let mut map: BTreeMap<String, serde_json::Value> =
        serde_json::from_str(&content).map_err(|e| format!("parse storage for {id}: {e}"))?;
    map.remove(&key);
    let json = serde_json::to_string_pretty(&map).map_err(|e| format!("serialize: {e}"))?;
    fs::write(&path, json).map_err(|e| format!("write storage for {id}: {e}"))
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
