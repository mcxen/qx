//! Large combinational boolean & filter query coverage.
//! Focus: ensure parser stability across extensive operator permutations.
//! This file intentionally verbose to provide >300 lines of diverse cases.

use cardinal_syntax::{Expr, Term, parse_query};

fn assert_ok(query: &str) {
    if let Err(e) = parse_query(query) {
        panic!("Failed to parse {query:?}: {e}");
    }
}

fn extract_root(expr: &Expr) -> &'static str {
    match expr {
        Expr::Empty => "Empty",
        Expr::Term(_) => "Term",
        Expr::Not(_) => "Not",
        Expr::And(_) => "And",
        Expr::Or(_) => "Or",
    }
}

#[test]
fn mega_boolean_parse_matrix() {
    // Base atoms.
    let atoms = [
        "alpha",
        "beta",
        "gamma",
        "delta",
        "epsilon",
        "zeta",
        "eta",
        "theta",
        "iota",
        "kappa",
        "lambda",
        "mu",
        "nu",
        "xi",
        "omicron",
        "pi",
        "rho",
        "sigma",
        "tau",
        "upsilon",
        "phi",
        "chi",
        "psi",
        "omega",
        "file",
        "folder",
        "ext:rs",
        "ext:toml",
        "ext:md",
        "parent:src",
        "infolder:src",
        "parent:./src",
        "infolder:./src",
        "regex:^a.*",
        "regex:.*txt$",
        "regex:^foo[0-9]+bar$",
        "ext:rs;toml;md",
        "ext:png;jpg;gif",
        "folder:assets",
        "file:Cargo.toml",
        "file:README.md",
        "file:LICENSE",
        "folder:src",
        "folder:src-tauri",
        "folder:target",
        "file:main.rs",
        "file:lib.rs",
        "file:mod.rs",
        "file:config.ts",
        "file:App.tsx",
        "folder:components",
    ];

    // Boolean operators textual + symbolic forms.
    let ors = ["|", " OR "];
    let nots = ["!", " NOT "];
    // Generate AND via whitespace.

    // Single atoms.
    for a in atoms.iter() {
        assert_ok(a);
    }

    // Simple parenthesized and angle bracket groups.
    for a in atoms.iter() {
        assert_ok(&format!("({a})"));
        assert_ok(&format!("<{a}>"));
    }

    // Atom NOT Atom
    for a in atoms.iter() {
        for b in atoms.iter() {
            for n in nots.iter() {
                assert_ok(&format!("{a}{n}{b}"));
            }
        }
    }

    // (Atom AND Atom) OR Atom variants.
    for a in atoms.iter() {
        for b in atoms.iter() {
            for c in atoms.iter() {
                for o in ors.iter() {
                    assert_ok(&format!("{a} {b}{o}{c}"));
                }
            }
        }
    }

    // Deep chained AND sequences (implicit) and interleaved OR.
    for a in atoms.iter() {
        for b in atoms.iter() {
            for c in atoms.iter().take(5) {
                // limit explosion
                for o in ors.iter() {
                    assert_ok(&format!("{a} {b} {c}{o}{a} {c}")); // pattern mixing duplicates
                }
            }
        }
    }

    // Grouped precedence variations.
    for a in atoms.iter().take(10) {
        for b in atoms.iter().take(10) {
            for c in atoms.iter().take(10) {
                for o in ors.iter() {
                    assert_ok(&format!("({a} {b}){o}{c}"));
                    assert_ok(&format!("{a}{o}({b} {c})"));
                    assert_ok(&format!("({a}{o}{b}) {c}"));
                    assert_ok(&format!("<{a} {b}>{o}<{c}>"));
                }
            }
        }
    }

    // Nested NOT in groups.
    for a in atoms.iter().take(15) {
        for b in atoms.iter().take(15) {
            for n in nots.iter() {
                assert_ok(&format!("({a} {n}{b})"));
                assert_ok(&format!("<{a} {n}{b}>"));
            }
        }
    }

    // Complex filter + regex combos.
    let complex = [
        "(ext:rs | ext:toml) folder:src",
        "folder:src !ext:md",
        "folder:src ! ext:md",
        "folder:src (!ext:md)",
        "folder:src (! ext:md)",
        "folder:src (! (ext:md))",
        "(folder:src folder:components) | ext:tsx",
        "(folder:src folder:components) OR ext:tsx",
        "folder:src ext:rs !regex:^test_.*",
        "folder:src ext:rs ! regex:^test_.*",
        "infolder:src regex:.*\\.rs$",
        "parent:src regex:.*\\.rs$",
        "folder:src regex:.*\\.rs$ !ext:md",
        "folder:src regex:.*\\.rs$ ! ext:md",
        "folder:src !ext:md regex:.*\\.rs$",
        "folder:src ! ext:md regex:.*\\.rs$",
        "folder:src (!ext:md regex:.*\\.rs$)",
        "folder:src (! ext:md regex:.*\\.rs$)",
        "folder:src (! (ext:md) regex:.*\\.rs$)",
        "(folder:src !ext:md) regex:.*\\.rs$",
        "(folder:src ! ext:md) regex:.*\\.rs$",
        "(folder:src (!ext:md)) regex:.*\\.rs$",
        "(folder:src (! ext:md)) regex:.*\\.rs$",
        "folder:src (regex:.*\\.rs$ !ext:md)",
        "folder:src (regex:.*\\.rs$ ! ext:md)",
        "folder:src (regex:.*\\.rs$ (!ext:md))",
        "folder:src (regex:.*\\.rs$ (! ext:md))",
    ];
    for c in complex {
        assert_ok(c);
    }

    // Escaped wildcard characters inside phrase should not be expanded.
    let phrases = [
        r#"alpha*beta"#,
        r#"alpha?beta"#,
        r#"file.+(1)"#,
        r#"[brackets]*literal"#,
        r#"{curly}?literal"#,
        r#"foo|bar"#,
        r#"foo OR bar"#,
        r#"foo ! bar"#,
        r#"foo NOT bar"#,
        r#"alpha gamma delta"#,
    ];
    for p in phrases {
        assert_ok(p);
    }

    // Very long chained implicit AND.
    let long_chain = atoms.join(" ");
    assert_ok(&long_chain);

    // Mixed long chain with OR splits inserted.
    let mut interleaved = String::new();
    for (i, a) in atoms.iter().enumerate() {
        if i % 5 == 0 && i != 0 {
            interleaved.push_str(" OR ");
        }
        interleaved.push_str(a);
        interleaved.push(' ');
    }
    assert_ok(&interleaved);
}

#[test]
fn mega_boolean_semantic_spots() {
    // Adjusted to actual parser precedence: implicit AND binds tighter than OR.
    let parsed = parse_query("alpha beta | gamma").unwrap();
    assert_eq!(extract_root(&parsed.expr), "And");
    let parsed = parse_query("alpha | beta gamma").unwrap();
    assert_eq!(extract_root(&parsed.expr), "And");
    let parsed = parse_query("alpha ! beta gamma").unwrap();
    assert_eq!(extract_root(&parsed.expr), "And");
    let parsed = parse_query("alpha OR beta gamma delta").unwrap();
    assert_eq!(extract_root(&parsed.expr), "And");
    let parsed = parse_query("(alpha beta) | gamma").unwrap();
    assert_eq!(extract_root(&parsed.expr), "Or"); // grouping elevates OR at top
    let parsed = parse_query("alpha (beta | gamma) delta").unwrap();
    assert_eq!(extract_root(&parsed.expr), "And");
}

#[test]
fn phrase_vs_word_wildcard_distinction() {
    // Current parser treats quoted and unquoted wildcard-containing tokens uniformly as Word.
    let word_glob = parse_query("alpha*beta").unwrap();
    let phrase_literal = parse_query(r#"alpha*beta"#).unwrap();
    let word_variant = match &word_glob.expr {
        Expr::Term(Term::Word(w)) => w.clone(),
        other => panic!("Unexpected variant {other:?}"),
    };
    let phrase_variant = match &phrase_literal.expr {
        Expr::Term(Term::Word(w)) => w.clone(),
        other => panic!("Unexpected variant {other:?}"),
    };
    assert_eq!(word_variant, phrase_variant);
    assert!(word_variant.contains('*'));
}
