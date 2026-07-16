import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  bufferShimModule,
  fileUrlShimModule,
  fsExtraShimModule,
  nodeFetchShimModule,
  osShimModule,
  pathShimModule,
  raycastApiShimModule,
  raycastShimStyles,
  runAppleScriptShimModule,
} from "./shims.mjs";

const require = createRequire(import.meta.url);

const VIRTUAL_DEPENDENCIES = new Set([
  "@raycast/api",
  "node-fetch",
  "file-url",
  "fs-extra",
  "run-applescript",
  "os",
  "path",
  "buffer",
]);

function titleCase(input) {
  return String(input)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fallbackIndexJs(pkg) {
  const name = pkg.title || titleCase(pkg.name || "Raycast Extension");
  return `export default {
  commands: [
    {
      name: "index",
      title: ${JSON.stringify(name)},
      async run(context) {
        context.showToast(${JSON.stringify(`${name} was converted, but needs a custom adapter.`)});
      },
    },
  ],
  panel: {
    title: ${JSON.stringify(name)},
    render(container) {
      container.innerHTML = "<div style='padding:16px;color:var(--qx-text-secondary)'>This Raycast extension needs a custom Qx adapter.</div>";
    },
  },
};
`;
}

function commandSourcePath(sourceDir, commandName) {
  const candidates = [
    path.join(sourceDir, "src", `${commandName}.tsx`),
    path.join(sourceDir, "src", `${commandName}.ts`),
    path.join(sourceDir, "src", `${commandName}.jsx`),
    path.join(sourceDir, "src", `${commandName}.js`),
    path.join(sourceDir, "src", "index.tsx"),
    path.join(sourceDir, "src", "index.ts"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function preferencesObject(pkg) {
  const result = {};
  for (const pref of pkg.preferences || []) {
    if (!pref?.name) continue;
    result[pref.name] = pref.default ?? "";
  }
  for (const command of pkg.commands || []) {
    for (const pref of command.preferences || []) {
      if (!pref?.name || result[pref.name] !== undefined) continue;
      result[pref.name] = pref.default ?? "";
    }
  }
  // Bing: daily throttle for random wallpaper (minutes). Upstream default 30
  // caused near-continuous desktop changes under Qx scheduling.
  const pkgId = String(pkg.name || "").replace(/^raycast-/, "");
  if (pkgId === "bing-wallpaper" && result.refreshInterval != null) {
    result.refreshInterval = "1440";
  }
  return result;
}

function virtualModulePlugin(modules) {
  return {
    name: "qx-raycast-virtual-modules",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (modules[args.path]) return { path: args.path, namespace: "qx-virtual" };
        return null;
      });
      build.onLoad({ filter: /.*/, namespace: "qx-virtual" }, (args) => ({
        contents: modules[args.path],
        loader: "js",
        resolveDir: process.cwd(),
      }));
    },
  };
}

function sharedReactPlugin() {
  const sharedModules = new Set([
    "react",
    "react-dom",
    "react-dom/client",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
  ]);
  return {
    name: "qx-raycast-shared-react",
    setup(build) {
      build.onResolve({ filter: /^(react|react-dom(?:\/client)?|react\/jsx(?:-dev)?-runtime)$/ }, (args) => {
        if (!sharedModules.has(args.path)) return null;
        return { path: require.resolve(args.path, { paths: [process.cwd()] }) };
      });
    },
  };
}

function raycastDependenciesToInstall(pkg) {
  return Object.keys(pkg.dependencies || {})
    .filter((name) => !VIRTUAL_DEPENDENCIES.has(name));
}

function installRaycastDependencies(sourceDir, pkg) {
  const dependencies = raycastDependenciesToInstall(pkg);
  if (dependencies.length === 0 || existsSync(path.join(sourceDir, "node_modules"))) return;

  const hasLockfile = existsSync(path.join(sourceDir, "package-lock.json"));
  const args = hasLockfile
    ? ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]
    : ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"];
  const result = spawnSync("npm", args, {
    cwd: sourceDir,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_ignore_scripts: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
  });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`npm ${args[0]} failed while installing Raycast dependencies: ${dependencies.join(", ")}`);
  }
}

function stabilizeBundleComments(text) {
  return text
    .split("\n")
    .map((line) => {
      if (/^\/\/ .*qx-raycast-build-[^/]+\/entry\.jsx$/.test(line)) {
        return "// qx-raycast-entry";
      }
      const sourceMatch = line.match(/^\/\/ .*\/extensions\/([^/]+\/src\/.+)$/);
      if (sourceMatch) {
        return `// raycast-source/${sourceMatch[1]}`;
      }
      return line;
    })
    .join("\n")
    .replace(/[ \t]+$/gm, "");
}

export async function genericRaycastIndexJs(sourceDir, pkg, manifest) {
  const esbuild = await import("esbuild");
  installRaycastDependencies(sourceDir, pkg);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "qx-raycast-build-"));
  const commandNames = [];
  for (const command of pkg.commands || []) {
    const commandName = command.name || "index";
    const sourcePath = commandSourcePath(sourceDir, commandName);
    if (!sourcePath) continue;
    commandNames.push({ name: commandName, sourcePath, mode: command.mode || "view" });
  }
  if (commandNames.length === 0) {
    return fallbackIndexJs(pkg);
  }
  const entryPath = path.join(tempDir, "entry.jsx");
  await writeFile(entryPath, `
import React from "react";
import { createRoot } from "react-dom/client";
import { Buffer as QxBuffer } from "buffer";
if (typeof globalThis.Buffer === "undefined") globalThis.Buffer = QxBuffer;
${raycastShimStyles()}

const commandLoaders = {
${commandNames.map((item) => JSON.stringify(item.name) + ": () => import(" + JSON.stringify(item.sourcePath) + ")").join(",\n")}
};
const commandModes = ${JSON.stringify(Object.fromEntries(commandNames.map((item) => [item.name, item.mode])))};
const manifestCommands = ${JSON.stringify(manifest.commands)};
const preferences = ${JSON.stringify(preferencesObject(pkg))};
let root = null;
const loadedCommandModules = new Map();

function renderElement(container, element) {
  injectRaycastStyles();
  if (!root) root = createRoot(container);
  if (globalThis.__qxRaycastRuntime) {
    globalThis.__qxRaycastRuntime.currentElement = element;
  }
  root.render(element || React.createElement("div", { className: "qx-raycast-empty" }, "No view"));
}

async function hydrateFilesystem(context, preferences) {
  const dirs = new Set([
    "/qx-plugin-files/" + ${JSON.stringify(manifest.id)},
    "/qx-home/Downloads",
  ]);
  const downloadDirectory = String(preferences?.downloadDirectory || "");
  if (downloadDirectory.startsWith("~/")) {
    dirs.add("/qx-home/" + downloadDirectory.slice(2));
  } else if (downloadDirectory.startsWith("/qx-home/") || downloadDirectory.startsWith("/qx-plugin-files/")) {
    dirs.add(downloadDirectory);
  } else if (downloadDirectory.startsWith("~")) {
    dirs.add("/qx-home");
  }
  for (const dir of dirs) {
    try {
      const names = await context?.qx?.invokeRust?.("plugin_file_list", { path: dir });
      if (typeof globalThis.__qxRaycastFsHydrate === "function") {
        globalThis.__qxRaycastFsHydrate(dir, Array.isArray(names) ? names : []);
      }
    } catch {
      if (typeof globalThis.__qxRaycastFsHydrate === "function") {
        globalThis.__qxRaycastFsHydrate(dir, []);
      }
    }
  }
}

async function loadPreferences(context) {
  const next = { ...preferences };
  if (!context?.getPreference) return next;
  await Promise.all(Object.keys(next).map(async (key) => {
    try {
      const value = await context.getPreference(key);
      if (value !== undefined && value !== null) next[key] = value;
    } catch {
    }
  }));
  return next;
}

async function loadCommandModule(name) {
  const key = commandLoaders[name] ? name : Object.keys(commandLoaders)[0];
  if (!key) throw new Error("Command not bundled: " + name);
  if (!loadedCommandModules.has(key)) {
    loadedCommandModules.set(key, await commandLoaders[key]());
  }
  return loadedCommandModules.get(key);
}

async function invokeCommand(name, container, context, options = {}) {
  const mode = commandModes[name] || "view";
  // Keep one in-memory Map for the plugin process; Cache also mirrors to
  // localStorage so no-view interval commands (Bing lastRefresh) survive.
  if (!globalThis.__qxRaycastSharedCache) globalThis.__qxRaycastSharedCache = new Map();
  const cache = globalThis.__qxRaycastSharedCache;
  const preferences = await loadPreferences(context);
  const launchType = options.launchType
    || globalThis.__qxRaycastLaunchType
    || (mode === "no-view" ? "background" : "userInitiated");
  globalThis.__qxRaycastLaunchType = launchType;
  globalThis.__qxRaycastRuntime = {
    context,
    preferences,
    activeCommand: name,
    cache,
    launchType,
    supportPath: "/qx-plugin-files/" + ${JSON.stringify(manifest.id)},
    assetsPath: "",
    homeDirectory: "/qx-home",
    navStack: [],
    currentElement: null,
    actionHandlers: new Map(),
    actionMeta: new Map(),
    render: (element) => renderElement(container, element),
    setSearch: () => {},
  };
  // Preload Downloads / support-path directory listings so readdirSync works
  // for extensions that list downloaded wallpapers on first paint.
  await hydrateFilesystem(context, preferences);
  const mod = await loadCommandModule(name);
  const component = mod.default || mod.Command || mod;
  if (mode === "view") {
    const element = React.isValidElement(component) ? component : React.createElement(component);
    renderElement(container, element);
    return;
  }
  const result = typeof component === "function" ? await component({}) : component;
  if (React.isValidElement(result)) {
    renderElement(container, result);
  } else if (container) {
    renderElement(container, React.createElement("div", { className: "qx-raycast-empty" }, result == null ? "" : String(result)));
  }
}

export default {
  commands: manifestCommands.map((command) => ({
    ...command,
    async run(context, runOptions = {}) {
      const mode = commandModes[command.name] || "view";
      const hidden = document.createElement("div");
      hidden.style.display = "none";
      document.body.appendChild(hidden);
      try {
        await invokeCommand(command.name, hidden, context, {
          launchType: runOptions.launchType
            || (mode === "no-view" ? "background" : "userInitiated"),
        });
        if (mode === "view") context.showToast("Open " + command.title + " from the plugin panel.");
      } finally {
        hidden.remove();
      }
    },
  })),
  panel: {
    title: ${JSON.stringify(manifest.panel.title)},
    render(container, context) {
      const firstView = manifestCommands.find((command) => (commandModes[command.name] || "view") === "view") || manifestCommands[0];
      return invokeCommand(firstView.name, container, context, { launchType: "userInitiated" });
    },
    destroy() {
      if (root) {
        root.unmount();
        root = null;
      }
    },
  },
};
`);
  try {
    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      nodePaths: [path.join(sourceDir, "node_modules"), path.join(process.cwd(), "node_modules")],
      platform: "browser",
      format: "esm",
      jsx: "automatic",
      mainFields: ["browser", "module", "main"],
      conditions: ["browser", "default"],
      // Ensure Buffer exists before any Raycast source evaluates (many extensions
      // call Buffer.from as a Node global when writing downloaded bytes).
      banner: {
        js: `if(typeof globalThis.Buffer==="undefined"){globalThis.Buffer={from(v){if(v instanceof ArrayBuffer)return new Uint8Array(v);if(ArrayBuffer.isView(v))return new Uint8Array(v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength));return new TextEncoder().encode(String(v||""));}};}`
      },
      plugins: [
        sharedReactPlugin(),
        virtualModulePlugin({
          "@raycast/api": raycastApiShimModule(preferencesObject(pkg), `/qx-plugin-files/${manifest.id}`),
          "node-fetch": nodeFetchShimModule(),
          "file-url": fileUrlShimModule(),
          "fs-extra": fsExtraShimModule(),
          "run-applescript": runAppleScriptShimModule(),
          "os": osShimModule(),
          "path": pathShimModule(),
          "buffer": bufferShimModule(),
        }),
      ],
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
        "global": "globalThis",
      },
    });
    return stabilizeBundleComments(result.outputFiles[0].text);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
