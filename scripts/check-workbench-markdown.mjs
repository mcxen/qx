#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import process from "node:process";

// The converter is intentionally kept in TypeScript with the host source.
// Re-exec this focused gate with Node's type stripping so `npm run check` can
// continue to use the same direct `.mjs` script convention as other gates.
if (!process.execArgv.includes("--experimental-strip-types")) {
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types",
    process.argv[1],
    ...process.argv.slice(2),
  ], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

const { analyzeWorkbenchMarkdown, serializeWorkbenchMarkdown } = await import(
  "../src/plugin/workbenchMarkdown.ts"
);
const { normalizePluginWorkbenchState } = await import("../src/plugin/workbenchTypes.ts");

function parse(source) {
  const result = analyzeWorkbenchMarkdown(source);
  assert.equal(result.safe, true, `expected supported Markdown: ${source}`);
  assert.ok(result.document, "supported Markdown must produce a document");
  return serializeWorkbenchMarkdown(result.document);
}

assert.equal(parse("plain first line\nplain second line"), "plain first line\nplain second line");
assert.equal(parse("- [ ] todo\n- [x] done"), "- [ ] todo\n- [x] done");
const legacyTasks = analyzeWorkbenchMarkdown("[] todo\n[x] done");
assert.equal(legacyTasks.safe, true);
assert.equal(legacyTasks.document.content[0].type, "taskList");
assert.deepEqual(legacyTasks.document.content[0].content.map(item => item.attrs.checked), [false, true]);
assert.equal(serializeWorkbenchMarkdown(legacyTasks.document), "- [ ] todo\n- [x] done");
// Nonstandard dashed empty brackets remain lossless in source mode.
assert.equal(analyzeWorkbenchMarkdown("- [] todo").safe, false);
assert.equal(
  parse("# heading\n\n2. two\n3. three\n  1. nested\n\n- [ ] parent\n  - [x] child"),
  "# heading\n\n2. two\n3. three\n  1. nested\n\n- [ ] parent\n  - [x] child",
);
assert.equal(
  parse("```ts\nconst x = 1\n```\n\nline  \nbreak\nsoft newline"),
  "```ts\nconst x = 1\n```\n\nline  \nbreak\nsoft newline",
);
assert.equal(
  parse("<u>under **bold**</u> [safe](https://example.com \"title\")\\*literal\\*"),
  "<u>under **bold**</u> [safe](https://example.com \"title\")\\*literal\\*",
);

for (const [source, reason] of [
  ["![image](https://example.com/a.png)", "image"],
  ["| a | b |\n| --- | --- |\n| c | d |", "table"],
  ["<script>alert(1)</script>", "html"],
  ["[bad](javascript:alert(1))", "dangerous-link"],
]) {
  const result = analyzeWorkbenchMarkdown(source);
  assert.equal(result.safe, false, `unsafe Markdown must stay in source mode: ${source}`);
  assert.equal(result.reason, reason);
}

function editorFormat(value) {
  const state = normalizePluginWorkbenchState({
    layout: { kind: "cards" },
    items: [{ id: "note", title: "Note", editor: value }],
  });
  return state.items?.[0]?.editor?.format;
}

assert.equal(editorFormat(undefined), undefined);
assert.equal(editorFormat({ format: "markdown" }), "markdown");
assert.equal(editorFormat({ format: "plaintext" }), "plaintext");
assert.equal(editorFormat({ format: "unknown" }), "plaintext");

console.log("workbench markdown: Tiptap Markdown round-trips, source-only safety guards, and format normalization passed");
