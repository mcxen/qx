use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ClipboardText {
    pub text: String,
}

#[tauri::command]
pub fn plugin_clipboard_read(app: AppHandle) -> Result<ClipboardText, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let text = app
        .clipboard()
        .read_text()
        .map_err(|e| format!("read clipboard: {e}"))?;
    Ok(ClipboardText { text })
}

#[tauri::command]
pub fn plugin_clipboard_write(app: AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(&text)
        .map_err(|e| format!("write clipboard: {e}"))
}

#[tauri::command]
pub fn plugin_perform_paste() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("enigo init: {e}"))?;
    enigo
        .key(Key::Meta, Direction::Press)
        .map_err(|e| format!("press command: {e}"))?;
    let key_result = enigo.key(Key::Unicode('v'), Direction::Click);
    let release_result = enigo.key(Key::Meta, Direction::Release);
    key_result.map_err(|e| format!("press v: {e}"))?;
    release_result.map_err(|e| format!("release command: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// HTTP fetch
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct HttpFetchRequest {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_method() -> String {
    "GET".to_string()
}

fn default_timeout_ms() -> u64 {
    15000
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub ok: bool,
    pub headers: std::collections::BTreeMap<String, String>,
    pub body: String,
}

#[tauri::command]
pub async fn plugin_http_fetch(req: HttpFetchRequest) -> Result<HttpResponse, String> {
    let url = reqwest::Url::parse(&req.url).map_err(|e| format!("invalid URL: {e}"))?;
    match url.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("unsupported URL scheme: {scheme}")),
    }

    let client = crate::http_client::client(
        "Qx/0.1 (Plugin HTTP; +https://github.com/mcxen/qx)",
        std::time::Duration::from_millis(req.timeout_ms.max(1000).min(60000)),
        None,
    )?;

    let method = req.method.to_uppercase();
    let mut builder = match method.as_str() {
        "GET" => client.get(url.clone()),
        "POST" => client.post(url.clone()),
        "PUT" => client.put(url.clone()),
        "PATCH" => client.patch(url.clone()),
        "DELETE" => client.delete(url.clone()),
        "HEAD" => client.head(url.clone()),
        _ => return Err(format!("unsupported HTTP method: {method}")),
    };

    for (key, value) in &req.headers {
        builder = builder.header(key.as_str(), value.as_str());
    }

    if let Some(body) = &req.body {
        builder = builder.body(body.clone());
    }

    let resp = builder
        .send()
        .await
        .map_err(|e| format!("http request: {e}"))?;

    let status = resp.status().as_u16();
    let ok = resp.status().is_success();

    let mut headers = std::collections::BTreeMap::new();
    for (name, value) in resp.headers().iter() {
        if let Ok(v) = value.to_str() {
            headers.insert(name.as_str().to_string(), v.to_string());
        }
    }

    let body = resp.text().await.map_err(|e| format!("read body: {e}"))?;

    Ok(HttpResponse {
        status,
        ok,
        headers,
        body,
    })
}

// ---------------------------------------------------------------------------
// Plugin assets
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct PluginAsset {
    pub path: String,
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

#[tauri::command]
pub fn plugin_resolve_asset(id: String, asset_path: String) -> Result<PluginAsset, String> {
    let rel = safe_relative_path(&asset_path)
        .ok_or_else(|| format!("invalid plugin asset path: {asset_path}"))?;
    let plugin_dir = crate::marketplace::checked_plugin_dir(&id)?;
    let path = plugin_dir.join(rel);
    let canonical_plugin_dir = plugin_dir
        .canonicalize()
        .map_err(|e| format!("resolve plugin dir for {id}: {e}"))?;
    let canonical_path = path
        .canonicalize()
        .map_err(|e| format!("resolve plugin asset {}: {e}", path.display()))?;
    if !canonical_path.starts_with(&canonical_plugin_dir) || !canonical_path.is_file() {
        return Err(format!("plugin asset not found: {asset_path}"));
    }
    Ok(PluginAsset {
        path: canonical_path.to_string_lossy().to_string(),
    })
}

// ---------------------------------------------------------------------------
// System notification (macOS NSUserNotification via objc2)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct NotificationRequest {
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub subtitle: String,
}

#[tauri::command]
pub fn plugin_notification_show(_app: AppHandle, req: NotificationRequest) -> Result<(), String> {
    // Use macOS NSUserNotification via objc2
    #[cfg(target_os = "macos")]
    {
        send_macos_notification(&req.title, &req.body, &req.subtitle)?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = req;
        return Err("notifications are only supported on macOS".to_string());
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn send_macos_notification(title: &str, body: &str, subtitle: &str) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    // We use the simpler NSUserNotificationCenter approach (deprecated but works)
    // For modern UNUserNotificationCenter, we'd need entitlements + bundle ID.
    // Since Qx is a Tauri app with proper bundle ID, we try the NSUserNotification path.

    unsafe {
        // Get NSUserNotificationCenter default center
        let cls = objc2::runtime::AnyClass::get(c"NSUserNotificationCenter")
            .ok_or("NSUserNotificationCenter class not found")?;
        let default_center: *mut AnyObject = msg_send![cls, defaultUserNotificationCenter];

        if default_center.is_null() {
            return Err("failed to get default user notification center".to_string());
        }

        // Create NSUserNotification
        let notif_cls = objc2::runtime::AnyClass::get(c"NSUserNotification")
            .ok_or("NSUserNotification class not found")?;
        let notif: *mut AnyObject = msg_send![notif_cls, new];

        if notif.is_null() {
            return Err("failed to create NSUserNotification".to_string());
        }

        // Set title
        let title_str = objc2_foundation::NSString::from_str(title);
        let _: () = msg_send![notif, setTitle: &*title_str];

        // Set subtitle
        if !subtitle.is_empty() {
            let subtitle_str = objc2_foundation::NSString::from_str(subtitle);
            let _: () = msg_send![notif, setSubtitle: &*subtitle_str];
        }

        // Set body / informative text
        if !body.is_empty() {
            let body_str = objc2_foundation::NSString::from_str(body);
            let _: () = msg_send![notif, setInformativeText: &*body_str];
        }

        // Set sound name (default)
        let sound_str = objc2_foundation::NSString::from_str("NSUserNotificationDefaultSoundName");
        let _: () = msg_send![notif, setSoundName: &*sound_str];

        // Deliver
        let _: () = msg_send![default_center, deliverNotification: notif];
    }

    Ok(())
}
