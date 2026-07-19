use super::*;

#[test]
fn legacy_schema_gains_file_list_storage_without_losing_rows() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE clipboard_history (
            id TEXT PRIMARY KEY,
            text TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            file_path TEXT
        );
        INSERT INTO clipboard_history (id, text, timestamp, file_path)
        VALUES ('legacy', '', '2026-07-19 12:00:00', 'C:\\work\\folder');",
    )
    .unwrap();

    ensure_clipboard_schema(&conn).unwrap();
    let legacy: (String, Option<String>) = conn
        .query_row(
            "SELECT file_path, file_paths FROM clipboard_history WHERE id = 'legacy'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(legacy.0, r"C:\work\folder");
    assert_eq!(legacy.1, None);
    assert_eq!(
        decode_stored_file_paths(legacy.1.as_deref(), Some(&legacy.0)),
        vec![r"C:\work\folder".to_string()]
    );
}

#[test]
fn file_list_is_stored_as_one_ordered_history_entry() {
    let conn = Connection::open_in_memory().unwrap();
    ensure_clipboard_schema(&conn).unwrap();
    let db = Arc::new(Mutex::new(Some(conn)));
    let paths = vec![
        r"C:\work\one.txt".to_string(),
        r"D:\共享\two.txt".to_string(),
    ];

    store_file_list(&db, "", None, None, Some(&paths)).unwrap();

    let guard = lock_db(&db);
    let conn = guard.as_ref().unwrap();
    let (primary, json, count): (String, String, i64) = conn
        .query_row(
            "SELECT file_path, file_paths, COUNT(*) FROM clipboard_history",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(count, 1);
    assert_eq!(primary, paths[0]);
    assert_eq!(serde_json::from_str::<Vec<String>>(&json).unwrap(), paths);
}
