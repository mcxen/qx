#!/usr/bin/env node
import { copyFile, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const INVOKE_PERMISSIONS = [
  "qx_system_information_check_system_info",
  "qx_system_information_check_storage",
  "qx_system_information_check_network",
  "qx_system_information_list_processes",
  "qx_system_information_kill_process",
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
  return path.basename(icon);
}

function buildManifest(pkg) {
  const id = pkg.name || "raycast-extension";
  const viewCommand = (pkg.commands || [])[0];
  const commands = [
    {
      name: viewCommand?.name || "index",
      title: viewCommand?.title || pkg.title || titleCase(id),
      description: viewCommand?.description || pkg.description || "",
      icon: normalizeIcon(pkg.icon),
      keywords: pkg.keywords || [],
    },
  ];

  for (const tool of pkg.tools || []) {
    commands.push({
      name: tool.name,
      title: tool.title || titleCase(tool.name),
      description: tool.description || "",
      icon: normalizeIcon(pkg.icon),
      keywords: [tool.name, ...(pkg.keywords || [])],
    });
  }

  return {
    id: `raycast-${id}`,
    name: pkg.title || titleCase(id),
    version: pkg.version || "1.0.0",
    description: pkg.description || "",
    author: pkg.author || "",
    icon: normalizeIcon(pkg.icon),
    keywords: pkg.keywords || [],
    permissions: INVOKE_PERMISSIONS,
    entry: "index.js",
    commands,
    panel: {
      title: pkg.title || titleCase(id),
      icon: normalizeIcon(pkg.icon),
      keywords: pkg.keywords || [],
    },
    raycast: {
      source: pkg.name || id,
      compatible: "converted",
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
    async render(container, context) {
      await renderSystemInformation(container, context);
    },
    destroy(container) {
      container.innerHTML = "";
    },
  },
};
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

async function copyAssetIfPresent(sourceDir, destDir, icon) {
  const iconName = normalizeIcon(icon);
  if (!iconName) return;
  const candidates = [
    path.join(sourceDir, "assets", iconName),
    path.join(sourceDir, iconName),
  ];
  const from = candidates.find((candidate) => existsSync(candidate));
  if (from) {
    await copyFile(from, path.join(destDir, iconName));
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
  const pluginDir = path.join(out, manifest.id);

  await rm(pluginDir, { recursive: true, force: true });
  await mkdir(pluginDir, { recursive: true });
  await writeFile(path.join(pluginDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(
    path.join(pluginDir, "index.js"),
    pkg.name === "system-information" ? systemInformationIndexJs() : fallbackIndexJs(pkg),
  );
  await copyAssetIfPresent(source, pluginDir, pkg.icon);
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
