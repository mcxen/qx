mod common;
use cardinal_syntax::*;
use common::*;

#[test]
fn block_01_metadata_tail() {
    let e1 = parse_ok("dm:today a b dc:pastweek");
    let p1 = as_and(&e1);
    word_is(&p1[0], "a");
    word_is(&p1[1], "b");
    filter_is_kind(&p1[2], &FilterKind::DateModified);
    filter_is_kind(&p1[3], &FilterKind::DateCreated);
    let e2 = parse_ok("a dm:today b dc:pastweek c");
    let p2 = as_and(&e2);
    word_is(&p2[0], "a");
    word_is(&p2[1], "b");
    word_is(&p2[2], "c");
    filter_is_kind(&p2[3], &FilterKind::DateModified);
    filter_is_kind(&p2[4], &FilterKind::DateCreated);
    let e3 = parse_ok("dc:pastweek dm:today a b");
    let p3 = as_and(&e3);
    word_is(&p3[0], "a");
    word_is(&p3[1], "b");
    filter_is_kind(&p3[2], &FilterKind::DateCreated);
    filter_is_kind(&p3[3], &FilterKind::DateModified);
    let e4 = parse_ok("dm:today dm:pastweek a b");
    let p4 = as_and(&e4);
    word_is(&p4[0], "a");
    word_is(&p4[1], "b");
    filter_is_kind(&p4[2], &FilterKind::DateModified);
    filter_is_kind(&p4[3], &FilterKind::DateModified);
}

#[test]
fn branch_and_reorder_mixed() {
    let e = parse_ok("folder:src ext:rs report dm:today dc:pastweek");
    let p = as_and(&e);
    word_is(&p[0], "report");
    filter_is_kind(&p[1], &FilterKind::Folder);
    filter_is_kind(&p[2], &FilterKind::Ext);
    filter_is_kind(&p[3], &FilterKind::DateModified);
    filter_is_kind(&p[4], &FilterKind::DateCreated);
}

#[test]
fn branch_metadata_relative_order() {
    let e = parse_ok("dc:pastweek dm:today a b");
    let p = as_and(&e);
    word_is(&p[0], "a");
    word_is(&p[1], "b");
    filter_is_kind(&p[2], &FilterKind::DateCreated);
    filter_is_kind(&p[3], &FilterKind::DateModified);
}

#[test]
fn branch_and_no_metadata() {
    let e = parse_ok("folder:src ext:rs report");
    let p = as_and(&e);
    word_is(&p[0], "report");
    filter_is_kind(&p[1], &FilterKind::Folder);
    filter_is_kind(&p[2], &FilterKind::Ext);
}

#[test]
fn metadata_tail_preserves_non_metadata_order() {
    let e = parse_ok("dm:today x y z dc:pastweek w");
    let p = as_and(&e);
    let l = p.len();
    word_is(&p[0], "x");
    word_is(&p[1], "y");
    word_is(&p[2], "z");
    word_is(&p[3], "w");
    filter_is_kind(&p[l - 2], &FilterKind::DateModified);
    filter_is_kind(&p[l - 1], &FilterKind::DateCreated);
}
