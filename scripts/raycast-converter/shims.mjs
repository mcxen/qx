export function raycastApiShimModule(defaultPreferences, defaultSupportPath) {
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

function markdownInline(value, keyPrefix = "i") {
  const text = String(value ?? "");
  const parts = [];
  const pattern = new RegExp("(\\*\\*([^*]+)\\*\\*|\\x60([^\\x60]+)\\x60|\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\))", "g");
  let index = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > index) parts.push(text.slice(index, match.index));
    if (match[2] !== undefined) {
      parts.push(React.createElement("strong", { key: keyPrefix + "-b-" + key++ }, match[2]));
    } else if (match[3] !== undefined) {
      parts.push(React.createElement("code", { key: keyPrefix + "-c-" + key++ }, match[3]));
    } else if (match[4] !== undefined && match[5] !== undefined) {
      parts.push(React.createElement("a", {
        key: keyPrefix + "-a-" + key++,
        href: match[5],
        target: "_blank",
        rel: "noreferrer",
      }, match[4]));
    }
    index = match.index + match[0].length;
  }
  if (index < text.length) parts.push(text.slice(index));
  return parts.length ? parts : text;
}

function isTableRow(line) {
  const trimmed = String(line || "").trim();
  return trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|");
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(String(line || ""));
}

function tableCells(line) {
  let value = String(line || "").trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split("|").map((cell) => cell.trim());
}

function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  const codeFence = String.fromCharCode(96, 96, 96);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith(codeFence)) {
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(codeFence)) code.push(lines[i++]);
      if (i < lines.length) i += 1;
      blocks.push(React.createElement("pre", { key: "md-" + blocks.length, className: "qx-raycast-md-code" },
        React.createElement("code", null, code.join("\n"))));
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      blocks.push(React.createElement("h" + level, { key: "md-" + blocks.length }, markdownInline(heading[2], "h" + i)));
      i += 1;
      continue;
    }

    if (isTableRow(line) && isTableSeparator(lines[i + 1])) {
      const header = tableCells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(tableCells(lines[i++]));
      blocks.push(React.createElement("table", { key: "md-" + blocks.length, className: "qx-raycast-md-table" },
        React.createElement("thead", null,
          React.createElement("tr", null, header.map((cell, cellIndex) =>
            React.createElement("th", { key: cellIndex }, markdownInline(cell, "th" + cellIndex))))),
        React.createElement("tbody", null, rows.map((row, rowIndex) =>
          React.createElement("tr", { key: rowIndex }, row.map((cell, cellIndex) =>
            React.createElement("td", { key: cellIndex }, markdownInline(cell, "td" + rowIndex + "-" + cellIndex))))))));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i += 1;
      }
      blocks.push(React.createElement("ul", { key: "md-" + blocks.length }, items.map((item, itemIndex) =>
        React.createElement("li", { key: itemIndex }, markdownInline(item, "li" + itemIndex)))));
      continue;
    }

    const paragraph = [line.trim()];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith(codeFence) &&
      !(isTableRow(lines[i]) && isTableSeparator(lines[i + 1])) &&
      !/^\s*[-*]\s+/.test(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push(React.createElement("p", { key: "md-" + blocks.length }, markdownInline(paragraph.join(" "), "p" + i)));
  }

  return React.createElement("div", { className: "qx-raycast-md" }, blocks);
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
      props.markdown ? renderMarkdown(props.markdown) : props.children),
    props.actions || null);
}
`;
}

export function nodeFetchShimModule() {
  return String.raw`
export class AbortError extends Error {}
export default async function fetch(url, options = {}) {
  const response = await globalThis.__qxRaycastRuntime.context.http.fetch(String(url), options);
  // Host may already provide arrayBuffer; ensure Raycast-style Response shape.
  if (response && typeof response.arrayBuffer !== "function") {
    const body = String(response.body || "");
    const bodyBase64 = response.bodyBase64 || response.body_base64 || "";
    const bytes = () => {
      if (bodyBase64) {
        const binary = atob(String(bodyBase64));
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
        return out;
      }
      return new TextEncoder().encode(body);
    };
    response.arrayBuffer = async () => {
      const value = bytes();
      return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    };
    if (typeof response.text !== "function") response.text = async () => body;
    if (typeof response.json !== "function") response.json = async () => JSON.parse(body);
  }
  return response;
}
`;
}

export function fileUrlShimModule() {
  return "export default function fileUrl(path) { return String(path || ''); }\n";
}

export function osShimModule() {
  return "export function homedir() { return globalThis.__qxRaycastRuntime?.homeDirectory || '/qx-home'; }\nexport default { homedir };\n";
}

export function pathShimModule() {
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

export function fsExtraShimModule() {
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

export function runAppleScriptShimModule() {
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

export function bufferShimModule() {
  return String.raw`
export const Buffer = {
  from(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    return new TextEncoder().encode(String(value || ""));
  },
};
if (typeof globalThis.Buffer === "undefined") globalThis.Buffer = Buffer;
export default { Buffer };
`;
}

export function raycastShimStyles() {
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
    .qx-raycast-md{color:var(--qx-text-primary,#111);line-height:1.45;max-width:100%;overflow:auto;}
    .qx-raycast-md h1,.qx-raycast-md h2,.qx-raycast-md h3{margin:0 0 10px;color:var(--qx-text-primary,#111);line-height:1.2;}
    .qx-raycast-md h1{font-size:22px;}.qx-raycast-md h2{font-size:18px;}.qx-raycast-md h3{font-size:15px;}
    .qx-raycast-md p{margin:0 0 10px;}.qx-raycast-md ul{margin:0 0 10px 18px;padding:0;}
    .qx-raycast-md code{font-family:ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,monospace;background:var(--qx-bg-component-2,#f5f5f5);border-radius:4px;padding:1px 4px;}
    .qx-raycast-md pre{margin:0 0 12px;white-space:pre-wrap;color:var(--qx-text-primary,#111);font:12px ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,monospace;background:var(--qx-bg-component-1,#fff);border:1px solid var(--qx-border-1,#ddd);border-radius:7px;padding:10px;overflow:auto;}
    .qx-raycast-md-table{border-collapse:collapse;width:max-content;max-width:100%;margin:0 0 12px;font-variant-numeric:tabular-nums;}
    .qx-raycast-md-table th,.qx-raycast-md-table td{border:1px solid var(--qx-border-1,#ddd);padding:5px 8px;text-align:center;white-space:nowrap;}
    .qx-raycast-md-table th{background:var(--qx-bg-component-2,#f5f5f5);font-weight:650;}
    .qx-raycast-md a{color:var(--qx-accent,#2563eb);text-decoration:none;}.qx-raycast-md a:hover{text-decoration:underline;}
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
