use serde::Serialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// A week of contribution data (7 days, Sunday–Saturday).
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContributionWeek {
    pub days: [u8; 7],
}

/// Full contribution calendar returned to the frontend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContributionCalendar {
    pub weeks: Vec<ContributionWeek>,
    /// The commit-contribution total across all shown weeks.
    pub total_commits: u64,
    /// The GitHub username queried.
    pub username: String,
    /// Unix timestamp of the oldest visible contribution day.
    pub since_ts: i64,
}

/// Parse contribution levels from the raw GitHub profile HTML.
fn extract_contribution_levels(html: &str) -> Vec<u8> {
    // GitHub's contribution SVG uses <rect data-level="0"> through <rect data-level="4">
    // inside <g> elements.  We collect every data-level value found.
    let mut levels: Vec<u8> = Vec::with_capacity(7 * 53); // 371 typical max
    let mut pos = 0;
    let bytes = html.as_bytes();

    loop {
        // Scan for `data-level="` in the byte stream
        let needle = b"data-level=\"";
        let found = match bytes[pos..].windows(needle.len()).position(|w| w == needle) {
            Some(p) => p,
            None => break,
        };
        let start = pos + found + needle.len();

        // Read the single digit that follows (0–4)
        if start < bytes.len() {
            let digit = bytes[start];
            if digit.is_ascii_digit() && digit <= b'4' {
                levels.push(digit - b'0');
            }
        }
        pos = start + 1;
    }

    levels
}

/// Group a flat list of daily levels into weeks (chunks of 7).
/// GitHub's SVG layout pads the first week to start on Sunday,
/// so this grouping is already aligned.
fn group_into_weeks(levels: &[u8]) -> Vec<ContributionWeek> {
    let mut weeks: Vec<ContributionWeek> = Vec::with_capacity(levels.len().div_ceil(7));

    for chunk in levels.chunks(7) {
        let mut days = [0u8; 7];
        for (i, &d) in chunk.iter().enumerate().take(7) {
            days[i] = d;
        }
        weeks.push(ContributionWeek { days });
    }

    weeks
}

#[tauri::command]
pub fn github_contributions(username: String) -> Result<ContributionCalendar, String> {
    let url = format!("https://github.com/{}", username);

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Qx/0.2 (GitHub Calendar; +https://github.com/mcxen/qx)")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("Failed to fetch profile: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub returned status {}", resp.status()));
    }

    let html = resp
        .text()
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    let levels = extract_contribution_levels(&html);

    if levels.is_empty() {
        // Try the legacy /contributions endpoint as fallback
        let legacy_url = format!("https://github.com/users/{}/contributions", username);
        if let Ok(resp) = client.get(&legacy_url).send() {
            if let Ok(text) = resp.text() {
                let fallback = extract_contribution_levels(&text);
                if !fallback.is_empty() {
                    let total = fallback.iter().map(|&l| l as u64).sum();
                    let weeks = group_into_weeks(&fallback);
                    let since_ts = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs() as i64
                        - 365 * 86400;
                    return Ok(ContributionCalendar {
                        weeks,
                        total_commits: total,
                        username,
                        since_ts,
                    });
                }
            }
        }
        return Err(
            "No contribution data found — the profile may be private or the user doesn't exist"
                .to_string(),
        );
    }

    let total: u64 = levels.iter().map(|&l| l as u64).sum();
    let weeks = group_into_weeks(&levels);

    // Approximate: all shown data covers ~1 year back from today
    let since_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
        - 365 * 86400;

    Ok(ContributionCalendar {
        weeks,
        total_commits: total,
        username,
        since_ts,
    })
}

#[tauri::command]
pub fn github_contributions_raw(username: String) -> Result<String, String> {
    // Returns the raw HTML snippet around contribution SVG for debugging
    let url = format!("https://github.com/{}", username);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Qx/0.2 (GitHub Calendar; +https://github.com/mcxen/qx)")
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .map_err(|e| format!("Failed to fetch profile: {e}"))?;

    let html = resp
        .text()
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    // Find the contribution calendar area
    let marker = "ContributionCalendar";
    if let Some(start) = html.find(marker) {
        let begin = start.saturating_sub(200);
        let end = (start + 5000).min(html.len());
        Ok(html[begin..end].to_string())
    } else {
        Err("Contribution calendar not found in profile HTML".to_string())
    }
}
