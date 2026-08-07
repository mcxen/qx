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
import {
  clampCaptureToolbarPosition,
  resolveCaptureToolbarPosition,
} from "../src/modules/screencap/captureToolbarPosition.ts";
import {
  captureNumberForeground,
  captureNumberOutline,
} from "../src/modules/screencap/captureColor.ts";
import { launcherActionModel } from "../src/launcher/actionModel.ts";

const qxShellSource = readFileSync(
  new URL("../src/components/QxShell.tsx", import.meta.url),
  "utf8",
);
const shortcutRecorderSource = readFileSync(
  new URL("../src/components/ShortcutRecorder.tsx", import.meta.url),
  "utf8",
);
const moduleSearchSource = readFileSync(
  new URL("../src/components/QxModuleSearch.tsx", import.meta.url),
  "utf8",
);
const pluginWorkbenchSource = readFileSync(
  new URL("../src/plugin/PluginWorkbenchView.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const resultsListSource = readFileSync(
  new URL("../src/ResultsList.tsx", import.meta.url),
  "utf8",
);
const mediaViewerSource = readFileSync(
  new URL("../src/components/QxMediaViewer.tsx", import.meta.url),
  "utf8",
);
const listIconsStyles = readFileSync(
  new URL("../src/styles/lists-icons.css", import.meta.url),
  "utf8",
);

// Search fields never reclaim focus after arbitrary pointer interaction.
// Surfaces opt into one-shot autofocus instead of inheriting permanent ownership.
assert.doesNotMatch(qxShellSource, /window\.addEventListener\("pointerup"/);
assert.match(moduleSearchSource, /autoFocus = false/);
assert.match(shortcutRecorderSource, /data-qx-search-focus="preserve"/);

// Launcher follows desktop list semantics and opens filesystem entries through
// the cross-platform path port, not the application-only launcher command.
assert.match(resultsListSource, /onClick=\{\(\) => onSelectRow\(rowIndex\)\}/);
assert.match(resultsListSource, /onDoubleClick=\{\(\) => onItemClick\(item\)\}/);
assert.doesNotMatch(resultsListSource, /onMouseEnter=\{\(\) => .*Select/);
assert.doesNotMatch(resultsListSource, /hoverArmedRef|handleHoverSelect/);
assert.match(
  resultsListSource,
  /onContextMenu=\{\(event\) => \{[\s\S]*event\.preventDefault\(\);[\s\S]*onSelectRow\(rowIndex\);[\s\S]*onOpenActionsAt\(event\.clientX, event\.clientY\)/,
);
assert.match(qxShellSource, /actionMenuRequest\?: QxShellActionMenuRequest \| null/);
assert.match(appSource, /item\.kind === "file" \|\| item\.kind === "folder"[\s\S]*openSystemPath\(item\.path\)/);

const launcherItem = (kind, path) => ({
  name: path.split(/[\\/]/).pop() || path,
  path,
  icon: "",
  kind,
});
assert.deepEqual(
  launcherActionModel(launcherItem("folder", "/Users/me/Documents"), "macos"),
  {
    kind: "folder",
    titleKey: "launcher.action.fileActions",
    titleFallback: "File Actions",
    primaryKey: "launcher.action.openFolder",
    primaryFallback: "Open Folder",
    hasPathActions: true,
    showsPackageContents: false,
  },
);
assert.equal(
  launcherActionModel(launcherItem("file", "C:\\Users\\me\\report.pdf"), "windows").primaryKey,
  "launcher.action.openFile",
);
assert.equal(
  launcherActionModel(launcherItem("app", "C:\\Program Files\\Qx\\Qx.exe"), "windows")
    .showsPackageContents,
  false,
);
assert.equal(
  launcherActionModel(launcherItem("app", "/Applications/Qx.app"), "macos")
    .showsPackageContents,
  true,
);
assert.equal(
  launcherActionModel(launcherItem("command", "__qx:settings"), "macos").primaryKey,
  "launcher.action.openSettings",
);
assert.equal(
  launcherActionModel(launcherItem("calculation", "__qx:calc:42"), "windows").primaryKey,
  "launcher.action.copyResult",
);
assert.equal(
  launcherActionModel(launcherItem("clipboard", "__qx:clipboard:1"), "windows").primaryKey,
  "launcher.action.copyText",
);

// Capture confirmation stays inside the active picker display even when a
// selection hugs the left/right edge; the toolbar itself remains one row.
assert.deepEqual(
  resolveCaptureToolbarPosition(
    { x: 0, y: 100, w: 80, h: 120 },
    { width: 640, height: 42 },
    { width: 800, height: 600 },
  ),
  { left: 330, top: 230 },
);
assert.deepEqual(
  resolveCaptureToolbarPosition(
    { x: 740, y: 540, w: 60, h: 60 },
    { width: 640, height: 76 },
    { width: 800, height: 600 },
  ),
  { left: 470, top: 454 },
);
assert.deepEqual(
  clampCaptureToolbarPosition(
    { left: -120, top: 900 },
    { width: 640, height: 46 },
    { width: 800, height: 600 },
  ),
  { left: 330, top: 544 },
);
assert.deepEqual(
  clampCaptureToolbarPosition(
    { left: 1200, top: -20 },
    { width: 640, height: 46 },
    { width: 800, height: 600 },
  ),
  { left: 470, top: 10 },
);
assert.equal(captureNumberForeground("#ffffff"), "#111111");
assert.equal(captureNumberForeground("#fff"), "#111111");
assert.equal(captureNumberForeground("#ff3b30"), "#ffffff");
assert.equal(captureNumberOutline("#ffffff"), "rgba(0,0,0,.72)");

// Full-size Workbench media owns an inner scrollport. Portrait and long images
// retain their natural aspect ratio instead of being forced into stage height.
assert.match(pluginWorkbenchSource, /<QxMediaViewer/);
assert.match(mediaViewerSource, /qx-host-workbench-media-preview-scroll/);
assert.match(mediaViewerSource, /metrics\.height\s*\/[\s\S]*metrics\.width[\s\S]*>=\s*3\.2/);
assert.match(mediaViewerSource, /mediaDecodeCache/);
assert.match(mediaViewerSource, /\[0,\s*-1,\s*1,\s*-2,\s*2\]/);
assert.match(mediaViewerSource, /MEDIA_DECODE_CACHE_TTL_MS\s*=\s*15\s*\*\s*60\s*\*\s*1_000/);
assert.match(mediaViewerSource, /MEDIA_DECODE_CACHE_MAX_ENTRIES\s*=\s*24/);
assert.match(mediaViewerSource, /setPointerCapture\(event\.pointerId\)/);
assert.match(mediaViewerSource, /scrollLeft\s*=\s*drag\.scrollLeft/);
assert.match(mediaViewerSource, /scrollTop\s*=\s*drag\.scrollTop/);
assert.match(mediaViewerSource, /new ResizeObserver\(updateViewport\)/);
assert.match(
  mediaViewerSource,
  /Math\.min\(\s*viewport\.width\s*\/\s*naturalWidth,\s*viewport\.height\s*\/\s*naturalHeight,\s*\)/s,
);
assert.match(mediaViewerSource, /event\.metaKey\s*\|\|\s*event\.ctrlKey/);
assert.match(mediaViewerSource, /scroll\.scrollLeft\s*\+=\s*event\.deltaX/);
assert.match(mediaViewerSource, /scroll\.scrollTop\s*\+=\s*event\.deltaY/);
assert.match(
  listIconsStyles,
  /\.qx-host-workbench-media-preview-scroll\s*\{[^}]*overflow:\s*auto;/s,
);
assert.match(
  listIconsStyles,
  /\.qx-host-workbench-media-preview-scroll\.is-enlarged\s*\{[^}]*cursor:\s*grab;[^}]*touch-action:\s*none;/s,
);
assert.match(
  listIconsStyles,
  /\.qx-host-workbench-media-preview-scroll\s*>\s*img\s*\{[^}]*height:\s*auto;[^}]*max-height:\s*100%;/s,
);
assert.match(
  listIconsStyles,
  /\.qx-host-workbench-media-preview-scroll\.is-long-screenshot\s*>\s*img\s*\{[^}]*max-height:\s*none;/s,
);
assert.match(
  listIconsStyles,
  /\.qx-host-workbench-media-preview-scroll\.is-landscape\s*>\s*img\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;/s,
);
assert.match(
  listIconsStyles,
  /\.qx-host-workbench-media-preview-scroll\.is-portrait\s*>\s*img\s*\{[^}]*width:\s*auto;[^}]*height:\s*100%;/s,
);
assert.match(
  listIconsStyles,
  /\.qx-host-workbench-media-zoom\s+\.qx-shadcn-button\s*\{[^}]*width:\s*26px;[^}]*height:\s*26px;[^}]*border-radius:\s*50%;/s,
);
assert.match(
  listIconsStyles,
  /\.qx-host-workbench-media-zoom\s+\.qx-shadcn-button\.qx-host-workbench-media-zoom-value\s*\{[^}]*min-width:\s*46px;[^}]*border-radius:\s*999px;/s,
);
assert.match(
  listIconsStyles,
  /\.qx-host-workbench-media-preview-count\s*\{[^}]*min-width:\s*46px;[^}]*height:\s*26px;/s,
);
assert.match(
  listIconsStyles,
  /@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*?\.qx-rss-shell\.is-reading\s+\.qx-rss-article-split\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
);

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
    {
      id: "image",
      title: "Image",
      image: { url: dataImage },
      detail: {
        images: [
          { url: "https://images.example.test/one.jpg", caption: "One" },
          { url: "http://images.example.test/rejected.jpg" },
          { url: "https://images.example.test/two.jpg", zoomable: false },
        ],
        content: [
          { type: "text", text: "Before image" },
          { type: "asset-image", assetPath: "assets/emotions/image_emoticon8.png", alt: "image_emoticon8" },
          { type: "image", image: { url: "https://images.example.test/inline.jpg" } },
          { type: "image", image: { url: "http://images.example.test/rejected-inline.jpg" } },
          { type: "text", text: "After image" },
        ],
        form: {
          controls: [{
            id: "key",
            label: "Key",
            value: "width",
            group: {
              id: "parameter-width",
              label: "Parameter",
              action: { id: "delete-width", label: "Delete", tone: "danger" },
            },
          }],
          actions: [{ id: "add-parameter", label: "Add parameter", primary: true }],
        },
      },
    },
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
assert.deepEqual(
  normalizedWorkbench.items?.[0]?.detail?.images?.map((image) => [image.url, image.zoomable]),
  [
    ["https://images.example.test/one.jpg", true],
    ["https://images.example.test/two.jpg", false],
  ],
);
assert.deepEqual(
  normalizedWorkbench.items?.[0]?.detail?.content?.map((block) =>
    block.type === "text"
      ? [block.type, block.text]
      : block.type === "asset-image"
        ? [block.type, block.assetPath]
        : [block.type, block.image.url]),
  [
    ["text", "Before image"],
    ["asset-image", "assets/emotions/image_emoticon8.png"],
    ["image", "https://images.example.test/inline.jpg"],
    ["text", "After image"],
  ],
);
assert.equal(normalizedWorkbench.items?.[0]?.detail?.form?.controls[0]?.group?.id, "parameter-width");
assert.equal(normalizedWorkbench.items?.[0]?.detail?.form?.controls[0]?.group?.action?.id, "delete-width");
assert.equal(normalizedWorkbench.items?.[0]?.detail?.form?.actions?.[0]?.id, "add-parameter");
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
