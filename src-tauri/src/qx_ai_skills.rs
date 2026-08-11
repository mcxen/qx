use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::command;

const MAX_SKILL_BYTES: u64 = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxAiSkillSummary {
    id: String,
    name: String,
    description: String,
    path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxAiSkillDocument {
    #[serde(flatten)]
    summary: QxAiSkillSummary,
    content: String,
}

fn skills_dir() -> PathBuf {
    crate::paths::state_dir().join("skills")
}

fn ensure_skills_dir() -> Result<PathBuf, String> {
    let dir = skills_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("create skills directory: {e}"))?;
    Ok(dir)
}

fn frontmatter_value(content: &str, key: &str) -> Option<String> {
    let mut lines = content.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }
    for line in lines {
        let line = line.trim();
        if line == "---" {
            break;
        }
        if let Some(value) = line.strip_prefix(&format!("{key}:")) {
            return Some(value.trim().trim_matches(['\'', '"']).to_string());
        }
    }
    None
}

fn fallback_name(content: &str, id: &str) -> String {
    content
        .lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::trim))
        .filter(|line| !line.is_empty())
        .unwrap_or(id)
        .to_string()
}

fn fallback_description(content: &str) -> String {
    let mut lines = content.lines();
    if lines.next().is_some_and(|line| line.trim() == "---") {
        for line in lines.by_ref() {
            if line.trim() == "---" {
                break;
            }
        }
    } else {
        lines = content.lines();
    }
    lines
        .find_map(|line| {
            let line = line.trim();
            (!line.is_empty() && !line.starts_with('#')).then_some(line)
        })
        .unwrap_or("")
        .chars()
        .take(180)
        .collect()
}

fn summary_for(path: &Path, id: String, content: &str) -> QxAiSkillSummary {
    QxAiSkillSummary {
        name: frontmatter_value(content, "name").unwrap_or_else(|| fallback_name(content, &id)),
        description: frontmatter_value(content, "description")
            .unwrap_or_else(|| fallback_description(content)),
        path: path.to_string_lossy().to_string(),
        id,
    }
}

fn read_skill_file(path: &Path) -> Result<String, String> {
    let metadata =
        fs::metadata(path).map_err(|e| format!("inspect skill {}: {e}", path.display()))?;
    if metadata.len() > MAX_SKILL_BYTES {
        return Err(format!(
            "skill {} exceeds the {} KiB limit",
            path.display(),
            MAX_SKILL_BYTES / 1024
        ));
    }
    fs::read_to_string(path).map_err(|e| format!("read skill {}: {e}", path.display()))
}

fn discover_skills() -> Result<Vec<QxAiSkillSummary>, String> {
    let root = ensure_skills_dir()?;
    let mut skills = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| format!("read skills directory: {e}"))? {
        let entry = entry.map_err(|e| format!("read skill entry: {e}"))?;
        let path = entry.path();
        let (id, document) = if path.is_dir() {
            let Some(id) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            (id.to_string(), path.join("SKILL.md"))
        } else if path.extension().and_then(|value| value.to_str()) == Some("md") {
            let Some(id) = path.file_stem().and_then(|value| value.to_str()) else {
                continue;
            };
            if id.eq_ignore_ascii_case("README") {
                continue;
            }
            (id.to_string(), path.clone())
        } else {
            continue;
        };
        if !document.is_file() {
            continue;
        }
        let Ok(content) = read_skill_file(&document) else {
            continue;
        };
        skills.push(summary_for(&document, id, &content));
    }
    skills.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    Ok(skills)
}

#[command]
pub async fn qxai_skills_directory() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        ensure_skills_dir().map(|path| path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("skills directory task failed: {e}"))?
}

#[command]
pub async fn qxai_list_skills() -> Result<Vec<QxAiSkillSummary>, String> {
    tauri::async_runtime::spawn_blocking(discover_skills)
        .await
        .map_err(|e| format!("skill scan task failed: {e}"))?
}

#[command]
pub async fn qxai_read_skill(id: String) -> Result<QxAiSkillDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let summary = discover_skills()?
            .into_iter()
            .find(|skill| skill.id == id)
            .ok_or_else(|| format!("skill not found: {id}"))?;
        let content = read_skill_file(Path::new(&summary.path))?;
        Ok(QxAiSkillDocument { summary, content })
    })
    .await
    .map_err(|e| format!("read skill task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::{fallback_description, fallback_name, frontmatter_value};

    #[test]
    fn parses_skill_metadata_and_markdown_fallbacks() {
        let yaml = "---\nname: File Helper\ndescription: Finds files\n---\n# Ignored";
        assert_eq!(
            frontmatter_value(yaml, "name").as_deref(),
            Some("File Helper")
        );
        assert_eq!(
            frontmatter_value(yaml, "description").as_deref(),
            Some("Finds files")
        );
        let markdown = "# Screenshot Expert\n\nCapture and annotate screens.";
        assert_eq!(fallback_name(markdown, "fallback"), "Screenshot Expert");
        assert_eq!(
            fallback_description(markdown),
            "Capture and annotate screens."
        );
    }
}
