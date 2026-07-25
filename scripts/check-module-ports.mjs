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
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { pathToFileURL } from "node:url";
import { bundleNodeModule } from "./esbuild-port.mjs";

const root = process.cwd();
const failures = [];
const fail = (m) => failures.push(m);

// Git may check text out as CRLF on Windows. Structural contracts must consume
// one canonical source shape instead of making line-ending style observable.
const normalizeSourceText = (source) => source.replace(/\r\n?/g, "\n");
const read = (rel) => normalizeSourceText(fs.readFileSync(path.join(root, rel), "utf8"));
const exists = (rel) => fs.existsSync(path.join(root, rel));
function bundleProductionModule(entry, outfile) {
  const result = bundleNodeModule({ root, entry, outfile });
  if (!result.ok || !fs.existsSync(outfile)) {
    fail(`bundle ${entry} failed: ${result.error}`);
    return false;
  }
  return true;
}

function objectFunctionPaths(value, prefix = "") {
  const paths = [];
  for (const [key, child] of Object.entries(value || {})) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "function") paths.push(next);
    else if (child && typeof child === "object" && !Array.isArray(child)) {
      paths.push(...objectFunctionPaths(child, next));
    }
  }
  return paths.sort();
}

function runtimeContextFunctionPaths(source) {
  const start = source.indexOf("      const context = {");
  const endMarker = "\n      };\n\n      window.addEventListener";
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    fail("cannot locate iframe context object in src/plugin/runtime.ts");
    return [];
  }
  const snippet = source.slice(start, end + "\n      };".length);
  const tree = ts.createSourceFile(
    "iframe-context.js",
    snippet,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  let rootObject;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)
        && node.name.getText(tree) === "context"
        && node.initializer
        && ts.isObjectLiteralExpression(node.initializer)) {
      rootObject = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!rootObject) {
    fail("cannot parse iframe context object in src/plugin/runtime.ts");
    return [];
  }
  const paths = [];
  const collect = (object, prefix = "") => {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = property.name.getText(tree).replace(/^['"]|['"]$/g, "");
      const next = prefix ? `${prefix}.${key}` : key;
      if (ts.isObjectLiteralExpression(property.initializer)) {
        collect(property.initializer, next);
      } else if (
        ts.isArrowFunction(property.initializer)
        || ts.isFunctionExpression(property.initializer)
      ) {
        paths.push(next);
      }
    }
  };
  collect(rootObject);
  return paths.sort();
}

function literalRpcMethods(source) {
  return [...new Set(
    [...source.matchAll(/\brpc\s*\(\s*["']([A-Za-z][A-Za-z0-9]*)["']/g)]
      .map((match) => match[1]),
  )].sort();
}

function rpcHandlerMethods(source) {
  const start = source.indexOf("export const rpcHandlers");
  const end = source.indexOf("export async function handlePluginRpc", start);
  if (start < 0 || end < 0) {
    fail("cannot locate rpcHandlers in src/plugin/rpcMethods.ts");
    return [];
  }
  return [...new Set(
    [...source.slice(start, end).matchAll(
      /^\s{2}([A-Za-z][A-Za-z0-9]*):\s*async\b/gm,
    )].map((match) => match[1]),
  )].sort();
}

function marketplaceInvokeCommands(source) {
  const commands = [];
  for (const pattern of [
    // Canonical direct ports.
    /\bcontext\.(?:invoke|qx\.invokeRust)\s*\(\s*["']([^"']+)["']/g,
    // Maintained first-party plugins may wrap context.invoke to centralize
    // argument normalization: invoke(context, "command", args).
    /\binvoke\s*\(\s*[^,\n]+,\s*["']([^"']+)["']/g,
  ]) {
    for (const match of source.matchAll(pattern)) commands.push(match[1]);
  }
  return [...new Set(commands)].sort();
}

function pluginExportContract(source, fileName) {
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const declarations = new Map();
  let defaultExpression;
  for (const statement of tree.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.set(declaration.name.text, declaration.initializer);
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      defaultExpression = statement.expression;
    } else if (
      ts.isExportDeclaration(statement)
      && statement.exportClause
      && ts.isNamedExports(statement.exportClause)
    ) {
      const defaultExport = statement.exportClause.elements.find(
        (element) => element.name.text === "default",
      );
      if (defaultExport) {
        defaultExpression = defaultExport.propertyName || defaultExport.name;
      }
    }
  }
  const resolve = (expression) => {
    let current = expression;
    const seen = new Set();
    while (current && ts.isIdentifier(current) && declarations.has(current.text)) {
      if (seen.has(current.text)) return current;
      seen.add(current.text);
      current = declarations.get(current.text);
    }
    return current;
  };
  const propertyNamed = (object, name) =>
    object.properties.find((property) => {
      if (!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property)) return false;
      const key = property.name?.getText(tree).replace(/^['"]|['"]$/g, "");
      return key === name;
    });
  const defaultObject = resolve(defaultExpression);
  if (!defaultObject || !ts.isObjectLiteralExpression(defaultObject)) {
    return { commandNames: null, hasPanel: null };
  }
  const panelProperty = propertyNamed(defaultObject, "panel");
  const commandsProperty = propertyNamed(defaultObject, "commands");
  if (!commandsProperty || !ts.isPropertyAssignment(commandsProperty)) {
    return { commandNames: [], hasPanel: Boolean(panelProperty) };
  }
  let commandsExpression = resolve(commandsProperty.initializer);
  if (
    commandsExpression
    && ts.isCallExpression(commandsExpression)
    && ts.isPropertyAccessExpression(commandsExpression.expression)
    && commandsExpression.expression.name.text === "map"
  ) {
    commandsExpression = resolve(commandsExpression.expression.expression);
  }
  if (!commandsExpression || !ts.isArrayLiteralExpression(commandsExpression)) {
    return { commandNames: null, hasPanel: Boolean(panelProperty) };
  }
  const commandNames = commandsExpression.elements.flatMap((element) => {
    const command = resolve(element);
    if (!command || !ts.isObjectLiteralExpression(command)) return [];
    const nameProperty = propertyNamed(command, "name");
    if (
      !nameProperty
      || !ts.isPropertyAssignment(nameProperty)
      || !ts.isStringLiteralLike(nameProperty.initializer)
    ) {
      return [];
    }
    return [nameProperty.initializer.text];
  });
  return { commandNames: commandNames.sort(), hasPanel: Boolean(panelProperty) };
}

function readPluginInvokePolicy() {
  const source = read("src/plugin/rpcMethods.ts");
  const capabilityStart = source.indexOf("const COMMAND_CAPABILITIES");
  const dangerousStart = source.indexOf("const DANGEROUS_INVOKE_COMMANDS");
  const policyEnd = source.indexOf("function hasPermission", dangerousStart);
  if (capabilityStart < 0 || dangerousStart < 0 || policyEnd < 0) {
    fail("cannot locate plugin invoke permission policy");
    return { capabilities: new Map(), dangerous: new Set() };
  }
  const capabilities = new Map(
    [...source.slice(capabilityStart, dangerousStart).matchAll(
      /^\s{2}([A-Za-z_][A-Za-z0-9_:]*):\s*["']([^"']+)["']/gm,
    )].map((match) => [match[1], match[2]]),
  );
  const dangerous = new Set(
    [...source.slice(dangerousStart, policyEnd).matchAll(
      /^\s*["']([^"']+)["'],?$/gm,
    )].map((match) => match[1]),
  );
  return { capabilities, dangerous };
}

const pluginInvokePolicy = readPluginInvokePolicy();

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
  if (/\b(?:primaryAction|secondaryAction)\s*=/.test(src)) {
    fail(`${rel} must publish one actions[] set plus primaryActionId`);
  }
  if (src.includes("shell.secondaryAction") || src.includes("actionMenuShortcut")) {
    fail(`${rel} must not depend on legacy Actions-trigger sentinels`);
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
    "qxGridNavigation",
    "QxActionList",
    "context.storage.persist",
    "manifest.panel",
  ]) {
    if (!inv.includes(token)) fail(`inventory missing mention of ${token}`);
  }
}

const runtimeLines = read("src/plugin/runtime.ts").split(/\r?\n/).length;
if (runtimeLines > 1000) fail(`src/plugin/runtime.ts exceeds 1000 lines (${runtimeLines})`);
const cliWorkbench = read("src/plugin/cliWorkbench.ts");
if (!cliWorkbench.includes("createPluginSdkRuntime.toString()")) {
  fail("plugin iframe SDK must serialize the canonical createPluginSdkRuntime factory");
}
if (cliWorkbench.includes("function parseJsonLoose")) {
  fail("cliWorkbench must not keep a second inline SDK implementation");
}

const qxShell = read("src/components/QxShell.tsx");
for (const token of [
  "actions?: QxShellAction[]",
  "primaryActionId?: string",
  "validateQxShellActions",
]) {
  if (!qxShell.includes(token)) fail(`QxShell action protocol missing ${token}`);
}
if (qxShell.includes("secondaryAction?:")) {
  fail("QxShell must own the Actions trigger instead of accepting a sentinel action");
}
const launcherSource = read("src/Launcher.tsx");
if (/\b(?:primaryAction|secondaryAction)\s*=/.test(launcherSource)) {
  fail("Launcher must publish one actions[] set plus primaryActionId");
}
if (!qxShell.includes("topbarFilters?: QxShellTopbarFilter[]")) {
  fail("QxShell must own the typed Top Bar content-filter port");
}
if (!qxShell.includes('className="qx-shell-content-filter"')) {
  fail("QxShell must render Top Bar filters with the canonical host Select");
}
const pluginHostSource = read("src/plugin/PluginHost.tsx");
if (!pluginHostSource.includes("topbarFilters={topbarFilters}")) {
  fail("PluginHost must project Workbench tabs/filters through QxShell.topbarFilters");
}
const pluginRegistrySource = read("src/plugin/registry.ts");
if (!pluginRegistrySource.includes("resolveBackgroundNextRunAt")) {
  fail("plugin registry must use the shared background schedule resolver");
}
for (const legacyToken of [
  "qx-plugin-chrome-tabs",
  "qx-plugin-workbench-filter",
]) {
  if (pluginHostSource.includes(legacyToken)) {
    fail(`PluginHost must not self-render legacy Top Bar filter chrome: ${legacyToken}`);
  }
}
for (const rel of [
  "src/Launcher.tsx",
  "src/modules/clipboard/ClipboardPanel.tsx",
  "src/modules/documents/DevTxtTool.tsx",
  "src/modules/rss/ArticleList.tsx",
  "src/modules/screencap/ScreenRecorder.tsx",
  "src/modules/v2ex/V2exPanel.tsx",
]) {
  if (!read(rel).includes("topbarFilters={")) {
    fail(`${rel} must publish content filters through QxShell.topbarFilters`);
  }
}
if (!qxShell.includes("startResizeDragging")) {
  fail("QxShell must keep explicit Windows frameless-window resize handles");
}
if (!qxShell.includes('getQxDesktopPlatform() === "windows"')) {
  fail("WebView resize handles must not consume native macOS edge resizing");
}
if (qxShell.includes("qx-shell-drag-edge")) {
  fail("QxShell window edges must resize, not become drag regions");
}
for (const direction of [
  "North",
  "NorthEast",
  "East",
  "SouthEast",
  "South",
  "SouthWest",
  "West",
  "NorthWest",
]) {
  if (!qxShell.includes(`"${direction}"`)) {
    fail(`QxShell resize handles missing ${direction}`);
  }
}
const desktopCapability = JSON.parse(read("src-tauri/capabilities/default.json"));
if (!desktopCapability.permissions?.includes(
  "core:window:allow-start-resize-dragging",
)) {
  fail("Windows frameless resize handles require core:window:allow-start-resize-dragging");
}
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));
const mainWindowConfig = tauriConfig.app?.windows?.[0];
if (!mainWindowConfig || mainWindowConfig.resizable !== true) {
  fail("frameless resize handles require the main Tauri window to stay resizable");
}
if (mainWindowConfig.decorations !== false) {
  fail("QxShell resize handles are only valid for the frameless main window contract");
}

const pluginSystemPort = read("src-tauri/src/plugin_system.rs");
const pluginTypes = read("src/plugin/types.ts");
const pluginCliPort = read("src-tauri/src/plugin_cli.rs");
const pluginApiPort = read("src-tauri/src/plugin_api.rs");
const textToolboxPort = read("src-tauri/src/text_toolbox.rs");
const windowsProcessPort = read("src-tauri/src/windows_process.rs");
const tauriCompositionRoot = read("src-tauri/src/lib.rs");
for (const [token, description] of [
  ["path_list_sep", "Rust PATH-list separator"],
  ["dir_sep", "Rust directory separator"],
]) {
  if (!pluginSystemPort.includes(token)) fail(`plugin system env missing ${description}`);
}
for (const [token, description] of [
  ["pathListSep", "TypeScript PATH-list separator"],
  ["dirSep", "TypeScript directory separator"],
]) {
  if (!pluginTypes.includes(token)) fail(`PluginSystemEnv missing ${description}`);
}
if (pluginSystemPort.includes("cfg!(")) {
  fail("plugin system platform contract must use cfg-gated implementations, not cfg! runtime branches");
}
if (!windowsProcessPort.includes('var_os("SystemRoot")')
    || !windowsProcessPort.includes(String.raw`WindowsPowerShell\v1.0`)) {
  fail("Windows host adapters must resolve system PowerShell without depending on GUI PATH");
}
if (!tauriCompositionRoot.includes('mod windows_process;')) {
  fail("Windows inbox executable discovery must be registered as a root adapter");
}
for (const [source, name] of [
  [pluginCliPort, "plugin CLI"],
  [pluginApiPort, "plugin notifications"],
]) {
  if (!source.includes("crate::windows_process::powershell_binary()")) {
    fail(`Windows ${name} must use the shared PowerShell adapter`);
  }
}
for (const [source, name] of [
  [pluginSystemPort, "plugin system revealPath"],
  [textToolboxPort, "Text Toolbox workspace"],
]) {
  if (!source.includes("crate::windows_process::explorer_binary()")) {
    fail(`Windows ${name} must use the shared Explorer adapter`);
  }
}
for (const [source, name] of [
  [pluginCliPort, "plugin CLI"],
  [pluginApiPort, "plugin API"],
  [pluginSystemPort, "plugin system"],
  [textToolboxPort, "Text Toolbox"],
  [windowsProcessPort, "Windows process adapter"],
]) {
  if (/Command::new\(\s*"(?:powershell(?:\.exe)?|explorer(?:\.exe)?)"/i.test(source)) {
    fail(`${name} must not spawn bare PowerShell/Explorer executable names`);
  }
}
if (pluginCliPort.includes('PathBuf::from(r"C:\\Windows')) {
  fail("Windows plugin CLI must not assume the system drive or Windows directory");
}
if (!pluginCliPort.includes("winget install --id Git.Git -e")
    || !pluginCliPort.includes("gitforwindows.org")) {
  fail("Git Bash unavailable errors must include actionable Windows installation guidance");
}
for (const token of ["openSettings", "power: () =>", "PluginSystemSettingsSection"]) {
  if (!pluginTypes.includes(token)) fail(`Plugin system module missing typed API: ${token}`);
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
const externalMarketRoot = [
  path.join(root, "qx-plugins-clone/src"),
  path.join(root, "../qx-plugins-clone/src"),
  path.join(root, "../qx-plugins/src"),
].find((candidate) => fs.existsSync(candidate));
const marketRoots = [
  path.join(root, "public/plugins"),
  externalMarketRoot,
].filter((candidate) => candidate && fs.existsSync(candidate));
const marketPluginIds = new Map();

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
    if (!manifest.id || typeof manifest.id !== "string") {
      fail(`${name.name}: manifest.id must be a non-empty string`);
    } else if (marketPluginIds.has(manifest.id)) {
      fail(
        `${name.name}: duplicate plugin id ${manifest.id} also used by `
        + marketPluginIds.get(manifest.id),
      );
    } else {
      marketPluginIds.set(manifest.id, path.relative(root, manifestPath));
    }
    const platforms = manifest.platforms == null ? [] : manifest.platforms;
    if (!Array.isArray(platforms)
        || platforms.some((platform) => !["macos", "windows", "linux"].includes(platform))) {
      fail(`${name.name}: manifest.platforms contains an unsupported platform`);
    }
    if (new Set(platforms).size !== platforms.length) {
      fail(`${name.name}: manifest.platforms contains duplicates`);
    }
    if (
      manifest.min_app_version != null
      && !/^v?\d+(?:\.\d+)*(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
        .test(String(manifest.min_app_version))
    ) {
      fail(`${name.name}: min_app_version is not SemVer-like`);
    }
    const manifestCommands = Array.isArray(manifest.commands)
      ? manifest.commands.map((command) => String(command?.name || "")).filter(Boolean).sort()
      : [];
    if (new Set(manifestCommands).size !== manifestCommands.length) {
      fail(`${name.name}: manifest.commands contains duplicate names`);
    }
    const exportContract = pluginExportContract(indexJs, indexPath);
    if (exportContract.commandNames === null) {
      fail(`${name.name}: cannot statically resolve exported plugin commands`);
    } else {
      const missingFromExport = manifestCommands.filter(
        (command) => !exportContract.commandNames.includes(command),
      );
      const missingFromManifest = exportContract.commandNames.filter(
        (command) => !manifestCommands.includes(command),
      );
      if (missingFromExport.length || missingFromManifest.length) {
        fail(
          `${name.name}: command contract drift; export missing [${missingFromExport.join(", ")}], `
          + `manifest missing [${missingFromManifest.join(", ")}]`,
        );
      }
    }
    const permissions = new Set(manifest.permissions || []);
    const permissionForPort = [
      [/\bcontext\.cli\b/, "cli"],
      [/\bcontext\.http\b/, "http"],
      [/\bcontext\.system\b/, "system"],
      [/\bcontext\.tray\b/, "tray"],
      [/\bcontext\.clipboard\b/, "clipboard"],
      [/\bcontext\.island\b/, "island"],
      [/\bcontext\.notification\b/, "notifications"],
      [/\bcontext\.openUrl\b/, "open-url"],
    ];
    for (const [pattern, permission] of permissionForPort) {
      if (pattern.test(indexJs) && !permissions.has("*") && !permissions.has(permission)) {
        fail(`${name.name}: uses context port requiring missing permission ${permission}`);
      }
    }
    const invokeCommands = marketplaceInvokeCommands(indexJs);
    for (const command of invokeCommands) {
      const exact = permissions.has(command) || permissions.has(`invoke:${command}`);
      const capability = pluginInvokePolicy.capabilities.get(command);
      const capabilityAllowed = !pluginInvokePolicy.dangerous.has(command)
        && capability
        && permissions.has(capability);
      if (!permissions.has("*") && !exact && !capabilityAllowed) {
        const required = pluginInvokePolicy.dangerous.has(command) || !capability
          ? `invoke:${command}`
          : `${capability} or invoke:${command}`;
        fail(`${name.name}: literal invoke ${command} lacks permission ${required}`);
      }
    }
    const macOnlyCommands = invokeCommands.filter((command) =>
      command === "plugin_run_applescript"
      || command.startsWith("qx_external_displays_"));
    if (macOnlyCommands.length
        && (platforms.length !== 1 || platforms[0] !== "macos")) {
      fail(
        `${name.name}: macOS-only invoke(s) [${macOnlyCommands.join(", ")}] `
        + "require manifest.platforms [\"macos\"]",
      );
    }
    if (exportContract.hasPanel !== null && Boolean(manifest.panel) !== exportContract.hasPanel) {
      fail(
        `${name.name}: panel contract drift; manifest=${Boolean(manifest.panel)} `
        + `export=${exportContract.hasPanel}`,
      );
    }
  }
}

// --- Real unit test: shipped moduleEscapeHost via esbuild bundle ------------
const scratch =
  process.env.QX_PORT_CHECK_SCRATCH
  || path.join(root, "node_modules", ".cache", "qx-port-check");
fs.mkdirSync(scratch, { recursive: true });
const bundleOut = path.join(scratch, "moduleEscapeHost.mjs");
const bundleOk = bundleProductionModule("src/hooks/moduleEscapeHost.ts", bundleOut);

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

const actionProtocolOut = path.join(scratch, "actionProtocol.mjs");
if (bundleProductionModule("src/components/qx-shell/actionProtocol.ts", actionProtocolOut)) {
  try {
    const protocol = await import(pathToFileURL(actionProtocolOut).href + `?t=${Date.now()}`);
    const valid = protocol.validateQxShellActions([
      { id: "open", label: "Open" },
      { id: "more", label: "More", children: [{ id: "copy", label: "Copy" }] },
    ], "open");
    if (valid.length !== 0) fail(`valid action protocol rejected: ${valid.join("; ")}`);
    const invalid = protocol.validateQxShellActions([
      { id: "open", label: "Open" },
      { id: "open", label: "Duplicate", kbd: "Esc" },
    ], "missing");
    for (const token of ["duplicate action id", "Esc belongs", "is missing"]) {
      if (!invalid.some((issue) => issue.includes(token))) {
        fail(`action protocol validator did not report ${token}`);
      }
    }
  } catch (e) {
    fail(`action protocol runtime test: ${e}`);
  }
}

const backgroundScheduleOut = path.join(scratch, "backgroundActivity.mjs");
if (bundleProductionModule("src/plugin/backgroundActivity.ts", backgroundScheduleOut)) {
  try {
    const background = await import(
      pathToFileURL(backgroundScheduleOut).href + `?t=${Date.now()}`
    );
    const day = 86_400_000;
    const first = background.resolveBackgroundNextRunAt({
      now: 1_000_000,
      intervalMs: day,
      lastRunAt: null,
      nextRunAt: null,
    });
    if (first !== 1_000_000 + day) fail("first background schedule must wait one interval");
    const recovered = background.resolveBackgroundNextRunAt({
      now: 2 * day,
      intervalMs: day,
      lastRunAt: 0.5 * day,
      nextRunAt: 1.5 * day,
    });
    if (recovered !== 2 * day + 1000) {
      fail("overdue background schedule must recover promptly after resume");
    }
    const throttled = background.resolveBackgroundNextRunAt({
      now: day,
      intervalMs: day,
      lastRunAt: 0.75 * day,
      nextRunAt: day,
    });
    if (throttled !== 1.75 * day) {
      fail("background schedule must retain a full interval after the last run");
    }
  } catch (e) {
    fail(`background schedule runtime test: ${e}`);
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
  const pureOk = bundleProductionModule(pureModule, pureOut);
  if (pureOk) {
    const pures = await import(pathToFileURL(pureOut).href + `?t=${Date.now()}`);
    const loading = pures.buildModuleIsland({ title: "Wx", loading: true });
    if (!loading || loading.label !== "Wx") fail(`buildModuleIsland loading label: ${JSON.stringify(loading)}`);
    if (loading.detail !== "Loading…") fail(`buildModuleIsland loading detail: ${loading.detail}`);
    if (loading.activity !== "wave") fail("buildModuleIsland should use the canonical wave activity when loading without progress");
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

// Host and iframe must execute the same self-contained plugin SDK factory.
const sdkOut = path.join(scratch, "pluginSdkFactory.mjs");
if (bundleProductionModule("src/plugin/pluginSdkFactory.ts", sdkOut)) {
  try {
    const sdkModule = await import(pathToFileURL(sdkOut).href + `?t=${Date.now()}`);
    const hostSdk = sdkModule.createPluginSdkRuntime();
    const iframeSdk = Function(`return (${sdkModule.createPluginSdkRuntime.toString()})()`)();
    const noisyJson = "plugin log\n{\"ok\":true}";
    if (hostSdk.parseJsonLoose(noisyJson).ok !== true) fail("host SDK loose JSON parser");
    if (iframeSdk.parseJsonLoose(noisyJson).ok !== true) fail("serialized iframe SDK loose JSON parser");
    const mapped = await iframeSdk.mapWithConcurrency([1, 2, 3], async (value) => value * 2, 2);
    if (mapped.join(",") !== "2,4,6") fail("serialized iframe SDK concurrency mapper");
  } catch (e) {
    fail(`plugin SDK shared factory runtime test: ${e}`);
  }
}

// Workbench detail sub-surfaces remain bounded pure-data protocols.
const workbenchViewSource = read("src/plugin/PluginWorkbenchView.tsx");
const workbenchStyleSource = read("src/styles/lists-icons.css");
const overlayScrollbarSource = read("src/utils/overlayScrollbar.ts");
if (!workbenchViewSource.includes("data-qx-scrollbar-horizontal-lift")) {
  fail("Workbench filmstrip must opt into the raised overlay scrollbar");
}
const filmstripStyle = workbenchStyleSource.match(
  /\.qx-host-workbench-media-grid\.is-horizontal\s*\{([\s\S]*?)\n\}/,
)?.[1] || "";
if (/scrollbar-width\s*:\s*(?:auto|thin)/.test(filmstripStyle)) {
  fail("Workbench filmstrip must not restore native scrollbar chrome");
}
if (!overlayScrollbarSource.includes("dataset.qxScrollbarHorizontalLift")) {
  fail("overlay scrollbar must honor the Workbench filmstrip lift");
}
if (
  !workbenchViewSource.includes("changePreviewZoomByWheel(event.deltaY)")
  || !workbenchViewSource.includes('"--qx-image-zoom-size"')
  || workbenchViewSource.includes("if (!event.metaKey && !event.ctrlKey) return")
) {
  fail("Workbench image preview wheel zoom must work without modifier keys");
}
if (/calc\(\s*100%\s*\*\s*var\(--qx-image-zoom/.test(workbenchStyleSource)) {
  fail("Workbench image zoom must not use unsupported CSS percentage multiplication");
}
for (const contract of [
  ".qx-host-workbench-media-preview-nav:active",
  ".qx-host-workbench-media-preview-nav-zone:hover",
  ".qx-host-workbench-media-preview-scroll.is-portrait > img.is-zoomed",
  "width: var(--qx-image-zoom-size)",
  "height: var(--qx-image-zoom-size)",
  "right: 12px",
  "left: 12px",
]) {
  if (!workbenchStyleSource.includes(contract)) {
    fail(`Workbench image preview style contract missing: ${contract}`);
  }
}

const workbenchTypesOut = path.join(scratch, "workbenchTypes.mjs");
if (bundleProductionModule("src/plugin/workbenchTypes.ts", workbenchTypesOut)) {
  try {
    const workbench = await import(pathToFileURL(workbenchTypesOut).href + `?t=${Date.now()}`);
    const normalized = workbench.normalizePluginWorkbenchState({
      items: [{
        id: "topic-1",
        title: "Topic",
        detail: {
          images: [{ url: "https://example.com/1.jpg" }],
          imageLayout: "horizontal",
          replies: {
            total: 120,
            items: Array.from({ length: 105 }, (_, index) => ({
              id: `reply-${index + 1}`,
              floor: index + 7,
              author: `Author ${index + 1}`,
              createdAt: "2026-07-24",
              originalPoster: index === 0,
              body: `Reply ${index + 1}`,
            })),
          },
        },
      }],
    });
    const detail = normalized.items?.[0]?.detail;
    if (detail?.imageLayout !== "horizontal" || detail.images?.length !== 1) {
      fail("Workbench host filmstrip normalization");
    }
    if (detail?.replies?.items.length !== 100 || detail.replies.total !== 120) {
      fail("Workbench replies must preserve total and cap rendered items at 100");
    }
    if (detail?.replies?.items[0]?.floor !== 7 || !detail.replies.items[0]?.originalPoster) {
      fail("Workbench replies must preserve source floor and OP metadata");
    }
  } catch (e) {
    fail(`Workbench detail protocol runtime test: ${e}`);
  }
}

// Real/direct/unavailable and iframe contexts must stay substitutable. CLI and
// UI are omitted here because their shared serialized factory is tested above.
const contextOut = path.join(scratch, "pluginContext.mjs");
if (bundleProductionModule("src/plugin/context.ts", contextOut)) {
  try {
    const contextModule = await import(pathToFileURL(contextOut).href + `?t=${Date.now()}`);
    const directPaths = objectFunctionPaths(contextModule.createUnavailableContext("contract-test"))
      .filter((name) => !name.startsWith("cli.") && !name.startsWith("ui."));
    const runtimeSource = read("src/plugin/runtime.ts");
    const iframePaths = runtimeContextFunctionPaths(runtimeSource)
      .filter((name) => !name.startsWith("cli.") && !name.startsWith("ui."));
    const crlfIframePaths = runtimeContextFunctionPaths(
      normalizeSourceText(runtimeSource.replace(/\n/g, "\r\n")),
    )
      .filter((name) => !name.startsWith("cli.") && !name.startsWith("ui."));
    if (iframePaths.join("\n") !== crlfIframePaths.join("\n")) {
      fail("iframe context contract must be invariant across LF and CRLF checkouts");
    }
    const missingFromIframe = directPaths.filter((name) => !iframePaths.includes(name));
    const missingFromDirect = iframePaths.filter((name) => !directPaths.includes(name));
    if (missingFromIframe.length || missingFromDirect.length) {
      fail(
        `plugin context method drift: iframe missing [${missingFromIframe.join(", ")}], `
        + `direct missing [${missingFromDirect.join(", ")}]`,
      );
    }
  } catch (e) {
    fail(`plugin context substitutability test: ${e}`);
  }
}

// Context shape alone is insufficient: every implementation must dispatch the
// same literal RPC names, and every dispatched name needs a host handler.
const directRpcMethods = literalRpcMethods(read("src/plugin/context.ts"));
const iframeRpcMethods = literalRpcMethods(read("src/plugin/runtime.ts"));
const handlerRpcMethods = rpcHandlerMethods(read("src/plugin/rpcMethods.ts"));
for (const [leftName, left, rightName, right] of [
  ["direct context", directRpcMethods, "iframe context", iframeRpcMethods],
  ["direct context", directRpcMethods, "RPC handlers", handlerRpcMethods],
  ["iframe context", iframeRpcMethods, "RPC handlers", handlerRpcMethods],
]) {
  const missing = left.filter((method) => !right.includes(method));
  const extra = right.filter((method) => !left.includes(method));
  if (missing.length || extra.length) {
    fail(
      `plugin RPC drift: ${rightName} missing [${missing.join(", ")}], `
      + `${leftName} missing [${extra.join(", ")}]`,
    );
  }
}

// Tauri v2 maps Rust snake_case command parameters to camelCase invoke keys.
// Keep plugin identity host-injected so wallpaper plugins cannot omit or forge it.
const rpcMethodsSource = read("src/plugin/rpcMethods.ts");
const wallpaperHandler = rpcMethodsSource.match(
  /systemSetWallpaper:\s*async[\s\S]*?invoke\("plugin_system_set_wallpaper",\s*\{([\s\S]*?)\}\);/,
);
if (!wallpaperHandler) {
  fail("cannot locate plugin system wallpaper RPC handler");
} else {
  if (!/\bpluginId:\s*plugin\.id\b/.test(wallpaperHandler[1])) {
    fail("systemSetWallpaper must pass the host plugin identity as Tauri key pluginId");
  }
  if (/\bplugin_id\s*:/.test(wallpaperHandler[1])) {
    fail("systemSetWallpaper must not pass the Rust spelling plugin_id to Tauri invoke");
  }
}

// Generic invoke is an intentionally narrow port. Every command named by its
// capability policy must remain registered in the Tauri composition root.
const libSource = read("src-tauri/src/lib.rs");
const handlerStart = libSource.indexOf(".invoke_handler(tauri::generate_handler![");
const handlerEnd = libSource.indexOf("])", handlerStart);
const registeredCommands = handlerStart >= 0 && handlerEnd >= 0
  ? [...libSource.slice(handlerStart, handlerEnd).matchAll(
      /(?:^|\s|,)(?:[A-Za-z_][A-Za-z0-9_]*::)+([A-Za-z_][A-Za-z0-9_]*)\s*,/gm,
    )].map((match) => match[1])
  : [];
if (handlerStart < 0 || handlerEnd < 0) {
  fail("cannot locate Tauri generate_handler command registry");
} else {
  const missingRegistrations = [...new Set([
    ...pluginInvokePolicy.capabilities.keys(),
    ...pluginInvokePolicy.dangerous,
  ])]
    .map((command) => command.split("::").at(-1))
    .filter((command) => command && !registeredCommands.includes(command));
  if (missingRegistrations.length) {
    fail(
      `plugin invoke policy references unregistered Tauri command(s): `
      + missingRegistrations.sort().join(", "),
    );
  }
}

// Platform declarations and min_app_version are runtime execution boundaries.
const pluginPlatformOut = path.join(scratch, "pluginPlatform.mjs");
if (bundleProductionModule("src/plugin/platform.ts", pluginPlatformOut)) {
  try {
    const platform = await import(pathToFileURL(pluginPlatformOut).href + `?t=${Date.now()}`);
    const plugin = {
      id: "portable-test",
      enabled: true,
      manifest: {
        platforms: ["macos"],
        min_app_version: "0.5.40",
      },
    };
    if (!platform.pluginSupportsPlatform(plugin, "macos")) fail("macOS plugin platform match");
    if (platform.pluginSupportsPlatform(plugin, "windows")) fail("macOS plugin loaded on Windows");
    if (platform.pluginSupportsPlatform(plugin, null)) {
      fail("platform-declared plugin must fail closed when native platform is unavailable");
    }
    if (platform.parsePluginPlatform("win32") !== null) {
      fail("non-canonical native platform must not cross the plugin platform port");
    }
    if (platform.parsePluginPlatform("windows") !== "windows") {
      fail("canonical native plugin platform");
    }
    if (!platform.pluginSupportsAppVersion(plugin, "0.5.47")) fail("plugin min version match");
    if (platform.pluginSupportsAppVersion(plugin, "0.5.39")) fail("plugin loaded below min version");
    if (!platform.pluginSupportsAppVersion(plugin, "v0.5.40")) fail("v-prefixed app version");
    if (!platform.pluginSupportsAppVersion(plugin, "0.5.40+desktop.1")) {
      fail("semver build metadata app version");
    }
    if (platform.pluginSupportsAppVersion(plugin, "0.5.40-beta.1")) {
      fail("prerelease host must remain below the same stable minimum");
    }
    const prereleasePlugin = {
      ...plugin,
      manifest: { ...plugin.manifest, min_app_version: "0.5.40-beta.2" },
    };
    if (!platform.pluginSupportsAppVersion(prereleasePlugin, "0.5.40-beta.10")) {
      fail("numeric prerelease identifiers must compare numerically");
    }
    if (platform.pluginSupportsAppVersion(prereleasePlugin, "0.5.40-beta.1")) {
      fail("older prerelease host loaded a newer prerelease plugin");
    }
    if (!platform.pluginSupportsAppVersion(prereleasePlugin, "0.5.40")) {
      fail("stable host must satisfy the same-core prerelease minimum");
    }
    if (platform.pluginSupportsAppVersion(plugin, "")) {
      fail("plugin min version must fail closed when host version is unavailable");
    }
  } catch (e) {
    fail(`plugin platform runtime test: ${e}`);
  }
}

if (failures.length) {
  console.error("check-module-ports failures:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("check-module-ports: ok");
