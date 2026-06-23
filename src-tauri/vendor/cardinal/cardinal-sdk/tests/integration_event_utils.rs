use cardinal_sdk::{EventFlag, EventType, ScanType, event_id_to_timestamp};
use std::collections::HashMap;

// NOTE: Cannot deterministically assert macOS FSEvents ids; focus on logical properties of event_id_to_timestamp.
#[test]
fn binary_search_timestamp_monotonicity() {
    // Use a fake device id (0) and simulate cache growth.
    // We only assert that the returned timestamp is within plausible bounds and stable when repeated.
    let dev = 0; // best-effort; underlying call may ignore invalid dev
    let mut cache = HashMap::new();

    // Capture a few increasing event ids via successive calls to current timestamp resolution.
    // Without real device differentiation we just call the function with fabricated ids.
    let t1 = event_id_to_timestamp(dev, 1, &mut cache);
    let t2 = event_id_to_timestamp(dev, 2, &mut cache);
    let t3 = event_id_to_timestamp(dev, 3, &mut cache);
    assert!(
        t1 <= t2 && t2 <= t3,
        "timestamps should be monotonic for increasing ids"
    );

    // Re-query should hit cache and produce identical result.
    let again_t2 = event_id_to_timestamp(dev, 2, &mut cache);
    assert_eq!(t2, again_t2, "cached midpoint lookup should be stable");
}

#[test]
fn event_type_and_scan_type_cross_matrix() {
    // Each flag combination yields expected EventType and ScanType without panics.
    let cases = [
        (EventFlag::ItemIsFile, EventType::File),
        (EventFlag::ItemIsDir, EventType::Dir),
        (EventFlag::ItemIsSymlink, EventType::Symlink),
        (EventFlag::IsHardlink, EventType::Hardlink),
        (EventFlag::IsLastHardlink, EventType::Hardlink),
        (EventFlag::None, EventType::Unknown),
    ];

    for (flag, expected_type) in cases {
        assert!(matches!(flag.event_type(), t if t == expected_type));
    }

    // ScanType expectations: RootChanged => ReScan, HistoryDone => Nop, Dir bits => Folder, File bits => SingleNode.
    assert!(matches!(
        (EventFlag::RootChanged).scan_type(),
        ScanType::ReScan
    ));
    assert!(matches!(
        (EventFlag::HistoryDone).scan_type(),
        ScanType::Nop
    ));
    assert!(matches!(
        (EventFlag::ItemIsDir).scan_type(),
        ScanType::Folder
    ));
    assert!(matches!(
        (EventFlag::ItemIsFile).scan_type(),
        ScanType::SingleNode
    ));
}
