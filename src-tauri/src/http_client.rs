use std::time::Duration;

/// How Qx routes outbound HTTP(S) traffic.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkProxyMode {
    /// Direct connection; ignore OS / env proxies.
    Off,
    /// Use OS system proxy + standard env vars (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, …).
    /// Requires reqwest `system-proxy` feature (enabled in Cargo.toml).
    System,
    /// Explicit user-provided proxy URL (http / https / socks5).
    Manual,
}

pub fn resolve_proxy_mode(settings: &crate::settings::AdvancedSettings) -> NetworkProxyMode {
    let mode = settings.network_proxy_mode.trim().to_ascii_lowercase();
    match mode.as_str() {
        "system" => NetworkProxyMode::System,
        "manual" => NetworkProxyMode::Manual,
        "off" | "none" | "direct" => NetworkProxyMode::Off,
        // Empty / unknown: migrate legacy toggle + URL.
        _ => {
            if settings.network_proxy_enabled {
                if settings.network_proxy_url.trim().is_empty() {
                    NetworkProxyMode::System
                } else {
                    NetworkProxyMode::Manual
                }
            } else {
                NetworkProxyMode::Off
            }
        }
    }
}

fn apply_proxy(
    mut builder: reqwest::ClientBuilder,
) -> Result<reqwest::ClientBuilder, String> {
    let settings = crate::settings::read_settings();
    match resolve_proxy_mode(&settings.advanced) {
        NetworkProxyMode::Off => {
            // system-proxy is on by default when the feature is enabled — opt out explicitly.
            builder = builder.no_proxy();
        }
        NetworkProxyMode::System => {
            // Leave builder defaults so reqwest picks up system + env proxies.
        }
        NetworkProxyMode::Manual => {
            let proxy_url = settings.advanced.network_proxy_url.trim();
            if proxy_url.is_empty() {
                return Err(
                    "manual proxy is selected but proxy URL is empty (e.g. http://127.0.0.1:7890)"
                        .to_string(),
                );
            }
            let proxy = reqwest::Proxy::all(proxy_url).map_err(|e| format!("proxy: {e}"))?;
            builder = builder.proxy(proxy);
        }
    }
    Ok(builder)
}

fn apply_proxy_blocking(
    mut builder: reqwest::blocking::ClientBuilder,
) -> Result<reqwest::blocking::ClientBuilder, String> {
    let settings = crate::settings::read_settings();
    match resolve_proxy_mode(&settings.advanced) {
        NetworkProxyMode::Off => {
            builder = builder.no_proxy();
        }
        NetworkProxyMode::System => {}
        NetworkProxyMode::Manual => {
            let proxy_url = settings.advanced.network_proxy_url.trim();
            if proxy_url.is_empty() {
                return Err(
                    "manual proxy is selected but proxy URL is empty (e.g. http://127.0.0.1:7890)"
                        .to_string(),
                );
            }
            let proxy = reqwest::Proxy::all(proxy_url).map_err(|e| format!("proxy: {e}"))?;
            builder = builder.proxy(proxy);
        }
    }
    Ok(builder)
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
    let builder = apply_proxy(builder)?;
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
    let builder = apply_proxy_blocking(builder)?;
    builder.build().map_err(|e| format!("http client: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::AdvancedSettings;

    #[test]
    fn resolves_explicit_modes() {
        let mut s = AdvancedSettings::default();
        s.network_proxy_mode = "system".into();
        assert_eq!(resolve_proxy_mode(&s), NetworkProxyMode::System);
        s.network_proxy_mode = "manual".into();
        assert_eq!(resolve_proxy_mode(&s), NetworkProxyMode::Manual);
        s.network_proxy_mode = "off".into();
        assert_eq!(resolve_proxy_mode(&s), NetworkProxyMode::Off);
    }

    #[test]
    fn migrates_legacy_enabled_with_url_to_manual() {
        let mut s = AdvancedSettings::default();
        s.network_proxy_mode = String::new();
        s.network_proxy_enabled = true;
        s.network_proxy_url = "http://127.0.0.1:7890".into();
        assert_eq!(resolve_proxy_mode(&s), NetworkProxyMode::Manual);
    }

    #[test]
    fn migrates_legacy_enabled_without_url_to_system() {
        let mut s = AdvancedSettings::default();
        s.network_proxy_mode = String::new();
        s.network_proxy_enabled = true;
        s.network_proxy_url = String::new();
        assert_eq!(resolve_proxy_mode(&s), NetworkProxyMode::System);
    }
}
