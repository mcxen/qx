mod common;
use common::*;

#[test]
fn block_04_groups_precedence() {
    let g1 = parse_ok("(a b)|c");
    let or1 = as_or(&g1);
    assert_eq!(or1.len(), 2);
    let g2 = parse_ok("a|(b c)");
    let or2 = as_or(&g2);
    assert_eq!(or2.len(), 2);
    let g3 = parse_ok("<(a b)>|<c>");
    let or3 = as_or(&g3);
    assert_eq!(or3.len(), 2);
    let g4 = parse_ok("(a b) (c d) | e");
    let and4 = as_and(&g4);
    assert!(and4.len() >= 2);
    let g5 = parse_ok("a (b|c) d");
    let and5 = as_and(&g5);
    assert!(and5.len() >= 2);
    let g6 = parse_ok("(a|b) c d");
    let and6 = as_and(&g6);
    assert!(and6.len() >= 2);
    let g7 = parse_ok("<a b>|d");
    let or7 = as_or(&g7);
    assert_eq!(or7.len(), 2);
    let g8 = parse_ok("a|<b c>");
    let or8 = as_or(&g8);
    assert_eq!(or8.len(), 2);
    let g9 = parse_ok("(a (b|c)) d");
    let and9 = as_and(&g9);
    assert!(and9.len() >= 2);
    let g10 = parse_ok("(a|b) (c|d)");
    let and10 = as_and(&g10);
    assert!(and10.len() >= 2);
    let g11 = parse_ok("(a (b||c)) d");
    let and11 = as_and(&g11);
    assert_eq!(and11.len(), 2);
    word_is(&and11[0], "a");
    word_is(&and11[1], "d");
}

#[test]
fn nested_and_groups_are_flattened() {
    let expr = parse_ok("(a b) c (d (e f))");
    let parts = as_and(&expr);
    assert_eq!(parts.len(), 6);
    word_is(&parts[0], "a");
    word_is(&parts[1], "b");
    word_is(&parts[2], "c");
    word_is(&parts[3], "d");
    word_is(&parts[4], "e");
    word_is(&parts[5], "f");
}

#[test]
fn nested_or_groups_are_flattened() {
    let expr = parse_ok("(a|b)|(c|d|(e|f))");
    let parts = as_or(&expr);
    assert_eq!(parts.len(), 6);
    word_is(&parts[0], "a");
    word_is(&parts[1], "b");
    word_is(&parts[2], "c");
    word_is(&parts[3], "d");
    word_is(&parts[4], "e");
    word_is(&parts[5], "f");
}
