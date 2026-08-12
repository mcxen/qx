use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::command;

const MAX_SKILL_BYTES: u64 = 256 * 1024;

/// How a skill is loaded into the agent context.
/// - fixed: always inject into the system prompt
/// - smart: auto-select by user query relevance
/// - disabled: never load unless the user explicitly picks it with `/`
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QxAiSkillMode {
    Fixed,
    Smart,
    Disabled,
}

impl Default for QxAiSkillMode {
    fn default() -> Self {
        Self::Smart
    }
}

impl QxAiSkillMode {
    fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "fixed" | "always" | "pinned" => Self::Fixed,
            "disabled" | "off" | "false" | "0" => Self::Disabled,
            _ => Self::Smart,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Fixed => "fixed",
            Self::Smart => "smart",
            Self::Disabled => "disabled",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QxAiSkillSummary {
    id: String,
    name: String,
    description: String,
    path: String,
    /// Declared load mode from skill frontmatter (settings may override in UI).
    mode: QxAiSkillMode,
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
    let mode = frontmatter_value(content, "mode")
        .map(|value| QxAiSkillMode::parse(&value))
        .unwrap_or_default();
    QxAiSkillSummary {
        name: frontmatter_value(content, "name").unwrap_or_else(|| fallback_name(content, &id)),
        description: frontmatter_value(content, "description")
            .unwrap_or_else(|| fallback_description(content)),
        path: path.to_string_lossy().to_string(),
        id,
        mode,
    }
}

fn sanitize_skill_id(id: &str) -> Result<String, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("skill id is empty".to_string());
    }
    if id.contains(['/', '\\', ':']) || id == ".." || id.contains("..") {
        return Err("skill id must be a simple file stem".to_string());
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err("skill id may only contain letters, numbers, '.', '-', '_'".to_string());
    }
    Ok(id.to_string())
}

fn skill_document_path(id: &str) -> Result<PathBuf, String> {
    let id = sanitize_skill_id(id)?;
    let root = ensure_skills_dir()?;
    let folder = root.join(&id);
    if folder.is_dir() {
        return Ok(folder.join("SKILL.md"));
    }
    Ok(root.join(format!("{id}.md")))
}

fn upsert_frontmatter_mode(content: &str, mode: QxAiSkillMode) -> String {
    let mode_line = format!("mode: {}", mode.as_str());
    let mut lines = content.lines().peekable();
    if lines.peek().map(|line| line.trim()) != Some("---") {
        return format!("---\n{mode_line}\n---\n\n{content}");
    }
    let mut out = String::from("---\n");
    lines.next();
    let mut saw_mode = false;
    let mut closed = false;
    for line in lines {
        if !closed && line.trim() == "---" {
            if !saw_mode {
                out.push_str(&mode_line);
                out.push('\n');
            }
            out.push_str("---\n");
            closed = true;
            continue;
        }
        if !closed {
            if line.trim().starts_with("mode:") {
                if !saw_mode {
                    out.push_str(&mode_line);
                    out.push('\n');
                    saw_mode = true;
                }
                continue;
            }
            out.push_str(line);
            out.push('\n');
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    if !closed {
        if !saw_mode {
            out.push_str(&mode_line);
            out.push('\n');
        }
        out.push_str("---\n");
    }
    out
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

/// Create or overwrite a skill document. Agents and Settings use this port.
#[command]
pub async fn qxai_write_skill(
    id: String,
    content: String,
    mode: Option<String>,
) -> Result<QxAiSkillDocument, String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_skill_for_host(&id, &content, mode.as_deref())
    })
    .await
    .map_err(|e| format!("write skill task failed: {e}"))?
}

/// Host-side helpers for schedule seeding and offline jobs.
pub(crate) fn skill_exists(id: &str) -> bool {
    skill_document_path(id)
        .map(|path| path.is_file())
        .unwrap_or(false)
}

pub(crate) fn read_skill_content_for_host(id: &str) -> Result<String, String> {
    let path = skill_document_path(id)?;
    if !path.is_file() {
        return Err(format!("skill not found: {id}"));
    }
    read_skill_file(&path)
}

pub(crate) fn write_skill_for_host(
    id: &str,
    content: &str,
    mode: Option<&str>,
) -> Result<QxAiSkillDocument, String> {
    let path = skill_document_path(id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create skill parent: {e}"))?;
    }
    let mut body = content.to_string();
    if let Some(mode) = mode {
        body = upsert_frontmatter_mode(&body, QxAiSkillMode::parse(mode));
    }
    if body.as_bytes().len() as u64 > MAX_SKILL_BYTES {
        return Err(format!(
            "skill exceeds the {} KiB limit",
            MAX_SKILL_BYTES / 1024
        ));
    }
    fs::write(&path, &body).map_err(|e| format!("write skill {}: {e}", path.display()))?;
    let id = sanitize_skill_id(id)?;
    let summary = summary_for(&path, id, &body);
    Ok(QxAiSkillDocument {
        summary,
        content: body,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        fallback_description, fallback_name, frontmatter_value, upsert_frontmatter_mode,
        QxAiSkillMode,
    };

    #[test]
    fn parses_skill_metadata_and_markdown_fallbacks() {
        let yaml = "---\nname: File Helper\ndescription: Finds files\nmode: fixed\n---\n# Ignored";
        assert_eq!(
            frontmatter_value(yaml, "name").as_deref(),
            Some("File Helper")
        );
        assert_eq!(
            frontmatter_value(yaml, "description").as_deref(),
            Some("Finds files")
        );
        assert_eq!(frontmatter_value(yaml, "mode").as_deref(), Some("fixed"));
        let markdown = "# Screenshot Expert\n\nCapture and annotate screens.";
        assert_eq!(fallback_name(markdown, "fallback"), "Screenshot Expert");
        assert_eq!(
            fallback_description(markdown),
            "Capture and annotate screens."
        );
    }

    #[test]
    fn upserts_mode_into_frontmatter() {
        let raw = "---\nname: Demo\n---\nBody";
        let next = upsert_frontmatter_mode(raw, QxAiSkillMode::Fixed);
        assert!(next.contains("mode: fixed"));
        assert!(next.contains("name: Demo"));
    }
}
