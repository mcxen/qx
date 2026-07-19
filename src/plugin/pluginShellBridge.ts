import {
  normalizePluginWorkbenchState,
  type PluginWorkbenchEvent,
  type PluginWorkbenchPayload,
} from "./workbenchTypes";

export interface PanelRuntimeSession {
  iframe: HTMLIFrameElement;
  runtimeId: string;
  pluginId: string;
}

export const panelSessions = new WeakMap<HTMLElement, PanelRuntimeSession>();
const panelSessionsByPlugin = new Map<string, PanelRuntimeSession>();
const runtimeSources = new Map<string, Map<string, Window>>();

export function getPanelRuntimeSession(pluginId: string): PanelRuntimeSession | undefined {
  return panelSessionsByPlugin.get(pluginId);
}

export function setPanelRuntimeSession(session: PanelRuntimeSession): void {
  panelSessionsByPlugin.set(session.pluginId, session);
}

export function deletePanelRuntimeSession(pluginId: string, runtimeId: string): void {
  if (panelSessionsByPlugin.get(pluginId)?.runtimeId === runtimeId) {
    panelSessionsByPlugin.delete(pluginId);
  }
}

export function registerPluginRuntime(
  pluginId: string,
  runtimeId: string,
  iframe: HTMLIFrameElement,
): void {
  const source = iframe.contentWindow;
  if (!source) return;
  const runtimes = runtimeSources.get(pluginId) ?? new Map<string, Window>();
  runtimes.set(runtimeId, source);
  runtimeSources.set(pluginId, runtimes);
}

export function unregisterPluginRuntime(pluginId: string, runtimeId: string): void {
  const runtimes = runtimeSources.get(pluginId);
  if (!runtimes) return;
  runtimes.delete(runtimeId);
  if (runtimes.size === 0) runtimeSources.delete(pluginId);
}

export function isPluginRuntimeSource(
  pluginId: string,
  runtimeId: string,
  source: Window,
): boolean {
  return runtimeSources.get(pluginId)?.get(runtimeId) === source;
}

export function currentPluginTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function broadcastPluginTheme(): void {
  const theme = currentPluginTheme();
  for (const runtimes of runtimeSources.values()) {
    for (const source of runtimes.values()) {
      source.postMessage({ type: "qx:theme", theme }, "*");
    }
  }
}

/** Raycast / plugin selected-item actions published to QxShell. */
export type PluginItemActionDescriptor = {
  id: string;
  title: string;
  kbd?: string;
};

export type PluginItemActionsPayload = {
  pluginId: string;
  runtimeId: string;
  selectionTitle?: string;
  actions: PluginItemActionDescriptor[];
};

export type PluginChromeTab = {
  id: string;
  label: string;
  active?: boolean;
};

export type PluginChromePayload = {
  pluginId: string;
  runtimeId: string;
  query?: string;
  queryPlaceholder?: string;
  showSearch?: boolean;
  tabs?: PluginChromeTab[];
  showTabs?: boolean;
};

type ItemActionsListener = (payload: PluginItemActionsPayload) => void;
type ChromeListener = (payload: PluginChromePayload) => void;
type WorkbenchListener = (payload: PluginWorkbenchPayload) => void;

const itemActionsListeners = new Set<ItemActionsListener>();
const chromeListeners = new Set<ChromeListener>();
const workbenchListeners = new Set<WorkbenchListener>();

export function subscribePluginItemActions(listener: ItemActionsListener): () => void {
  ensurePluginShellBridge();
  itemActionsListeners.add(listener);
  return () => itemActionsListeners.delete(listener);
}

export function subscribePluginChrome(listener: ChromeListener): () => void {
  ensurePluginShellBridge();
  chromeListeners.add(listener);
  return () => chromeListeners.delete(listener);
}

export function subscribePluginWorkbench(listener: WorkbenchListener): () => void {
  ensurePluginShellBridge();
  workbenchListeners.add(listener);
  return () => workbenchListeners.delete(listener);
}

function postToPluginPanel(pluginId: string, message: Record<string, unknown>): void {
  const session = panelSessionsByPlugin.get(pluginId);
  if (!session?.iframe.contentWindow) return;
  session.iframe.contentWindow.postMessage({
    ...message,
    pluginId,
    runtimeId: session.runtimeId,
  }, "*");
}

export function runPluginItemAction(pluginId: string, actionId: string): void {
  postToPluginPanel(pluginId, { type: "qx:run-item-action", actionId });
}

export function postPluginChromeQuery(pluginId: string, query: string): void {
  postToPluginPanel(pluginId, { type: "qx:chrome:query", query: String(query ?? "") });
}

export function postPluginChromeTab(pluginId: string, tabId: string): void {
  postToPluginPanel(pluginId, { type: "qx:chrome:tab", tabId: String(tabId ?? "") });
}

export function postPluginChromeKey(pluginId: string, key: string): void {
  postToPluginPanel(pluginId, { type: "qx:chrome:key", key: String(key ?? "") });
}

export function postPluginWorkbenchEvent(pluginId: string, event: PluginWorkbenchEvent): void {
  postToPluginPanel(pluginId, { type: "qx:workbench:event", event });
}

export function isExpectedPluginMessageOrigin(event: MessageEvent): boolean {
  return event.origin === window.location.origin || event.origin === "null";
}

function isPanelRuntimeSource(
  pluginId: string,
  runtimeId: string,
  source: MessageEventSource | null,
): boolean {
  if (!source) return false;
  const session = panelSessionsByPlugin.get(pluginId);
  return Boolean(
    session
    && session.runtimeId === runtimeId
    && session.iframe.contentWindow === source
    && isPluginRuntimeSource(pluginId, runtimeId, source as Window),
  );
}

function publishSafely<T>(listeners: Set<(payload: T) => void>, payload: T): void {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // One consumer must not block the remaining host subscribers.
    }
  }
}

export function ensurePluginShellBridge(): void {
  const host = globalThis as typeof globalThis & { __qxPluginShellBridge?: boolean };
  if (host.__qxPluginShellBridge) return;
  host.__qxPluginShellBridge = true;
  const themeObserver = new MutationObserver(broadcastPluginTheme);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class"],
  });
  window.addEventListener("message", (event: MessageEvent) => {
    if (!isExpectedPluginMessageOrigin(event)) return;
    const data = event.data || {};
    const pluginId = String(data.pluginId || "");
    const runtimeId = String(data.runtimeId || "");

    if (data.type === "qx:plugin:workbench") {
      if (!pluginId || !runtimeId || !isPanelRuntimeSource(pluginId, runtimeId, event.source)) return;
      publishSafely(workbenchListeners, {
        pluginId,
        runtimeId,
        state: normalizePluginWorkbenchState(data.state),
      });
      return;
    }

    if (data.type === "qx:plugin:chrome") {
      if (!pluginId || !runtimeId || !isPanelRuntimeSource(pluginId, runtimeId, event.source)) return;
      const tabs = Array.isArray(data.tabs)
        ? data.tabs.slice(0, 16).map((raw: PluginChromeTab) => ({
            id: String(raw?.id || "").slice(0, 64),
            label: String(raw?.label || raw?.id || "").slice(0, 64),
            active: Boolean(raw?.active),
          })).filter((tab: PluginChromeTab) => Boolean(tab.id))
        : [];
      publishSafely(chromeListeners, {
        pluginId,
        runtimeId,
        query: data.query != null ? String(data.query).slice(0, 500) : "",
        queryPlaceholder: data.queryPlaceholder
          ? String(data.queryPlaceholder).slice(0, 120)
          : undefined,
        showSearch: data.showSearch !== false,
        tabs,
        showTabs: data.showTabs !== false && tabs.length > 0,
      });
      return;
    }

    if (data.type === "qx:plugin:open-preferences") {
      if (!pluginId || !runtimeId || !isPanelRuntimeSource(pluginId, runtimeId, event.source)) return;
      try {
        sessionStorage.setItem("qx.settings.pendingTab", "plugins");
        sessionStorage.setItem("qx.settings.focusPluginId", pluginId);
      } catch {
        // Settings still opens if storage is unavailable.
      }
      window.dispatchEvent(new CustomEvent("qx:navigate", { detail: "settings" }));
      return;
    }

    if (data.type !== "qx:plugin:item-actions") return;
    if (!pluginId || !runtimeId || !isPanelRuntimeSource(pluginId, runtimeId, event.source)) return;
    const actions = Array.isArray(data.actions)
      ? data.actions.slice(0, 64).map((raw: PluginItemActionDescriptor) => ({
          id: String(raw?.id || "").slice(0, 128),
          title: String(raw?.title || "Action").slice(0, 256),
          kbd: raw?.kbd ? String(raw.kbd).slice(0, 64) : undefined,
        })).filter((action: PluginItemActionDescriptor) => Boolean(action.id))
      : [];
    publishSafely(itemActionsListeners, {
      pluginId,
      runtimeId,
      selectionTitle: data.selectionTitle
        ? String(data.selectionTitle).slice(0, 256)
        : undefined,
      actions,
    });
  });
}
