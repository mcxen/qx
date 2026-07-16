import assert from "node:assert/strict";
import {
  resolveQxContentScroll,
  resolveQxListNavigation,
} from "../src/components/qx-shell/navigationModel.ts";
import {
  MatchTier,
  classifyMatch,
  normalizeSearchQuery,
  textMatchesQuery,
} from "../src/search/rankResults.ts";

const list = (overrides = {}) => resolveQxListNavigation({
  key: "ArrowDown",
  index: 2,
  count: 12,
  pageSize: 5,
  editable: false,
  allowEditable: false,
  modified: false,
  canOpen: true,
  canClose: true,
  ...overrides,
});

assert.deepEqual(list(), { type: "change", index: 3 });
assert.deepEqual(list({ key: "PageDown" }), { type: "change", index: 7 });
assert.deepEqual(list({ key: "Home" }), { type: "change", index: 0 });
assert.deepEqual(list({ key: "End" }), { type: "change", index: 11 });
assert.deepEqual(list({ key: "ArrowRight" }), { type: "open" });
assert.deepEqual(list({ key: "ArrowLeft" }), { type: "close" });

// Textareas/contenteditable keep arrows, pages, Home/End, and modified selection.
assert.equal(list({ editable: true, allowEditable: false }), null);
assert.equal(list({ key: "PageDown", editable: true, allowEditable: false }), null);
assert.equal(list({ key: "Home", editable: true, allowEditable: true }), null);
assert.equal(list({ modified: true }), null);

// Search inputs may opt into list arrows/pages without losing native Home/End.
assert.deepEqual(list({ editable: true, allowEditable: true }), { type: "change", index: 3 });
assert.deepEqual(list({ key: "PageUp", editable: true, allowEditable: true }), { type: "change", index: 0 });

const scroll = (overrides = {}) => resolveQxContentScroll({
  key: "ArrowDown",
  shiftKey: false,
  scrollTop: 100,
  scrollHeight: 1200,
  clientHeight: 500,
  ...overrides,
});

assert.equal(scroll(), 156);
assert.equal(scroll({ key: "PageDown" }), 510);
assert.equal(scroll({ key: " ", shiftKey: true }), -310);
assert.equal(scroll({ key: "Home" }), 0);
assert.equal(scroll({ key: "End" }), 1200);
assert.equal(scroll({ scrollHeight: 500 }), null);

// Launcher text matching is case-insensitive, Unicode-normalized, and tolerant
// of spaces/common separators across apps, built-ins, and extension keywords.
assert.equal(normalizeSearchQuery("  Ｑx   AI  "), "qx ai");
assert.equal(classifyMatch("QxAI", "qx ai"), MatchTier.exact);
assert.equal(classifyMatch("screen-recording", "screen recording"), MatchTier.exact);
assert.equal(textMatchesQuery("Cardinal", "cardinal file search"), true);

console.log("QxShell navigation checks passed");
