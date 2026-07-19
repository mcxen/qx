//! Clipboard file-list domain helpers shared by storage and platform adapters.

use std::collections::HashSet;

pub(super) fn normalize(paths: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty() && seen.insert(path.clone()))
        .collect()
}

pub(super) fn decode(json: Option<&str>, primary: Option<&str>) -> Vec<String> {
    let decoded = json
        .and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
        .unwrap_or_default();
    let mut paths = normalize(decoded);
    if paths.is_empty() {
        if let Some(primary) = primary.filter(|value| !value.is_empty()) {
            paths.push(primary.to_string());
        }
    }
    paths
}

pub(super) fn identity_seed(paths: &[String]) -> Option<String> {
    match paths {
        [] => None,
        [path] => Some(path.clone()),
        _ => Some(paths.join("\0")),
    }
}

#[cfg(test)]
mod tests {
    use super::{decode, identity_seed, normalize};

    #[test]
    fn file_lists_keep_order_and_remove_duplicates() {
        let paths = normalize([
            r"C:\work\folder".to_string(),
            r"C:\work\note.txt".to_string(),
            r"C:\work\folder".to_string(),
        ]);
        assert_eq!(paths.len(), 2);
        assert_ne!(identity_seed(&paths), identity_seed(&paths[..1]));
        assert_eq!(identity_seed(&paths[..1]), Some(paths[0].clone()));
    }

    #[test]
    fn legacy_primary_path_backfills_the_file_list_contract() {
        assert_eq!(
            decode(None, Some(r"C:\work\folder")),
            vec![r"C:\work\folder".to_string()]
        );
        assert_eq!(
            decode(Some(r#"["C:\\one","C:\\two"]"#), None),
            vec![r"C:\one".to_string(), r"C:\two".to_string()]
        );
    }
}
