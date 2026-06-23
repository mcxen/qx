mod common;
use cardinal_syntax::*;
use common::*;

#[test]
fn and_is_implicit_by_whitespace() {
    let expr = parse_ok("foo bar baz");
    let parts = as_and(&expr);
    assert_eq!(parts.len(), 3);
    word_is(&parts[0], "foo");
    word_is(&parts[1], "bar");
    word_is(&parts[2], "baz");
}

#[test]
fn or_has_higher_precedence_than_and() {
    let expr = parse_ok("a b|c d");
    let parts = as_and(&expr);
    assert_eq!(parts.len(), 3);
    word_is(&parts[0], "a");
    let right = &parts[1];
    let or_parts = as_or(right);
    assert_eq!(or_parts.len(), 2);
    word_is(&or_parts[0], "b");
    word_is(&or_parts[1], "c");
    word_is(&parts[2], "d");
}

#[test]
fn consecutive_or_with_empty_operand_collapses_to_empty_expr() {
    let expr = parse_ok("foo||bar");
    assert!(is_empty(&expr));
}

#[test]
fn leading_or_collapses_to_empty_expr() {
    let expr = parse_ok("| foo");
    assert!(is_empty(&expr));
}

#[test]
fn trailing_or_collapses_to_empty_expr() {
    let expr = parse_ok("foo |");
    assert!(is_empty(&expr));
}

#[test]
fn or_with_empty_phrase_collapses_to_empty_expr() {
    let expr = parse_ok("a|\"\"");
    assert!(is_empty(&expr));
}

#[test]
fn not_binds_tighter_than_or_and_and() {
    let expr = parse_ok("!foo | bar baz");
    let parts = as_and(&expr);
    assert_eq!(parts.len(), 2);
    let left = &parts[0];
    let left_or = as_or(left);
    let not_foo = &left_or[0];
    let not_inner = as_not(not_foo);
    word_is(not_inner, "foo");
    word_is(&left_or[1], "bar");
    word_is(&parts[1], "baz");
}

#[test]
fn not_chain_collapses_to_single() {
    let expr = parse_ok("!!!foo");
    let inner = as_not(&expr);
    if let Expr::Not(_) = inner {
        panic!("double NOT should cancel")
    }
}

#[test]
fn textual_keywords_are_accepted() {
    let expr = parse_ok("foo AND bar");
    let parts = as_and(&expr);
    assert_eq!(parts.len(), 2);
    word_is(&parts[0], "foo");
    word_is(&parts[1], "bar");

    let expr = parse_ok("NOT temp");
    let inner = as_not(&expr);
    word_is(inner, "temp");

    let expr = parse_ok("foo OR bar");
    let parts = as_or(&expr);
    assert_eq!(parts.len(), 2);
    word_is(&parts[0], "foo");
    word_is(&parts[1], "bar");
}

#[test]
fn textual_keywords_with_boundaries() {
    // NOT should not eat path separators
    let expr = parse_ok("NOT/Users");
    let inner = as_not(&expr);
    word_is(inner, "/Users");

    // AND with gaps should reduce to empty
    let expr = parse_ok(" AND ");
    assert!(is_empty(&expr));

    // OR with gaps should reduce to empty
    let expr = parse_ok(" | ");
    assert!(is_empty(&expr));
}
