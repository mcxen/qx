#!/usr/bin/env node
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const INVOKE_PERMISSIONS = [
  "system-info",
  "system-stats",
  "processes",
  "invoke:qx_system_information_kill_process",
];

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

function buildManifest(pkg) {
  const id = (pkg.name || "raycast-extension").replace(/^raycast-/, "");
  const name = pkg.title || titleCase(id);
  const kind = adapterKind(pkg);
  const commands = [];

  commands.push(...(pkg.commands || []).map((command) => ({
    name: command.name || "index",
    title: command.title || name,
    description: command.description || pkg.description || "",
    icon: normalizeIcon(command.icon || pkg.icon),
    keywords: pkg.keywords || [],
    mode: command.mode || "view",
    interval: command.interval,
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
    preferences: raycastPreferences(pkg),
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

function systemInformationIndexJs() {
  return String.raw`const call = (context, cmd, args) => context.invoke(cmd, args || {});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function section(title, rows) {
  return '<section class="qx-raycast-section"><h2>' + escapeHtml(title) + '</h2>' + rows.join("") + '</section>';
}

function row(icon, title, detail, actions = "") {
  return '<div class="qx-raycast-row"><div class="qx-raycast-icon">' + escapeHtml(icon) + '</div><div class="qx-raycast-main"><div class="qx-raycast-title">' + escapeHtml(title) + '</div><div class="qx-raycast-detail">' + escapeHtml(detail) + '</div></div>' + actions + '</div>';
}

function styles() {
  return '<style>' +
    'body{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--qx-text-primary,#111);background:transparent;margin:0;}' +
    '.qx-raycast-wrap{box-sizing:border-box;height:100%;overflow:auto;padding:14px 18px 28px;}' +
    '.qx-raycast-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;}' +
    '.qx-raycast-header h1{font-size:18px;line-height:1.2;margin:0;font-weight:650;}' +
    '.qx-raycast-header button,.qx-raycast-action{border:1px solid var(--qx-border-1,#ddd);background:var(--qx-bg-component-1,#fff);color:inherit;border-radius:6px;padding:6px 10px;font:inherit;cursor:pointer;}' +
    '.qx-raycast-section{border-top:1px solid var(--qx-border-1,#ddd);padding-top:10px;margin-top:12px;}' +
    '.qx-raycast-section h2{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--qx-text-tertiary,#888);margin:0 0 8px;}' +
    '.qx-raycast-row{min-height:38px;display:flex;align-items:center;gap:10px;border-radius:6px;padding:7px 8px;}' +
    '.qx-raycast-row:hover{background:var(--qx-bg-component-2,#f5f5f5);}' +
    '.qx-raycast-icon{width:22px;text-align:center;flex:0 0 22px;}' +
    '.qx-raycast-main{min-width:0;flex:1;}' +
    '.qx-raycast-title{font-weight:560;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.qx-raycast-detail{margin-top:2px;color:var(--qx-text-secondary,#666);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.qx-raycast-error{color:var(--qx-danger,#c00);padding:16px;}' +
    '</style>';
}

async function loadAll(context) {
  const [system, storage, network, processes] = await Promise.all([
    call(context, "qx_system_information_check_system_info"),
    call(context, "qx_system_information_check_storage"),
    call(context, "qx_system_information_check_network"),
    call(context, "qx_system_information_list_processes"),
  ]);
  return { system, storage, network, processes };
}

async function renderSystemInformation(container, context) {
  container.innerHTML = styles() + '<div class="qx-raycast-wrap">Loading system information...</div>';
  try {
    const data = await loadAll(context);
    const processRows = (data.processes.processes || []).slice(0, 80).map((proc) =>
      row("A", proc.name, "PID: " + proc.pid + " | CPU: " + Number(proc.cpu || 0).toFixed(1) + "% | MEM: " + Number(proc.mem || 0).toFixed(1) + "%")
    );
    const networkRows = (data.network.devices || []).map((device) => row("N", device.name, device.ip));

    container.innerHTML = styles() + '<div class="qx-raycast-wrap">' +
      '<div class="qx-raycast-header"><h1>System Information</h1><button id="qx-refresh">Refresh</button></div>' +
      section("About This Mac", [
        row("H", "Hostname", data.system.hostname),
        row("C", "Chip", data.system.chip),
        row("M", "Memory", data.system.memory),
        row("#", "Serial Number", data.system.serialNumber),
      ]) +
      section("Storage", [row("D", "Macintosh HD", data.storage.summary)]) +
      section("macOS", [
        row("i", data.system.macOS, "Kernel " + data.system.kernel),
      ]) +
      section("Network", networkRows.length ? networkRows : [row("N", "No active IPv4 network devices", "-")]) +
      section("Running Processes", processRows.length ? processRows : [row("A", "No processes", "-")]) +
      '</div>';
    container.querySelector("#qx-refresh")?.addEventListener("click", () => renderSystemInformation(container, context));
  } catch (error) {
    container.innerHTML = styles() + '<div class="qx-raycast-error">Failed to load system information: ' + escapeHtml(error) + '</div>';
  }
}

function toastJson(context, title, value) {
  const compact = typeof value === "string" ? value : JSON.stringify(value);
  context.showToast(title + ": " + compact.slice(0, 220));
}

export default {
  commands: [
    {
      name: "index",
      title: "View System Information",
      async run(context) {
        toastJson(context, "System Information", await call(context, "qx_system_information_check_system_info"));
      },
    },
    {
      name: "check-storage",
      title: "Check Storage",
      async run(context) {
        const result = await call(context, "qx_system_information_check_storage");
        context.showToast(result.summary);
      },
    },
    {
      name: "check-system-info",
      title: "Check System Info",
      async run(context) {
        toastJson(context, "System", await call(context, "qx_system_information_check_system_info"));
      },
    },
    {
      name: "check-network",
      title: "Check Network",
      async run(context) {
        const result = await call(context, "qx_system_information_check_network");
        context.showToast(result.count + " network device(s)");
      },
    },
    {
      name: "list-processes",
      title: "List Processes",
      async run(context) {
        const result = await call(context, "qx_system_information_list_processes");
        context.showToast(result.count + " running process(es)");
      },
    },
    {
      name: "kill-process",
      title: "Kill Process",
      async run(context) {
        const pid = await context.prompt("PID to kill");
        if (!pid) return;
        const result = await call(context, "qx_system_information_kill_process", { pid: Number(pid) });
        context.showToast(result.message);
      },
    },
  ],
  panel: {
    title: "System Information",
    render(container, context) {
      void renderSystemInformation(container, context);
    },
    destroy(container) {
      container.innerHTML = "";
    },
  },
};
`;
}

function systemMonitorIndexJs() {
  return String.raw`function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}
function bytes(v){const n=Math.max(0,Number(v||0));if(n<1024)return Math.round(n)+" B";if(n<1048576)return(n/1024).toFixed(2)+" KB";if(n<1073741824)return(n/1048576).toFixed(2)+" MB";return(n/1073741824).toFixed(2)+" GB"}
function css(){return '<style>:root{--b:#f7f7f7;--p:#fff;--p2:#ededed;--l:#d7d7d7;--t:#111;--m:#777;--s:#222}@media(prefers-color-scheme:dark){:root{--b:#1e1e1f;--p:#252526;--p2:#3a3a3c;--l:#3c3c3f;--t:#f5f5f5;--m:#a9a9aa;--s:#fff}}html,body,#root{margin:0;width:100%;height:100%;background:transparent}body{font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--t)}.sm{height:100%;display:grid;grid-template-columns:minmax(220px,32%) minmax(0,1fr);background:var(--b)}.nav{border-right:1px solid var(--l);padding:22px 16px;overflow:auto}.nav button{width:100%;min-height:52px;display:grid;grid-template-columns:28px 1fr auto;align-items:center;gap:10px;border:0;border-radius:8px;background:transparent;color:var(--t);font:inherit;text-align:left;padding:8px 12px;cursor:pointer}.nav button.active{background:var(--p2)}.label{font-size:16px;font-weight:650}.metric{color:var(--m);font-size:14px;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.detail{padding:24px 30px;overflow:auto}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.top h1{font-size:22px;margin:0}.top button{border:1px solid var(--l);background:var(--p);color:var(--t);border-radius:6px;padding:7px 12px;font:inherit}.row{min-height:42px;display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid var(--l);padding:8px 0}.name{color:var(--m);font-weight:650}.value{font-size:15px;font-weight:650;text-align:right}.bar{height:8px;background:var(--p2);border-radius:999px;overflow:hidden}.fill{height:100%;background:var(--s);border-radius:999px}.error{padding:20px;color:#d44}.small{font-size:12px;color:var(--m)}</style>'}
function row(n,v){return '<div class="row"><div class="name">'+esc(n)+'</div><div class="value">'+esc(v)+'</div></div>'}
function bar(p){return '<div class="bar"><div class="fill" style="width:'+Math.max(0,Math.min(100,Number(p||0))).toFixed(0)+'%"></div></div>'}
function stat(st,snake,camel){return Number(st?.[snake]??st?.[camel]??0)}
let active="system-info",lastNet=null;
async function data(ctx){const [stats,system,storage,network,processes,power,counters]=await Promise.all([ctx.system.stats(),ctx.system.info(),ctx.system.storage(),ctx.system.network(),ctx.system.processes.list(),ctx.qx.invokeRust("qx_system_monitor_power",{}),ctx.qx.invokeRust("qx_system_monitor_network_counters",{})]);const now=Date.now();let down=0,up=0;if(lastNet&&counters){const s=Math.max(.001,(now-lastNet.time)/1000);down=Math.max(0,(Number(counters.totalBytesIn||0)-lastNet.in)/s);up=Math.max(0,(Number(counters.totalBytesOut||0)-lastNet.out)/s)}lastNet={time:now,in:Number(counters?.totalBytesIn||0),out:Number(counters?.totalBytesOut||0)};return{stats,system,storage,network,processes,power,counters,down,up}}
function nav(id,i,l,m){return '<button data-tab="'+id+'" class="'+(active===id?'active':'')+'"><span>'+i+'</span><span class="label">'+l+'</span><span class="metric">'+esc(m||'')+'</span></button>'}
function pane(d){const st=d.stats||{};if(active==="cpu")return '<div class="top"><h1>CPU</h1><button id="refresh">Refresh</button></div>'+bar(st.cpu)+row("Usage",Number(st.cpu||0).toFixed(1)+" %")+row("Chip",d.system?.chip||"Unknown")+row("Temperature","N/A");if(active==="memory")return '<div class="top"><h1>Memory</h1><button id="refresh">Refresh</button></div>'+bar(st.memory)+row("Used",stat(st,"memory_used_gb","memoryUsedGb").toFixed(2)+" GB")+row("Total",stat(st,"memory_total_gb","memoryTotalGb").toFixed(2)+" GB")+row("Usage",Number(st.memory||0).toFixed(1)+" %");if(active==="power")return '<div class="top"><h1>Power</h1><button id="refresh">Refresh</button></div>'+(d.power?.batteryLevel==null?'':bar(d.power.batteryLevel))+row("Battery",d.power?.batteryLevel==null?"N/A":d.power.batteryLevel+" %")+row("Source",d.power?.source||"Unknown")+row("State",d.power?.summary||"Unknown");if(active==="network"){const dev=(d.network?.devices||[]).map(x=>row(x.name,x.ip)).join("");const c=(d.counters?.interfaces||[]).slice(0,8).map(x=>row(x.name,"In "+bytes(x.bytesIn)+" / Out "+bytes(x.bytesOut))).join("");return '<div class="top"><h1>Network</h1><button id="refresh">Refresh</button></div>'+row("Download Speed",bytes(d.down)+"/s")+row("Upload Speed",bytes(d.up)+"/s")+row("Active Devices",String(d.network?.count||0))+dev+c}const ps=(d.processes?.processes||[]).slice(0,8).map((p,i)=>'<div class="row"><div><strong>'+(i+1)+' -> '+esc(p.name)+'</strong><div class="small">PID '+p.pid+'</div></div><div class="value">CPU '+Number(p.cpu||0).toFixed(1)+'% / MEM '+Number(p.mem||0).toFixed(1)+'%</div></div>').join("");return '<div class="top"><h1>System Info</h1><button id="refresh">Refresh</button></div>'+row("Hostname",d.system?.hostname||"Unknown")+row("macOS",d.system?.macOS||"Unknown")+row("Kernel",d.system?.kernel||"Unknown")+row("Storage",d.storage?.summary||"Unknown")+row("Serial Number",d.system?.serialNumber||"Unknown")+ps}
async function draw(c,ctx){c.innerHTML=css()+'<div class="sm"><div class="nav">Loading System Monitor...</div><div></div></div>';try{const d=await data(ctx);c.innerHTML=css()+'<div class="sm"><div class="nav">'+nav("system-info","S","System Info","")+nav("cpu","C","CPU",Number(d.stats?.cpu||0).toFixed(0)+" %")+nav("memory","M","Memory",Number(d.stats?.memory||0).toFixed(0)+" %")+nav("power","P","Power",d.power?.batteryLevel==null?"N/A":d.power.batteryLevel+" %")+nav("network","N","Network","↓ "+bytes(d.down)+"/s")+'</div><div class="detail">'+pane(d)+'</div></div>';c.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click",()=>{active=b.getAttribute("data-tab")||"system-info";draw(c,ctx)}));c.querySelector("#refresh")?.addEventListener("click",()=>draw(c,ctx))}catch(e){c.innerHTML=css()+'<div class="error">Failed to load System Monitor: '+esc(e?.message||e)+'</div>'}}
export default{commands:[{name:"system-monitor",title:"System Monitor",async run(ctx){const s=await ctx.system.stats();ctx.showToast("CPU "+Number(s.cpu||0).toFixed(1)+"%, Memory "+Number(s.memory||0).toFixed(1)+"%")}},{name:"menubar-system-monitor",title:"Menubar System Monitor",async run(ctx){const s=await ctx.system.stats();ctx.showToast("Qx panel monitor ready: CPU "+Number(s.cpu||0).toFixed(1)+"%")}}],panel:{title:"System Monitor",render(c,ctx){void draw(c,ctx);c.__timer=ctx.setInterval(()=>draw(c,ctx),3000)},destroy(c){c.innerHTML=""}}};
`;
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

function raycastApiShimModule(defaultPreferences, defaultSupportPath) {
  return String.raw`
import React from "react";

const defaultPreferenceValues = ${JSON.stringify(defaultPreferences)};
const defaultEnvironmentSupportPath = ${JSON.stringify(defaultSupportPath)};

function runtime() {
  return globalThis.__qxRaycastRuntime;
}

function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

function textOf(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return value.title || value.name || value.text || "";
}

function firstAction(node) {
  const children = React.Children.toArray(node?.props?.children);
  for (const child of children) {
    if (!React.isValidElement(child)) continue;
    if (child.type === Action) return child;
    const nested = firstAction(child);
    if (nested) return nested;
  }
  return null;
}

function collectActions(node, result = []) {
  const children = React.Children.toArray(node?.props?.children);
  for (const child of children) {
    if (!React.isValidElement(child)) continue;
    if (child.type === Action && typeof child.props?.onAction === "function") {
      result.push(child);
    }
    if (child.type !== Action && typeof child.type === "function") {
      try {
        collectActions(child.type(child.props || {}), result);
      } catch {
        // Action-only components should be pure. Ignore anything that needs
        // a React render dispatcher and let the primary click action handle it.
      }
    }
    collectActions(child, result);
  }
  return result;
}

function runAction(action) {
  const handler = action?.props?.onAction;
  if (typeof handler === "function") {
    void Promise.resolve(handler());
  }
}

export const Icon = {
  Info: "info",
  Download: "download",
  Desktop: "desktop",
  Eye: "eye",
  Folder: "folder",
  Gear: "gear",
  Link: "link",
  Trash: "trash",
  XMarkCircle: "x",
};

export const Color = {
  Blue: "blue",
  Green: "green",
  Orange: "orange",
  Purple: "purple",
  Red: "red",
  Yellow: "yellow",
};

export const Toast = {
  Style: {
    Animated: "animated",
    Success: "success",
    Failure: "failure",
  },
};

export async function showToast(input, title, message) {
  const toast = typeof input === "object"
    ? { ...input }
    : { style: input, title: String(title || ""), message: String(message || "") };
  runtime()?.context?.showToast?.([toast.title, toast.message].filter(Boolean).join(": "));
  return {
    ...toast,
    hide() {},
    show() { runtime()?.context?.showToast?.(this.title || ""); },
  };
}

export async function showHUD(message) {
  runtime()?.context?.showToast?.(String(message || ""));
}

export async function open(target) {
  return runtime()?.context?.openUrl?.(String(target || ""));
}

export async function showInFinder(target) {
  return runtime()?.context?.openUrl?.(String(target || ""));
}

export async function openExtensionPreferences() {
  runtime()?.context?.showToast?.("Preferences are managed in Qx Extensions settings.");
}

export async function confirmAlert(options) {
  const title = options?.title || "Confirm";
  const message = options?.message ? "\n" + options.message : "";
  return globalThis.confirm ? globalThis.confirm(title + message) : true;
}

export function getPreferenceValues() {
  return runtime()?.preferences || defaultPreferenceValues;
}

export const environment = {
  get supportPath() {
    return runtime()?.supportPath || defaultEnvironmentSupportPath;
  },
  get assetsPath() {
    return runtime()?.assetsPath || "";
  },
  get commandName() {
    return runtime()?.activeCommand || "index";
  },
  get launchType() {
    return LaunchType.UserInitiated;
  },
};

export const LaunchType = {
  UserInitiated: "userInitiated",
  Background: "background",
};

export const LocalStorage = {
  async getItem(key) {
    const value = await runtime()?.context?.storage?.persist?.get?.(String(key));
    return value == null ? undefined : value;
  },
  async setItem(key, value) {
    await runtime()?.context?.storage?.persist?.set?.(String(key), value);
  },
  async removeItem(key) {
    await runtime()?.context?.storage?.persist?.delete?.(String(key));
  },
  async allItems() {
    return {};
  },
};

export class Cache {
  constructor(options = {}) {
    this.namespace = options.namespace || "default";
  }
  key(key) {
    return "raycast-cache:" + this.namespace + ":" + key;
  }
  get(key) {
    return runtime()?.cache?.get(this.key(key));
  }
  set(key, value) {
    runtime()?.cache?.set(this.key(key), value);
  }
  remove(key) {
    runtime()?.cache?.delete(this.key(key));
  }
  clear() {}
}

export const Clipboard = {
  readText: () => runtime()?.context?.clipboard?.read?.(),
  copy: (value) => runtime()?.context?.clipboard?.write?.(String(value || "")),
};

export function useNavigation() {
  return {
    push(element) {
      runtime()?.render?.(element);
    },
    pop() {},
  };
}

function actionPanelVisible() {
  return runtime()?.context?.display?.raycastActionPanel !== false;
}

export function ActionPanel({ children }) {
  return React.createElement("div", {
    "data-raycast-actions": true,
    className: cx("qx-raycast-actions-inline", actionPanelVisible() ? null : "is-hidden"),
  }, children);
}
ActionPanel.Section = function ActionPanelSection({ children }) {
  return React.createElement(React.Fragment, null, children);
};

export function Action(props) {
  return React.createElement("button", {
    type: "button",
    className: "qx-raycast-action-button",
    onClick: (event) => {
      event?.stopPropagation?.();
      if (typeof props.onAction === "function") void Promise.resolve(props.onAction());
    },
  }, props.title || "Action");
}
Action.OpenInBrowser = function ActionOpenInBrowser(props) {
  return React.createElement(Action, { ...props, onAction: () => open(props.url), title: props.title || "Open in Browser" });
};
Action.Open = function ActionOpen(props) {
  return React.createElement(Action, { ...props, onAction: () => open(props.target), title: props.title || "Open" });
};
Action.ShowInFinder = function ActionShowInFinder(props) {
  return React.createElement(Action, { ...props, onAction: () => showInFinder(props.path), title: props.title || "Show in Finder" });
};
Action.CopyToClipboard = function ActionCopyToClipboard(props) {
  return React.createElement(Action, { ...props, onAction: () => Clipboard.copy(props.content), title: props.title || "Copy" });
};
Action.Push = function ActionPush(props) {
  const nav = useNavigation();
  return React.createElement(Action, { ...props, onAction: () => nav.push(props.target), title: props.title || "Open" });
};

function SearchInput({ placeholder }) {
  return React.createElement("input", {
    className: "qx-raycast-search",
    placeholder: placeholder || "Search",
    onChange: (event) => runtime()?.setSearch?.(event.target.value),
  });
}

function ItemShell({ title, subtitle, icon, accessories, actions, children, image }) {
  const action = firstAction(actions);
  return React.createElement("div", {
    role: "button",
    tabIndex: 0,
    className: "qx-raycast-item",
    onClick: () => runAction(action),
    onKeyDown: (event) => {
      if (event.key === "Enter" || event.key === " ") runAction(action);
    },
  },
    image ? React.createElement("img", { className: "qx-raycast-thumb", src: typeof image === "string" ? image : image?.source || image }) : React.createElement("span", { className: "qx-raycast-icon" }, textOf(icon)),
    React.createElement("span", { className: "qx-raycast-item-main" },
      React.createElement("strong", null, textOf(title)),
      subtitle ? React.createElement("small", null, textOf(subtitle)) : null,
      children),
    accessories ? React.createElement("span", { className: "qx-raycast-accessory" }, textOf(Array.isArray(accessories) ? accessories[0] : accessories)) : null,
    actions);
}

export function List(props) {
  return React.createElement("div", { className: "qx-raycast-view" },
    React.createElement(SearchInput, { placeholder: props.searchBarPlaceholder }),
    props.isLoading ? React.createElement("div", { className: "qx-raycast-loading" }, "Loading...") : null,
    React.createElement("div", { className: "qx-raycast-list" }, props.children));
}
List.Item = function ListItem(props) {
  return React.createElement(ItemShell, props);
};
List.Section = function ListSection({ title, children }) {
  return React.createElement("section", { className: "qx-raycast-section" },
    title ? React.createElement("h2", null, title) : null,
    children);
};
List.EmptyView = function ListEmptyView(props) {
  return React.createElement("div", { className: "qx-raycast-empty" }, props.title || "No results");
};
List.Dropdown = function ListDropdown() { return null; };
List.Dropdown.Item = function ListDropdownItem() { return null; };

export function Grid(props) {
  return React.createElement("div", { className: "qx-raycast-view" },
    React.createElement(SearchInput, { placeholder: props.searchBarPlaceholder }),
    props.isLoading ? React.createElement("div", { className: "qx-raycast-loading" }, "Loading...") : null,
    React.createElement("div", { className: "qx-raycast-grid" }, props.children));
}
Grid.Item = function GridItem(props) {
  return React.createElement(ItemShell, { ...props, image: props.content });
};
Grid.Section = List.Section;
Grid.EmptyView = List.EmptyView;
Grid.Dropdown = List.Dropdown;
Grid.Dropdown.Item = List.Dropdown.Item;
Grid.Fit = { Fill: "fill", Contain: "contain" };

export function Detail(props) {
  return React.createElement("div", { className: "qx-raycast-detail" },
    React.createElement("div", { className: "qx-raycast-detail-content" },
      props.markdown ? React.createElement("pre", null, props.markdown) : props.children),
    props.actions || null);
}
`;
}

function nodeFetchShimModule() {
  return String.raw`
export class AbortError extends Error {}
export default async function fetch(url, options = {}) {
  return globalThis.__qxRaycastRuntime.context.http.fetch(String(url), options);
}
`;
}

function fileUrlShimModule() {
  return "export default function fileUrl(path) { return String(path || ''); }\n";
}

function osShimModule() {
  return "export function homedir() { return globalThis.__qxRaycastRuntime?.homeDirectory || '/qx-home'; }\nexport default { homedir };\n";
}

function pathShimModule() {
  return String.raw`
export function parse(input) {
  const value = String(input || "");
  const slash = value.lastIndexOf("/");
  const base = slash >= 0 ? value.slice(slash + 1) : value;
  const dot = base.lastIndexOf(".");
  return {
    root: value.startsWith("/") ? "/" : "",
    dir: slash >= 0 ? value.slice(0, slash) : "",
    base,
    ext: dot > 0 ? base.slice(dot) : "",
    name: dot > 0 ? base.slice(0, dot) : base,
  };
}
export function basename(input) { return parse(input).base; }
export function dirname(input) { return parse(input).dir || "."; }
export function join(...parts) { return parts.filter(Boolean).join("/").replace(/\/+/g, "/"); }
export default { parse, basename, dirname, join };
`;
}

function fsExtraShimModule() {
  return String.raw`
const mem = new Map();
const dirs = new Set(["/"]);
function runtime() {
  return globalThis.__qxRaycastRuntime;
}
function writes() {
  if (!globalThis.__qxRaycastPendingWrites) globalThis.__qxRaycastPendingWrites = new Map();
  return globalThis.__qxRaycastPendingWrites;
}
function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer);
  return new TextEncoder().encode(String(data ?? ""));
}
function toBase64(data) {
  const bytes = toUint8Array(data);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return btoa(binary);
}
function normalizePath(path) {
  return String(path || "").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}
function dirname(path) {
  const value = normalizePath(path);
  const slash = value.lastIndexOf("/");
  if (slash <= 0) return "/";
  return value.slice(0, slash);
}
function basename(path) {
  const value = normalizePath(path);
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}
function rememberDir(path) {
  let current = normalizePath(path);
  while (current && current !== "/") {
    dirs.add(current);
    current = dirname(current);
  }
  dirs.add("/");
}
function fromBase64(text) {
  const binary = atob(String(text || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
export function existsSync(path) {
  const value = normalizePath(path);
  return mem.has(value) || dirs.has(value);
}
export function pathExistsSync(path) {
  const value = normalizePath(path);
  if (existsSync(value)) return true;
  if (value.startsWith("/qx-plugin-files/")) return true;
  return [...mem.keys()].some((key) => key.startsWith(value + "/"));
}
export async function pathExists(path) {
  const value = normalizePath(path);
  if (pathExistsSync(value)) return true;
  try {
    const exists = await runtime()?.context?.qx?.invokeRust?.("plugin_file_exists", { path: value });
    if (exists) dirs.add(value);
    return !!exists;
  } catch {
    return false;
  }
}
export function readdirSync(dir) {
  const folder = normalizePath(dir);
  const names = new Set();
  for (const key of mem.keys()) {
    if (dirname(key) === folder) names.add(basename(key));
  }
  return [...names];
}
export async function emptydir(dir) {
  const prefix = normalizePath(dir);
  for (const key of [...mem.keys()]) if (key === prefix || key.startsWith(prefix + "/")) mem.delete(key);
  for (const key of [...dirs.keys()]) if (key !== prefix && key.startsWith(prefix + "/")) dirs.delete(key);
  dirs.add(prefix);
  await runtime()?.context?.qx?.invokeRust?.("plugin_file_empty_dir", { path: prefix });
}
export async function ensureDir(dir) {
  const target = normalizePath(dir);
  rememberDir(target);
  await runtime()?.context?.qx?.invokeRust?.("plugin_file_ensure_dir", { path: target });
}
export const mkdirp = ensureDir;
export function writeFile(path, data, callback) {
  const target = normalizePath(path);
  rememberDir(dirname(target));
  mem.set(target, data);
  const promise = runtime()?.context?.qx?.invokeRust?.("plugin_file_write_base64", {
    path: target,
    dataBase64: toBase64(data),
  }) || Promise.resolve();
  writes().set(target, promise);
  promise
    .then(() => {
      writes().delete(target);
      if (typeof callback === "function") callback(null);
    })
    .catch((error) => {
      writes().delete(target);
      if (typeof callback === "function") callback(error);
    });
}
export function writeFileSync(path, data) {
  writeFile(path, data);
}
export async function readFile(path, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  const target = normalizePath(path);
  const promise = mem.has(target)
    ? Promise.resolve(toUint8Array(mem.get(target)))
    : runtime()?.context?.qx?.invokeRust?.("plugin_file_read_base64", { path: target }).then(fromBase64);
  return promise.then((bytes) => {
    const encoding = typeof options === "string" ? options : options?.encoding;
    const value = encoding ? new TextDecoder().decode(bytes) : bytes;
    if (typeof callback === "function") callback(null, value);
    return value;
  }).catch((error) => {
    if (typeof callback === "function") callback(error);
    else throw error;
  });
}
export function readFileSync(path, options) {
  const target = normalizePath(path);
  if (!mem.has(target)) throw new Error("readFileSync only supports files touched in this runtime");
  const bytes = toUint8Array(mem.get(target));
  return options ? new TextDecoder().decode(bytes) : bytes;
}
export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
export async function writeJson(path, value, options) {
  const spaces = options?.spaces ?? 2;
  return writeFile(path, JSON.stringify(value, null, spaces));
}
export default { existsSync, pathExistsSync, pathExists, readdirSync, emptydir, ensureDir, mkdirp, writeFile, writeFileSync, readFile, readFileSync, readJson, writeJson };
`;
}

function runAppleScriptShimModule() {
  return String.raw`
export async function runAppleScript(script) {
  const pending = globalThis.__qxRaycastPendingWrites
    ? [...globalThis.__qxRaycastPendingWrites.values()]
    : [];
  if (pending.length) await Promise.allSettled(pending);
  return globalThis.__qxRaycastRuntime?.context?.qx?.invokeRust?.("plugin_run_applescript", { script: String(script || "") })
    .catch(() => "unsupported");
}
export default runAppleScript;
`;
}

function bufferShimModule() {
  return String.raw`
export const Buffer = {
  from(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer);
    return new TextEncoder().encode(String(value || ""));
  },
};
export default { Buffer };
`;
}

function raycastShimStyles() {
  const css = `
    html,body,#root{margin:0;width:100%;height:100%;background:transparent;color:var(--qx-text-primary,#111);font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
    .qx-raycast-view{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:10px;padding:14px;overflow:hidden;}
    .qx-raycast-search{height:34px;border:1px solid var(--qx-border-1,#ddd);border-radius:7px;background:var(--qx-bg-component-1,#fff);color:inherit;padding:0 10px;font:inherit;outline:none;}
    .qx-raycast-list{display:flex;flex-direction:column;gap:4px;overflow:auto;min-height:0;}
    .qx-raycast-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px;overflow:auto;min-height:0;}
    .qx-raycast-section{display:contents;}
    .qx-raycast-section h2{grid-column:1/-1;margin:10px 0 2px;color:var(--qx-text-tertiary,#777);font-size:11px;text-transform:uppercase;letter-spacing:.08em;}
    .qx-raycast-item{min-width:0;display:flex;align-items:center;gap:10px;border:0;border-radius:7px;background:transparent;color:inherit;text-align:left;padding:8px;cursor:pointer;font:inherit;}
    .qx-raycast-grid .qx-raycast-item{display:flex;flex-direction:column;align-items:stretch;padding:0;overflow:hidden;background:var(--qx-bg-component-1,#fff);border:1px solid var(--qx-border-1,#ddd);}
    .qx-raycast-item:hover{background:var(--qx-bg-component-2,#f5f5f5);}
    .qx-raycast-thumb{width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--qx-bg-component-2,#eee);}
    .qx-raycast-list .qx-raycast-thumb{width:52px;height:34px;border-radius:5px;flex:0 0 auto;}
    .qx-raycast-icon{width:22px;min-height:22px;display:inline-flex;align-items:center;justify-content:center;color:var(--qx-text-tertiary,#777);}
    .qx-raycast-item-main{min-width:0;display:flex;flex-direction:column;gap:2px;padding:6px;}
    .qx-raycast-item-main strong,.qx-raycast-item-main small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .qx-raycast-item-main small,.qx-raycast-accessory{color:var(--qx-text-secondary,#666);}
    .qx-raycast-loading,.qx-raycast-empty,.qx-raycast-detail{padding:18px;color:var(--qx-text-secondary,#666);overflow:auto;}
    .qx-raycast-detail{box-sizing:border-box;height:100%;}
    .qx-raycast-detail-content pre{margin:0;white-space:pre-wrap;font:inherit;color:var(--qx-text-primary,#111);}
    .qx-raycast-actions-inline{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex:0 1 min(42%,360px);margin-left:auto;min-width:0;max-width:min(42%,360px);overflow:hidden;padding:4px 6px 4px 0;}
    .qx-raycast-actions-inline.is-hidden{display:none;}
    .qx-raycast-action-button{border:1px solid var(--qx-border-1,#ddd);background:var(--qx-bg-component-1,#fff);color:inherit;border-radius:6px;padding:4px 7px;font:inherit;font-size:11px;cursor:pointer;}
    .qx-raycast-action-button{min-width:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .qx-raycast-action-button:hover{background:var(--qx-bg-component-2,#f5f5f5);}
    .qx-raycast-grid .qx-raycast-actions-inline{margin-left:0;max-width:100%;width:100%;justify-content:flex-start;padding:0 8px 8px;}
    .qx-raycast-detail > .qx-raycast-actions-inline{justify-content:flex-start;margin:12px 0 0;max-width:100%;padding:0;overflow:visible;}
    :root[data-qx-raycast-action-panel="hidden"] .qx-raycast-actions-inline{display:none;}
    @media (max-width: 680px){.qx-raycast-actions-inline{display:none;}}
  `;
  return String.raw`
function injectRaycastStyles() {
  if (document.getElementById("qx-raycast-shim-style")) return;
  const style = document.createElement("style");
  style.id = "qx-raycast-shim-style";
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);
}
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

async function genericRaycastIndexJs(sourceDir, pkg, manifest) {
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
  root.render(element || React.createElement("div", { className: "qx-raycast-empty" }, "No view"));
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

async function invokeCommand(name, container, context) {
  const mode = commandModes[name] || "view";
  const cache = new Map();
  globalThis.__qxRaycastRuntime = {
    context,
    preferences: await loadPreferences(context),
    activeCommand: name,
    cache,
    supportPath: "/qx-plugin-files/" + ${JSON.stringify(manifest.id)},
    assetsPath: "",
    homeDirectory: "/qx-home",
    render: (element) => renderElement(container, element),
    setSearch: () => {},
  };
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
    async run(context) {
      const mode = commandModes[command.name] || "view";
      const hidden = document.createElement("div");
      hidden.style.display = "none";
      document.body.appendChild(hidden);
      try {
        await invokeCommand(command.name, hidden, context);
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
      return invokeCommand(firstView.name, container, context);
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
