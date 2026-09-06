#!/usr/bin/env node
/**
 * Ablation-level checks for Workbench collection compatibility and cards data.
 * This intentionally exercises the production trust-boundary normalizer while
 * keeping browser rendering in the separate visual fixture.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/plugin/workbenchTypes.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const workbench = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const { normalizePluginWorkbenchState, normalizePluginWorkbenchEditResult } = workbench;

// Baseline ablation: list/gallery retain their old normalized shape and title fallback.
const list = normalizePluginWorkbenchState({
  items: [{ id: "legacy-list", title: "" }],
});
assert.deepEqual(list.layout, { kind: "list" });
assert.equal(list.items[0].title, "Item 1");
assert.equal("density" in list.layout, false);
const gallery = normalizePluginWorkbenchState({
  layout: { kind: "gallery", columns: 1 },
  items: [{ id: "legacy-gallery", title: "" }],
});
assert.deepEqual(gallery.layout, {
  kind: "gallery",
  columns: 2,
  aspectRatio: "landscape",
});
assert.equal(gallery.items[0].title, "Item 1");

// Cards without editing: card body is independent from bounded subtitle data,
// and an empty title/body remains empty instead of being fabricated.
const cards = normalizePluginWorkbenchState({
  layout: { kind: "cards", columns: 4, showImages: false },
  items: [{
    id: "card-empty-title",
    title: "",
    subtitle: "bounded preview must not become card body",
    card: { body: "", tags: ["one"], pinned: true },
  }],
});
assert.equal(cards.layout.kind, "cards");
assert.equal(cards.layout.columns, 4);
assert.equal(cards.layout.showImages, false);
assert.equal(cards.items[0].title, "");
assert.equal(cards.items[0].card.body, "");
assert.equal(cards.items[0].subtitle, "bounded preview must not become card body");
assert.equal(cards.items[0].editor, undefined);

// Cards + editing: editor data is explicit and full response values are kept.
const editable = normalizePluginWorkbenchState({
  layout: { kind: "cards" },
  items: [{ id: "editable", title: "Note", card: { body: "preview" }, editor: { rows: 2 } }],
});
assert.equal(editable.items[0].editor.rows, 3, "editor rows are clamped by the host");
const start = normalizePluginWorkbenchEditResult({
  phase: "start", status: "ready", itemId: "editable", sessionId: "s1", requestId: "r1",
  value: "authoritative full body\nwith Markdown *untouched*", revision: "opaque-v1",
});
assert.equal(start.status, "ready");
assert.equal(start.value, "authoritative full body\nwith Markdown *untouched*");
const oversized = normalizePluginWorkbenchEditResult({
  phase: "save", status: "saved", itemId: "editable", sessionId: "s1", requestId: "r2",
  value: "字".repeat(22_000),
});
assert.equal(oversized.status, "error");
assert.equal(oversized.value, undefined, "64 KiB overflow is never truncated into a save");

// Old/hostile responses cannot create a different correlation key by coercion.
assert.equal(normalizePluginWorkbenchEditResult({
  phase: "start", status: "ready", itemId: "editable", sessionId: "s1", requestId: {}, value: "x",
}), undefined);
assert.equal(normalizePluginWorkbenchEditResult({
  phase: "start", status: "ready", itemId: "editable", sessionId: "s1", requestId: "r".repeat(257), value: "x",
}), undefined);

const [cardsSource, sessionSource, editorSource, viewSource, hostSource] = await Promise.all([
  readFile("src/plugin/PluginWorkbenchCards.tsx", "utf8"),
  readFile("src/plugin/workbenchEditSession.ts", "utf8"),
  readFile("src/plugin/PluginWorkbenchInlineEditor.tsx", "utf8"),
  readFile("src/plugin/PluginWorkbenchView.tsx", "utf8"),
  readFile("src/plugin/PluginHost.tsx", "utf8"),
]);
assert.match(cardsSource, /data-qx-grid-columns/);
assert.match(cardsSource, /onDoubleClick/);
assert.match(cardsSource, /defaultRangeExtractor/);
assert.match(sessionSource, /!current\.ready/);
assert.match(sessionSource, /status === "conflict"/);
assert.match(editorSource, /isImeCompositionEvent/);
assert.match(editorSource, /event\.key === "Escape"/);
assert.match(editorSource, /event\.metaKey \|\| event\.ctrlKey/);
assert.match(viewSource, /registerNavigationGuard/);
assert.match(hostSource, /runWorkbenchNavigation/);
assert.match(hostSource, /onGoHome=\{goHome\}/);

console.log("workbench cards: list/gallery baseline, cards data/editing, identity/overflow and editor navigation guards passed");
