mod common;
use cardinal_syntax::*;
use common::*;

#[test]
fn block_05_not_chain() {
    let n1 = parse_ok("!x");
    match &n1 {
        Expr::Not(inner) => word_is(inner, "x"),
        _ => panic!(),
    }
    let n2 = parse_ok("!!x");
    word_is(&n2, "x");
    let n3 = parse_ok("!!!x");
    match &n3 {
        Expr::Not(inner) => word_is(inner, "x"),
        _ => panic!(),
    }
    let n4 = parse_ok("!!!!x");
    word_is(&n4, "x");
    let n5 = parse_ok("!!!!!x");
    match &n5 {
        Expr::Not(inner) => word_is(inner, "x"),
        _ => panic!(),
    }
    let n6 = parse_ok("!ext:rs");
    match &n6 {
        Expr::Not(inner) => filter_is_kind(inner, &FilterKind::Ext),
        _ => panic!(),
    }
    let n7 = parse_ok("!!ext:rs");
    match &n7 {
        Expr::Term(_) => {}
        _ => panic!(),
    }
    let n8 = parse_ok("!!!folder:src");
    match &n8 {
        Expr::Not(inner) => filter_is_kind(inner, &FilterKind::Folder),
        _ => panic!(),
    }
    let n9 = parse_ok("!!!!folder:src");
    match &n9 {
        Expr::Term(_) => {}
        _ => panic!(),
    }
    let n10 = parse_ok("!a !b c");
    let p10 = as_and(&n10);
    assert!(p10.len() >= 3);
}

#[test]
fn branch_not_expr() {
    let e = parse_ok("!dm:today a");
    let p = as_and(&e);
    match &p[0] {
        Expr::Not(inner) => filter_is_kind(inner, &FilterKind::DateModified),
        _ => panic!(),
    }
}
