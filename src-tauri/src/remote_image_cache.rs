use reqwest::header::{CONTENT_TYPE, REFERER};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};

const IMAGE_MAX_BYTES: usize = 20 * 1024 * 1024;
const CACHE_MAX_BYTES: u64 = 512 * 1024 * 1024;
const CACHE_MAX_FILES: usize = 256;
const CACHE_EXTENSIONS: &[&str] = &["jpg", "png", "gif", "webp", "bmp", "avif"];
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn cache_dir(namespace: &str) -> PathBuf {
    let dir = crate::paths::cache_dir().join(namespace);
    let _ = fs::create_dir_all(&dir);
    dir
}

fn digest(url: &str) -> String {
    blake3::hash(url.trim().as_bytes()).to_hex().to_string()[..32].to_string()
}

fn cached_path(dir: &Path, url: &str) -> Option<PathBuf> {
    let stem = digest(url);
    CACHE_EXTENSIONS
        .iter()
        .map(|extension| dir.join(format!("{stem}.{extension}")))
        .find(|path| path.is_file())
}

fn extension_for_content_type(content_type: Option<&str>) -> Option<&'static str> {
    let mime = content_type
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    match mime.as_str() {
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/bmp" | "image/x-ms-bmp" => Some("bmp"),
        "image/avif" => Some("avif"),
        _ => None,
    }
}

fn extension_for_bytes(bytes: &[u8]) -> Option<&'static str> {
    match image::guess_format(bytes).ok()? {
        image::ImageFormat::Jpeg => Some("jpg"),
        image::ImageFormat::Png => Some("png"),
        image::ImageFormat::Gif => Some("gif"),
        image::ImageFormat::WebP => Some("webp"),
        image::ImageFormat::Bmp => Some("bmp"),
        image::ImageFormat::Avif => Some("avif"),
        _ => None,
    }
}

fn write_cache(bytes: &[u8], target: &Path) -> Result<(), String> {
    let temp = target.with_extension(format!(
        "{}-{}.tmp",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&temp, bytes).map_err(|error| format!("write image cache: {error}"))?;
    let result = match fs::rename(&temp, target) {
        Ok(()) => Ok(()),
        Err(_) if target.is_file() => Ok(()),
        Err(error) => Err(format!("store image cache: {error}")),
    };
    let _ = fs::remove_file(temp);
    result
}

fn prune_cache(dir: &Path) {
    let mut entries = fs::read_dir(dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            Some((
                entry.path(),
                metadata.len(),
                metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            ))
        })
        .collect::<Vec<_>>();
    entries.sort_by_key(|(_, _, modified)| *modified);
    let mut total_bytes = entries.iter().map(|(_, size, _)| *size).sum::<u64>();
    let mut total_files = entries.len();
    for (path, size, _) in entries {
        if total_files <= CACHE_MAX_FILES && total_bytes <= CACHE_MAX_BYTES {
            break;
        }
        if fs::remove_file(path).is_ok() {
            total_files = total_files.saturating_sub(1);
            total_bytes = total_bytes.saturating_sub(size);
        }
    }
}

pub async fn resolve(namespace: &str, url: &str, referer: Option<&str>) -> Result<String, String> {
    let dir = cache_dir(namespace);
    if let Some(path) = cached_path(&dir, url) {
        return Ok(path.to_string_lossy().to_string());
    }

    let parsed = reqwest::Url::parse(url).map_err(|error| format!("invalid image URL: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("unsupported image URL scheme: {}", parsed.scheme()));
    }
    let client = crate::http_client::client(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Qx Image Cache/1.0",
        Duration::from_secs(30),
        Some(Duration::from_secs(10)),
    )?;
    let mut request = client.get(parsed);
    if let Some(referer) = referer.filter(|value| !value.trim().is_empty()) {
        request = request.header(REFERER, referer);
    }
    let mut response = request
        .send()
        .await
        .map_err(|error| format!("fetch image: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("image HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > IMAGE_MAX_BYTES as u64)
    {
        return Err("image exceeds 20 MiB cache limit".to_string());
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let mut bytes = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or(64 * 1024)
            .min(IMAGE_MAX_BYTES as u64) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("read image: {error}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > IMAGE_MAX_BYTES {
            return Err("image exceeds 20 MiB cache limit".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    let extension = extension_for_content_type(content_type.as_deref())
        .or_else(|| extension_for_bytes(&bytes))
        .ok_or_else(|| "unsupported image format".to_string())?;
    let target = dir.join(format!("{}.{}", digest(url), extension));
    let write_target = target.clone();
    let write_bytes = bytes;
    let prune_dir = dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        write_cache(&write_bytes, &write_target)?;
        prune_cache(&prune_dir);
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| format!("join image cache task: {error}"))??;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn plugin_workbench_cache_image(
    app: AppHandle,
    id: String,
    url: String,
) -> Result<String, String> {
    let id = crate::marketplace::validate_plugin_id(&id)?;
    let namespace = format!("plugin-workbench-images/{}", &digest(id)[..16]);
    let path = resolve(&namespace, &url, None).await?;
    app.asset_protocol_scope()
        .allow_file(Path::new(&path))
        .map_err(|error| format!("allow cached plugin image failed: {error}"))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::{extension_for_bytes, extension_for_content_type};

    #[test]
    fn accepts_supported_raster_images() {
        assert_eq!(
            extension_for_content_type(Some("image/jpeg; charset=binary")),
            Some("jpg")
        );
        assert_eq!(extension_for_content_type(Some("text/html")), None);
        assert_eq!(
            extension_for_bytes(&[0x89, b'P', b'N', b'G', 13, 10, 26, 10]),
            Some("png")
        );
    }
}
