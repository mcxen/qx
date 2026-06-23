mod common;
use common::*;

#[test]
fn block_03_or_fold_empty() {
    let e1 = parse_ok("|a|b");
    assert!(is_empty(&e1));
    let e2 = parse_ok("a||b");
    assert!(is_empty(&e2));
    let e3 = parse_ok("a| |b");
    assert!(is_empty(&e3));
    let e4 = parse_ok("||");
    assert!(is_empty(&e4));
    let e5 = parse_ok("|a||b|");
    assert!(is_empty(&e5));
    let e6 = parse_ok("a|b||c");
    assert!(is_empty(&e6));
    let e7 = parse_ok("||a|b|c");
    assert!(is_empty(&e7));
    let e8 = parse_ok("a|||b");
    assert!(is_empty(&e8));
    let e9 = parse_ok("| | | ");
    assert!(is_empty(&e9));
    let e10 = parse_ok("alpha||beta|gamma");
    assert!(is_empty(&e10));
    let e11 = parse_ok("|alpha|beta|gamma");
    assert!(is_empty(&e11));
    let e12 = parse_ok("alpha|beta|gamma||delta");
    assert!(is_empty(&e12));
    let e13 = parse_ok("||alpha||beta||");
    assert!(is_empty(&e13));
    let e14 = parse_ok("omega|psi|chi||phi");
    assert!(is_empty(&e14));
    let e15 = parse_ok("||omega|psi|chi|phi");
    assert!(is_empty(&e15));
    let e16 = parse_ok("|ext:rs|ext:md");
    assert!(is_empty(&e16));
    let e17 = parse_ok("folder:src||ext:rs");
    assert!(is_empty(&e17));
    let e18 = parse_ok("regex:^a| ||b");
    assert!(is_empty(&e18));
    let e19 = parse_ok("parent:src| |infolder:src");
    assert!(is_empty(&e19));
    let e20 = parse_ok("a||b|c|d");
    assert!(is_empty(&e20));
}

#[test]
fn branch_or_contains_empty() {
    let e = parse_ok("a||b");
    assert!(is_empty(&e));
    let e2 = parse_ok("|a|b");
    assert!(is_empty(&e2));
}

#[test]
fn branch_or_no_empty() {
    let e = parse_ok("a|b|c");
    let p = as_or(&e);
    assert_eq!(p.len(), 3);
    word_is(&p[0], "a");
    word_is(&p[1], "b");
    word_is(&p[2], "c");
}
