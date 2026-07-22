use crate::apps::AppEntry;
use crate::settings::{default_file_search_categories, FileSearchCategory};
#[cfg(target_os = "macos")]
use fswalk::NodeFileType;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
#[cfg(target_os = "macos")]
use std::sync::Mutex;
use std::sync::OnceLock;
use tauri::Manager;

static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();
static ACTIVE_FILE_SEARCH_VERSION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy)]
struct FileSearchCancellation {
    version: Option<u64>,
}

impl FileSearchCancellation {
    fn new(request_id: Option<u64>, starts_generation: bool) -> Self {
        let version = match request_id {
            Some(version) => {
                if starts_generation {
                    ACTIVE_FILE_SEARCH_VERSION.store(version, AtomicOrdering::SeqCst);
                }
                Some(version)
            }
            // Compatibility callers that do not participate in the launcher
            // generation protocol stay independent instead of cancelling it.
            None => None,
        };
        Self { version }
    }

    fn is_cancelled(self) -> bool {
        self.version.is_some_and(|version| {
            version != ACTIVE_FILE_SEARCH_VERSION.load(AtomicOrdering::Relaxed)
        })
    }
}

pub fn init(app: &tauri::AppHandle) {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let _ = RESOURCE_DIR.set(resource_dir);
    }
    init_platform();
}

#[cfg(target_os = "macos")]
pub(crate) fn refresh_platform_permissions() {
    init_platform();
}

/// Progressive file search.
///
/// - `pass = 0`: fast first paint (name-focused / first strategies)
/// - `pass = 1`: expanded recall (remaining local-index strategies)
/// - `pass = 2`: system fallback / broader mdfind (or extra Everything strategies)
///
/// The frontend runs these asynchronously and **merges** results so later passes
/// chase onto the list without blocking the first response.
pub async fn search(
    query: String,
    limit: usize,
    pass: u32,
    categories: Vec<FileSearchCategory>,
    category_id: Option<String>,
    request_id: Option<u64>,
) -> Vec<AppEntry> {
    let Some(q) = normalize_query(&query) else {
        return Vec::new();
    };

    let categories = normalize_categories(categories);
    // Allocate the generation before entering the blocking pool. A newer invoke
    // invalidates queued/active work even when an older task has not started yet.
    let cancellation = FileSearchCancellation::new(request_id, pass == 0);
    tauri::async_runtime::spawn_blocking(move || {
        if cancellation.is_cancelled() {
            return Vec::new();
        }
        search_platform(
            &q,
            limit,
            pass,
            &categories,
            category_id.as_deref(),
            cancellation,
        )
    })
    .await
    .unwrap_or_default()
}

fn normalize_query(query: &str) -> Option<String> {
    let normalized = query.split_whitespace().collect::<Vec<_>>().join(" ");
    (!normalized.is_empty()).then_some(normalized)
}

fn entry_from_path(path: &str) -> AppEntry {
    entry_from_path_with_kind(path, PathBuf::from(path).is_dir())
}

fn entry_from_path_with_kind(path: &str, is_dir: bool) -> AppEntry {
    let modified = std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs());
    entry_from_path_with_metadata(path, is_dir, modified)
}

fn entry_from_path_with_metadata(path: &str, is_dir: bool, modified_at: Option<u64>) -> AppEntry {
    let path_buf = PathBuf::from(path);
    let name = path_buf
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string();
    AppEntry {
        name: name.clone(),
        display_name: name,
        path: path.to_string(),
        icon: if is_dir {
            "builtin:folder".to_string()
        } else {
            "builtin:file".to_string()
        },
        kind: if is_dir {
            "folder".to_string()
        } else {
            "file".to_string()
        },
        modified_at,
        aliases: String::new(),
    }
}

fn normalize_categories(categories: Vec<FileSearchCategory>) -> Vec<FileSearchCategory> {
    let source = if categories.is_empty() {
        default_file_search_categories()
    } else {
        categories
    };
    let mut seen = std::collections::HashSet::new();
    let mut normalized = source
        .into_iter()
        .filter_map(|mut category| {
            category.id = category.id.trim().to_string();
            category.label = category.label.trim().to_string();
            if category.id.is_empty()
                || category.label.is_empty()
                || !seen.insert(category.id.clone())
            {
                return None;
            }
            category.extensions = category
                .extensions
                .into_iter()
                .map(|value| value.trim().trim_start_matches('.').to_ascii_lowercase())
                .filter(|value| !value.is_empty())
                .collect();
            Some(category)
        })
        .collect::<Vec<_>>();
    if !normalized.iter().any(|category| category.catch_all) {
        normalized.push(FileSearchCategory {
            id: "other".to_string(),
            label: "Other Files".to_string(),
            extensions: Vec::new(),
            include_folders: false,
            catch_all: true,
        });
    }
    normalized
}

fn file_category_rank(path: &Path, is_dir: bool, categories: &[FileSearchCategory]) -> usize {
    if is_dir {
        return categories
            .iter()
            .position(|category| category.include_folders)
            .or_else(|| categories.iter().position(|category| category.catch_all))
            .unwrap_or(categories.len());
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    categories
        .iter()
        .position(|category| {
            !category.catch_all
                && category
                    .extensions
                    .iter()
                    .any(|value| value.eq_ignore_ascii_case(&extension))
        })
        .or_else(|| categories.iter().position(|category| category.catch_all))
        .unwrap_or(categories.len())
}

/// Dot-segments and well-known system junk — demote to the end of results.
fn is_hidden_path(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(name) => {
            let value = name.to_string_lossy();
            if value.starts_with('.') && value != "." && value != ".." {
                return true;
            }
            matches!(
                value.as_ref(),
                "$Recycle.Bin"
                    | "System Volume Information"
                    | "Recovery"
                    | "node_modules"
                    | "__pycache__"
            )
        }
        _ => false,
    })
}

/// Lower = better. Prefer everyday office docs over code/junk when name match quality is equal.
///
/// Cardinal/Everything return many leaf-name hits; without a type prior, `.ts` / logs /
/// build artifacts crowd out PDF / Word / Excel that users actually open.
fn document_type_rank(path: &Path) -> u8 {
    let Some(ext) = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
    else {
        // No extension: treat as ordinary file (after office, before source).
        return 28;
    };
    match ext.as_str() {
        // Primary office / productivity documents
        "pdf" => 0,
        "doc" | "docx" | "dot" | "dotx" | "rtf" | "odt" | "pages" => 1,
        "xls" | "xlsx" | "xlsm" | "xlsb" | "csv" | "tsv" | "ods" | "numbers" => 2,
        "ppt" | "pptx" | "pps" | "ppsx" | "key" | "odp" => 3,
        // Secondary user documents
        "txt" | "md" | "markdown" | "text" => 10,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "heic" | "heif" | "tif" | "tiff" | "bmp"
        | "svg" => 12,
        "mp4" | "mov" | "m4v" | "mkv" | "avi" | "webm" | "mp3" | "m4a" | "wav" | "aac" | "flac" => {
            14
        }
        // Packages / archives users still open from search
        "zip" | "rar" | "7z" | "tar" | "gz" | "tgz" | "dmg" | "pkg" => 18,
        // Source / build noise — demote hard
        "rs" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "py" | "go" | "java" | "kt"
        | "swift" | "c" | "cc" | "cpp" | "cxx" | "h" | "hpp" | "m" | "mm" | "cs" | "rb" | "php"
        | "vue" | "svelte" | "astro" | "json" | "jsonc" | "yml" | "yaml" | "toml" | "lock"
        | "map" | "wasm" | "o" | "a" | "so" | "dylib" | "class" | "pyc" | "pyo" | "log" => 40,
        // Everything else
        _ => 25,
    }
}

fn search_tokens(value: &str) -> Vec<String> {
    value
        .to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn compact_search_text(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn fuzzy_query_is_long_enough(value: &str) -> bool {
    let chars = value.chars().collect::<Vec<_>>();
    let minimum = if chars.iter().all(|character| character.is_ascii()) {
        5
    } else {
        3
    };
    chars.len() >= minimum
}

/// Returns a small gap penalty when every query character occurs in order and
/// the match remains dense. Short names such as "Siri" must stay literal:
/// treating them as `s*i*r*i` floods results with unrelated long filenames.
fn fuzzy_subsequence_penalty(needle: &str, haystack: &str) -> Option<u16> {
    let needle_chars = needle.chars().collect::<Vec<_>>();
    if !fuzzy_query_is_long_enough(needle) {
        return None;
    }
    let mut next = 0usize;
    let mut first = None;
    let mut last = 0usize;
    let mut gaps = 0usize;
    for (index, character) in haystack.chars().enumerate() {
        if needle_chars.get(next) != Some(&character) {
            continue;
        }
        if let Some(previous) = first.map(|_| last) {
            gaps = gaps.saturating_add(index.saturating_sub(previous + 1));
        } else {
            first = Some(index);
        }
        last = index;
        next += 1;
        if next == needle_chars.len() {
            // At most one skipped character per query transition. This still
            // supports compact abbreviations such as `sftwy` → `spftowery`,
            // but rejects `siri` scattered across `PersistentOriginTrials`.
            if gaps > needle_chars.len().saturating_sub(1) {
                return None;
            }
            return Some((first.unwrap_or(0).saturating_add(gaps)).min(220) as u16);
        }
    }
    None
}

fn fuzzy_wildcard(value: &str) -> Option<String> {
    let compact = compact_search_text(value);
    if !fuzzy_query_is_long_enough(&compact) {
        return None;
    }
    Some(format!(
        "*{}*",
        compact
            .chars()
            .map(|character| character.to_string())
            .collect::<Vec<_>>()
            .join("*")
    ))
}

/// File search is **name-only**. Separators are weak boundaries; only longer,
/// dense abbreviations may match as an ordered fuzzy subsequence.
fn name_matches_query(path: &Path, query: &str) -> bool {
    let q = query.trim();
    if q.is_empty() {
        return false;
    }
    let name_lower = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let q_lower = q.to_lowercase();

    if name_lower.contains(&q_lower) {
        return true;
    }

    // Separators are interchangeable: spaces match `-`, `_`, `.`, etc.
    let tokens = search_tokens(&q_lower);
    if tokens.len() > 1 && tokens.iter().all(|token| name_lower.contains(token)) {
        return true;
    }

    let compact_query = compact_search_text(&q_lower);
    let compact_name = compact_search_text(&name_lower);
    (!compact_query.is_empty() && compact_name.contains(&compact_query))
        || fuzzy_subsequence_penalty(&compact_query, &compact_name).is_some()
}

fn relevance_rank(path: &Path, query: &str) -> u16 {
    // Name-only ranking (Unicode lowercase for CJK).
    let needle = query.trim().to_lowercase();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let query_tokens = search_tokens(&needle);
    let compact_query = compact_search_text(&needle);
    let compact_name = compact_search_text(&file_name);
    let compact_stem = compact_search_text(&stem);
    if file_name == needle {
        0
    } else if stem == needle {
        1
    } else if file_name.starts_with(&needle) {
        2
    } else if file_name
        .split(|character: char| !character.is_alphanumeric())
        .any(|part| part.starts_with(&needle))
    {
        3
    } else if file_name.contains(&needle) {
        4
    } else if !compact_query.is_empty() && compact_stem == compact_query {
        5
    } else if !compact_query.is_empty() && compact_name.starts_with(&compact_query) {
        6
    } else if !compact_query.is_empty() && compact_name.contains(&compact_query) {
        7
    } else if query_tokens.len() > 1 && query_tokens.iter().all(|token| file_name.contains(token)) {
        8
    } else if let Some(penalty) = fuzzy_subsequence_penalty(&compact_query, &compact_name) {
        20 + penalty
    } else {
        // Not a name match — should be filtered out before ranking.
        u16::MAX
    }
}

/// Composite sort key shared by Cardinal / mdfind / Everything ranking paths.
/// Lower tuple = higher in the list. Name match still dominates type bias.
fn file_sort_key(
    path: &Path,
    query: &str,
    is_dir: bool,
    modified: u64,
    strategy_rank: usize,
    categories: &[FileSearchCategory],
) -> (u8, usize, u16, std::cmp::Reverse<u64>, u8, usize, usize) {
    (
        is_hidden_path(path) as u8,
        file_category_rank(path, is_dir, categories),
        // Active search is relevance-first inside each visible category.
        relevance_rank(path, query),
        std::cmp::Reverse(modified),
        // Preserve the old type bias only as a final tie-break inside custom groups.
        if is_dir { 50 } else { document_type_rank(path) },
        strategy_rank,
        path.as_os_str().len(),
    )
}

/// Preserve at least one hit from every matched user category before filling
/// the remaining window, then restore category/newest-first order. This keeps a
/// busy first category from consuming Cardinal's entire public result window.
#[cfg(test)]
fn limit_ranked_entries(
    entries: Vec<AppEntry>,
    query: &str,
    limit: usize,
    categories: &[FileSearchCategory],
) -> Vec<AppEntry> {
    limit_ranked_entries_for_category(entries, query, limit, categories, None)
}

fn limit_ranked_entries_for_category(
    mut entries: Vec<AppEntry>,
    query: &str,
    limit: usize,
    categories: &[FileSearchCategory],
    category_id: Option<&str>,
) -> Vec<AppEntry> {
    if let Some(category_id) = category_id {
        entries.retain(|entry| {
            let rank =
                file_category_rank(Path::new(&entry.path), entry.kind == "folder", categories);
            categories.get(rank).map(|category| category.id.as_str()) == Some(category_id)
        });
    }
    let sort_key = |entry: &AppEntry| {
        let path = PathBuf::from(&entry.path);
        file_sort_key(
            &path,
            query,
            entry.kind == "folder",
            entry.modified_at.unwrap_or(0),
            0,
            categories,
        )
    };
    entries.sort_by_key(&sort_key);
    if entries.len() <= limit {
        return entries;
    }

    let mut buckets = (0..=categories.len())
        .map(|_| std::collections::VecDeque::new())
        .collect::<Vec<_>>();
    for entry in entries {
        let rank = file_category_rank(Path::new(&entry.path), entry.kind == "folder", categories)
            .min(categories.len());
        buckets[rank].push_back(entry);
    }

    let mut selected = Vec::with_capacity(limit);
    while selected.len() < limit {
        let mut added = false;
        for bucket in &mut buckets {
            if let Some(entry) = bucket.pop_front() {
                selected.push(entry);
                added = true;
                if selected.len() == limit {
                    break;
                }
            }
        }
        if !added {
            break;
        }
    }
    selected.sort_by_key(sort_key);
    selected
}

#[cfg(target_os = "windows")]
fn resource_bin(name: &str) -> Option<PathBuf> {
    let dir = RESOURCE_DIR.get()?;
    [
        dir.join("search").join(name),
        dir.join("resources").join("search").join(name),
    ]
    .into_iter()
    .find(|path| path.exists())
}

#[cfg(target_os = "macos")]
#[path = "file_search/platform_macos.rs"]
mod platform;

#[cfg(target_os = "windows")]
#[path = "file_search/platform_windows.rs"]
mod platform;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::*;

    pub fn init_platform() {}

    pub fn search_platform(
        _query: &str,
        _limit: usize,
        _pass: u32,
        _categories: &[FileSearchCategory],
        _category_id: Option<&str>,
        _cancellation: FileSearchCancellation,
    ) -> Vec<AppEntry> {
        Vec::new()
    }
}

use platform::{init_platform, search_platform};

#[cfg(test)]
mod tests {
    use super::{
        document_type_rank, entry_from_path, file_category_rank, file_sort_key, is_hidden_path,
        limit_ranked_entries, name_matches_query, normalize_query, relevance_rank,
    };
    use crate::settings::{default_file_search_categories, FileSearchCategory};
    use std::path::Path;

    #[test]
    fn file_queries_ignore_blank_and_collapse_whitespace() {
        assert_eq!(normalize_query("   "), None);
        assert_eq!(normalize_query(" a ").as_deref(), Some("a"));
        assert_eq!(
            normalize_query("  project   notes  ").as_deref(),
            Some("project notes")
        );
    }

    #[test]
    fn hidden_dot_segments_sort_last_key() {
        assert!(is_hidden_path(Path::new("/Users/me/.ssh/config")));
        assert!(!is_hidden_path(Path::new("/Users/me/Documents/notes.txt")));
        assert!(
            relevance_rank(Path::new("/tmp/notes.txt"), "notes")
                < relevance_rank(Path::new("/tmp/my-notes-backup.txt"), "notes")
        );
    }

    #[test]
    fn document_type_fallback_and_default_category_order_are_distinct() {
        assert!(
            document_type_rank(Path::new("/tmp/report.pdf"))
                < document_type_rank(Path::new("/tmp/report.ts"))
        );
        assert!(
            document_type_rank(Path::new("/tmp/report.docx"))
                < document_type_rank(Path::new("/tmp/report.py"))
        );
        assert!(
            document_type_rank(Path::new("/tmp/report.xlsx"))
                < document_type_rank(Path::new("/tmp/report.log"))
        );
        assert!(
            document_type_rank(Path::new("/tmp/report.pdf"))
                < document_type_rank(Path::new("/tmp/report.docx"))
        );
        // The user-facing default puts the Code category before Office even
        // though the legacy type fallback still prefers office documents.
        let q = "report";
        let categories = default_file_search_categories();
        let pdf = file_sort_key(Path::new("/tmp/report.pdf"), q, false, 0, 0, &categories);
        let ts = file_sort_key(Path::new("/tmp/report.ts"), q, false, 0, 0, &categories);
        assert!(ts < pdf);
    }

    #[test]
    fn custom_category_order_and_modified_time_drive_file_order() {
        let categories = vec![
            FileSearchCategory {
                id: "excel".to_string(),
                label: "Excel".to_string(),
                extensions: vec!["xlsx".to_string()],
                include_folders: false,
                catch_all: false,
            },
            FileSearchCategory {
                id: "word".to_string(),
                label: "Word".to_string(),
                extensions: vec!["docx".to_string()],
                include_folders: false,
                catch_all: false,
            },
            FileSearchCategory {
                id: "other".to_string(),
                label: "Other".to_string(),
                extensions: Vec::new(),
                include_folders: false,
                catch_all: true,
            },
        ];
        assert_eq!(
            file_category_rank(Path::new("/tmp/report.xlsx"), false, &categories),
            0
        );
        assert_eq!(
            file_category_rank(Path::new("/tmp/report.docx"), false, &categories),
            1
        );
        assert!(
            file_sort_key(
                Path::new("/tmp/older.xlsx"),
                "report",
                false,
                100,
                0,
                &categories,
            ) > file_sort_key(
                Path::new("/tmp/newer.xlsx"),
                "report",
                false,
                200,
                0,
                &categories,
            )
        );
    }

    #[test]
    fn result_window_keeps_each_matching_category_visible() {
        let categories = vec![
            FileSearchCategory {
                id: "excel".to_string(),
                label: "Excel".to_string(),
                extensions: vec!["xlsx".to_string()],
                include_folders: false,
                catch_all: false,
            },
            FileSearchCategory {
                id: "word".to_string(),
                label: "Word".to_string(),
                extensions: vec!["docx".to_string()],
                include_folders: false,
                catch_all: false,
            },
        ];
        let entries = vec![
            entry_from_path("/tmp/report-a.xlsx"),
            entry_from_path("/tmp/report-b.xlsx"),
            entry_from_path("/tmp/report-c.xlsx"),
            entry_from_path("/tmp/report-word.docx"),
        ];
        let limited = limit_ranked_entries(entries, "report", 2, &categories);
        assert_eq!(limited.len(), 2);
        assert!(limited[0].path.ends_with(".xlsx"));
        assert!(limited[1].path.ends_with(".docx"));
    }

    #[test]
    fn name_match_is_leaf_only() {
        assert!(name_matches_query(
            Path::new("/tmp/HelloWorld.txt"),
            "hello"
        ));
        assert!(name_matches_query(Path::new("/tmp/报告.pdf"), "报告"));
        assert!(!name_matches_query(
            Path::new("/tmp/HelloWorld.txt"),
            "报告"
        ));
        assert!(!name_matches_query(Path::new("/tmp/foo.txt"), "bar"));
        // Parent path must not count.
        assert!(!name_matches_query(
            Path::new("/tmp/报告/readme.txt"),
            "报告"
        ));
    }

    #[test]
    fn fuzzy_name_match_ignores_separators_and_keeps_character_order() {
        let path = Path::new("/tmp/SPF-TOWERY_final.Report.pdf");
        assert!(name_matches_query(path, "spf tow"));
        assert!(name_matches_query(path, "spf_tow"));
        assert!(name_matches_query(path, "spftow"));
        assert!(name_matches_query(path, "sftwy"));
        assert!(name_matches_query(path, "sf twy"));
        assert!(!name_matches_query(path, "tow spf missing"));
        assert!(!name_matches_query(path, "wot fps"));
    }

    #[test]
    fn short_queries_do_not_match_scattered_subsequences() {
        for unrelated in [
            "/tmp/system-configuration-sys-11792c09e4c9fc6b",
            "/tmp/PersistentOriginTrials",
            "/tmp/SignalStorageConfigDB",
            "/tmp/Site Characteristics Database",
        ] {
            assert!(
                !name_matches_query(Path::new(unrelated), "Siri"),
                "unrelated short fuzzy match: {unrelated}"
            );
        }
        assert!(name_matches_query(
            Path::new("/tmp/group.com.apple.siri.recorded-audio"),
            "Siri"
        ));
    }

    #[test]
    fn relevance_precedes_recency_inside_a_category() {
        let categories = default_file_search_categories();
        let literal = file_sort_key(
            Path::new("/tmp/Siri Notes"),
            "Siri",
            true,
            10,
            0,
            &categories,
        );
        let weak = file_sort_key(
            Path::new("/tmp/group.com.apple.siri.recorded-audio"),
            "Siri",
            true,
            9_999,
            0,
            &categories,
        );
        assert!(literal < weak);
    }

    #[test]
    fn fuzzy_matches_rank_after_literal_name_matches() {
        assert!(
            relevance_rank(Path::new("/tmp/spftow.txt"), "spf tow")
                < relevance_rank(Path::new("/tmp/SPF-TOWERY_final.txt"), "sftwy")
        );
    }
}
