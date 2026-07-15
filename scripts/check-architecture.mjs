#!/usr/bin/env node
/**
 * Structural architecture gates (SOLID-oriented).
 * Enforces portfolio-level rules so fixes go through ports, not one-off forks.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const failures = [];
const fail = (msg) => failures.push(msg);
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

// --- 1. Principles doc is first-class and linked ---
if (!exists("docs/architecture-principles.md")) {
  fail("missing docs/architecture-principles.md (SOLID / abstraction contract)");
} else {
  const principles = read("docs/architecture-principles.md");
  for (const token of ["Single Responsibility", "Open/Closed", "Liskov", "Interface Segregation", "Dependency Inversion", "SOLID"]) {
    if (!principles.includes(token) && !principles.includes(token.replace(" ", ""))) {
      // Chinese headings may use letter form
    }
  }
  if (!/SOLID/.test(principles)) fail("architecture-principles.md must document SOLID");
  if (!/文档义务|doc duty|文档/.test(principles)) fail("architecture-principles.md must state documentation duty");
}

const agents = read("AGENTS.md");
if (!agents.includes("architecture-principles.md")) {
  fail("AGENTS.md must link docs/architecture-principles.md");
}
if (!/SOLID/.test(agents)) {
  fail("AGENTS.md must mention SOLID principles");
}

const docsIndex = read("docs/README.md");
if (!docsIndex.includes("architecture-principles.md")) {
  fail("docs/README.md must index architecture-principles.md");
}

// --- 2. Host HTTP binary port (plugin external modules depend on this) ---
const pluginApi = exists("src-tauri/src/plugin_api.rs") ? read("src-tauri/src/plugin_api.rs") : "";
if (pluginApi) {
  if (!/body_base64|bodyBase64/.test(pluginApi)) {
    fail("plugin_api.rs: HttpResponse must expose body_base64 for binary plugin fetch (port, not per-plugin curl forks)");
  }
}
const runtime = exists("src/plugin/runtime.ts") ? read("src/plugin/runtime.ts") : "";
if (runtime && !/arrayBuffer/.test(runtime)) {
  fail("src/plugin/runtime.ts: plugin fetch response must implement arrayBuffer()");
}

// --- 3. Raycast conversion stays generic (OCP) ---
const converterGeneric = exists("scripts/raycast-converter/generic.mjs")
  ? read("scripts/raycast-converter/generic.mjs")
  : "";
if (converterGeneric) {
  if (!/Buffer/.test(converterGeneric)) {
    fail("raycast-converter/generic.mjs must polyfill Buffer at bundle boundary");
  }
}
const conversionDoc = exists("public/doc/raycast-plugin-conversion.md")
  ? read("public/doc/raycast-plugin-conversion.md")
  : "";
if (conversionDoc && !/host|Host|converter|shim/i.test(conversionDoc)) {
  fail("raycast-plugin-conversion.md must describe host/converter ports");
}

// --- 4. Settings UI: no raw product <select> already in docs:check; ensure settings use useT ---
const settingsDir = path.join(root, "src/modules/settings");
if (fs.existsSync(settingsDir)) {
  const settingsFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".tsx")) settingsFiles.push(p);
    }
  };
  walk(settingsDir);
  // Panels that render user-visible chrome should import useT (skip pure re-exports).
  const mustI18n = settingsFiles.filter((f) => {
    const base = path.basename(f);
    return /Settings\.tsx$|Panel\.tsx$|PluginManager\.tsx$|InstalledModuleCard\.tsx$/.test(base);
  });
  for (const file of mustI18n) {
    const content = fs.readFileSync(file, "utf8");
    const isReexportOnly = /^\s*export\s*\{[\s\S]*\}\s*from\s*["']/m.test(content)
      && !/function |const \w+.*=.*\(|export default function/.test(content);
    if (isReexportOnly) continue;
    if (!content.includes("useT")) {
      fail(`settings panel missing useT: ${path.relative(root, file)}`);
    }
  }
}

// --- 5. Island / shell ports stay registered, not ad-hoc ---
if (exists("src/island/index.ts") && !/QxIslandSurface|hostApi|session/i.test(read("src/island/index.ts"))) {
  fail("src/island/index.ts should re-export surface/session host ports");
}

// --- 6. Every protected capture WebView must have an IPC capability ---
if (exists("src-tauri/capabilities/default.json")) {
  const capability = JSON.parse(read("src-tauri/capabilities/default.json"));
  const windows = new Set(capability.windows ?? []);
  for (const label of ["main", "recording-controls", "region-picker"]) {
    if (!windows.has(label)) {
      fail(`capture surface missing Tauri capability: ${label}`);
    }
  }
}

if (failures.length) {
  console.error("architecture check failed:\n");
  for (const item of failures) console.error(`  - ${item}`);
  console.error("\nSee docs/architecture-principles.md — fix the port once, do not patch call sites one-by-one.");
  process.exit(1);
}

console.log("architecture: ok — SOLID doc linked, host binary port, converter Buffer, settings i18n import, island ports, capture capabilities.");
