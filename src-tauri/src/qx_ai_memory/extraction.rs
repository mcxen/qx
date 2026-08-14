//! Model-facing selective memory extraction.
//!
//! This module has no storage authority. It returns bounded candidates (including
//! an empty list); the parent module validates lineage and commits them atomically.

use crate::g4f::{self, ChatMessage};
use serde::Deserialize;
use serde_json::json;

#[derive(Debug, Clone, Deserialize)]
pub(super) struct ExtractionCandidate {
    pub target: String,
    pub content: String,
    #[serde(default = "default_memory_type", rename = "type")]
    pub memory_type: String,
    #[serde(default = "default_importance")]
    pub importance: i64,
    #[serde(default)]
    pub supersedes: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ExtractionResponse {
    #[serde(default)]
    candidates: Vec<ExtractionCandidate>,
    #[serde(default)]
    diary: String,
}

fn default_memory_type() -> String {
    "episodic".to_string()
}

fn default_importance() -> i64 {
    50
}

pub(super) fn extract_candidates(
    provider: Option<String>,
    model: Option<String>,
    existing: &str,
    transcript: &str,
    mode: &str,
) -> Result<(Vec<ExtractionCandidate>, String), String> {
    let prompt = format!(
        r#"You are QxAI's selective memory extractor.

Return ONLY JSON in this shape:
{{"candidates":[{{"target":"memory|user","content":"one compact fact","type":"core|episodic","importance":0,"supersedes":["source-id"]}}],"diary":"short decision note"}}

Rules:
- It is correct and preferred to return an empty candidates array when nothing is durable.
- Never store routine tool output, acknowledgements, transient status, raw logs, or secrets.
- core: stable identity, preference, constraint, project invariant, or durable lesson that should stay in prompt.
- episodic: useful event/context that should only be found by search.
- Importance is 0-100. Use >=70 only for genuinely durable core facts.
- Use supersedes only when a candidate materially replaces or consolidates listed source ids.
- Do not copy an existing fact merely to rephrase it.

Mode: {mode}
Existing active core records (id | target | content):
{existing}

Recent conversation or manual input:
{transcript}
"#,
    );
    let messages = vec![
        ChatMessage {
            role: "system".into(),
            content: json!(
                "Extract selective long-term memory. JSON only; empty candidates are valid."
            ),
        },
        ChatMessage {
            role: "user".into(),
            content: json!(prompt),
        },
    ];
    let raw = g4f::qxai_chat(provider, model, messages)?;
    let extracted = extract_json_object(&raw).unwrap_or(raw);
    let parsed: ExtractionResponse = serde_json::from_str(&extracted)
        .map_err(|e| format!("memory extractor returned non-JSON: {e}; raw={extracted}"))?;
    Ok((parsed.candidates, parsed.diary.trim().to_string()))
}

fn extract_json_object(raw: &str) -> Option<String> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    (end >= start).then(|| raw[start..=end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_candidate_response_is_valid() {
        let parsed: ExtractionResponse = serde_json::from_value(json!({
            "candidates": [],
            "diary": "nothing durable"
        }))
        .expect("valid extraction response");
        assert!(parsed.candidates.is_empty());
    }
}
