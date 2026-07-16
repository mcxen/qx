#!/usr/bin/env node
/**
 * Structural + behavioral checks for module/plugin port reuse.
 * - Built-in modules that own a full panel should use useQxModuleShell
 * - Marketplace manifests: if panel is declared, index.js must export panel
 * - Real unit test: moduleEscapeHost register/try/unregister (bundled shipped code)
 *
 * Run: node scripts/check-module-ports.mjs
 * Also invoked from npm run check.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const failures = [];
const fail = (m) => failures.push(m);

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

// --- Built-in panel modules must register Esc via useQxModuleShell ----------
const MODULE_PANELS = [
  "src/modules/clipboard/ClipboardPanel.tsx",
  "src/modules/rss/RssPanel.tsx",
  "src/modules/rss/ArticleList.tsx",
  "src/modules/rss/ArticleDetail.tsx",
  "src/modules/documents/DevTxtTool.tsx",
  "src/modules/screencap/ScreenRecorder.tsx",
  "src/modules/macros/MacroRecorder.tsx",
  "src/modules/qx-tty/QxTTYPanel.tsx",
  "src/modules/qx-ai/QxAiPanel.tsx",
  "src/modules/qx-ai/QxAiChat.tsx",
  "src/modules/qx-ai/QxAiSettings.tsx",
  "src/modules/settings/SettingsPanel.tsx",
  "src/modules/v2ex/V2exPanel.tsx",
  "src/modules/weather/WeatherPanel.tsx",
  "src/plugin/PluginHost.tsx",
  "src/App.tsx", // ModuleLoadingShell / ModuleErrorShell
];

for (const rel of MODULE_PANELS) {
  if (!exists(rel)) {
    fail(`missing module file: ${rel}`);
    continue;
  }
  const src = read(rel);
  if (!src.includes("useQxModuleShell")) {
    fail(`expected useQxModuleShell in ${rel}`);
  }
}

if (!exists("docs/module-port-inventory.md")) {
  fail("docs/module-port-inventory.md missing");
} else {
  const inv = read("docs/module-port-inventory.md");
  for (const token of [
    "clipboard",
    "rss",
    "weather",
    "v2ex",
    "pomodoro-island",
    "useQxModuleShell",
    "context.storage.persist",
    "manifest.panel",
  ]) {
    if (!inv.includes(token)) fail(`inventory missing mention of ${token}`);
  }
}

const guide = read("public/doc/plugin-development-guide.md");
for (const token of [
  "Panel not registered",
  "manifest.panel",
  "storage.persist",
  "module-port-inventory",
  "tryModuleEscapeStep",
  "老插件",
]) {
  if (!guide.includes(token)) fail(`plugin-development-guide missing: ${token}`);
}

// --- Marketplace plugin package (optional path) ------------------------------
const marketRoots = [
  path.join(root, "../qx-plugins-clone/src"),
  path.join(root, "../qx-plugins/src"),
].filter((p) => fs.existsSync(p));

for (const marketSrc of marketRoots) {
  for (const name of fs.readdirSync(marketSrc, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const dir = path.join(marketSrc, name.name);
    const manifestPath = path.join(dir, "manifest.json");
    const indexPath = path.join(dir, "index.js");
    if (!fs.existsSync(manifestPath) || !fs.existsSync(indexPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (e) {
      fail(`invalid manifest ${manifestPath}: ${e}`);
      continue;
    }
    const indexJs = fs.readFileSync(indexPath, "utf8");
    if (manifest.panel) {
      // Must export a panel surface (host registers from manifest; render from export)
      if (!/\bpanel\s*:/.test(indexJs) && !/panel\s*:\s*\{/.test(indexJs)) {
        fail(`${name.name}: manifest.panel set but index.js has no panel export`);
      }
    }
  }
}

// --- Real unit test: shipped moduleEscapeHost via esbuild bundle ------------
const scratch =
  process.env.QX_PORT_CHECK_SCRATCH
  || path.join(root, "node_modules", ".cache", "qx-port-check");
fs.mkdirSync(scratch, { recursive: true });
const bundleOut = path.join(scratch, "moduleEscapeHost.mjs");
const esbuild = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/esbuild/bin/esbuild"),
    path.join(root, "src/hooks/moduleEscapeHost.ts"),
    "--bundle",
    "--platform=node",
    "--format=esm",
    `--outfile=${bundleOut}`,
  ],
  { encoding: "utf8" },
);
// fallback: npx esbuild if local missing
let bundleOk = esbuild.status === 0 && fs.existsSync(bundleOut);
if (!bundleOk) {
  const npx = spawnSync(
    "npx",
    ["--yes", "esbuild", "src/hooks/moduleEscapeHost.ts", "--bundle", "--platform=node", "--format=esm", `--outfile=${bundleOut}`],
    { cwd: root, encoding: "utf8", shell: true },
  );
  bundleOk = npx.status === 0 && fs.existsSync(bundleOut);
  if (!bundleOk) {
    fail(`esbuild moduleEscapeHost failed: ${npx.stderr || esbuild.stderr}`);
  }
}

if (bundleOk) {
  try {
    const mod = await import(pathToFileURL(bundleOut).href + `?t=${Date.now()}`);
    const { registerModuleEscapeStep, tryModuleEscapeStep } = mod;
    let calls = 0;
    const un = registerModuleEscapeStep(() => {
      calls += 1;
    });
    if (tryModuleEscapeStep() !== true) fail("tryModuleEscapeStep should return true when registered");
    if (calls !== 1) fail("registered stepBack not invoked");
    un();
    if (tryModuleEscapeStep() !== false) fail("tryModuleEscapeStep should return false after unregister");
    // double-register last writer wins
    let a = 0;
    let b = 0;
    registerModuleEscapeStep(() => {
      a += 1;
    });
    const unB = registerModuleEscapeStep(() => {
      b += 1;
    });
    tryModuleEscapeStep();
    if (a !== 0 || b !== 1) fail("last registered escape step should win");
    unB();
  } catch (e) {
    fail(`moduleEscapeHost runtime test: ${e}`);
  }
}

// Pure shell helpers must stay re-exported from useQxModuleShell for module authors.
const shellSrc = read("src/hooks/useQxModuleShell.ts");
if (!shellSrc.includes("export function buildModuleIsland")) {
  fail("buildModuleIsland must remain exported from useQxModuleShell");
}
if (!shellSrc.includes("export function qxEscapeAction")) {
  fail("qxEscapeAction must remain exported from useQxModuleShell");
}
if (!shellSrc.includes("moduleShellPures")) {
  fail("useQxModuleShell must import pure helpers from moduleShellPures");
}

const pureModule = path.join(root, "src/hooks/moduleShellPures.ts");
if (!fs.existsSync(pureModule)) {
  fail("src/hooks/moduleShellPures.ts missing — pure shell helpers for tests");
} else {
  const pureOut = path.join(scratch, "moduleShellPures.mjs");
  const b = spawnSync(
    process.execPath,
    [
      path.join(root, "node_modules/esbuild/bin/esbuild"),
      pureModule,
      "--bundle",
      "--platform=node",
      "--format=esm",
      `--outfile=${pureOut}`,
    ],
    { cwd: root, encoding: "utf8" },
  );
  let pureOk = b.status === 0 && fs.existsSync(pureOut);
  if (!pureOk) {
    const npx = spawnSync(
      "npx",
      ["--yes", "esbuild", pureModule, "--bundle", "--platform=node", "--format=esm", `--outfile=${pureOut}`],
      { cwd: root, encoding: "utf8", shell: true },
    );
    pureOk = npx.status === 0 && fs.existsSync(pureOut);
    if (!pureOk) fail(`bundle moduleShellPures failed: ${npx.stderr || b.stderr}`);
  }
  if (pureOk) {
    const pures = await import(pathToFileURL(pureOut).href + `?t=${Date.now()}`);
    const loading = pures.buildModuleIsland({ title: "Wx", loading: true });
    if (!loading || loading.label !== "Wx") fail(`buildModuleIsland loading label: ${JSON.stringify(loading)}`);
    if (loading.detail !== "Loading…") fail(`buildModuleIsland loading detail: ${loading.detail}`);
    if (loading.activity !== "bounce") fail("buildModuleIsland should bounce when loading without progress");
    const errIsland = pures.buildModuleIsland({ title: "Wx", error: " nope " });
    if (errIsland?.tone !== "danger" || errIsland.detail !== "nope") fail("buildModuleIsland error branch");
    let left = false;
    const esc = pures.qxEscapeAction(() => {
      left = true;
    });
    if (esc.label !== "Esc" || esc.kbd !== "Esc") fail("qxEscapeAction shape");
    esc.onClick();
    if (!left) fail("qxEscapeAction onClick");
  }
}

if (failures.length) {
  console.error("check-module-ports failures:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("check-module-ports: ok");
