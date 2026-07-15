#!/usr/bin/env node
/**
 * Systemic i18n gate — not a one-off string audit.
 *
 * Scans src/** for t("key", "fallback") / t('key', 'fallback') and ensures every
 * static key exists in the zh dictionary in src/i18n.ts.
 *
 * Dynamic keys (template literals with ${}) are listed as warnings only.
 *
 * Exit 1 on any missing static key.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const srcRoot = path.join(root, "src");
const i18nPath = path.join(srcRoot, "i18n.ts");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "shadcn") continue;
      walk(target, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      out.push(target);
    }
  }
  return out;
}

function extractZhKeys(source) {
  const start = source.indexOf("const zh");
  if (start < 0) throw new Error("cannot find const zh in src/i18n.ts");
  const brace = source.indexOf("{", start);
  let depth = 0;
  let end = brace;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(brace, end + 1);
  return new Set([...body.matchAll(/^\s*"([^"]+)":\s*"/gm)].map((m) => m[1]));
}

/** t("key", "fallback") or t('key', 'fallback') — first arg static string only */
const STATIC_T = /\bt\s*\(\s*(["'])([^"'\\]+)\1\s*,/g;
/** t(`prefix.${id}`) style — dynamic, warn only */
const DYNAMIC_T = /\bt\s*\(\s*`([^`]+)`/g;

const i18nSource = fs.readFileSync(i18nPath, "utf8");
const zhKeys = extractZhKeys(i18nSource);
const files = walk(srcRoot);

const missing = new Map(); // key -> Set of files
const dynamic = [];

for (const file of files) {
  if (file.endsWith(`${path.sep}i18n.ts`)) continue;
  const content = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file);

  for (const match of content.matchAll(STATIC_T)) {
    const key = match[2];
    if (!zhKeys.has(key)) {
      if (!missing.has(key)) missing.set(key, new Set());
      missing.get(key).add(rel);
    }
  }

  for (const match of content.matchAll(DYNAMIC_T)) {
    const expr = match[1];
    if (expr.includes("${")) {
      dynamic.push({ file: rel, expr });
    }
  }
}

const missingKeys = [...missing.keys()].sort();
if (missingKeys.length) {
  console.error(`i18n: ${missingKeys.length} static key(s) used but missing from zh dictionary:\n`);
  for (const key of missingKeys) {
    const locs = [...missing.get(key)].slice(0, 5).join(", ");
    console.error(`  - ${key}`);
    console.error(`      at ${locs}`);
  }
  console.error("\nFix: add entries to src/i18n.ts zh map (English stays at call-site fallback).");
  process.exit(1);
}

console.log(`i18n: ok — ${zhKeys.size} zh keys, no missing static t() keys across ${files.length} files.`);
if (dynamic.length) {
  console.log(`i18n: ${dynamic.length} dynamic t(\`...\`) call(s) (not auto-checked):`);
  const sample = dynamic.slice(0, 12);
  for (const item of sample) {
    console.log(`  - ${item.file}: \`${item.expr}\``);
  }
  if (dynamic.length > sample.length) console.log(`  … +${dynamic.length - sample.length} more`);
}
