mod common;
use cardinal_syntax::FilterKind;
use common::*;

#[test]
fn regex_term_parses_basic_pattern() {
    let expr = parse_ok("regex:^Report");
    regex_is(&expr, "^Report");
}

#[test]
fn regex_term_trims_whitespace_and_is_case_insensitive() {
    let expr = parse_ok("  ReGeX:  [0-9]{4}   ");
    regex_is(&expr, "[0-9]{4}");
}

#[test]
fn regex_term_requires_pattern() {
    let err = parse_err("regex:");
    assert!(err.message.contains("requires a pattern"));
}

#[test]
fn regex_term_can_coexist_with_other_filters_and_words() {
    let expr = parse_ok("foo regex:^bar$ ext:rs");
    let parts = as_and(&expr);
    assert_eq!(parts.len(), 3);
    word_is(&parts[0], "foo");
    regex_is(&parts[1], "^bar$");
    filter_is_kind(&parts[2], &FilterKind::Ext);
}

#[test]
fn regex_term_respects_group_boundaries() {
    let expr = parse_ok("(regex:foo(bar))");
    regex_is(&expr, "foo(bar)");
}

#[test]
fn regex_term_can_participate_in_or_expressions() {
    let expr = parse_ok("regex:^foo$ | bar");
    let parts = as_or(&expr);
    assert_eq!(parts.len(), 2);
    regex_is(&parts[0], "^foo$");
    word_is(&parts[1], "bar");
}

#[test]
fn regex_term_supports_quoted_patterns() {
    let expr = parse_ok(r#"regex:"foo bar|baz""#);
    regex_is(&expr, "foo bar|baz");
}
