use serde::{Deserialize, Serialize};
use std::time::Duration;

// ---------------------------------------------------------------------------
// Types returned to the frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WeatherLocation {
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub country: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WeatherCurrent {
    pub temperature: f64,
    pub temp_min: f64,
    pub temp_max: f64,
    pub condition_code: String,
    pub humidity: u8,
    pub wind_speed: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WeatherForecastDay {
    pub label: String,
    pub temp_min: f64,
    pub temp_max: f64,
    pub condition_code: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WeatherData {
    pub location: WeatherLocation,
    pub current: WeatherCurrent,
    pub forecast: Vec<WeatherForecastDay>,
    pub updated_at: String,
    pub provider: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GeoLocation {
    pub latitude: f64,
    pub longitude: f64,
    pub city: String,
    pub country: String,
}

// ---------------------------------------------------------------------------
// Open-Meteo API types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct OpenMeteoResponse {
    current: OpenMeteoCurrent,
    daily: OpenMeteoDaily,
    timezone: String,
}

#[derive(Debug, Deserialize)]
struct OpenMeteoCurrent {
    temperature_2m: f64,
    weather_code: i32,
    relative_humidity_2m: u8,
    wind_speed_10m: f64,
    is_day: i32,
}

#[derive(Debug, Deserialize)]
struct OpenMeteoDaily {
    time: Vec<String>,
    temperature_2m_max: Vec<f64>,
    temperature_2m_min: Vec<f64>,
    weather_code: Vec<i32>,
}

#[derive(Debug, Deserialize)]
struct OpenMeteoGeocodingResponse {
    results: Option<Vec<OpenMeteoGeocodingResult>>,
}

#[derive(Debug, Deserialize)]
struct OpenMeteoGeocodingResult {
    name: String,
    latitude: f64,
    longitude: f64,
    country: Option<String>,
}

// ---------------------------------------------------------------------------
// IP geolocation types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct IpApiCoResponse {
    latitude: f64,
    longitude: f64,
    city: String,
    country_name: String,
}

// ---------------------------------------------------------------------------
// OpenWeatherMap API types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct OwmOneCallResponse {
    current: OwmCurrent,
    daily: Vec<OwmDaily>,
    timezone: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct OwmCurrent {
    temp: f64,
    humidity: u8,
    wind_speed: f64,
    weather: Vec<OwmWeather>,
    dt: i64,
}

#[derive(Debug, Deserialize)]
struct OwmDaily {
    dt: i64,
    temp: OwmTemp,
    weather: Vec<OwmWeather>,
}

#[derive(Debug, Deserialize)]
struct OwmTemp {
    min: f64,
    max: f64,
}

#[derive(Debug, Deserialize)]
struct OwmWeather {
    id: i32,
}

// ---------------------------------------------------------------------------
// Weather code mapping
// ---------------------------------------------------------------------------

/// Map WMO weather interpretation codes (Open-Meteo) to condition codes.
fn map_wmo_code(code: i32, _is_day: bool) -> String {
    match code {
        0 => "clear",
        1 | 2 => "partly-cloudy",
        3 => "cloudy",
        45 | 48 => "fog",
        51 | 53 | 55 => "drizzle",
        56 | 57 => "sleet",
        61 | 63 => "rain",
        65 | 80 | 81 | 82 => "heavy-rain",
        66 | 67 => "sleet",
        71 | 73 => "snow",
        75 | 77 | 85 | 86 => "snow",
        95 => "thunderstorm",
        96 | 99 => "thunderstorm",
        _ => "cloudy",
    }
    .to_string()
}

/// Map OpenWeatherMap condition IDs to condition codes.
fn map_owm_code(code: i32) -> String {
    match code {
        200..=232 => "thunderstorm",
        300..=321 => "drizzle",
        500..=504 => "rain",
        511 => "sleet",
        520..=531 => "heavy-rain",
        600..=622 => "snow",
        701 => "fog",
        711 => "fog",
        721 => "fog",
        731 => "fog",
        741 => "fog",
        751 => "windy",
        761 => "windy",
        762 => "windy",
        771 => "windy",
        781 => "windy",
        800 => "clear",
        801 => "partly-cloudy",
        802 => "cloudy",
        803 | 804 => "overcast",
        _ => "cloudy",
    }
    .to_string()
}

// ---------------------------------------------------------------------------
// Helper: day-of-week label from ISO date string
// ---------------------------------------------------------------------------

fn day_label(iso_date: &str) -> String {
    // Try parsing "YYYY-MM-DD"
    if iso_date.len() >= 10 {
        let parts: Vec<&str> = iso_date[..10].split('-').collect();
        if parts.len() == 3 {
            if let (Ok(y), Ok(m), Ok(d)) = (
                parts[0].parse::<i32>(),
                parts[1].parse::<u32>(),
                parts[2].parse::<u32>(),
            ) {
                // Zeller-like day-of-week calculation (Tomohiko Sakamoto's algorithm)
                let t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
                let mut y = y;
                let m = m as usize;
                if m < 3 {
                    y -= 1;
                }
                let dow = (y + y / 4 - y / 100 + y / 400 + t[m - 1] + d as i32) % 7;
                // 0=Sun, 1=Mon, ...
                let labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
                return labels[dow as usize].to_string();
            }
        }
    }
    iso_date.to_string()
}

fn day_label_from_unix(ts: i64) -> String {
    // Simple conversion: seconds since epoch -> day of week
    // Using modular arithmetic (Jan 1, 1970 was Thursday = 4)
    let days = (ts / 86400 + 4) % 7;
    let labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    // days can be negative for dates before epoch, so use rem_euclid
    labels[days.rem_euclid(7) as usize].to_string()
}

// ---------------------------------------------------------------------------
// Weather settings helper
// ---------------------------------------------------------------------------

fn weather_settings() -> crate::settings::WeatherSettings {
    crate::settings::read_settings().weather
}

// ---------------------------------------------------------------------------
// Resolve location: settings override → IP geolocation
// ---------------------------------------------------------------------------

fn resolve_location(
    client: &reqwest::blocking::Client,
    override_val: &str,
) -> Result<WeatherLocation, String> {
    let ov = override_val.trim();

    // Try "lat,lon" format
    if ov.contains(',') {
        let parts: Vec<&str> = ov.splitn(2, ',').collect();
        if parts.len() == 2 {
            if let (Ok(lat), Ok(lon)) = (
                parts[0].trim().parse::<f64>(),
                parts[1].trim().parse::<f64>(),
            ) {
                return Ok(WeatherLocation {
                    name: format!("{:.2}, {:.2}", lat, lon),
                    latitude: lat,
                    longitude: lon,
                    country: String::new(),
                });
            }
        }
    }

    // Try city name geocoding
    if !ov.is_empty() {
        let geo_url = format!(
            "https://geocoding-api.open-meteo.com/v1/search?name={}&count=1",
            urlencoding::encode(ov)
        );
        if let Ok(resp) = client.get(&geo_url).send() {
            if let Ok(geo) = resp.json::<OpenMeteoGeocodingResponse>() {
                if let Some(results) = geo.results {
                    if let Some(r) = results.into_iter().next() {
                        return Ok(WeatherLocation {
                            name: r.name,
                            latitude: r.latitude,
                            longitude: r.longitude,
                            country: r.country.unwrap_or_default(),
                        });
                    }
                }
            }
        }
        return Err(format!("Could not geocode city name: {}", ov));
    }

    // IP geolocation fallback
    let ip_resp = client
        .get("https://ipapi.co/json/")
        .send()
        .map_err(|e| format!("IP geolocation failed: {e}"))?;
    let ip_data: IpApiCoResponse = ip_resp
        .json()
        .map_err(|e| format!("IP geolocation parse failed: {e}"))?;

    Ok(WeatherLocation {
        name: ip_data.city,
        latitude: ip_data.latitude,
        longitude: ip_data.longitude,
        country: ip_data.country_name,
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn detect_location() -> Result<GeoLocation, String> {
    let client = crate::http_client::blocking_client(
        "Qx/0.2 (Weather; +https://github.com/mcxen/qx)",
        Duration::from_secs(10),
        Some(Duration::from_secs(5)),
    )
    .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get("https://ipapi.co/json/")
        .send()
        .map_err(|e| format!("IP geolocation failed: {e}"))?;

    let data: IpApiCoResponse = resp
        .json()
        .map_err(|e| format!("IP geolocation parse failed: {e}"))?;

    Ok(GeoLocation {
        latitude: data.latitude,
        longitude: data.longitude,
        city: data.city,
        country: data.country_name,
    })
}

#[tauri::command]
pub fn fetch_weather() -> Result<WeatherData, String> {
    let settings = weather_settings();

    let client = crate::http_client::blocking_client(
        "Qx/0.2 (Weather; +https://github.com/mcxen/qx)",
        Duration::from_secs(10),
        Some(Duration::from_secs(5)),
    )
    .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let location = resolve_location(&client, &settings.location_override)?;

    // Choose provider
    if settings.provider == "openweathermap" && !settings.api_key.trim().is_empty() {
        fetch_openweathermap(&client, &location, settings.api_key.trim())
    } else {
        fetch_open_meteo(&client, &location)
    }
}

fn fetch_open_meteo(
    client: &reqwest::blocking::Client,
    location: &WeatherLocation,
) -> Result<WeatherData, String> {
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m,is_day&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto&forecast_days=7",
        location.latitude, location.longitude
    );

    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("Open-Meteo request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Open-Meteo returned status {}", resp.status()));
    }

    let data: OpenMeteoResponse = resp
        .json()
        .map_err(|e| format!("Open-Meteo parse failed: {e}"))?;

    let is_day = data.current.is_day == 1;
    let current = WeatherCurrent {
        temperature: data.current.temperature_2m,
        temp_min: data
            .daily
            .temperature_2m_min
            .first()
            .copied()
            .unwrap_or(0.0),
        temp_max: data
            .daily
            .temperature_2m_max
            .first()
            .copied()
            .unwrap_or(0.0),
        condition_code: map_wmo_code(data.current.weather_code, is_day),
        humidity: data.current.relative_humidity_2m,
        wind_speed: data.current.wind_speed_10m,
    };

    let forecast: Vec<WeatherForecastDay> = data
        .daily
        .time
        .iter()
        .enumerate()
        .skip(1) // skip today (already in current)
        .map(|(i, date)| WeatherForecastDay {
            label: day_label(date),
            temp_min: data.daily.temperature_2m_min.get(i).copied().unwrap_or(0.0),
            temp_max: data.daily.temperature_2m_max.get(i).copied().unwrap_or(0.0),
            condition_code: map_wmo_code(
                data.daily.weather_code.get(i).copied().unwrap_or(3),
                true,
            ),
        })
        .collect();

    Ok(WeatherData {
        location: location.clone(),
        current,
        forecast,
        updated_at: chrono::Utc::now().to_rfc3339(),
        provider: "open-meteo".to_string(),
    })
}

fn fetch_openweathermap(
    client: &reqwest::blocking::Client,
    location: &WeatherLocation,
    api_key: &str,
) -> Result<WeatherData, String> {
    let url = format!(
        "https://api.openweathermap.org/data/3.0/onecall?lat={}&lon={}&appid={}&units=metric&exclude=minutely,hourly,alerts",
        location.latitude, location.longitude, api_key
    );

    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("OpenWeatherMap request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("OpenWeatherMap returned status {}", resp.status()));
    }

    let data: OwmOneCallResponse = resp
        .json()
        .map_err(|e| format!("OpenWeatherMap parse failed: {e}"))?;

    let owm_code = data.current.weather.first().map(|w| w.id).unwrap_or(800);

    let current = WeatherCurrent {
        temperature: data.current.temp,
        temp_min: data
            .daily
            .first()
            .map(|d| d.temp.min)
            .unwrap_or(data.current.temp),
        temp_max: data
            .daily
            .first()
            .map(|d| d.temp.max)
            .unwrap_or(data.current.temp),
        condition_code: map_owm_code(owm_code),
        humidity: data.current.humidity,
        wind_speed: data.current.wind_speed,
    };

    let forecast: Vec<WeatherForecastDay> = data
        .daily
        .iter()
        .skip(1) // skip today
        .take(6)
        .map(|d| WeatherForecastDay {
            label: day_label_from_unix(d.dt),
            temp_min: d.temp.min,
            temp_max: d.temp.max,
            condition_code: map_owm_code(d.weather.first().map(|w| w.id).unwrap_or(800)),
        })
        .collect();

    Ok(WeatherData {
        location: location.clone(),
        current,
        forecast,
        updated_at: chrono::Utc::now().to_rfc3339(),
        provider: "openweathermap".to_string(),
    })
}
