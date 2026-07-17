use super::*;
use search_cache::SearchCache;
use search_cancel::CancellationToken;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;

const IGNORE_PATH: &str = "/System/Volumes/Data";
static CARDINAL_CACHE: OnceLock<Mutex<Option<SearchCache>>> = OnceLock::new();
static CARDINAL_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
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
    categories: &[FileSearchCategory],
    category_id: Option<&str>,
) -> Vec<AppEntry> {
    if candidates.is_empty() {
        return Vec::new();
    }
    let ranked = candidates
        .into_iter()
        // Hard gate: leaf name must contain the query (name-only search).
        .filter(|(path, _)| super::name_matches_query(path, query))
        .collect::<Vec<_>>();
    let entries = ranked
        .into_iter()
        .filter_map(|(path, (is_dir, modified, _))| {
            path.to_str()
                .map(|path| super::entry_from_path_with_metadata(path, is_dir, Some(modified)))
        })
        .collect();
    super::limit_ranked_entries_for_category(entries, query, limit, categories, category_id)
}

fn merge_ranked_entries(
    primary: Vec<AppEntry>,
    supplemental: Vec<AppEntry>,
    query: &str,
    limit: usize,
    categories: &[FileSearchCategory],
    category_id: Option<&str>,
) -> Vec<AppEntry> {
    let mut by_path = HashMap::<String, AppEntry>::new();
    for entry in primary.into_iter().chain(supplemental) {
        by_path.entry(entry.path.clone()).or_insert(entry);
    }
    super::limit_ranked_entries_for_category(
        by_path.into_values().collect(),
        query,
        limit,
        categories,
        category_id,
    )
}

fn query_cardinal_strategies(
    cache: &mut SearchCache,
    strategies: &[(usize, String)],
    candidate_limit: usize,
    categories: &[FileSearchCategory],
    category_id: Option<&str>,
    cancellation: FileSearchCancellation,
) -> HashMap<PathBuf, (bool, u64, usize)> {
    let mut candidates: HashMap<PathBuf, (bool, u64, usize)> = HashMap::new();
    let mut prioritized = Vec::new();
    if let Some((_, fastest_query)) = strategies
        .first()
        .filter(|(_, query)| !has_advanced_cardinal_syntax(query))
    {
        let classified_extensions = categories
            .iter()
            .filter(|category| !category.catch_all)
            .flat_map(|category| category.extensions.iter().cloned())
            .collect::<Vec<_>>()
            .join(";");
        for (category_rank, category) in categories.iter().enumerate() {
            if category_id.is_some_and(|id| id != category.id) {
                continue;
            }
            let filtered = if category.catch_all {
                if classified_extensions.is_empty() {
                    format!("file: {fastest_query}")
                } else {
                    format!("file: {fastest_query} !ext:{classified_extensions}")
                }
            } else if category.include_folders {
                format!("folder: {fastest_query}")
            } else if !category.extensions.is_empty() {
                format!("{fastest_query} ext:{}", category.extensions.join(";"))
            } else {
                continue;
            };
            prioritized.push((category_rank, filtered));
        }
    }
    if category_id.is_none() || prioritized.is_empty() {
        prioritized.extend(
            strategies
                .iter()
                .map(|(strategy_rank, query)| (categories.len() + strategy_rank, query.clone())),
        );
    }

    for (strategy_rank, cardinal_query) in &prioritized {
        if cancellation.is_cancelled() {
            break;
        }
        let Ok(Some(nodes)) = cache.query_files(cardinal_query, CancellationToken::noop()) else {
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

pub fn search_platform(
    query: &str,
    limit: usize,
    pass: u32,
    categories: &[FileSearchCategory],
    category_id: Option<&str>,
    cancellation: FileSearchCancellation,
) -> Vec<AppEntry> {
    if cancellation.is_cancelled() {
        return Vec::new();
    }
    let all_queries = cardinal_queries(query);
    let candidate_limit = limit.saturating_mul(80).max(120);

    // All passes are filename-only (no path segment, no content).
    // Pass 0: Cardinal name:"…" (or mdfind -name).
    // Pass 1: Spotlight -name (overlap fill while index warms / more hits).
    // Pass 2: Spotlight display-name predicate (still leaf name).
    match pass {
        0 => {
            let cardinal_ranked = if CARDINAL_READY.load(std::sync::atomic::Ordering::Acquire) {
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
                        let candidates = query_cardinal_strategies(
                            cache,
                            &quick,
                            candidate_limit,
                            categories,
                            category_id,
                            cancellation,
                        );
                        Some(rank_candidates(
                            candidates,
                            query,
                            limit,
                            categories,
                            category_id,
                        ))
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            // The Cardinal mutex protects only the in-memory index. Never
            // retain it while waiting for a Spotlight child process.
            if cancellation.is_cancelled() {
                return Vec::new();
            }
            if let Some(ranked) = cardinal_ranked {
                // Cardinal is the low-latency source, but its bounded
                // candidate window can be saturated by build artifacts.
                let spotlight = search_mdfind_name(
                    query,
                    limit.saturating_mul(8).max(80),
                    categories,
                    category_id,
                    cancellation,
                );
                if cancellation.is_cancelled() {
                    return Vec::new();
                }
                return merge_ranked_entries(
                    ranked,
                    spotlight,
                    query,
                    limit,
                    categories,
                    category_id,
                );
            }
            search_mdfind_name(query, limit, categories, category_id, cancellation)
        }
        1 => search_mdfind_name(
            query,
            limit.saturating_mul(2).max(limit),
            categories,
            category_id,
            cancellation,
        ),
        _ => search_mdfind_display_name(query, limit, categories, category_id, cancellation),
    }
}

fn home_onlyin() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

fn collect_mdfind_output(
    output: std::process::Output,
    query: &str,
    limit: usize,
    categories: &[FileSearchCategory],
    category_id: Option<&str>,
    cancellation: FileSearchCancellation,
) -> Vec<AppEntry> {
    if cancellation.is_cancelled() || !output.status.success() {
        return Vec::new();
    }
    let entries: Vec<AppEntry> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(super::entry_from_path)
        .filter(|entry| super::name_matches_query(Path::new(&entry.path), query))
        .collect();
    super::limit_ranked_entries_for_category(entries, query, limit, categories, category_id)
}

fn search_mdfind_name(
    query: &str,
    limit: usize,
    categories: &[FileSearchCategory],
    category_id: Option<&str>,
    cancellation: FileSearchCancellation,
) -> Vec<AppEntry> {
    if cancellation.is_cancelled() {
        return Vec::new();
    }
    let output = Command::new("mdfind")
        .args(["-onlyin", &home_onlyin(), "-name", query])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    collect_mdfind_output(output, query, limit, categories, category_id, cancellation)
}

fn search_mdfind_display_name(
    query: &str,
    limit: usize,
    categories: &[FileSearchCategory],
    category_id: Option<&str>,
    cancellation: FileSearchCancellation,
) -> Vec<AppEntry> {
    if cancellation.is_cancelled() {
        return Vec::new();
    }
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
    collect_mdfind_output(output, query, limit, categories, category_id, cancellation)
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
        let categories = crate::settings::default_file_search_categories();
        let merged = merge_ranked_entries(
            vec![generated],
            vec![user_file],
            "spf",
            1,
            &categories,
            None,
        );
        assert_eq!(merged[0].path, "/Users/me/Downloads/SPF-notes.mov");
    }
}
