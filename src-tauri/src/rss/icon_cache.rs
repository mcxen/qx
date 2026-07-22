use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

const ICON_EDGE: u32 = 64;
const ICON_MAX_BYTES: usize = 3 * 1024 * 1024;
const ICON_REFRESH_AFTER: Duration = Duration::from_secs(30 * 24 * 60 * 60);
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn cache_dir() -> PathBuf {
    let dir = crate::paths::cache_dir().join("rss-icons");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn cache_path(feed_url: &str) -> PathBuf {
    let digest = blake3::hash(feed_url.trim().as_bytes())
        .to_hex()
        .to_string();
    cache_dir().join(format!("{}.png", &digest[..24]))
}

fn is_fresh(path: &Path) -> bool {
    path.metadata()
        .and_then(|metadata| metadata.modified())
        .and_then(|modified| modified.elapsed().map_err(std::io::Error::other))
        .map(|age| age < ICON_REFRESH_AFTER)
        .unwrap_or(false)
}

fn write_compact_png(bytes: &[u8], target: &Path) -> Result<(), String> {
    let decoded =
        image::load_from_memory(bytes).map_err(|error| format!("decode icon: {error}"))?;
    let compact = decoded.thumbnail(ICON_EDGE, ICON_EDGE);
    let temp = target.with_extension(format!(
        "{}-{}.tmp.png",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    compact
        .save_with_format(&temp, image::ImageFormat::Png)
        .map_err(|error| format!("encode icon: {error}"))?;
    let copy_result = fs::copy(&temp, target).map(|_| ());
    let _ = fs::remove_file(&temp);
    copy_result.map_err(|error| format!("store icon: {error}"))
}

/// Resolve a feed icon to a compact local PNG. A fresh cache entry is returned
/// without touching the network; stale files remain usable if refresh fails.
pub async fn resolve(feed_url: &str, source: &str) -> String {
    let target = cache_path(feed_url);
    let target_string = target.to_string_lossy().to_string();

    if target.is_file() && (source == target_string || is_fresh(&target)) {
        return target_string;
    }

    let fallback_source;
    let mut source = source.trim();
    if source.is_empty()
        || (!(source.starts_with("https://") || source.starts_with("http://"))
            && !Path::new(source).is_file())
    {
        fallback_source = super::fetcher::resolve_feed_icon(feed_url, "", &[]);
        source = fallback_source.as_str();
    }
    if source.is_empty() || !(source.starts_with("https://") || source.starts_with("http://")) {
        return if target.is_file() {
            target_string
        } else {
            source.to_string()
        };
    }

    let client = match crate::http_client::client(
        "Qx RSS Icon Cache/1.0",
        Duration::from_secs(10),
        Some(Duration::from_secs(6)),
    ) {
        Ok(client) => client,
        Err(_) => return stale_or_source(&target, source),
    };
    let response = match client.get(source).send().await {
        Ok(response) if response.status().is_success() => response,
        _ => return stale_or_source(&target, source),
    };
    if response
        .content_length()
        .is_some_and(|length| length > ICON_MAX_BYTES as u64)
    {
        return stale_or_source(&target, source);
    }
    let bytes = match response.bytes().await {
        Ok(bytes) if bytes.len() <= ICON_MAX_BYTES => bytes,
        _ => return stale_or_source(&target, source),
    };

    let write_target = target.clone();
    let write_result = tauri::async_runtime::spawn_blocking(move || {
        write_compact_png(bytes.as_ref(), &write_target)
    })
    .await;
    match write_result {
        Ok(Ok(())) => target_string,
        _ => stale_or_source(&target, source),
    }
}

fn stale_or_source(target: &Path, source: &str) -> String {
    if target.is_file() {
        target.to_string_lossy().to_string()
    } else {
        source.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{write_compact_png, ICON_EDGE};

    #[test]
    fn cached_feed_icons_are_bounded() {
        let source = image::DynamicImage::new_rgba8(512, 320);
        let mut bytes = std::io::Cursor::new(Vec::new());
        source
            .write_to(&mut bytes, image::ImageFormat::Png)
            .expect("encode fixture");
        let path =
            std::env::temp_dir().join(format!("qx-rss-icon-test-{}.png", std::process::id()));
        write_compact_png(bytes.get_ref(), &path).expect("cache icon");
        let (width, height) = image::image_dimensions(&path).expect("cached dimensions");
        let _ = std::fs::remove_file(path);
        assert!(width <= ICON_EDGE);
        assert!(height <= ICON_EDGE);
    }
}
