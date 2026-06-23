mod common;
use cardinal_syntax::*;
use common::*;

#[test]
fn block_09_paths_and_custom() {
    let p1 = parse_ok("\\\\server\\share\\folder parent:src");
    let parts1 = as_and(&p1);
    assert!(parts1.len() >= 2);
    let p2 = parse_ok("/usr/local/bin infolder:src");
    let parts2 = as_and(&p2);
    assert!(parts2.len() >= 2);
    let p3 = parse_ok("C: D: E:");
    let parts3 = as_and(&p3);
    assert!(parts3.len() >= 3);
    let p4 = parse_ok("<D:|E:> a b");
    let parts4 = as_and(&p4);
    assert!(parts4.len() >= 2);
    let p5 = parse_ok("custom:foo a b c");
    let parts5 = as_and(&p5);
    assert!(parts5.len() >= 2);
    let p6 = parse_ok("custom:bar dm:today a");
    let parts6 = as_and(&p6);
    let l6 = parts6.len();
    filter_is_kind(&parts6[l6 - 1], &FilterKind::DateModified);
    let p7 = parse_ok("custom:baz dc:pastweek a");
    let parts7 = as_and(&p7);
    let l7 = parts7.len();
    filter_is_kind(&parts7[l7 - 1], &FilterKind::DateCreated);
    let p8 = parse_ok("folder:src custom:abc def");
    let parts8 = as_and(&p8);
    assert!(parts8.len() >= 2);
    let p9 = parse_ok("regex:^Report custom:qwe asd");
    let parts9 = as_and(&p9);
    assert!(parts9.len() >= 2);
    let p10 = parse_ok("file:README.md custom:xyz");
    let parts10 = as_and(&p10);
    assert!(parts10.len() >= 2);
}
