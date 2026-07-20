/**
 * Production-module checks for QxIsland priority, store caps and Shell wiring.
 * No copied resolver implementation: this script imports the shipped TS ports.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { bundleNodeModule } from "./esbuild-port.mjs";
import {
  resolveDockedRenderMode,
  resolveDockedWinner,
  resolveRotatingWinner,
} from "../src/island/session/priority.ts";
import {
  defaultIslandOpenTarget,
  islandRouteForTarget,
} from "../src/island/session/openTarget.ts";
import { visibleIslandActivity } from "../src/island/surface/contentPolicy.ts";

// store/logger run in a WebView in production; provide only the timer surface
// needed by the store before importing it in Node.
if (!globalThis.window) {
  globalThis.window = {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}

const rootDir = process.cwd();
const cacheDir = path.join(rootDir, "node_modules", ".cache", "qx-island-check");
const storeBundle = path.join(cacheDir, "store.mjs");
fs.mkdirSync(cacheDir, { recursive: true });
const bundleResult = bundleNodeModule({
  root: rootDir,
  entry: "src/island/session/store.ts",
  outfile: storeBundle,
});
assert.equal(
  bundleResult.ok,
  true,
  `Failed to bundle production Island store:\n${bundleResult.error}`,
);

const {
  __resetIslandStoreForTests,
  getSession,
  showSession,
  updateSession,
} = await import(`${pathToFileURL(storeBundle).href}?check=${Date.now()}`);

const session = (overrides = {}) => ({
  id: "session",
  generation: 1,
  priority: "location",
  rankEpoch: 1,
  source: "module",
  createdAt: 1,
  contentUpdatedAt: 1,
  replacePolicy: "replace-same-id",
  placement: "docked-or-float",
  content: { primary: "Session" },
  ...overrides,
});

const prioritySessions = [
  session({ id: "home", priority: "home", rankEpoch: 9, createdAt: 9 }),
  session({ id: "toast", priority: "toast", rankEpoch: 8, createdAt: 8 }),
  session({ id: "task", priority: "task", rankEpoch: 1, createdAt: 1 }),
];
assert.equal(resolveDockedWinner(prioritySessions), "task");

const standing = [
  session({ id: "calendar", sticky: true, rankEpoch: 1, createdAt: 1 }),
  session({ id: "pomodoro", sticky: true, rankEpoch: 2, createdAt: 2 }),
];
assert.equal(resolveRotatingWinner(standing, 0), "pomodoro");
assert.equal(resolveRotatingWinner(standing, 1), "calendar");
assert.equal(
  resolveRotatingWinner([
    ...standing,
    session({ id: "rss", sticky: false, rankEpoch: 1, createdAt: 3 }),
  ], 1),
  "rss",
);
assert.equal(
  resolveRotatingWinner([
    ...standing,
    session({ id: "download", priority: "task", rankEpoch: 1, createdAt: 3 }),
  ], 1),
  "download",
);
assert.equal(resolveDockedRenderMode({ exception: true, winnerId: "task" }), "exception");
assert.equal(resolveDockedRenderMode({ exception: false, winnerId: "task" }), "store");
assert.equal(resolveDockedRenderMode({ exception: false, winnerId: null }), "empty");
assert.deepEqual(defaultIslandOpenTarget("rss.article-detail", "module"), {
  kind: "module",
  id: "rss",
});
assert.equal(defaultIslandOpenTarget("rss.article-detail", "shell"), undefined);
assert.equal(islandRouteForTarget({ kind: "launcher" }), "launcher");
assert.equal(islandRouteForTarget({ kind: "plugin", id: "pomodoro-island" }), "plugin:pomodoro-island");
assert.equal(
  visibleIslandActivity({
    primary: "Focus session",
    meter: { kind: "activity", activity: "pulse" },
    countdown: { remainingMs: 60_000, paused: true },
  }),
  undefined,
);
assert.equal(
  visibleIslandActivity({
    primary: "Focus session",
    meter: { kind: "activity", activity: "pulse" },
    countdown: { endsAt: Date.now() + 60_000, paused: false },
  }),
  "pulse",
);

__resetIslandStoreForTests();
const display = showSession({
  id: "plugin.display.pomodoro-island",
  priority: "task",
  source: "plugin-display",
  placement: "floating",
  sticky: false,
  content: {
    primary: "Pomodoro",
    componentId: "forbidden.component",
  },
});
assert.ok(display);
const normalizedDisplay = getSession("plugin.display.pomodoro-island");
assert.equal(normalizedDisplay?.priority, "location");
assert.equal(normalizedDisplay?.placement, "docked-or-float");
assert.equal(normalizedDisplay?.sticky, true);
assert.deepEqual(normalizedDisplay?.openTarget, {
  kind: "plugin",
  id: "pomodoro-island",
});
assert.equal(normalizedDisplay?.content.componentId, undefined);

const generation = normalizedDisplay?.generation;
assert.equal(updateSession("plugin.display.pomodoro-island", {
  expectedGeneration: generation,
  content: { secondary: "Running" },
}).ok, true);
assert.equal(updateSession("plugin.display.pomodoro-island", {
  expectedGeneration: generation,
  content: { secondary: "Stale" },
}).ok, false);

// Integration invariants that pure priority checks cannot prove.
const shellSource = fs.readFileSync("src/components/QxShell.tsx", "utf8");
assert.match(shellSource, /islandKey:\s*string/);
assert.doesNotMatch(shellSource, /title\s*\.toLowerCase\(\)/);
assert.match(shellSource, /<QxIslandDockSlot exception=\{customIsland\}\s*\/>/);
assert.doesNotMatch(shellSource, /<QxBottomIsland/);

const launcherSource = fs.readFileSync("src/Launcher.tsx", "utf8");
assert.doesNotMatch(launcherSource, /\bisland=\{island\}/);
assert.doesNotMatch(launcherSource, /\bcustomIsland=\{customIsland\}/);

const workbenchKitSource = fs.readFileSync("src/plugin/cliWorkbench.ts", "utf8");
assert.doesNotMatch(workbenchKitSource, /__qxPluginUiBridge\?\.updateIsland/);
assert.doesNotMatch(workbenchKitSource, /__qxPluginUiBridge\.updateIsland/);

const pluginHostSource = fs.readFileSync("src/plugin/PluginHost.tsx", "utf8");
assert.match(pluginHostSource, /syncPluginWorkbenchIsland/);
assert.match(pluginHostSource, /islandManagedExternally=\{workbenchIslandManaged \|\| pluginIslandSessionActive\}/);

const islandTypesSource = fs.readFileSync("src/island/types.ts", "utf8");
for (const activity of ["wave", "dots", "spinner", "pulse"]) {
  assert.match(islandTypesSource, new RegExp(`\\| "${activity}"`));
}
assert.doesNotMatch(islandTypesSource, /"bounce(?:-exit)?"/);

const pluginIslandSource = fs.readFileSync("src/plugin/pluginIsland.ts", "utf8");
assert.match(pluginIslandSource, /workbenchProjectionSignatures/);
assert.match(pluginIslandSource, /hasPluginIslandSession\(plugin\.id\)/);
assert.match(pluginIslandSource, /getPluginIcon\(plugin\.id\)/);

const shellContentSource = fs.readFileSync("src/island/surface/ShellContent.tsx", "utf8");
assert.match(shellContentSource, /qx-island-module-button/);
assert.match(shellContentSource, /visibleIslandActivity\(content\)/);

const cliWorkbenchSource = fs.readFileSync("src/plugin/cliWorkbench.ts", "utf8");
assert.match(cliWorkbenchSource, /createPluginSdkRuntime\.toString\(\)/);
assert.doesNotMatch(cliWorkbenchSource, /function parseJsonLoose/);

__resetIslandStoreForTests();
console.log("QxIsland production port and Shell integration checks passed");
