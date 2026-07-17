use crate::apps::AppEntry;
#[cfg(target_os = "macos")]
use fswalk::NodeFileType;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
#[cfg(target_os = "macos")]
use std::sync::Mutex;
use std::sync::OnceLock;
use tauri::Manager;

static RESOURCE_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init(app: &tauri::AppHandle) {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let _ = RESOURCE_DIR.set(resource_dir);
    }
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
pub async fn search(query: String, limit: usize, pass: u32) -> Vec<AppEntry> {
    let Some(q) = normalize_query(&query) else {
        return Vec::new();
    };

    tauri::async_runtime::spawn_blocking(move || search_platform(&q, limit, pass))
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
        aliases: String::new(),
    }
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

/// Returns a small gap penalty when every query character occurs in order.
/// Short one/two-character queries stay literal to avoid flooding results.
fn fuzzy_subsequence_penalty(needle: &str, haystack: &str) -> Option<u16> {
    let needle_chars = needle.chars().collect::<Vec<_>>();
    if needle_chars.len() < 3 {
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
            return Some((first.unwrap_or(0).saturating_add(gaps)).min(220) as u16);
        }
    }
    None
}

fn fuzzy_wildcard(value: &str) -> Option<String> {
    let compact = compact_search_text(value);
    if compact.chars().count() < 3 {
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

/// File search is **name-only**. Separators are weak boundaries and queries of
/// at least three characters may match as an ordered fuzzy subsequence.
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
) -> (u8, u16, u8, u8, std::cmp::Reverse<u64>, usize, usize) {
    (
        is_hidden_path(path) as u8,
        relevance_rank(path, query),
        // Folders after files of the same name quality.
        is_dir as u8,
        // Office docs before code/logs when the leaf-name match is equal.
        if is_dir { 50 } else { document_type_rank(path) },
        std::cmp::Reverse(modified),
        strategy_rank,
        path.as_os_str().len(),
    )
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
mod platform {
    use super::*;
    use search_cache::SearchCache;
    use search_cancel::CancellationToken;
    use std::collections::HashMap;
    use std::sync::atomic::AtomicBool;

    const IGNORE_PATH: &str = "/System/Volumes/Data";
    static CARDINAL_CACHE: OnceLock<Mutex<Option<SearchCache>>> = OnceLock::new();
    static CARDINAL_READY: std::sync::atomic::AtomicBool =
        std::sync::atomic::AtomicBool::new(false);
    static NEVER_STOPPED: AtomicBool = AtomicBool::new(false);

    fn has_advanced_cardinal_syntax(query: &str) -> bool {
        let lower = query.to_ascii_lowercase();
        [
            "file:",
            "files:",
            "folder:",
            "folders:",
            "dir:",
            "directory:",
            "type:",
            "ext:",
            "name:",
            "path:",
            "parent:",
            "infolder:",
            "size:",
            "dm:",
            "dc:",
            "content:",
            "regex:",
            "tag:",
        ]
        .iter()
        .any(|prefix| lower.contains(prefix))
    }

    /// Filename-only Cardinal strategies (never path/content).
    ///
    /// Cardinal's `name:` filter currently produces no candidates in the
    /// embedded search-cache build. Use its normal filename index and keep the
    /// strict leaf-name post-filter in `rank_candidates`; this preserves
    /// filename-only semantics without making Spotlight the only working path.
    fn cardinal_queries(query: &str) -> Vec<String> {
        if has_advanced_cardinal_syntax(query) {
            // Even advanced syntax is user-controlled; we still name-filter results.
            return vec![query.to_string()];
        }

        let without_quotes = query.replace('"', "");
        // Cardinal's default matcher is case-insensitive. Lead with a prefix
        // query for relevance, then widen to contains and ordinary token forms.
        let mut queries = vec![
            format!("{without_quotes}*"),
            format!("*{without_quotes}*"),
            without_quotes.clone(),
        ];
        let tokens = super::search_tokens(&without_quotes);
        if tokens.len() > 1 {
            queries.push(
                tokens
                    .iter()
                    .map(|token| format!("*{token}*"))
                    .collect::<Vec<_>>()
                    .join(" "),
            );
        }
        if let Some(fuzzy) = super::fuzzy_wildcard(&without_quotes) {
            queries.push(fuzzy);
        }
        if without_quotes.contains(' ') {
            queries.push(format!(r#""{without_quotes}""#));
        }
        queries.dedup();
        queries
    }

    pub fn init_platform() {
        CARDINAL_CACHE.get_or_init(|| Mutex::new(None));
        std::thread::Builder::new()
            .name("qx-cardinal-cache".to_string())
            .spawn(|| {
                let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
                let root = PathBuf::from(home);
                let cache_path = dirs::cache_dir()
                    .unwrap_or_else(std::env::temp_dir)
                    .join("qx")
                    .join("cardinal-search-cache.zstd");
                if let Some(parent) = cache_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let ignore_paths = vec![PathBuf::from(IGNORE_PATH)];
                let include_paths = Vec::new();
                let cache = SearchCache::try_read_persistent_cache(
                    &root,
                    &cache_path,
                    &ignore_paths,
                    &include_paths,
                    &NEVER_STOPPED,
                )
                .unwrap_or_else(|_| {
                    let mut cache = SearchCache::walk_fs_with_ignore(&root, &ignore_paths);
                    let _ = cache.flush_snapshot_to_file(&cache_path);
                    cache
                });

                let store = CARDINAL_CACHE.get_or_init(|| Mutex::new(None));
                let mut guard = store
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                *guard = Some(cache);
                CARDINAL_READY.store(true, std::sync::atomic::Ordering::Release);
            })
            .ok();
    }

    fn rank_candidates(
        candidates: HashMap<PathBuf, (bool, u64, usize)>,
        query: &str,
        limit: usize,
    ) -> Vec<AppEntry> {
        if candidates.is_empty() {
            return Vec::new();
        }
        let mut ranked = candidates
            .into_iter()
            // Hard gate: leaf name must contain the query (name-only search).
            .filter(|(path, _)| super::name_matches_query(path, query))
            .collect::<Vec<_>>();
        ranked.sort_by_key(|(path, (is_dir, modified, strategy_rank))| {
            super::file_sort_key(path, query, *is_dir, *modified, *strategy_rank)
        });
        ranked
            .into_iter()
            .filter_map(|(path, (is_dir, _, _))| {
                path.to_str()
                    .map(|path| super::entry_from_path_with_kind(path, is_dir))
            })
            .take(limit)
            .collect()
    }

    fn merge_ranked_entries(
        primary: Vec<AppEntry>,
        supplemental: Vec<AppEntry>,
        query: &str,
        limit: usize,
    ) -> Vec<AppEntry> {
        let mut by_path = HashMap::<String, AppEntry>::new();
        for entry in primary.into_iter().chain(supplemental) {
            by_path.entry(entry.path.clone()).or_insert(entry);
        }
        let mut entries = by_path.into_values().collect::<Vec<_>>();
        entries.sort_by_key(|entry| {
            let path = PathBuf::from(&entry.path);
            let is_dir = entry.kind == "folder";
            super::file_sort_key(&path, query, is_dir, 0, 0)
        });
        entries.into_iter().take(limit).collect()
    }

    fn query_cardinal_strategies(
        cache: &mut SearchCache,
        strategies: &[(usize, String)],
        candidate_limit: usize,
    ) -> HashMap<PathBuf, (bool, u64, usize)> {
        let mut candidates: HashMap<PathBuf, (bool, u64, usize)> = HashMap::new();
        for (strategy_rank, cardinal_query) in strategies {
            let Ok(Some(nodes)) = cache.query_files(cardinal_query, CancellationToken::noop())
            else {
                continue;
            };
            for node in nodes.into_iter().take(candidate_limit) {
                let is_dir = node.metadata.file_type_hint() == NodeFileType::Dir;
                let modified = node
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.mtime())
                    .map(|value| u64::from(value.get()))
                    .unwrap_or(0);
                candidates
                    .entry(node.path)
                    .and_modify(|current| {
                        current.1 = current.1.max(modified);
                        current.2 = current.2.min(*strategy_rank);
                    })
                    .or_insert((is_dir, modified, *strategy_rank));
            }
        }
        candidates
    }

    pub fn search_platform(query: &str, limit: usize, pass: u32) -> Vec<AppEntry> {
        let all_queries = cardinal_queries(query);
        let candidate_limit = limit.saturating_mul(80).max(120);

        // All passes are filename-only (no path segment, no content).
        // Pass 0: Cardinal name:"…" (or mdfind -name).
        // Pass 1: Spotlight -name (overlap fill while index warms / more hits).
        // Pass 2: Spotlight display-name predicate (still leaf name).
        match pass {
            0 => {
                if CARDINAL_READY.load(std::sync::atomic::Ordering::Acquire) {
                    if let Some(store) = CARDINAL_CACHE.get() {
                        let mut guard = store
                            .lock()
                            .unwrap_or_else(|poisoned| poisoned.into_inner());
                        if let Some(cache) = guard.as_mut() {
                            let quick: Vec<(usize, String)> = all_queries
                                .iter()
                                .cloned()
                                .enumerate()
                                .map(|(i, q)| (i, q))
                                .collect();
                            let candidates =
                                query_cardinal_strategies(cache, &quick, candidate_limit);
                            let ranked = rank_candidates(candidates, query, limit);
                            // Cardinal is the low-latency source, but its bounded
                            // candidate window can be saturated by build artifacts
                            // whose generated names happen to contain a short query
                            // such as `spf`. Always merge a wider Spotlight name
                            // sample so real user files are not hidden by that window.
                            let spotlight =
                                search_mdfind_name(query, limit.saturating_mul(8).max(80));
                            return merge_ranked_entries(ranked, spotlight, query, limit);
                        }
                    }
                }
                search_mdfind_name(query, limit)
            }
            1 => search_mdfind_name(query, limit.saturating_mul(2).max(limit)),
            _ => search_mdfind_display_name(query, limit),
        }
    }

    fn home_onlyin() -> String {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
    }

    fn collect_mdfind_output(
        output: std::process::Output,
        query: &str,
        limit: usize,
    ) -> Vec<AppEntry> {
        if !output.status.success() {
            return Vec::new();
        }
        let mut entries: Vec<AppEntry> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(super::entry_from_path)
            .filter(|entry| super::name_matches_query(Path::new(&entry.path), query))
            .collect();
        entries.sort_by_key(|entry| {
            let path = PathBuf::from(&entry.path);
            let is_dir = entry.kind == "folder";
            super::file_sort_key(&path, query, is_dir, 0, 0)
        });
        entries.into_iter().take(limit).collect()
    }

    fn search_mdfind_name(query: &str, limit: usize) -> Vec<AppEntry> {
        let output = Command::new("mdfind")
            .args(["-onlyin", &home_onlyin(), "-name", query])
            .output();
        let Ok(output) = output else {
            return Vec::new();
        };
        collect_mdfind_output(output, query, limit)
    }

    fn search_mdfind_display_name(query: &str, limit: usize) -> Vec<AppEntry> {
        // Leaf display name only (not path, not content).
        let escaped = query.replace('\\', "\\\\").replace('"', "\\\"");
        let literal = format!("kMDItemDisplayName == \"*{escaped}*\"cd");
        let tokens = super::search_tokens(query);
        let token_predicate = (tokens.len() > 1).then(|| {
            tokens
                .iter()
                .map(|token| format!("kMDItemDisplayName == \"*{token}*\"cd"))
                .collect::<Vec<_>>()
                .join(" && ")
        });
        let fuzzy_predicate = super::fuzzy_wildcard(query)
            .map(|pattern| format!("kMDItemDisplayName == \"{pattern}\"cd"));
        let predicate = [Some(literal), token_predicate, fuzzy_predicate]
            .into_iter()
            .flatten()
            .map(|part| format!("({part})"))
            .collect::<Vec<_>>()
            .join(" || ");
        let output = Command::new("mdfind")
            .args(["-onlyin", &home_onlyin(), &predicate])
            .output();
        let Ok(output) = output else {
            return Vec::new();
        };
        collect_mdfind_output(output, query, limit)
    }

    #[cfg(test)]
    mod tests {
        use super::{cardinal_queries, merge_ranked_entries};
        use crate::file_search::{entry_from_path, name_matches_query, relevance_rank};
        use std::path::Path;

        #[test]
        fn cardinal_is_name_only_for_plain_queries() {
            let queries = cardinal_queries("项目笔记");
            assert_eq!(
                queries,
                vec![
                    "项目笔记*".to_string(),
                    "*项目笔记*".to_string(),
                    "项目笔记".to_string(),
                    "*项*目*笔*记*".to_string()
                ]
            );
            assert!(!queries
                .iter()
                .any(|q| q.contains("path:") || q.contains('|')));
            assert_eq!(
                cardinal_queries("ext:pdf report"),
                vec!["ext:pdf report".to_string()]
            );
            assert_eq!(
                cardinal_queries("spf"),
                vec![
                    "spf*".to_string(),
                    "*spf*".to_string(),
                    "spf".to_string(),
                    "*s*p*f*".to_string()
                ]
            );
            let spaced = cardinal_queries("spf tow");
            assert!(spaced.contains(&"*spf* *tow*".to_string()));
            assert!(spaced.contains(&"*s*p*f*t*o*w*".to_string()));
        }

        #[test]
        fn name_match_uses_leaf_only() {
            assert!(name_matches_query(
                Path::new("/Users/me/Documents/项目笔记.md"),
                "项目笔记"
            ));
            // Parent folder matches must NOT count — name-only search.
            assert!(!name_matches_query(
                Path::new("/Users/me/项目笔记/readme.txt"),
                "项目笔记"
            ));
            assert!(!name_matches_query(
                Path::new("/Users/me/Documents/完全无关.txt"),
                "项目笔记"
            ));
        }

        #[test]
        fn exact_file_names_rank_before_fuzzy_paths() {
            assert!(
                relevance_rank(Path::new("/tmp/report.pdf"), "report.pdf")
                    < relevance_rank(Path::new("/tmp/report-backup.pdf"), "report.pdf")
            );
        }

        #[test]
        fn spotlight_supplement_beats_generated_short_query_noise() {
            let generated =
                entry_from_path("/Users/me/project/target/incremental/f4t2ivnv4spfnsekjzpdnhlgr.o");
            let user_file = entry_from_path("/Users/me/Downloads/SPF-notes.mov");
            let merged = merge_ranked_entries(vec![generated], vec![user_file], "spf", 1);
            assert_eq!(merged[0].path, "/Users/me/Downloads/SPF-notes.mov");
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::collections::HashMap;
    use std::ffi::OsStr;
    use std::os::windows::process::CommandExt;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    const EVERYTHING_INSTANCE: &str = "Qx";
    const CACHE_TTL: Duration = Duration::from_secs(20);
    static EVERYTHING_READY: AtomicBool = AtomicBool::new(false);
    static QUERY_CACHE: OnceLock<Mutex<HashMap<String, (Instant, Vec<AppEntry>)>>> =
        OnceLock::new();

    fn background_command(program: impl AsRef<OsStr>) -> Command {
        let mut command = Command::new(program);
        // Qx is a GUI helper. Console-based sidecars such as es.exe must never
        // surface a terminal window while the user types a search query.
        command.creation_flags(CREATE_NO_WINDOW);
        command
    }

    /// Filename-only Everything strategies (`nopath:`). No full-path / content.
    fn everything_queries(query: &str) -> Vec<String> {
        let lower = query.to_ascii_lowercase();
        let has_type_filter = [
            "file:",
            "files:",
            "folder:",
            "folders:",
            "dir:",
            "directory:",
            "type:",
            "ext:",
            "path:",
            "nopath:",
            "parent:",
            "infolder:",
            "size:",
            "dm:",
            "dc:",
            "content:",
            "regex:",
            "attrib:",
            "attributes:",
            "ww:",
            "wfn:",
            "startwith:",
            "endwith:",
            "wildcards:",
            "case:",
        ]
        .iter()
        .any(|prefix| lower.contains(prefix));
        if has_type_filter {
            return vec![query.to_string()];
        }

        let quoted = query.replace('"', "");
        // nopath: restricts match to the leaf name only.
        let mut queries = vec![
            format!(r#"nopath:wfn:"{quoted}""#),
            format!(r#"nopath:startwith:{quoted}"#),
            format!(r#"nopath:"{quoted}""#),
        ];
        let tokens = super::search_tokens(&quoted);
        if tokens.len() > 1 {
            queries.push(format!(
                "nopath:{}",
                tokens
                    .iter()
                    .map(|token| format!("*{token}*"))
                    .collect::<Vec<_>>()
                    .join(" ")
            ));
        }
        if let Some(fuzzy) = super::fuzzy_wildcard(&quoted) {
            queries.push(format!("nopath:wildcards:{fuzzy}"));
        }
        queries
    }

    pub fn init_platform() {
        QUERY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        std::thread::Builder::new()
            .name("qx-everything-cache".to_string())
            .spawn(|| {
                let Some(everything) = find_everything_engine() else {
                    return;
                };
                let _ = background_command(everything)
                    .args([
                        "-instance",
                        EVERYTHING_INSTANCE,
                        "-startup",
                        "-app-data",
                        "-no-update-notification",
                    ])
                    .spawn();

                // Everything builds and persists its own filesystem database in
                // the background. Probe IPC without holding up Tauri setup.
                for _ in 0..60 {
                    if query_everything_raw("qx-ready-probe", 1).is_some() {
                        EVERYTHING_READY.store(true, Ordering::Release);
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
            })
            .ok();
    }

    pub fn search_platform(query: &str, limit: usize, pass: u32) -> Vec<AppEntry> {
        let cache_key = format!("{pass}\0{limit}\0{}", query.to_lowercase());
        if EVERYTHING_READY.load(Ordering::Acquire) {
            if let Some(cache) = QUERY_CACHE.get() {
                let guard = cache
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if let Some((created, results)) = guard.get(&cache_key) {
                    if created.elapsed() <= CACHE_TTL {
                        return results.clone();
                    }
                }
            }
        }

        // A query can also make progress while the initial readiness probe is
        // running. ES returns immediately when IPC is unavailable.
        let results = search_everything_layered(query, limit, pass);
        if !results.is_empty() {
            EVERYTHING_READY.store(true, Ordering::Release);
        }
        if EVERYTHING_READY.load(Ordering::Acquire) {
            if let Some(cache) = QUERY_CACHE.get() {
                let mut guard = cache
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                guard.retain(|_, (created, _)| created.elapsed() <= CACHE_TTL);
                guard.insert(cache_key, (Instant::now(), results.clone()));
            }
        }
        results
    }

    fn search_everything_layered(query: &str, limit: usize, pass: u32) -> Vec<AppEntry> {
        let strategies = everything_queries(query);
        // Progressive passes: first strategies first, later passes chase broader recall.
        // Progressive name-only strategies (all already nopath:).
        let selected: Vec<(usize, String)> = match pass {
            0 => strategies.into_iter().enumerate().take(1).collect(),
            1 => strategies.into_iter().enumerate().skip(1).take(1).collect(),
            _ => strategies.into_iter().enumerate().skip(2).collect(),
        };
        if selected.is_empty() {
            return Vec::new();
        }

        let per_strategy = limit.saturating_mul(8).max(40);
        // path -> (strategy_rank)
        let mut candidates: HashMap<String, usize> = HashMap::new();
        let mut any_success = false;

        for (strategy_rank, strategy_query) in selected {
            let Some(paths) = query_everything_raw(&strategy_query, per_strategy) else {
                continue;
            };
            any_success = true;
            for path in paths {
                candidates
                    .entry(path)
                    .and_modify(|current| *current = (*current).min(strategy_rank))
                    .or_insert(strategy_rank);
            }
        }

        if !any_success {
            return Vec::new();
        }

        let mut ranked = candidates
            .into_iter()
            .filter(|(path, _)| super::name_matches_query(Path::new(path), query))
            .collect::<Vec<_>>();
        ranked.sort_by_key(|(path, strategy_rank)| {
            let path_buf = PathBuf::from(path);
            let is_dir = path_buf.is_dir();
            super::file_sort_key(&path_buf, query, is_dir, 0, *strategy_rank)
        });

        ranked
            .into_iter()
            .take(limit)
            .map(|(path, _)| super::entry_from_path(&path))
            .collect()
    }

    fn query_everything_raw(query: &str, limit: usize) -> Option<Vec<String>> {
        let es = find_everything_cli()?;
        let output = background_command(es)
            .args([
                "-instance",
                EVERYTHING_INSTANCE,
                "-n",
                &limit.to_string(),
                "-utf8",
                query,
            ])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }

        Some(
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_string)
                .collect(),
        )
    }

    fn find_everything_cli() -> Option<PathBuf> {
        if let Some(path) = resource_bin("es.exe") {
            return Some(path);
        }
        let candidates = [
            r"C:\Program Files\Everything\es.exe",
            r"C:\Program Files (x86)\Everything\es.exe",
        ];
        candidates
            .iter()
            .map(PathBuf::from)
            .find(|path| path.exists())
    }

    fn find_everything_engine() -> Option<PathBuf> {
        if let Some(path) = resource_bin("everything.exe") {
            return Some(path);
        }
        [
            r"C:\Program Files\Everything\Everything.exe",
            r"C:\Program Files (x86)\Everything\Everything.exe",
        ]
        .iter()
        .map(PathBuf::from)
        .find(|path| path.exists())
    }

    #[cfg(test)]
    mod tests {
        use super::everything_queries;
        use crate::file_search::{is_hidden_path, relevance_rank};
        use std::path::Path;

        #[test]
        fn everything_uses_multiple_recall_strategies_for_plain_queries() {
            let queries = everything_queries("project notes");
            assert!(queries.len() >= 3);
            assert!(queries.iter().any(|q| q.contains("nopath:")));
            assert_eq!(
                everything_queries("ext:pdf report"),
                vec!["ext:pdf report".to_string()]
            );
        }

        #[test]
        fn hidden_paths_are_detected() {
            assert!(is_hidden_path(Path::new(r"C:\Users\me\.config\app.json")));
            assert!(is_hidden_path(Path::new(
                r"C:\Users\me\project\node_modules\pkg\index.js"
            )));
            assert!(!is_hidden_path(Path::new(
                r"C:\Users\me\Documents\report.pdf"
            )));
        }

        #[test]
        fn exact_file_names_rank_before_fuzzy_paths() {
            assert!(
                relevance_rank(Path::new(r"C:\tmp\report.pdf"), "report.pdf")
                    < relevance_rank(Path::new(r"C:\tmp\report-backup.pdf"), "report.pdf")
            );
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::*;

    pub fn init_platform() {}

    pub fn search_platform(_query: &str, _limit: usize, _pass: u32) -> Vec<AppEntry> {
        Vec::new()
    }
}

use platform::{init_platform, search_platform};

#[cfg(test)]
mod tests {
    use super::{
        document_type_rank, file_sort_key, is_hidden_path, name_matches_query, normalize_query,
        relevance_rank,
    };
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
    fn office_documents_rank_before_source_when_name_match_equal() {
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
        // Same name quality: PDF still ahead of code via composite key.
        let q = "report";
        let pdf = file_sort_key(Path::new("/tmp/report.pdf"), q, false, 0, 0);
        let ts = file_sort_key(Path::new("/tmp/report.ts"), q, false, 0, 0);
        assert!(pdf < ts);
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
    fn fuzzy_matches_rank_after_literal_name_matches() {
        assert!(
            relevance_rank(Path::new("/tmp/spftow.txt"), "spf tow")
                < relevance_rank(Path::new("/tmp/SPF-TOWERY_final.txt"), "sftwy")
        );
    }
}
