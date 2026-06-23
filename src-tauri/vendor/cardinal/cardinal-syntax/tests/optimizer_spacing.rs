mod common;
use cardinal_syntax::*;
use common::*;

#[test]
fn block_10_spacing_variants() {
    let s1 = parse_ok("a  b   c\n d");
    let parts1 = as_and(&s1);
    assert_eq!(parts1.len(), 4);
    let s2 = parse_ok("a\t\tb   c\n d");
    let parts2 = as_and(&s2);
    assert_eq!(parts2.len(), 4);
    let s3 = parse_ok("a OR  b   c");
    let parts3 = as_and(&s3);
    assert!(parts3.len() >= 2);
    let s4 = parse_ok("a  NOT  b   c");
    let parts4 = as_and(&s4);
    assert!(parts4.len() >= 2);
    let s5 = parse_ok("a| b |c");
    let parts5 = as_or(&s5);
    assert_eq!(parts5.len(), 3);
    let s6 = parse_ok(" a| b |c ");
    let parts6 = as_or(&s6);
    assert_eq!(parts6.len(), 3);
    let s7 = parse_ok("a |b | c");
    let parts7 = as_or(&s7);
    assert_eq!(parts7.len(), 3);
    let s8 = parse_ok("a b c d e f g h i j k l m");
    let parts8 = as_and(&s8);
    assert!(parts8.len() >= 10);
    let s9 = parse_ok("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda");
    let parts9 = as_and(&s9);
    assert!(parts9.len() >= 10);
    let s10 = parse_ok("folder:src   ext:rs   regex:^a   dm:today");
    let p10 = as_and(&s10);
    let l10 = p10.len();
    filter_is_kind(&p10[l10 - 1], &FilterKind::DateModified);
}
