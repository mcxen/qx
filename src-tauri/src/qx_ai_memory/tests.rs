use super::consolidation::commit_candidates;
use super::extraction::ExtractionCandidate;
use super::*;

fn test_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("memory db");
    conn.execute_batch(
            "CREATE TABLE memories (
                id TEXT PRIMARY KEY NOT NULL,
                target TEXT NOT NULL,
                content TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                source TEXT NOT NULL,
                memory_type TEXT NOT NULL,
                importance INTEGER NOT NULL,
                supersedes TEXT NOT NULL
             );
             CREATE VIRTUAL TABLE memories_fts USING fts5(id UNINDEXED, target UNINDEXED, content, tags);",
        )
        .expect("schema");
    conn
}

fn row(id: &str, memory_type: &str, supersedes: &[&str]) -> MemoryRow {
    MemoryRow {
        id: id.to_string(),
        target: "memory".to_string(),
        content: format!("content {id}"),
        tags: "[]".to_string(),
        source: "test".to_string(),
        memory_type: memory_type.to_string(),
        importance: 70,
        supersedes: serde_json::to_string(supersedes).expect("lineage"),
        created_at: 1,
        updated_at: 1,
    }
}

fn insert_without_fts(conn: &Connection, row: &MemoryRow) {
    conn.execute(
        "INSERT INTO memories VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            row.id,
            row.target,
            row.content,
            row.tags,
            row.created_at,
            row.updated_at,
            row.source,
            row.memory_type,
            row.importance,
            row.supersedes
        ],
    )
    .expect("insert");
}

#[test]
fn derived_summary_preserves_source_and_replaces_only_core_projection() {
    let conn = test_conn();
    insert_without_fts(&conn, &row("source", "core", &[]));
    insert_without_fts(&conn, &row("episode", "episodic", &[]));
    insert_without_fts(&conn, &row("summary", "core", &["source"]));

    assert_eq!(count_target(&conn, MemoryTarget::Memory).unwrap(), 3);
    let active = list_active_core(&conn, MemoryTarget::Memory).unwrap();
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].id, "summary");
    assert!(load_row(&conn, "source").unwrap().is_some());
}

#[test]
fn legacy_schema_gains_metadata_without_losing_rows() {
    let conn = Connection::open_in_memory().expect("memory db");
    conn.execute_batch(
        "CREATE TABLE memories (
                id TEXT PRIMARY KEY NOT NULL,
                target TEXT NOT NULL,
                content TEXT NOT NULL,
                tags TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
             );
             INSERT INTO memories VALUES ('legacy', 'memory', 'keep me', '[]', 1, 1);",
    )
    .expect("legacy schema");
    ensure_column(&conn, "source", "TEXT NOT NULL DEFAULT 'legacy'").unwrap();
    ensure_column(&conn, "memory_type", "TEXT NOT NULL DEFAULT 'core'").unwrap();
    ensure_column(&conn, "importance", "INTEGER NOT NULL DEFAULT 60").unwrap();
    ensure_column(&conn, "supersedes", "TEXT NOT NULL DEFAULT '[]'").unwrap();

    let row = load_row(&conn, "legacy").unwrap().expect("preserved row");
    assert_eq!(row.content, "keep me");
    assert_eq!(row.source, "legacy");
    assert_eq!(row.memory_type, "core");
    assert_eq!(row.importance, 60);
    assert_eq!(row.supersedes, "[]");
}

#[test]
fn derived_candidate_allows_new_facts_and_clamps_importance() {
    let conn = test_conn();
    let rows = commit_candidates(
        &conn,
        &[],
        vec![ExtractionCandidate {
            target: "memory".to_string(),
            content: "durable fact".to_string(),
            memory_type: "core".to_string(),
            importance: 140,
            supersedes: vec![],
            category: Some("feedback".into()),
        }],
        "smart",
    )
    .unwrap();
    let row = &rows[0];
    assert_eq!(row.importance, 100);
    assert_eq!(row.supersedes, "[]");
    assert_eq!(row.source, "dream.smart");
    assert_eq!(category(row), "feedback");
}

fn candidate(ids: &[&str], content: &str) -> ExtractionCandidate {
    ExtractionCandidate {
        target: "memory".into(),
        content: content.into(),
        memory_type: "core".into(),
        importance: 1,
        supersedes: ids.iter().map(|id| (*id).into()).collect(),
        category: Some("project".into()),
    }
}

#[test]
fn hot_window_skips_oversized_rows_without_losing_short_followers() {
    let mut large = row("large", "core", &[]);
    large.content = "很".repeat(20);
    let mut small = row("small", "core", &[]);
    small.content = "中文🙂".into();
    assert_eq!(
        pack_hot(&[large, small.clone(), small], 9),
        vec!["中文🙂", "中文🙂"]
    );
}

#[test]
fn compression_keeps_sources_searchable_and_reduces_active_text() {
    let conn = test_conn();
    let sources = vec![row("first", "core", &[]), row("second", "core", &[])];
    for source in &sources {
        insert_row(&conn, source).unwrap();
    }
    let saved = commit_candidates(
        &conn,
        &sources,
        vec![candidate(&["first", "second"], "summary")],
        "compress",
    )
    .unwrap();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].importance, 70);
    assert_eq!(
        list_active_core(&conn, MemoryTarget::Memory).unwrap(),
        saved
    );
    assert_eq!(count_target(&conn, MemoryTarget::Memory).unwrap(), 3);
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM memories_fts WHERE memories_fts MATCH 'first'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn invalid_later_candidate_rolls_back_the_whole_batch() {
    let conn = test_conn();
    let sources = vec![row("first", "core", &[])];
    insert_row(&conn, &sources[0]).unwrap();
    let result = commit_candidates(
        &conn,
        &sources,
        vec![candidate(&["first"], "one"), candidate(&["missing"], "two")],
        "compress",
    );
    assert!(result.is_err());
    assert_eq!(count_target(&conn, MemoryTarget::Memory).unwrap(), 1);
}

#[test]
fn sql_failure_rolls_back_summaries_and_fts_together() {
    let conn = test_conn();
    let sources = vec![row("first", "core", &[]), row("second", "core", &[])];
    for source in &sources {
        insert_row(&conn, source).unwrap();
    }
    conn.execute_batch("CREATE TRIGGER fail_second BEFORE INSERT ON memories WHEN NEW.content = 'bad' BEGIN SELECT RAISE(ABORT, 'forced failure'); END;").unwrap();
    assert!(commit_candidates(
        &conn,
        &sources,
        vec![candidate(&["first"], "ok"), candidate(&["second"], "bad")],
        "compress"
    )
    .is_err());
    assert_eq!(count_target(&conn, MemoryTarget::Memory).unwrap(), 2);
    let count: i64 = conn
        .query_row("SELECT count(*) FROM memories_fts", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 2);
}

#[test]
fn compression_rejects_stale_deleted_and_already_superseded_sources() {
    for change in ["edit", "delete", "supersede"] {
        let conn = test_conn();
        let source = row("first", "core", &[]);
        insert_row(&conn, &source).unwrap();
        match change {
            "edit" => update_row_content(&conn, "first", "updated").unwrap(),
            "delete" => delete_row(&conn, "first").unwrap(),
            _ => insert_row(&conn, &row("replacement", "core", &["first"])).unwrap(),
        }
        assert!(commit_candidates(
            &conn,
            &[source],
            vec![candidate(&["first"], "small")],
            "compress"
        )
        .is_err());
    }
}

#[test]
fn compression_rejects_cross_target_category_and_overlapping_lineage() {
    let conn = test_conn();
    let source = row("first", "core", &[]);
    insert_row(&conn, &source).unwrap();
    let mut other_target = candidate(&["first"], "small");
    other_target.target = "user".into();
    let mut other_category = candidate(&["first"], "small");
    other_category.category = Some("feedback".into());
    for invalid in [
        vec![other_target],
        vec![other_category],
        vec![candidate(&["first"], "one"), candidate(&["first"], "two")],
    ] {
        assert!(commit_candidates(&conn, &[source.clone()], invalid, "compress").is_err());
    }
}

#[test]
fn compression_no_op_never_creates_new_or_longer_memories() {
    let conn = test_conn();
    let source = row("first", "core", &[]);
    insert_row(&conn, &source).unwrap();
    assert!(
        commit_candidates(&conn, &[source.clone()], vec![], "compress")
            .unwrap()
            .is_empty()
    );
    assert!(commit_candidates(
        &conn,
        &[source.clone()],
        vec![candidate(
            &["first"],
            "this is longer than the original content"
        )],
        "compress"
    )
    .unwrap()
    .is_empty());
    assert!(commit_candidates(&conn, &[source], vec![candidate(&[], "new")], "compress").is_err());
    assert_eq!(count_target(&conn, MemoryTarget::Memory).unwrap(), 1);
}

#[test]
fn compression_cannot_replace_sources_with_a_summary_too_large_for_hot_window() {
    let conn = test_conn();
    let mut source = row("large", "core", &[]);
    source.content = "字".repeat(MEMORY_CHAR_LIMIT * 2);
    insert_row(&conn, &source).unwrap();
    let saved = commit_candidates(
        &conn,
        &[source.clone()],
        vec![candidate(&["large"], &"字".repeat(MEMORY_CHAR_LIMIT + 1))],
        "compress",
    )
    .unwrap();
    assert!(saved.is_empty());
    assert_eq!(
        list_active_core(&conn, MemoryTarget::Memory).unwrap(),
        vec![source]
    );
}

#[test]
fn plugin_projection_keeps_category_and_source_metadata() {
    let mut source = row("first", "core", &[]);
    source.tags = "[\"category:feedback\"]".into();
    let entry: crate::plugin_api::PluginAiMemoryEntry =
        serde_json::from_value(plugin_entry_json(&source)).unwrap();
    assert_eq!(entry.category, "feedback");
    assert_eq!(entry.source, "test");
    assert_eq!(entry.memory_type, "core");
    assert_eq!(entry.importance, 70);
    assert!(entry.active);
}

fn scope_context(scope: &str) -> MemoryContext {
    MemoryContext {
        scope: Some(scope.into()),
        conversation_id: Some("chat-a".into()),
        provider: Some("provider-a".into()),
        model: Some("model-a".into()),
    }
}

#[test]
fn scope_controls_snapshot_search_read_and_mutation() {
    let conn = test_conn();
    for scope in ["", "Qx", "Other"] {
        context::mutate(
            &conn,
            "add",
            None,
            &format!("{scope} 项目约束 needle"),
            "",
            Some("project"),
            &scope_context(scope),
            false,
        )
        .unwrap();
    }
    let snapshot = context::snapshot(&conn, "Qx").unwrap();
    assert!(snapshot.contains("Qx 项目约束"));
    assert!(!snapshot.contains("Other"));
    let global = context::snapshot(&conn, "").unwrap();
    assert!(!global.contains("Qx 项目约束"));
    for query in ["needle", "目约"] {
        // FTS and Chinese substring fallback.
        let found = retrieval::search(&conn, query, None, "Qx", false, 20).unwrap();
        assert_eq!(found["count"], 2);
        assert!(!found.to_string().contains("Other"));
        assert!(found["hits"][0].get("text").is_none());
    }
    let other = context::scoped_rows(&conn, MemoryTarget::Memory, "Other", false)
        .unwrap()
        .remove(0);
    for action in ["read", "replace", "remove"] {
        assert!(context::mutate(
            &conn,
            action,
            None,
            "replacement",
            &other.id,
            None,
            &scope_context("Qx"),
            false
        )
        .is_err());
    }
    let global_row = context::scoped_rows(&conn, MemoryTarget::Memory, "", false)
        .unwrap()
        .remove(0);
    assert!(context::mutate(
        &conn,
        "read",
        None,
        "",
        &global_row.id,
        None,
        &scope_context("Qx"),
        false
    )
    .is_ok());
    assert!(context::mutate(
        &conn,
        "remove",
        None,
        "",
        &global_row.id,
        None,
        &scope_context("Qx"),
        false
    )
    .is_err());
}

#[test]
fn scope_precedes_limit_and_archive_recall_is_explicit() {
    let conn = test_conn();
    for i in 0..30 {
        let mut item = row(&format!("other-{i}"), "core", &[]);
        item.tags = "[\"scope:Other\"]".into();
        item.content = "needle".into();
        insert_row(&conn, &item).unwrap();
    }
    let mut original = row("original", "core", &[]);
    original.content = "needle original text".into();
    insert_row(&conn, &original).unwrap();
    let mut summary = row("summary", "core", &["original"]);
    summary.content = "needle summary".into();
    insert_row(&conn, &summary).unwrap();
    let hits = retrieval::search(&conn, "needle", None, "Qx", false, 1).unwrap();
    assert_eq!(hits["hits"][0]["id"], "summary");
    assert_eq!(
        retrieval::search(&conn, "needle", None, "Qx", true, 20).unwrap()["count"],
        2
    );
}

#[test]
fn receipts_commit_with_facts_and_noops_but_never_failed_batches() {
    use super::consolidation::commit_with_context;
    let conn = test_conn();
    let ctx = scope_context("Qx");
    let rows = commit_with_context(
        &conn,
        &[],
        vec![candidate(&[], "fact")],
        "smart",
        &ctx,
        Some("turn1"),
    )
    .unwrap();
    assert_eq!(context::row_scope(&rows[0]), "Qx");
    assert_eq!(metadata(&rows[0], "origin:"), "chat-a");
    assert!(commit_with_context(
        &conn,
        &[],
        vec![candidate(&[], "duplicate")],
        "smart",
        &ctx,
        Some("turn1")
    )
    .unwrap()
    .is_empty());
    commit_with_context(&conn, &[], vec![], "smart", &ctx, Some("noop")).unwrap();
    assert!(commit_with_context(
        &conn,
        &[],
        vec![candidate(&[], "skip")],
        "smart",
        &ctx,
        Some("noop")
    )
    .unwrap()
    .is_empty());
    assert!(commit_with_context(
        &conn,
        &[],
        vec![candidate(&["missing"], "invalid")],
        "smart",
        &ctx,
        Some("retry")
    )
    .is_err());
    assert_eq!(
        commit_with_context(
            &conn,
            &[],
            vec![candidate(&[], "retry succeeds")],
            "smart",
            &ctx,
            Some("retry")
        )
        .unwrap()
        .len(),
        1
    );
    let mut wrong = candidate(&[&rows[0].id], "x");
    wrong.category = Some("project".into());
    assert!(commit_with_context(
        &conn,
        &rows,
        vec![wrong],
        "compress",
        &scope_context("Other"),
        None
    )
    .is_err());
}

#[test]
fn duplicate_text_isolated_by_scope_and_category() {
    let conn = test_conn();
    for scope in ["", "Qx"] {
        for category in ["project", "feedback"] {
            for _ in 0..2 {
                context::mutate(
                    &conn,
                    "add",
                    None,
                    "same text",
                    "",
                    Some(category),
                    &scope_context(scope),
                    false,
                )
                .unwrap();
            }
        }
    }
    assert_eq!(count_target(&conn, MemoryTarget::Memory).unwrap(), 4);
}
