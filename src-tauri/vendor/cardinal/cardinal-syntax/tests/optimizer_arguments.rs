mod common;
use cardinal_syntax::*;
use common::*;

#[test]
fn block_07_arguments_shapes() {
    let a1 = parse_ok("ext:jpg;png");
    filter_is_kind(&a1, &FilterKind::Ext);
    filter_arg_is_list(&a1, &["jpg", "png"]);
    let a2 = parse_ok("size:1..10");
    filter_is_kind(&a2, &FilterKind::Size);
    filter_arg_is_range_dots(&a2, Some("1"), Some("10"));
    let a3 = parse_ok("size:..10");
    filter_is_kind(&a3, &FilterKind::Size);
    filter_arg_is_range_dots(&a3, None, Some("10"));
    let a4 = parse_ok("size:1..");
    filter_is_kind(&a4, &FilterKind::Size);
    filter_arg_is_range_dots(&a4, Some("1"), None);
    let a5 = parse_ok("dc:2021/01/01-2021/02/01");
    filter_is_kind(&a5, &FilterKind::DateCreated);
    let a6 = parse_ok("dm:2020/1/1-2020/12/31");
    filter_is_kind(&a6, &FilterKind::DateModified);
    let a7 = parse_ok("size:10-20");
    let (_, arg7) = common::filter_kind(&a7);
    assert!(matches!(
        arg7.as_ref().unwrap().kind,
        ArgumentKind::Bare | ArgumentKind::Comparison(_)
    ));
    let a8 = parse_ok("size:>1mb");
    filter_arg_is_comparison(&a8, ComparisonOp::Gt, "1mb");
    let a9 = parse_ok("size:<=2gb");
    filter_arg_is_comparison(&a9, ComparisonOp::Lte, "2gb");
    let a10 = parse_ok("size:!=42");
    filter_arg_is_comparison(&a10, ComparisonOp::Ne, "42");
}

#[test]
fn block_08_comparisons_matrix() {
    let c1 = parse_ok("size:>100 a b dm:today");
    let p1 = as_and(&c1);
    let l1 = p1.len();
    filter_is_kind(&p1[l1 - 1], &FilterKind::DateModified);
    let c2 = parse_ok("size:>=100 a b dc:pastweek");
    let p2 = as_and(&c2);
    let l2 = p2.len();
    filter_is_kind(&p2[l2 - 1], &FilterKind::DateCreated);
    let c3 = parse_ok("size:<100 a b c");
    let p3 = as_and(&c3);
    assert!(p3.len() >= 3);
    let c4 = parse_ok("size:<=100 a b c d");
    let p4 = as_and(&c4);
    assert!(p4.len() >= 4);
    let c5 = parse_ok("size:=100 a b");
    let p5 = as_and(&c5);
    assert!(p5.len() >= 2);
    let c6 = parse_ok("size:!=100 a b");
    let p6 = as_and(&c6);
    assert!(p6.len() >= 2);
    let c7 = parse_ok("size:>1gb folder:src a");
    let p7 = as_and(&c7);
    assert!(p7.len() >= 3);
    let c8 = parse_ok("size:<2mb ext:rs a b");
    let p8 = as_and(&c8);
    assert!(p8.len() >= 3);
    let c9 = parse_ok("size:>=3kb regex:^a a");
    let p9 = as_and(&c9);
    assert!(p9.len() >= 3);
    let c10 = parse_ok("size:<=4tb parent:src a");
    let p10 = as_and(&c10);
    assert!(p10.len() >= 3);
}
