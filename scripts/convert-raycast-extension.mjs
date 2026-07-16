#!/usr/bin/env node
import { copyFile, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { systemInformationIndexJs, systemMonitorIndexJs } from "./raycast-converter/adapters.mjs";
import { genericRaycastIndexJs } from "./raycast-converter/generic.mjs";
const INVOKE_PERMISSIONS = [
  "system-info",
  "system-stats",
  "processes",
  "invoke:qx_system_information_kill_process",
];

function usage() {
  console.error(`Usage:
  node scripts/convert-raycast-extension.mjs <raycast-extension-dir> [--out <dir>] [--package]

Example:
  node scripts/convert-raycast-extension.mjs /tmp/extensions/system-information --out /tmp/qx-plugins --package`);
}

function parseArgs(argv) {
  const args = [...argv];
  const source = args.shift();
  if (!source || source === "-h" || source === "--help") {
    usage();
    process.exit(source ? 0 : 1);
  }
  let out = path.resolve("dist/raycast-converted");
  let shouldPackage = false;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--out") {
      const value = args.shift();
      if (!value) throw new Error("--out requires a directory");
      out = path.resolve(value);
    } else if (arg === "--package") {
      shouldPackage = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { source: path.resolve(source), out, shouldPackage };
}

function titleCase(input) {
  return String(input)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeIcon(icon) {
  if (!icon) return undefined;
  if (typeof icon === "string") return path.basename(icon);
  if (typeof icon === "object") return normalizeIcon(icon.source || icon.path || icon.light || icon.dark);
  return undefined;
}

function normalizeAssetList(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map(normalizeIcon).filter(Boolean);
}

function packageScreenshots(pkg) {
  return [
    ...normalizeAssetList(pkg.screenshots),
    ...normalizeAssetList(pkg.screenshot),
    ...normalizeAssetList(pkg.media),
    ...normalizeAssetList(pkg.gallery),
    ...normalizeAssetList(pkg.metadata?.screenshots),
  ].filter((item, index, all) => all.indexOf(item) === index);
}

async function discoverScreenshots(sourceDir, pkg) {
  const declared = packageScreenshots(pkg);
  const found = new Set(declared);
  for (const folderName of ["metadata", "screenshots", "media"]) {
    const folder = path.join(sourceDir, folderName);
    if (!existsSync(folder)) continue;
    const entries = await readdir(folder).catch(() => []);
    for (const entry of entries) {
      if (/\.(png|jpe?g|webp|gif)$/i.test(entry)) found.add(entry);
    }
  }
  return [...found];
}

function adapterKind(pkg) {
  if (pkg.name === "system-information") return "system-information";
  if (pkg.name === "raycast-system-monitor" || pkg.name === "system-monitor") return "system-monitor";
  return "generic";
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function hasPattern(text, pattern) {
  return pattern.test(text);
}

async function collectTextFiles(dir) {
  if (!existsSync(dir)) return "";
  const chunks = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      chunks.push(await collectTextFiles(fullPath));
      continue;
    }
    if (/\.(cjs|mjs|js|jsx|ts|tsx|json)$/i.test(entry.name)) {
      chunks.push(await readFile(fullPath, "utf8").catch(() => ""));
    }
  }
  return chunks.join("\n");
}

async function collectRaycastSourceText(sourceDir) {
  const packageText = await readFile(path.join(sourceDir, "package.json"), "utf8").catch(() => "");
  const srcText = await collectTextFiles(path.join(sourceDir, "src"));
  return `${packageText}\n${srcText}`;
}

function raycastPlatforms(kind) {
  return kind === "generic" ? ["macos", "windows"] : ["macos"];
}

function analyzeRaycastCompatibility(pkg, kind, sourceText) {
  if (kind !== "generic") {
    return {
      macos: {
        status: "supported",
        features: ["Qx native adapter"],
      },
      windows: {
        status: "unsupported",
        unsupported: ["This Raycast adapter currently uses macOS-specific system APIs"],
      },
    };
  }

  const commandModes = (pkg.commands || []).map((command) => command.mode || "view");
  const usesAppleScript = hasPattern(sourceText, /\brunAppleScript\b|run-applescript/i);
  const usesFinder = hasPattern(sourceText, /\bshowInFinder\b|Action\.ShowInFinder/i);
  const usesClipboard = hasPattern(sourceText, /\bClipboard\b|Action\.CopyToClipboard/i);
  const usesHttp = hasPattern(sourceText, /\bnode-fetch\b|\bfetch\s*\(/i);
  const usesStorage = hasPattern(sourceText, /\bLocalStorage\b|\bCache\b/i);
  const usesFileSystem = hasPattern(sourceText, /\bfs-extra\b|from\s+["']fs["']|require\(["']fs["']\)/i);
  const usesOpen = hasPattern(sourceText, /\bopen\s*\(|Action\.Open|Action\.OpenInBrowser/i);
  const hasBackground = (pkg.commands || []).some((command) => command.mode === "no-view" && command.interval);
  const hasMenuBar = commandModes.some((mode) => mode === "menu-bar" || mode === "menuBar");
  const wallpaperScript = usesAppleScript && hasPattern(sourceText, /desktop picture|wallpaper|System Events/i);

  const commonFeatures = ["Raycast UI"];
  if (usesHttp) commonFeatures.push("HTTP fetch");
  if (usesClipboard) commonFeatures.push("Clipboard");
  if (usesStorage) commonFeatures.push("LocalStorage / Cache");
  if (usesFileSystem) commonFeatures.push("File cache");
  if (usesOpen) commonFeatures.push("Open URL/file");
  if (hasBackground) commonFeatures.push("Background interval");

  const macFeatures = [...commonFeatures];
  if (usesAppleScript) macFeatures.push("AppleScript automation");
  if (usesFinder) macFeatures.push("Finder reveal");

  const macDegraded = [];
  if (hasMenuBar) macDegraded.push("Raycast menu bar command -> Qx background/command entry");

  const windowsFeatures = [...commonFeatures];
  const windowsDegraded = [];
  const windowsUnsupported = [];
  const windowsNotes = [];
  if (usesFinder) windowsDegraded.push("showInFinder -> open target path");
  if (usesAppleScript) windowsUnsupported.push(wallpaperScript ? "AppleScript wallpaper setter" : "AppleScript automation");
  if (hasMenuBar) windowsUnsupported.push("Raycast menu bar command");
  if (wallpaperScript) {
    windowsNotes.push("This can become Windows-compatible after mapping the script to automation.wallpaper.setImage(path).");
  }

  return {
    macos: {
      status: macDegraded.length > 0 ? "partial" : "supported",
      features: unique(macFeatures),
      degraded: macDegraded,
    },
    windows: {
      status: windowsUnsupported.length > 0 || windowsDegraded.length > 0 ? "partial" : "supported",
      features: unique(windowsFeatures),
      degraded: windowsDegraded,
      unsupported: unique(windowsUnsupported),
      notes: windowsNotes,
    },
  };
}

function genericPermissionsForSource(sourceText) {
  const permissions = ["http", "open-url", "clipboard"];
  if (hasPattern(sourceText, /\brunAppleScript\b|run-applescript/i)) {
    permissions.push("invoke:plugin_run_applescript");
  }
  if (hasPattern(sourceText, /\bfs-extra\b|from\s+["']fs["']|require\(["']fs["']\)/i)) {
    permissions.push(
      "invoke:plugin_file_read_base64",
      "invoke:plugin_file_exists",
      "invoke:plugin_file_ensure_dir",
      "invoke:plugin_file_write_base64",
      "invoke:plugin_file_empty_dir",
      "invoke:plugin_file_list",
    );
  }
  return permissions;
}

function raycastPreferenceType(pref) {
  switch (pref?.type) {
    case "checkbox":
      return "boolean";
    case "dropdown":
      return "select";
    case "password":
      return "password";
    case "number":
      return "number";
    default:
      return "string";
  }
}

function raycastPreferenceOptions(pref) {
  const items = Array.isArray(pref?.data)
    ? pref.data
    : Array.isArray(pref?.options)
      ? pref.options
      : [];
  return items
    .map((item) => ({
      label: String(item.title || item.label || item.name || item.value || ""),
      value: String(item.value ?? item.id ?? item.title ?? item.label ?? ""),
    }))
    .filter((item) => item.label && item.value);
}

function raycastPreferences(pkg) {
  const seen = new Set();
  const result = [];
  const add = (pref) => {
    if (!pref?.name || seen.has(pref.name)) return;
    seen.add(pref.name);
    const mapped = {
      id: pref.name,
      label: pref.title || pref.label || pref.name,
      type: raycastPreferenceType(pref),
      required: pref.required !== false,
      default: pref.default ?? (pref.type === "checkbox" ? false : ""),
      description: pref.description || "",
    };
    const options = raycastPreferenceOptions(pref);
    if (options.length > 0) mapped.options = options;
    result.push(mapped);
  };
  for (const pref of pkg.preferences || []) add(pref);
  for (const command of pkg.commands || []) {
    for (const pref of command.preferences || []) add(pref);
  }
  return result;
}

/**
 * Qx product overrides for Raycast no-view intervals.
 * Bing ships 5m/30m in upstream which thrash desktop wallpaper; daily matches
 * Bing's publish cadence and Qx background stability policy.
 */
function qxBackgroundIntervalOverrides(pkgName) {
  const id = String(pkgName || "").replace(/^raycast-/, "");
  if (id === "bing-wallpaper") {
    return {
      "auto-random-bing-wallpaper": "1d",
      "auto-switch-bing-wallpaper": "1d",
    };
  }
  return null;
}

function applyQxPreferenceDefaults(preferences, pkgName) {
  const id = String(pkgName || "").replace(/^raycast-/, "");
  if (id !== "bing-wallpaper" || !Array.isArray(preferences)) return preferences;
  return preferences.map((pref) => {
    if (pref?.id !== "refreshInterval") return pref;
    return {
      ...pref,
      // minutes; plugin canRefresh() uses parseInt(refreshInterval) * ONE_MINUTE
      default: "1440",
      description: pref.description || "Minimum minutes between random wallpaper changes.",
    };
  });
}

function buildManifest(pkg) {
  const id = (pkg.name || "raycast-extension").replace(/^raycast-/, "");
  const name = pkg.title || titleCase(id);
  const kind = adapterKind(pkg);
  const commands = [];
  const intervalOverrides = qxBackgroundIntervalOverrides(pkg.name || id);

  commands.push(...(pkg.commands || []).map((command) => ({
    name: command.name || "index",
    title: command.title || name,
    description: command.description || pkg.description || "",
    icon: normalizeIcon(command.icon || pkg.icon),
    keywords: pkg.keywords || [],
    mode: command.mode || "view",
    interval: (intervalOverrides && intervalOverrides[command.name]) || command.interval,
  })));

  for (const tool of pkg.tools || []) {
    commands.push({
      name: tool.name,
      title: tool.title || titleCase(tool.name),
      description: tool.description || "",
      icon: normalizeIcon(pkg.icon),
      keywords: [tool.name, ...(pkg.keywords || [])],
    });
  }

  if (commands.length === 0) {
    commands.push({
      name: "index",
      title: name,
      description: pkg.description || "",
      icon: normalizeIcon(pkg.icon),
      keywords: pkg.keywords || [],
    });
  }

  return {
    id: `raycast-${id}`,
    name,
    version: pkg.version || "1.0.0",
    description: pkg.description || "",
    author: pkg.author || "",
    icon: normalizeIcon(pkg.icon),
    screenshots: packageScreenshots(pkg),
    platforms: raycastPlatforms(kind),
    keywords: pkg.keywords || [],
    preferences: applyQxPreferenceDefaults(raycastPreferences(pkg), pkg.name || id),
    permissions: kind === "generic"
      ? [
          "http",
          "open-url",
          "clipboard",
          "invoke:plugin_run_applescript",
          "invoke:plugin_file_read_base64",
          "invoke:plugin_file_exists",
          "invoke:plugin_file_ensure_dir",
          "invoke:plugin_file_write_base64",
          "invoke:plugin_file_empty_dir",
          "invoke:plugin_file_list",
        ]
      : INVOKE_PERMISSIONS,
    entry: "index.js",
    commands,
    panel: {
      title: pkg.title || titleCase(id),
      icon: normalizeIcon(pkg.icon),
      keywords: pkg.keywords || [],
    },
    raycast: {
      source: pkg.name || id,
      compatible: kind === "generic" ? "generic-shim" : "converted",
      sourceCommands: (pkg.commands || []).map((command) => command.name).filter(Boolean),
      sourceTools: (pkg.tools || []).map((tool) => tool.name).filter(Boolean),
      platformCompatibility: analyzeRaycastCompatibility(pkg, kind, ""),
    },
  };
}

async function copyAssetIfPresent(sourceDir, destDir, asset) {
  const assetName = normalizeIcon(asset);
  if (!assetName) return;
  const candidates = [
    path.join(sourceDir, "assets", assetName),
    path.join(sourceDir, "metadata", assetName),
    path.join(sourceDir, "media", assetName),
    path.join(sourceDir, assetName),
  ];
  const from = candidates.find((candidate) => existsSync(candidate));
  if (from) {
    await copyFile(from, path.join(destDir, assetName));
  }
}

async function copyRaycastAssets(sourceDir, destDir, pkg, manifest) {
  const assets = new Set([pkg.icon, ...(manifest?.screenshots || packageScreenshots(pkg))]);
  for (const command of pkg.commands || []) {
    if (command.icon) assets.add(command.icon);
  }
  for (const asset of assets) {
    await copyAssetIfPresent(sourceDir, destDir, asset);
  }
}

function packagePlugin(pluginDir) {
  const archive = `${pluginDir}.qx-plugin`;
  const result = spawnSync("zip", ["-qr", archive, "."], {
    cwd: pluginDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("zip failed; plugin directory was still generated");
  }
  return archive;
}

async function main() {
  const { source, out, shouldPackage } = parseArgs(process.argv.slice(2));
  const packageJsonPath = path.join(source, "package.json");
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const manifest = buildManifest(pkg);
  manifest.screenshots = await discoverScreenshots(source, pkg);
  const kind = adapterKind(pkg);
  const sourceText = await collectRaycastSourceText(source);
  manifest.platforms = raycastPlatforms(kind);
  manifest.raycast.platformCompatibility = analyzeRaycastCompatibility(pkg, kind, sourceText);
  if (kind === "generic") {
    manifest.permissions = genericPermissionsForSource(sourceText);
  }
  const pluginDir = path.join(out, manifest.id);

  await rm(pluginDir, { recursive: true, force: true });
  await mkdir(pluginDir, { recursive: true });
  await writeFile(path.join(pluginDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(pluginDir, "index.js"),
    kind === "system-information"
      ? systemInformationIndexJs()
      : kind === "system-monitor"
        ? systemMonitorIndexJs()
        : await genericRaycastIndexJs(source, pkg, manifest),
  );
  await copyRaycastAssets(source, pluginDir, pkg, manifest);
  await writeFile(
    path.join(pluginDir, "README.md"),
    `# ${manifest.name}\n\nConverted from Raycast extension \`${pkg.name}\` for Qx.\n\nSource commands: ${(pkg.commands || []).map((c) => c.name).join(", ") || "-"}\nSource tools: ${(pkg.tools || []).map((t) => t.name).join(", ") || "-"}\n`,
  );

  const result = { pluginDir };
  if (shouldPackage) {
    await unlink(`${pluginDir}.qx-plugin`).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    result.archive = packagePlugin(pluginDir);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
