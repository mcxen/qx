pub async fn resolve(url: &str, referer: Option<&str>) -> Result<String, String> {
    crate::remote_image_cache::resolve("rss-article-images", url, referer).await
}
