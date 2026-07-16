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
  if (typeof value === "object") {
    if (value.title != null) return String(value.title);
    if (value.name != null) return String(value.name);
    if (value.text != null) return String(value.text);
    if (value.tooltip != null) return String(value.tooltip);
  }
  return "";
}

function mediaSource(value) {
  if (value == null || value === false) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    if (typeof value.source === "string") return value.source;
    if (value.source && typeof value.source === "object") {
      return value.source.light || value.source.dark || value.source.raw || "";
    }
    if (typeof value.fileIcon === "string") return value.fileIcon;
  }
  return "";
}

function expandNode(node, depth = 0) {
  if (!React.isValidElement(node) || depth > 10) return node;
  const type = node.type;
  if (typeof type !== "function") return node;
  if (type === Action || type === ActionPanel || type === ActionPanel.Section) return node;
  // Expand pure action/layout wrappers such as ActionsOnlineBingWallpaper.
  try {
    const rendered = type(node.props || {});
    return expandNode(rendered, depth + 1);
  } catch {
    return node;
  }
}

function isActionElement(node) {
  if (!React.isValidElement(node)) return false;
  if (node.type === Action) return true;
  // Action.OpenInBrowser / Action.Push etc. are function wrappers.
  if (typeof node.type === "function" && node.type !== ActionPanel && node.type !== ActionPanel.Section) {
    try {
      const rendered = expandNode(node);
      return React.isValidElement(rendered) && rendered.type === Action;
    } catch {
      return false;
    }
  }
  return false;
}

function normalizeActionElement(node) {
  if (!React.isValidElement(node)) return null;
  if (node.type === Action) return node;
  try {
    const rendered = expandNode(node);
    if (React.isValidElement(rendered) && rendered.type === Action) return rendered;
  } catch {}
  return null;
}

function collectActions(node, result = []) {
  if (node == null || node === false) return result;
  if (Array.isArray(node)) {
    for (const child of node) collectActions(child, result);
    return result;
  }
  if (!React.isValidElement(node)) return result;

  const expanded = expandNode(node);
  if (React.isValidElement(expanded) && expanded !== node) {
    return collectActions(expanded, result);
  }

  if (node.type === Action) {
    if (typeof node.props?.onAction === "function") result.push(node);
    return result;
  }

  if (typeof node.type === "function" && node.type !== ActionPanel && node.type !== ActionPanel.Section) {
    try {
      const rendered = node.type(node.props || {});
      collectActions(rendered, result);
      return result;
    } catch {
      // fall through to children
    }
  }

  const children = React.Children.toArray(node.props?.children);
  for (const child of children) collectActions(child, result);
  return result;
}

function firstAction(node) {
  return collectActions(node)[0] || null;
}

function actionTitle(action) {
  return textOf(action?.props?.title) || action?.props?.title || "Action";
}

function runAction(action) {
  const resolved = normalizeActionElement(action) || action;
  const handler = resolved?.props?.onAction;
  if (typeof handler === "function") {
    void Promise.resolve(handler()).catch((error) => {
      console.error("[qx-raycast] action failed", error);
      runtime()?.context?.showToast?.("Action failed: " + String(error?.message || error));
    });
  }
}

function shortcutMatches(event, shortcut) {
  if (!shortcut || !shortcut.key) return false;
  const key = String(shortcut.key).toLowerCase();
  const eventKey = String(event.key || "").toLowerCase();
  if (eventKey !== key && event.code?.toLowerCase() !== "key" + key) return false;
  const mods = new Set((shortcut.modifiers || []).map((m) => String(m).toLowerCase()));
  const wantMeta = mods.has("cmd") || mods.has("command") || mods.has("super") || mods.has("meta");
  const wantCtrl = mods.has("ctrl") || mods.has("control");
  const wantAlt = mods.has("alt") || mods.has("option");
  const wantShift = mods.has("shift");
  const isMac = /mac/i.test(String(navigator.platform || "") + String(navigator.userAgent || ""));
  if (wantMeta) {
    if (isMac ? !event.metaKey : !event.ctrlKey && !event.metaKey) return false;
  } else if (event.metaKey) return false;
  if (wantCtrl !== !!event.ctrlKey && !(wantMeta && !isMac && event.ctrlKey)) {
    if (wantCtrl !== !!event.ctrlKey) return false;
  }
  if (wantAlt !== !!event.altKey) return false;
  if (wantShift !== !!event.shiftKey) return false;
  return true;
}

function ensureKeyboardNav() {
  if (globalThis.__qxRaycastKeyNavInstalled) return;
  globalThis.__qxRaycastKeyNavInstalled = true;
  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const tag = String(target?.tagName || "").toLowerCase();
    const isEditable = tag === "input" || tag === "textarea" || target?.isContentEditable;
    const items = Array.from(document.querySelectorAll("[data-qx-raycast-item]"));
    if (!items.length) return;

    let selected = document.querySelector("[data-qx-raycast-item].is-selected");
    if (!selected) {
      selected = items[0];
      selected.classList.add("is-selected");
      selected.setAttribute("aria-selected", "true");
    }
    const index = Math.max(0, items.indexOf(selected));
    const selectAt = (nextIndex) => {
      const next = items[Math.max(0, Math.min(items.length - 1, nextIndex))];
      if (!next) return;
      items.forEach((el) => {
        el.classList.remove("is-selected");
        el.setAttribute("aria-selected", "false");
      });
      next.classList.add("is-selected");
      next.setAttribute("aria-selected", "true");
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest" });
      // Publish selected actions into a sticky footer if inline buttons are hidden.
      updateActionDock(next);
    };

    if (!isEditable && (event.key === "ArrowDown" || event.key === "ArrowRight")) {
      event.preventDefault();
      selectAt(index + 1);
      return;
    }
    if (!isEditable && (event.key === "ArrowUp" || event.key === "ArrowLeft")) {
      event.preventDefault();
      selectAt(index - 1);
      return;
    }
    if (!isEditable && event.key === "Home") {
      event.preventDefault();
      selectAt(0);
      return;
    }
    if (!isEditable && event.key === "End") {
      event.preventDefault();
      selectAt(items.length - 1);
      return;
    }
    if (!isEditable && event.key === "Enter") {
      event.preventDefault();
      const primaryId = selected.getAttribute("data-primary-action");
      if (primaryId && runtime()?.actionHandlers?.has(primaryId)) {
        runtime().actionHandlers.get(primaryId)();
      } else {
        selected.click();
      }
      return;
    }

    // Item-level Raycast shortcuts (Cmd+D download, Cmd+Y preview, etc.)
    const actionIds = String(selected.getAttribute("data-action-ids") || "").split(",").filter(Boolean);
    for (const id of actionIds) {
      const meta = runtime()?.actionMeta?.get(id);
      if (!meta?.shortcut) continue;
      if (shortcutMatches(event, meta.shortcut)) {
        event.preventDefault();
        event.stopPropagation();
        runtime()?.actionHandlers?.get(id)?.();
        return;
      }
    }
  }, true);
}

function updateActionDock(itemEl) {
  let dock = document.getElementById("qx-raycast-action-dock");
  if (!dock) {
    dock = document.createElement("div");
    dock.id = "qx-raycast-action-dock";
    dock.className = "qx-raycast-action-dock";
    document.body.appendChild(dock);
  }
  const ids = String(itemEl?.getAttribute("data-action-ids") || "").split(",").filter(Boolean);
  dock.innerHTML = "";
  if (!ids.length) {
    dock.classList.add("is-empty");
    return;
  }
  dock.classList.remove("is-empty");
  for (const id of ids) {
    const meta = runtime()?.actionMeta?.get(id);
    if (!meta) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "qx-raycast-action-button";
    btn.textContent = meta.title || "Action";
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runtime()?.actionHandlers?.get(id)?.();
    });
    dock.appendChild(btn);
  }
}

function registerActionHandlers(actions) {
  const rt = runtime();
  if (!rt) return [];
  if (!rt.actionHandlers) rt.actionHandlers = new Map();
  if (!rt.actionMeta) rt.actionMeta = new Map();
  const ids = [];
  for (const action of actions) {
    const resolved = normalizeActionElement(action) || action;
    if (!resolved || typeof resolved.props?.onAction !== "function") continue;
    const id = "act-" + Math.random().toString(36).slice(2, 10);
    const title = actionTitle(resolved);
    const shortcut = resolved.props.shortcut || null;
    const handler = () => runAction(resolved);
    rt.actionHandlers.set(id, handler);
    rt.actionMeta.set(id, { title, shortcut });
    ids.push(id);
  }
  return ids;
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
  ChevronDown: "↓",
  ChevronUp: "↑",
  ChevronLeft: "←",
  ChevronRight: "→",
  Finder: "finder",
  Repeat: "repeat",
  MagnifyingGlass: "search",
  Globe: "globe",
  ArrowClockwise: "refresh",
  Sidebar: "sidebar",
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
  const message = options?.message ? "\\n" + options.message : "";
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
    // Background interval jobs must report Background so extensions like Bing
    // can suppress HUDs and honor canRefresh() style throttles.
    const value = runtime()?.launchType || globalThis.__qxRaycastLaunchType;
    if (value === LaunchType.Background || value === "background") return LaunchType.Background;
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
    this.capacity = options.capacity;
  }
  storageKey(key) {
    const plugin = runtime()?.supportPath || defaultEnvironmentSupportPath || "qx";
    return "qx:raycast-cache:" + plugin + ":" + this.namespace + ":" + key;
  }
  key(key) {
    return "raycast-cache:" + this.namespace + ":" + key;
  }
  get(key) {
    const memKey = this.key(key);
    const mem = runtime()?.cache?.get(memKey);
    if (mem != null) return mem;
    // Persist across command invocations — Raycast Cache is process-durable.
    // Bing auto-random uses this for lastRefresh throttling.
    try {
      const raw = globalThis.localStorage?.getItem(this.storageKey(key));
      if (raw == null) return undefined;
      runtime()?.cache?.set(memKey, raw);
      return raw;
    } catch {
      return undefined;
    }
  }
  set(key, value) {
    const memKey = this.key(key);
    const text = value == null ? "" : String(value);
    runtime()?.cache?.set(memKey, text);
    try {
      globalThis.localStorage?.setItem(this.storageKey(key), text);
    } catch {
      // private mode
    }
  }
  remove(key) {
    const memKey = this.key(key);
    runtime()?.cache?.delete(memKey);
    try {
      globalThis.localStorage?.removeItem(this.storageKey(key));
    } catch {
      // ignore
    }
  }
  clear() {
    // Only clear this namespace's mem keys; leave durable keys for other runs.
    const prefix = "raycast-cache:" + this.namespace + ":";
    const cache = runtime()?.cache;
    if (cache && typeof cache.keys === "function") {
      for (const k of [...cache.keys()]) {
        if (String(k).startsWith(prefix)) cache.delete(k);
      }
    }
  }
}

export const Clipboard = {
  readText: () => runtime()?.context?.clipboard?.read?.(),
  copy: (value) => runtime()?.context?.clipboard?.write?.(String(value || "")),
};

export function useNavigation() {
  return {
    push(element) {
      const rt = runtime();
      if (!rt) return;
      if (!rt.navStack) rt.navStack = [];
      // Keep current root so pop can restore the list/grid.
      if (rt.currentElement) rt.navStack.push(rt.currentElement);
      rt.currentElement = element;
      rt.render?.(element);
    },
    pop() {
      const rt = runtime();
      if (!rt?.navStack?.length) return;
      const previous = rt.navStack.pop();
      rt.currentElement = previous;
      rt.render?.(previous);
    },
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
    title: props.title || "Action",
    onClick: (event) => {
      event?.stopPropagation?.();
      if (typeof props.onAction === "function") {
        void Promise.resolve(props.onAction()).catch((error) => {
          console.error("[qx-raycast] action failed", error);
          runtime()?.context?.showToast?.("Action failed: " + String(error?.message || error));
        });
      }
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
  return React.createElement(Action, {
    ...props,
    onAction: () => useNavigation().push(props.target),
    title: props.title || "Open",
  });
};

function SearchInput({ placeholder, value, onChange }) {
  return React.createElement("input", {
    className: "qx-raycast-search",
    placeholder: placeholder || "Search",
    value: value,
    onChange: (event) => {
      const next = event.target.value;
      onChange?.(next);
      runtime()?.setSearch?.(next);
    },
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

function LocalImage({ src, className, alt }) {
  const [resolved, setResolved] = React.useState(() => {
    const value = String(src || "");
    if (!value) return "";
    if (/^(https?:|data:|blob:|asset:)/i.test(value)) return value;
    return "";
  });
  React.useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    const value = String(src || "");
    if (!value) {
      setResolved("");
      return undefined;
    }
    if (/^(https?:|data:|blob:|asset:)/i.test(value)) {
      setResolved(value);
      return undefined;
    }
    // Prefer in-memory bytes written this session.
    const mem = globalThis.__qxRaycastFsMem;
    const key = value.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    if (mem?.has?.(key)) {
      try {
        const data = mem.get(key);
        const bytes = data instanceof Uint8Array ? data
          : data instanceof ArrayBuffer ? new Uint8Array(data)
          : new TextEncoder().encode(String(data ?? ""));
        objectUrl = URL.createObjectURL(new Blob([bytes]));
        setResolved(objectUrl);
        return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
      } catch {}
    }
    (async () => {
      try {
        const b64 = await runtime()?.context?.qx?.invokeRust?.("plugin_file_read_base64", { path: value });
        if (cancelled || !b64) return;
        const binary = atob(String(b64));
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
        objectUrl = URL.createObjectURL(new Blob([out]));
        if (!cancelled) setResolved(objectUrl);
      } catch {
        if (!cancelled) setResolved("");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);
  if (!resolved) return React.createElement("div", { className: className || "qx-raycast-thumb", "aria-hidden": true });
  return React.createElement("img", { className, src: resolved, alt: alt || "" });
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
    // Inline HTML images used by Bing Wallpaper preview / list detail.
    const htmlImg = trimmed.match(/^<img\s+[^>]*src=["']([^"']+)["'][^>]*\/?\s*>$/i);
    if (htmlImg) {
      blocks.push(React.createElement(LocalImage, {
        key: "md-" + blocks.length,
        className: "qx-raycast-md-image",
        src: htmlImg[1],
        alt: "",
      }));
      i += 1;
      continue;
    }

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

    const mdImage = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (mdImage) {
      blocks.push(React.createElement(LocalImage, {
        key: "md-" + blocks.length,
        className: "qx-raycast-md-image",
        src: mdImage[2],
        alt: mdImage[1] || "",
      }));
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

function ItemShell({ title, subtitle, icon, accessories, actions, children, image, id }) {
  ensureKeyboardNav();
  const itemId = String(id || title || Math.random());
  const actionList = React.useMemo(() => collectActions(actions), [actions]);
  const primary = actionList[0] || null;
  const actionIds = React.useMemo(() => registerActionHandlers(actionList), [actionList]);

  const imageSrc = mediaSource(image);
  const iconSrc = mediaSource(icon);

  return React.createElement("div", {
    role: "option",
    tabIndex: 0,
    "data-qx-raycast-item": itemId,
    "data-primary-action": actionIds[0] || "",
    "data-action-ids": actionIds.join(","),
    "aria-selected": "false",
    className: "qx-raycast-item",
    onClick: (event) => {
      // Selecting the card should run the primary action (Set Wallpaper).
      // Nested action buttons stop propagation themselves.
      if (event.target?.closest?.(".qx-raycast-action-button")) return;
      document.querySelectorAll("[data-qx-raycast-item].is-selected").forEach((el) => {
        el.classList.remove("is-selected");
        el.setAttribute("aria-selected", "false");
      });
      event.currentTarget.classList.add("is-selected");
      event.currentTarget.setAttribute("aria-selected", "true");
      updateActionDock(event.currentTarget);
      runAction(primary);
    },
    onFocus: (event) => {
      document.querySelectorAll("[data-qx-raycast-item].is-selected").forEach((el) => {
        el.classList.remove("is-selected");
        el.setAttribute("aria-selected", "false");
      });
      event.currentTarget.classList.add("is-selected");
      event.currentTarget.setAttribute("aria-selected", "true");
      updateActionDock(event.currentTarget);
    },
    onKeyDown: (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runAction(primary);
      }
    },
  },
    imageSrc
      ? React.createElement(LocalImage, { className: "qx-raycast-thumb", src: imageSrc, alt: textOf(title) })
      : iconSrc
        ? React.createElement(LocalImage, { className: "qx-raycast-thumb qx-raycast-thumb-icon", src: iconSrc, alt: "" })
        : React.createElement("span", { className: "qx-raycast-icon" }, textOf(icon) || "🖼"),
    React.createElement("span", { className: "qx-raycast-item-main" },
      React.createElement("strong", null, textOf(title)),
      subtitle ? React.createElement("small", null, textOf(subtitle)) : null,
      children),
    accessories ? React.createElement("span", { className: "qx-raycast-accessory" }, textOf(Array.isArray(accessories) ? accessories[0] : accessories)) : null,
    // Always keep a compact action strip for the card so Download/Preview work
    // even when the global ActionPanel preference hides inline rows.
    actionList.length
      ? React.createElement("div", {
          className: "qx-raycast-item-actions",
          onClick: (event) => event.stopPropagation(),
        }, actionList.slice(0, 4).map((action, index) => {
          const resolved = normalizeActionElement(action) || action;
          return React.createElement("button", {
            key: actionIds[index] || index,
            type: "button",
            className: "qx-raycast-action-button",
            onClick: (event) => {
              event.stopPropagation();
              runAction(resolved);
            },
          }, actionTitle(resolved));
        }))
      : null,
    // Keep original ActionPanel tree for compatibility, but hide visually if we
    // already rendered item actions.
    actionList.length ? null : actions);
}

function collectSearchText(node, parts = []) {
  if (node == null || node === false) return parts;
  if (typeof node === "string" || typeof node === "number") {
    parts.push(String(node));
    return parts;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectSearchText(child, parts);
    return parts;
  }
  if (!React.isValidElement(node)) return parts;
  const props = node.props || {};
  if (props.title) parts.push(textOf(props.title));
  if (props.subtitle) parts.push(textOf(props.subtitle));
  if (props.children) collectSearchText(props.children, parts);
  return parts;
}

function filterChildrenBySearch(children, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return children;
  return React.Children.toArray(children).filter((child) => {
    if (!React.isValidElement(child)) return true;
    // Keep sections if any child matches.
    if (child.type === List.Section || child.type === Grid.Section) {
      const filtered = filterChildrenBySearch(child.props.children, q);
      return React.Children.count(filtered) > 0;
    }
    const hay = collectSearchText(child).join(" ").toLowerCase();
    return hay.includes(q);
  }).map((child) => {
    if (!React.isValidElement(child)) return child;
    if (child.type === List.Section || child.type === Grid.Section) {
      return React.cloneElement(child, {
        children: filterChildrenBySearch(child.props.children, q),
      });
    }
    return child;
  });
}

export function List(props) {
  const [query, setQuery] = React.useState("");
  React.useEffect(() => { ensureKeyboardNav(); }, []);
  const children = filterChildrenBySearch(props.children, props.onSearchTextChange ? "" : query);
  return React.createElement("div", { className: "qx-raycast-view" },
    React.createElement(SearchInput, {
      placeholder: props.searchBarPlaceholder,
      onChange: (value) => {
        setQuery(value);
        props.onSearchTextChange?.(value);
      },
    }),
    props.isLoading ? React.createElement("div", { className: "qx-raycast-loading" }, "Loading...") : null,
    React.createElement("div", { className: "qx-raycast-list", role: "listbox" }, children));
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
List.Item.Detail = function ListItemDetail(props) {
  if (props.markdown) return React.createElement("div", { className: "qx-raycast-item-detail" }, renderMarkdown(props.markdown));
  return React.createElement("div", { className: "qx-raycast-item-detail" }, props.children || null);
};

export function Grid(props) {
  const [query, setQuery] = React.useState("");
  React.useEffect(() => { ensureKeyboardNav(); }, []);
  const columns = Number(props.columns) > 0 ? Number(props.columns) : undefined;
  const children = filterChildrenBySearch(props.children, props.onSearchTextChange ? "" : query);
  return React.createElement("div", { className: "qx-raycast-view" },
    React.createElement(SearchInput, {
      placeholder: props.searchBarPlaceholder,
      onChange: (value) => {
        setQuery(value);
        props.onSearchTextChange?.(value);
      },
    }),
    props.isLoading ? React.createElement("div", { className: "qx-raycast-loading" }, "Loading...") : null,
    React.createElement("div", {
      className: "qx-raycast-grid",
      role: "listbox",
      style: columns ? { gridTemplateColumns: "repeat(" + columns + ", minmax(0, 1fr))" } : undefined,
    }, children));
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
  React.useEffect(() => {
    // Detail views (preview) should expose their actions in the dock.
    const actions = collectActions(props.actions);
    const ids = registerActionHandlers(actions);
    const fake = document.createElement("div");
    fake.setAttribute("data-action-ids", ids.join(","));
    updateActionDock(fake);
  }, [props.actions]);
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
  // Keep the raw path so LocalImage / markdown can resolve via fs bridge.
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
const dirListCache = new Map();
globalThis.__qxRaycastFsMem = mem;
globalThis.__qxRaycastFsDirs = dirs;
globalThis.__qxRaycastFsDirList = dirListCache;
globalThis.__qxRaycastFsHydrate = function hydrateDir(dir, names) {
  const folder = String(dir || "").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  dirs.add(folder);
  let current = folder;
  while (current && current !== "/") {
    const slash = current.lastIndexOf("/");
    current = slash <= 0 ? "/" : current.slice(0, slash);
    dirs.add(current);
  }
  if (Array.isArray(names)) dirListCache.set(folder, names.map(String));
};
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
  if (dirListCache.has(value)) return true;
  if (value.startsWith("/qx-plugin-files/")) return true;
  // Common user folders mapped through /qx-home are treated as present after hydrate.
  if (value === "/qx-home" || value.startsWith("/qx-home/")) return true;
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
  if (dirListCache.has(folder)) {
    for (const name of dirListCache.get(folder)) names.add(name);
  }
  for (const key of mem.keys()) {
    if (dirname(key) === folder) names.add(basename(key));
  }
  // Kick async refresh for subsequent calls / remounts.
  void runtime()?.context?.qx?.invokeRust?.("plugin_file_list", { path: folder }).then((list) => {
    if (Array.isArray(list) && typeof globalThis.__qxRaycastFsHydrate === "function") {
      globalThis.__qxRaycastFsHydrate(folder, list);
    }
  }).catch(() => {});
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
    .qx-raycast-view{padding-bottom:52px;}
    .qx-raycast-item{min-width:0;display:flex;align-items:center;gap:10px;border:0;border-radius:7px;background:transparent;color:inherit;text-align:left;padding:8px;cursor:pointer;font:inherit;outline:none;}
    .qx-raycast-grid .qx-raycast-item{display:flex;flex-direction:column;align-items:stretch;padding:0;overflow:hidden;background:var(--qx-bg-component-1,#fff);border:1px solid var(--qx-border-1,#ddd);}
    .qx-raycast-item:hover{background:var(--qx-bg-component-2,#f5f5f5);}
    .qx-raycast-item.is-selected,.qx-raycast-item:focus{background:var(--qx-bg-component-2,#f0f4ff);box-shadow:inset 0 0 0 1px var(--qx-accent,#2563eb);}
    .qx-raycast-grid .qx-raycast-item.is-selected,.qx-raycast-grid .qx-raycast-item:focus{box-shadow:0 0 0 2px var(--qx-accent,#2563eb);}
    .qx-raycast-thumb{width:100%;aspect-ratio:16/9;object-fit:cover;background:var(--qx-bg-component-2,#eee);display:block;}
    .qx-raycast-list .qx-raycast-thumb,.qx-raycast-thumb-icon{width:52px;height:34px;border-radius:5px;flex:0 0 auto;}
    .qx-raycast-icon{width:22px;min-height:22px;display:inline-flex;align-items:center;justify-content:center;color:var(--qx-text-tertiary,#777);}
    .qx-raycast-item-main{min-width:0;display:flex;flex-direction:column;gap:2px;padding:6px;}
    .qx-raycast-item-main strong,.qx-raycast-item-main small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .qx-raycast-item-main small,.qx-raycast-accessory{color:var(--qx-text-secondary,#666);}
    .qx-raycast-item-actions{display:flex;flex-wrap:wrap;gap:4px;padding:0 8px 8px;width:100%;box-sizing:border-box;}
    .qx-raycast-list .qx-raycast-item-actions{width:auto;flex:0 0 auto;padding:0;margin-left:auto;}
    .qx-raycast-loading,.qx-raycast-empty,.qx-raycast-detail{padding:18px;color:var(--qx-text-secondary,#666);overflow:auto;}
    .qx-raycast-detail{box-sizing:border-box;height:100%;padding-bottom:60px;}
    .qx-raycast-md{color:var(--qx-text-primary,#111);line-height:1.45;max-width:100%;overflow:auto;}
    .qx-raycast-md h1,.qx-raycast-md h2,.qx-raycast-md h3{margin:0 0 10px;color:var(--qx-text-primary,#111);line-height:1.2;}
    .qx-raycast-md h1{font-size:22px;}.qx-raycast-md h2{font-size:18px;}.qx-raycast-md h3{font-size:15px;}
    .qx-raycast-md p{margin:0 0 10px;}.qx-raycast-md ul{margin:0 0 10px 18px;padding:0;}
    .qx-raycast-md-image{display:block;width:100%;max-height:420px;object-fit:contain;border-radius:8px;background:var(--qx-bg-component-2,#eee);margin:0 0 12px;}
    .qx-raycast-md code{font-family:ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,monospace;background:var(--qx-bg-component-2,#f5f5f5);border-radius:4px;padding:1px 4px;}
    .qx-raycast-md pre{margin:0 0 12px;white-space:pre-wrap;color:var(--qx-text-primary,#111);font:12px ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,monospace;background:var(--qx-bg-component-1,#fff);border:1px solid var(--qx-border-1,#ddd);border-radius:7px;padding:10px;overflow:auto;}
    .qx-raycast-md-table{border-collapse:collapse;width:max-content;max-width:100%;margin:0 0 12px;font-variant-numeric:tabular-nums;}
    .qx-raycast-md-table th,.qx-raycast-md-table td{border:1px solid var(--qx-border-1,#ddd);padding:5px 8px;text-align:center;white-space:nowrap;}
    .qx-raycast-md-table th{background:var(--qx-bg-component-2,#f5f5f5);font-weight:650;}
    .qx-raycast-md a{color:var(--qx-accent,#2563eb);text-decoration:none;}.qx-raycast-md a:hover{text-decoration:underline;}
    .qx-raycast-actions-inline{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex:0 1 min(42%,360px);margin-left:auto;min-width:0;max-width:min(42%,360px);overflow:hidden;padding:4px 6px 4px 0;}
    .qx-raycast-actions-inline.is-hidden{display:none;}
    .qx-raycast-action-button{border:1px solid var(--qx-border-1,#ddd);background:var(--qx-bg-component-1,#fff);color:inherit;border-radius:6px;padding:4px 7px;font:inherit;font-size:11px;cursor:pointer;min-width:0;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .qx-raycast-action-button:hover{background:var(--qx-bg-component-2,#f5f5f5);}
    .qx-raycast-grid .qx-raycast-actions-inline{margin-left:0;max-width:100%;width:100%;justify-content:flex-start;padding:0 8px 8px;}
    .qx-raycast-detail > .qx-raycast-actions-inline{justify-content:flex-start;margin:12px 0 0;max-width:100%;padding:0;overflow:visible;}
    .qx-raycast-action-dock{position:fixed;left:0;right:0;bottom:0;z-index:20;display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;background:var(--qx-bg-component-1,rgba(255,255,255,.92));border-top:1px solid var(--qx-border-1,#ddd);backdrop-filter:blur(10px);}
    .qx-raycast-action-dock.is-empty{display:none;}
    :root[data-qx-raycast-action-panel="hidden"] .qx-raycast-actions-inline{display:none;}
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
