import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveQxContentScroll,
  resolveQxListNavigation,
  shouldProxySearchReadingKey,
  shouldSwitchRegionFromSearch,
} from "../src/components/qx-shell/navigationModel.ts";
import {
  MatchTier,
  classifyMatch,
  normalizeSearchQuery,
  textMatchesQuery,
} from "../src/search/rankResults.ts";
import {
  shouldForwardPluginWorkbenchHostKey,
} from "../src/plugin/workbenchKeyboard.ts";
import {
  resolveQxGridIndex,
  shouldHandleQxGridKey,
} from "../src/hooks/qxGridNavigation.ts";
import { normalizePluginWorkbenchState } from "../src/plugin/workbenchTypes.ts";

const qxShellSource = readFileSync(
  new URL("../src/components/QxShell.tsx", import.meta.url),
  "utf8",
);
const shortcutRecorderSource = readFileSync(
  new URL("../src/components/ShortcutRecorder.tsx", import.meta.url),
  "utf8",
);

// Shortcut recording owns keyboard focus. The shell's normal pointer-up
// search restore must recognize the shared focus-preservation marker.
assert.match(qxShellSource, /data-qx-search-focus="preserve"/);
assert.match(shortcutRecorderSource, /data-qx-search-focus="preserve"/);

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

// A hidden plugin iframe may retain focus after publishing a host-rendered
// Workbench. Navigation keys must cross that boundary for both List/Gallery.
assert.equal(shouldForwardPluginWorkbenchHostKey({ mounted: true, key: "ArrowDown" }), true);
assert.equal(shouldForwardPluginWorkbenchHostKey({ mounted: true, key: "PageUp" }), true);
assert.equal(shouldForwardPluginWorkbenchHostKey({ mounted: true, key: "Enter" }), true);
assert.equal(shouldForwardPluginWorkbenchHostKey({ mounted: false, key: "ArrowDown" }), false);
assert.equal(shouldForwardPluginWorkbenchHostKey({ mounted: true, key: "ArrowDown", metaKey: true }), false);
assert.equal(shouldForwardPluginWorkbenchHostKey({ mounted: true, key: "a" }), false);

const galleryKey = (overrides = {}) => shouldHandleQxGridKey({
  key: "ArrowRight",
  query: "",
  editable: true,
  fromSearch: true,
  modified: false,
  ...overrides,
});
assert.equal(galleryKey(), true);
assert.equal(galleryKey({ key: "ArrowLeft" }), true);
assert.equal(galleryKey({ key: "ArrowDown", query: "wallpaper" }), true);
assert.equal(galleryKey({ key: "ArrowRight", query: "wallpaper" }), false);
assert.equal(galleryKey({ fromSearch: false }), false);
assert.equal(galleryKey({ editable: false, fromSearch: false }), true);
assert.equal(galleryKey({ modified: true }), false);

assert.equal(resolveQxGridIndex({ key: "ArrowRight", index: 1, count: 10, columns: 4 }), 2);
assert.equal(resolveQxGridIndex({ key: "ArrowLeft", index: 4, count: 10, columns: 4 }), 4);
assert.equal(resolveQxGridIndex({ key: "ArrowDown", index: 2, count: 10, columns: 4 }), 6);
assert.equal(resolveQxGridIndex({ key: "ArrowDown", index: 6, count: 10, columns: 4 }), 9);
assert.equal(resolveQxGridIndex({ key: "ArrowUp", index: 6, count: 10, columns: 4 }), 2);
assert.equal(resolveQxGridIndex({ key: "Enter", index: 2, count: 10, columns: 4 }), null);

// Workbench trust boundary: optional ids must stay addressable by the iframe
// event bridge, duplicate React keys are removed, and tab state is singular.
const dataImage = `data:image/png;base64,${"a".repeat(5_000)}`;
const normalizedWorkbench = normalizePluginWorkbenchState({
  items: [
    { title: "Missing id is rejected" },
    { id: "image", title: "Image", image: { url: dataImage }, detail: {} },
    { id: "duplicate", title: "First duplicate" },
    { id: "duplicate", title: "Second duplicate" },
  ],
  tabs: [
    { id: "one", label: "One", active: true },
    { id: "one", label: "Duplicate one", active: false },
    { id: "two", label: "Two", active: true },
  ],
});
assert.equal(normalizedWorkbench.items?.[0]?.id, "image");
assert.equal(normalizedWorkbench.items?.[0]?.image?.url, dataImage);
assert.equal(normalizedWorkbench.items?.[0]?.detail, undefined);
assert.equal(normalizedWorkbench.items?.length, 2);
assert.deepEqual(normalizedWorkbench.tabs?.map((tab) => [tab.id, tab.active]), [
  ["one", true],
  ["two", false],
]);

// Search inputs may opt into list arrows/pages without losing native Home/End.
assert.deepEqual(list({ editable: true, allowEditable: true }), { type: "change", index: 3 });
assert.deepEqual(list({ key: "PageUp", editable: true, allowEditable: true }), { type: "change", index: 0 });

const searchReading = (overrides = {}) => shouldProxySearchReadingKey({
  key: "ArrowDown",
  fromSearch: true,
  activeRegionId: "plugin-workbench-detail",
  navigationRegionId: "plugin-workbench-list",
  modified: false,
  ...overrides,
});
assert.equal(searchReading(), true);
assert.equal(searchReading({ key: "PageUp" }), true);
assert.equal(searchReading({ activeRegionId: "plugin-workbench-list" }), false);
assert.equal(searchReading({ key: "ArrowLeft" }), false);
assert.equal(searchReading({ key: "Home" }), false);
assert.equal(searchReading({ key: " " }), false);
assert.equal(searchReading({ modified: true }), false);

const searchRegionSwitch = (overrides = {}) => shouldSwitchRegionFromSearch({
  key: "ArrowRight",
  query: "",
  regionCount: 2,
  modified: false,
  ...overrides,
});
assert.equal(searchRegionSwitch(), true);
assert.equal(searchRegionSwitch({ key: "ArrowLeft" }), true);
assert.equal(searchRegionSwitch({ query: "cpu" }), false);
assert.equal(searchRegionSwitch({ regionCount: 1 }), false);
assert.equal(searchRegionSwitch({ modified: true }), false);
assert.equal(searchRegionSwitch({ key: "ArrowDown" }), false);

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
