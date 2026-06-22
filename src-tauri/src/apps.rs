use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Clone)]
pub struct AppEntry {
    pub name: String,
    pub path: String,
    pub icon: String,
}

fn scan_dir(dir: &PathBuf, results: &mut Vec<AppEntry>) {
    if !dir.exists() {
        return;
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e == "app").unwrap_or(false) {
                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                let icon_path = path
                    .join("Contents")
                    .join("Resources")
                    .join(format!("{}.icns", name));
                let icon = if icon_path.exists() {
                    icon_path.to_string_lossy().to_string()
                } else {
                    String::new()
                };
                results.push(AppEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    icon,
                });
            }
        }
    }
}

#[tauri::command]
pub fn search_apps(query: String) -> Vec<AppEntry> {
    let mut results = Vec::new();
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());

    let dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
        PathBuf::from(format!("{}/Applications", home)),
    ];

    for dir in dirs {
        scan_dir(&dir, &mut results);
    }

    if query.is_empty() {
        results.sort_by(|a, b| a.name.cmp(&b.name));
        results.truncate(20);
        return results;
    }

    let q = query.to_lowercase();
    let mut scored: Vec<(i32, AppEntry)> = results
        .into_iter()
        .filter_map(|app| {
            let name_lower = app.name.to_lowercase();
            if name_lower == q {
                Some((0, app))
            } else if name_lower.starts_with(&q) {
                Some((1, app))
            } else if name_lower.contains(&q) {
                Some((2, app))
            } else {
                None
            }
        })
        .collect();

    scored.sort_by_key(|(score, _)| *score);
    scored.truncate(12);
    scored.into_iter().map(|(_, app)| app).collect()
}
