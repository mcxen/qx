mod common;
use cardinal_syntax::*;
use common::*;

#[test]
fn block_02_and_elide_empty() {
    let e1 = parse_ok("a   b");
    assert!(!is_empty(&e1));
    let e2 = parse_ok("AND  a b c");
    let p2 = as_and(&e2);
    for x in p2 {
        assert!(!is_empty(x));
    }
    let e3 = parse_ok("a b AND  c d");
    let p3 = as_and(&e3);
    for x in p3 {
        assert!(!is_empty(x));
    }
    let e4 = parse_ok("a AND   AND  b c");
    let p4 = as_and(&e4);
    for x in p4 {
        assert!(!is_empty(x));
    }
    let e5 = parse_ok("AND  AND  a b c d");
    let p5 = as_and(&e5);
    for x in p5 {
        assert!(!is_empty(x));
    }
    let e6 = parse_ok("a b c AND  d AND  e");
    let p6 = as_and(&e6);
    for x in p6 {
        assert!(!is_empty(x));
    }
    let e7 = parse_ok("AND  x y z AND  u v");
    let p7 = as_and(&e7);
    for x in p7 {
        assert!(!is_empty(x));
    }
    let e8 = parse_ok("p q r AND   AND   AND  s t");
    let p8 = as_and(&e8);
    for x in p8 {
        assert!(!is_empty(x));
    }
    let e9 = parse_ok("a AND  b AND  c AND   AND  d");
    let p9 = as_and(&e9);
    for x in p9 {
        assert!(!is_empty(x));
    }
    let e10 = parse_ok("AND  a AND  b AND  c d e");
    let p10 = as_and(&e10);
    for x in p10 {
        assert!(!is_empty(x));
    }
    let e11 = parse_ok("x AND  y AND  z AND  w");
    let p11 = as_and(&e11);
    for x in p11 {
        assert!(!is_empty(x));
    }
    let e12 = parse_ok("AND  x AND  y AND  z AND  w");
    let p12 = as_and(&e12);
    for x in p12 {
        assert!(!is_empty(x));
    }
    let e13 = parse_ok("a AND  b c AND  d e AND  f");
    let p13 = as_and(&e13);
    for x in p13 {
        assert!(!is_empty(x));
    }
    let e14 = parse_ok("a b c AND  ");
    let p14 = as_and(&e14);
    for x in p14 {
        assert!(!is_empty(x));
    }
}

#[test]
fn branch_and_single_item() {
    let e = parse_ok("a AND   ");
    word_is(&e, "a");
}

#[test]
fn branch_and_zero_items() {
    let e = optimize_query(parse_query("AND   ").unwrap());
    assert!(matches!(e.expr, Expr::Empty));
}

#[test]
fn or_empty_inside_and_elided() {
    let e = parse_ok("a (b||c) d");
    let p = as_and(&e);
    assert_eq!(p.len(), 2);
    word_is(&p[0], "a");
    word_is(&p[1], "d");
}
