use std::time::Duration;

fn proxy_url() -> Result<Option<String>, String> {
    let settings = crate::settings::read_settings();
    if !settings.advanced.network_proxy_enabled {
        return Ok(None);
    }

    let proxy_url = settings.advanced.network_proxy_url.trim();
    if proxy_url.is_empty() {
        return Err("network proxy is enabled but proxy URL is empty".to_string());
    }
    Ok(Some(proxy_url.to_string()))
}

pub fn client(
    user_agent: &str,
    timeout: Duration,
    connect_timeout: Option<Duration>,
) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(timeout);
    if let Some(connect_timeout) = connect_timeout {
        builder = builder.connect_timeout(connect_timeout);
    }
    if let Some(proxy_url) = proxy_url()? {
        let proxy = reqwest::Proxy::all(&proxy_url).map_err(|e| format!("proxy: {e}"))?;
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(|e| format!("http client: {e}"))
}

pub fn blocking_client(
    user_agent: &str,
    timeout: Duration,
    connect_timeout: Option<Duration>,
) -> Result<reqwest::blocking::Client, String> {
    let mut builder = reqwest::blocking::Client::builder()
        .user_agent(user_agent)
        .timeout(timeout);
    if let Some(connect_timeout) = connect_timeout {
        builder = builder.connect_timeout(connect_timeout);
    }
    if let Some(proxy_url) = proxy_url()? {
        let proxy = reqwest::Proxy::all(&proxy_url).map_err(|e| format!("proxy: {e}"))?;
        builder = builder.proxy(proxy);
    }
    builder.build().map_err(|e| format!("http client: {e}"))
}
