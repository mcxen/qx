#!/usr/bin/env node
/**
 * Regression checks for Settings → Module Search source isolation.
 * Imports the shipped pure policy rather than copying launcher logic.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleNodeModule } from "./esbuild-port.mjs";

const rootDir = process.cwd();
const cacheDir = path.join(rootDir, "node_modules", ".cache", "qx-module-search-check");
const policyBundle = path.join(cacheDir, "policy.mjs");
fs.mkdirSync(cacheDir, { recursive: true });
const bundleResult = bundleNodeModule({
  root: rootDir,
  entry: "src/search/moduleSearchPolicy.ts",
  outfile: policyBundle,
});
assert.equal(
  bundleResult.ok,
  true,
  `Failed to bundle production module-search policy:\n${bundleResult.error}`,
);

const {
  filterLauncherModuleSearchEntries,
  launcherSearchModuleId,
  shouldSearchClipboardProvider,
} = await import(`${pathToFileURL(policyBundle).href}?check=${Date.now()}`);

const clipboard = {
  name: "Saved clipboard text",
  path: "__qx:clipboard:42",
  icon: "builtin:clipboard",
  kind: "clipboard",
};
const recalledClipboard = {
  name: "Frequent clipboard text",
  path: "__qx:clipboard:99",
  icon: "builtin:clipboard",
  kind: "clipboard",
  clickCount: 5,
};
const recalledClipboardRoot = {
  name: "Clipboard History",
  path: "__qx:clipboard",
  icon: "builtin:clipboard",
  kind: "command",
  clickCount: 3,
};
const recalledClipboardSurface = {
  name: "Pinned clipboard item",
  path: `__qx:launch:${encodeURIComponent(JSON.stringify({
    tab: "clipboard",
    surface: "item",
    params: { id: "42" },
  }))}`,
  icon: "builtin:clipboard",
  kind: "command",
  clickCount: 2,
};
const rss = {
  name: "RSS Reader",
  path: "__qx:rss",
  icon: "builtin:rss",
  kind: "command",
  moduleId: "rss",
};
const legacyRssFeed = {
  name: "Legacy RSS feed",
  path: "__qx:rss:feed:42",
  icon: "builtin:rss",
  kind: "command",
  clickCount: 4,
};
const app = {
  name: "Clash Verge",
  path: "/Applications/Clash Verge.app",
  icon: "app",
  kind: "app",
};

assert.equal(launcherSearchModuleId(clipboard), "clipboard");
assert.equal(launcherSearchModuleId(recalledClipboardRoot), "clipboard");
assert.equal(launcherSearchModuleId(recalledClipboardSurface), "clipboard");
assert.equal(launcherSearchModuleId(rss), "rss");
assert.equal(launcherSearchModuleId(legacyRssFeed), "rss");
assert.equal(launcherSearchModuleId(app), null);
assert.deepEqual(
  filterLauncherModuleSearchEntries(
    [
      clipboard,
      recalledClipboard,
      recalledClipboardRoot,
      recalledClipboardSurface,
      rss,
      app,
    ],
    (moduleId) => moduleId !== "clipboard",
  ),
  [rss, app],
);
assert.deepEqual(
  filterLauncherModuleSearchEntries(
    [legacyRssFeed, app],
    (moduleId) => moduleId !== "rss",
  ),
  [app],
);
assert.equal(shouldSearchClipboardProvider("all", "clash", false), false);
assert.equal(shouldSearchClipboardProvider("clipboard", "clash", false), false);
assert.equal(shouldSearchClipboardProvider("all", "clash", true), true);
assert.equal(shouldSearchClipboardProvider("apps", "clash", true), false);
assert.equal(shouldSearchClipboardProvider("all", "   ", true), false);

const moduleSurfacesSource = fs.readFileSync(
  path.join(rootDir, "src/search/moduleSurfaces.ts"),
  "utf8",
);
assert.doesNotMatch(
  moduleSurfacesSource,
  /get_clipboard_history/,
  "Clipboard history must have one Launcher provider; Module Surfaces only owns the root command.",
);

console.log("module-search: ok — one clipboard provider; disabled modules block current and legacy recall.");
