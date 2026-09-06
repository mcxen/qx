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

const { outputFiles: masonryOutput } = await build({
  entryPoints: ["src/plugin/workbenchMasonry.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const masonry = await import(`data:text/javascript;base64,${Buffer.from(masonryOutput[0].text).toString("base64")}`);
const {
  layoutWorkbenchMasonry,
  resolveWorkbenchMasonryColumns,
  restoreWorkbenchMasonryScrollTop,
  visibleWorkbenchMasonryIndexes,
  workbenchMasonryScrollAnchor,
} = masonry;

const { outputFiles: keyboardOutput } = await build({
  entryPoints: ["src/plugin/workbenchKeyboard.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
});
const { resolveRenderedWorkbenchIndex } = await import(
  `data:text/javascript;base64,${Buffer.from(keyboardOutput[0].text).toString("base64")}`,
);

// Masonry geometry: source order is retained while each next item goes to
// the currently shortest lane. No two card rectangles may overlap.
const interleaved = layoutWorkbenchMasonry([
  { id: "long-a", height: 220 },
  { id: "short-b", height: 40 },
  { id: "long-c", height: 180 },
  { id: "short-d", height: 36 },
  { id: "medium-e", height: 96 },
  { id: "short-f", height: 44 },
], { width: 620, columns: 2, gap: 12 });
assert.deepEqual(interleaved.positions.map((position) => position.id), [
  "long-a", "short-b", "long-c", "short-d", "medium-e", "short-f",
]);
assert.deepEqual(interleaved.positions.map((position) => position.column), [0, 1, 1, 0, 1, 0]);
for (let left = 0; left < interleaved.positions.length; left += 1) {
  for (let right = left + 1; right < interleaved.positions.length; right += 1) {
    const a = interleaved.positions[left];
    const b = interleaved.positions[right];
    const separatedX = a.x + a.width <= b.x || b.x + b.width <= a.x;
    const separatedY = a.y + a.height <= b.y || b.y + b.height <= a.y;
    assert.ok(separatedX || separatedY, `masonry rectangles overlap: ${a.id}/${b.id}`);
  }
}
assert.equal(interleaved.neighbors[0].down, 3);
assert.equal(interleaved.neighbors[0].right, 1);
assert.equal(interleaved.neighbors[1].up, -1);
assert.equal(interleaved.neighbors[1].down, 2);
assert.equal(interleaved.neighbors[1].left, 0);
assert.equal(interleaved.neighbors[1].right, -1);

// The host can consume a neighbor index for a selected card even when that
// destination is outside the bounded mounted DOM window.
const unmountedNeighbor = {
  querySelector: (selector) => {
    assert.equal(selector, '[data-qx-list-index="10"]');
    return { getAttribute: (name) => name === "data-qx-masonry-down" ? "150" : null };
  },
};
assert.equal(resolveRenderedWorkbenchIndex({
  element: unmountedNeighbor,
  kind: "cards",
  key: "ArrowDown",
  index: 10,
  count: 200,
}), 150);

// Responsive Cards are intentionally limited to one through three columns.
assert.equal(resolveWorkbenchMasonryColumns(296, 3, 12, 280), 1);
assert.equal(resolveWorkbenchMasonryColumns(616, 3, 12, 280), 2);
assert.equal(resolveWorkbenchMasonryColumns(956, 3, 12, 280), 3);

// Width changes and measured-height updates reflow without sorting source
// items. A stable item anchor restores its viewport offset after reflow.
const wide = layoutWorkbenchMasonry(
  interleaved.positions.map(({ id, height }) => ({ id, height })),
  { width: 956, columns: 3, gap: 12 },
);
const anchor = workbenchMasonryScrollAnchor(interleaved, 150);
const reflowed = layoutWorkbenchMasonry([
  { id: "inserted", height: 72 },
  ...interleaved.positions.map(({ id, height }) => ({ id, height: id === "long-a" ? height + 80 : height })),
], { width: 620, columns: 2, gap: 12 });
const restored = restoreWorkbenchMasonryScrollTop(reflowed, anchor);
assert.equal(anchor?.id, "long-a");
assert.ok(restored != null && restored >= 0);
const removed = layoutWorkbenchMasonry(
  interleaved.positions
    .filter(({ id }) => id !== "short-b")
    .map(({ id, height }) => ({ id, height })),
  { width: 620, columns: 2, gap: 12 },
);
const removedAnchor = workbenchMasonryScrollAnchor(interleaved, 260);
assert.equal(removed.positions.some((position) => position.id === "short-b"), false);
assert.ok(restoreWorkbenchMasonryScrollTop(removed, removedAnchor) != null);
assert.equal(wide.positions[0].id, "long-a");
assert.equal(wide.columns, 3);
const visible = visibleWorkbenchMasonryIndexes(
  layoutWorkbenchMasonry(Array.from({ length: 2_000 }, (_, index) => ({ id: `item-${index}`, height: 80 })),
    { width: 620, columns: 2, gap: 12 }),
  12_000,
  540,
  600,
);
assert.ok(visible.length < 100, `virtualized geometry mounted too many indexes: ${visible.length}`);

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
assert.match(cardsSource, /layoutWorkbenchMasonry/);
assert.match(cardsSource, /data-qx-masonry-up/);
assert.match(cardsSource, /data-qx-masonry-down/);
assert.match(cardsSource, /data-qx-masonry-left/);
assert.match(cardsSource, /data-qx-masonry-right/);
assert.match(cardsSource, /ResizeObserver/);
assert.doesNotMatch(cardsSource, /defaultRangeExtractor/);
assert.doesNotMatch(cardsSource, /useVirtualizer/);
assert.match(sessionSource, /!current\.ready/);
assert.match(sessionSource, /status === "conflict"/);
assert.match(editorSource, /isImeCompositionEvent/);
assert.match(editorSource, /event\.key === "Escape"/);
assert.match(editorSource, /event\.metaKey \|\| event\.ctrlKey/);
assert.match(viewSource, /registerNavigationGuard/);
assert.match(hostSource, /runWorkbenchNavigation/);
assert.match(hostSource, /onGoHome=\{goHome\}/);
assert.match(hostSource, /resolveRenderedWorkbenchIndex/);

console.log("workbench cards: list/gallery baseline, cards data/editing, identity/overflow and editor navigation guards passed");
