use reqwest::header::{CONTENT_TYPE, REFERER};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

const IMAGE_MAX_BYTES: usize = 20 * 1024 * 1024;
const CACHE_EXTENSIONS: &[&str] = &["jpg", "png", "gif", "webp", "bmp", "avif"];
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn cache_dir() -> PathBuf {
    let dir = crate::paths::cache_dir().join("rss-article-images");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn digest(url: &str) -> String {
    blake3::hash(url.trim().as_bytes()).to_hex().to_string()[..32].to_string()
}

fn cached_path(url: &str) -> Option<PathBuf> {
    let stem = digest(url);
    CACHE_EXTENSIONS
        .iter()
        .map(|extension| cache_dir().join(format!("{stem}.{extension}")))
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
        // The hero and the first inline image may resolve the same URL at once.
        // Whichever writer loses the race can safely reuse the completed file.
        Err(_) if target.is_file() => Ok(()),
        Err(error) => Err(format!("store image cache: {error}")),
    };
    let _ = fs::remove_file(temp);
    result
}

pub async fn resolve(url: &str, referer: Option<&str>) -> Result<String, String> {
    if let Some(path) = cached_path(url) {
        return Ok(path.to_string_lossy().to_string());
    }

    let parsed = reqwest::Url::parse(url).map_err(|error| format!("invalid image URL: {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("unsupported image URL scheme: {}", parsed.scheme()));
    }

    let client = crate::http_client::client(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Qx RSS/1.0",
        Duration::from_secs(20),
        Some(Duration::from_secs(10)),
    )?;
    let mut request = client.get(parsed);
    if let Some(referer) = referer.filter(|value| !value.trim().is_empty()) {
        request = request.header(REFERER, referer);
    }
    let response = request
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
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("read image: {error}"))?;
    if bytes.len() > IMAGE_MAX_BYTES {
        return Err("image exceeds 20 MiB cache limit".to_string());
    }
    let extension = extension_for_content_type(content_type.as_deref())
        .or_else(|| extension_for_bytes(bytes.as_ref()))
        .ok_or_else(|| "unsupported image format".to_string())?;
    let target = cache_dir().join(format!("{}.{}", digest(url), extension));
    let write_target = target.clone();
    let write_bytes = bytes.to_vec();
    tauri::async_runtime::spawn_blocking(move || write_cache(&write_bytes, &write_target))
        .await
        .map_err(|error| format!("join image cache task: {error}"))??;
    Ok(target.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::extension_for_content_type;

    #[test]
    fn accepts_supported_raster_content_types() {
        assert_eq!(
            extension_for_content_type(Some("image/jpeg; charset=binary")),
            Some("jpg")
        );
        assert_eq!(extension_for_content_type(Some("text/html")), None);
    }
}
