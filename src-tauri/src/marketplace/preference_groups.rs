use std::collections::BTreeSet;

use super::{PluginCommand, PluginPreference};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginPreferenceGroup {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub titles: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub descriptions: std::collections::HashMap<String, String>,
    #[serde(default, rename = "preferenceIds")]
    pub preference_ids: Vec<String>,
    #[serde(default = "default_save_mode", rename = "saveMode")]
    pub save_mode: String,
    #[serde(default, rename = "connectionCheck")]
    pub connection_check: Option<PluginPreferenceConnectionCheck>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginPreferenceConnectionCheck {
    pub command: String,
    #[serde(default)]
    pub title: String,
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub titles: std::collections::HashMap<String, String>,
}

fn default_save_mode() -> String {
    "autosave".to_string()
}

pub fn validate_preference_groups(
    groups: &[PluginPreferenceGroup],
    preferences: &[PluginPreference],
    commands: &[PluginCommand],
) -> Result<(), String> {
    if groups.len() > 32 {
        return Err("manifest.preferenceGroups exceeds 32 entries".to_string());
    }
    let preference_ids: BTreeSet<&str> = preferences
        .iter()
        .map(|preference| preference.id.as_str())
        .collect();
    let command_names: BTreeSet<&str> = commands
        .iter()
        .map(|command| command.name.as_str())
        .collect();
    let mut group_ids = BTreeSet::new();
    let mut assigned_preference_ids = BTreeSet::new();

    for group in groups {
        let group_id = group.id.trim();
        if group_id.is_empty() || group_id.len() > 64 || group_id.chars().any(char::is_control) {
            return Err("manifest.preferenceGroups contains an invalid group id".to_string());
        }
        if !group_ids.insert(group_id) {
            return Err(format!("duplicate plugin preference group: {group_id}"));
        }
        if group.title.trim().is_empty() || group.title.len() > 160 {
            return Err(format!(
                "invalid title for plugin preference group: {group_id}"
            ));
        }
        if group.description.len() > 500 {
            return Err(format!(
                "description is too long for plugin preference group: {group_id}"
            ));
        }
        if !matches!(group.save_mode.as_str(), "autosave" | "manual") {
            return Err(format!(
                "invalid saveMode for plugin preference group: {group_id}"
            ));
        }
        let mut group_preference_ids = BTreeSet::new();
        for preference_id in &group.preference_ids {
            let preference_id = preference_id.trim();
            if !preference_ids.contains(preference_id) {
                return Err(format!(
                    "plugin preference group {group_id} references unknown preference: {preference_id}"
                ));
            }
            if !group_preference_ids.insert(preference_id) {
                return Err(format!(
                    "duplicate preference in plugin preference group {group_id}: {preference_id}"
                ));
            }
            if !assigned_preference_ids.insert(preference_id) {
                return Err(format!(
                    "preference assigned to multiple plugin groups: {preference_id}"
                ));
            }
        }
        if let Some(check) = &group.connection_check {
            let command = check.command.trim();
            if command.is_empty() || !command_names.contains(command) {
                return Err(format!(
                    "plugin preference group {group_id} references unknown connection check command: {command}"
                ));
            }
            if commands
                .iter()
                .find(|candidate| candidate.name == command)
                .is_some_and(|candidate| !candidate.interval.trim().is_empty())
            {
                return Err(format!(
                    "plugin preference group {group_id} connection check cannot be an interval command: {command}"
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preference(id: &str) -> PluginPreference {
        PluginPreference {
            id: id.to_string(),
            label: id.to_string(),
            labels: Default::default(),
            pref_type: "string".to_string(),
            required: false,
            default: None,
            options: vec![],
            description: String::new(),
            descriptions: Default::default(),
            rows: None,
            placeholder: None,
            placeholders: Default::default(),
            min: None,
            max: None,
            step: None,
            unit: None,
        }
    }

    fn command(name: &str) -> PluginCommand {
        PluginCommand {
            name: name.to_string(),
            title: name.to_string(),
            titles: Default::default(),
            description: String::new(),
            descriptions: Default::default(),
            icon: String::new(),
            keywords: vec![],
            mode: String::new(),
            interval: String::new(),
            background_category: String::new(),
        }
    }

    fn group(ids: &[&str]) -> PluginPreferenceGroup {
        PluginPreferenceGroup {
            id: "connection".to_string(),
            title: "Connection".to_string(),
            titles: Default::default(),
            description: String::new(),
            descriptions: Default::default(),
            preference_ids: ids.iter().map(|id| (*id).to_string()).collect(),
            save_mode: "manual".to_string(),
            connection_check: Some(PluginPreferenceConnectionCheck {
                command: "check".to_string(),
                title: String::new(),
                titles: Default::default(),
            }),
        }
    }

    #[test]
    fn validates_groups_and_connection_command() {
        assert!(validate_preference_groups(
            &[group(&["url", "pat"])],
            &[preference("url"), preference("pat")],
            &[command("check")],
        )
        .is_ok());
    }

    #[test]
    fn rejects_duplicate_preference_ids() {
        assert!(validate_preference_groups(
            &[group(&["url", "url"])],
            &[preference("url")],
            &[command("check")],
        )
        .is_err());
    }

    #[test]
    fn rejects_duplicate_group_ids() {
        let first = group(&["url"]);
        let mut second = group(&["pat"]);
        second.id = first.id.clone();
        assert!(validate_preference_groups(
            &[first, second],
            &[preference("url"), preference("pat")],
            &[command("check")],
        )
        .is_err());
    }

    #[test]
    fn rejects_unknown_preference_and_command() {
        assert!(validate_preference_groups(
            &[group(&["missing"])],
            &[preference("url")],
            &[command("check")],
        )
        .is_err());
        let mut invalid = group(&["url"]);
        invalid.connection_check.as_mut().unwrap().command = "missing".to_string();
        assert!(
            validate_preference_groups(&[invalid], &[preference("url")], &[command("check")],)
                .is_err()
        );
    }

    #[test]
    fn old_manifest_without_groups_is_valid() {
        assert!(validate_preference_groups(&[], &[preference("url")], &[]).is_ok());
    }

    #[test]
    fn serde_uses_manifest_camel_case_keys() {
        let decoded: PluginPreferenceGroup = serde_json::from_value(serde_json::json!({
            "id": "connection",
            "title": "Connection",
            "preferenceIds": ["url"],
            "saveMode": "manual",
            "connectionCheck": { "command": "check" }
        }))
        .expect("decode preference group");
        assert_eq!(decoded.preference_ids, vec!["url"]);
        assert_eq!(decoded.save_mode, "manual");
        assert_eq!(decoded.connection_check.unwrap().command, "check");
    }
}
