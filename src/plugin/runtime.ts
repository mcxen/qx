import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  InstalledPlugin,
  RegisteredCommand,
  RegisteredPanel,
} from "./types";
import { handlePluginRpc } from "./rpcMethods";
import {
  DEFAULT_SETTINGS,
  useSettingsStore,
  type PluginDisplaySettings,
} from "../modules/settings/store";
import { createQxLogger, qxLog } from "../lib/logger";
import { PLUGIN_WORKBENCH_RUNTIME_JS } from "./cliWorkbench";
import { PLUGIN_OVERLAY_SCROLLBAR_RUNTIME_JS } from "../utils/overlayScrollbar";

let requestCounter = 0;
function nextRequestId(): string {
  requestCounter += 1;
  return `rpc-${Date.now()}-${requestCounter}`;
}

export interface PluginLoadResult {
  plugin: InstalledPlugin;
  commands: RegisteredCommand[];
  panel?: RegisteredPanel;
  iframe: HTMLIFrameElement;
  runtimeId: string;
}

export interface PluginRuntimeOptions {
  onToast: (msg: string) => void;
  onPrompt: (label: string, defaultValue?: string) => Promise<string | null>;
  onGetPreference: (pluginId: string, id: string) => Promise<unknown>;
  onPluginStatus?: (status: {
    kind: "activity" | "success" | "error";
    pluginId?: string;
    label: string;
    detail?: string;
  }) => void;
  onRunPluginCommand?: (pluginId: string, command: string) => Promise<void>;
}

interface PanelRuntimeSession {
  iframe: HTMLIFrameElement;
  runtimeId: string;
  pluginId: string;
}

const panelSessions = new WeakMap<HTMLElement, PanelRuntimeSession>();
/** Live panel sessions by plugin id (for host → iframe action dispatch). */
const panelSessionsByPlugin = new Map<string, PanelRuntimeSession>();
const runtimeSources = new Map<string, Map<string, Window>>();
const runtimeLogger = createQxLogger("plugin.runtime");

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

type ItemActionsListener = (payload: PluginItemActionsPayload) => void;
const itemActionsListeners = new Set<ItemActionsListener>();

export function subscribePluginItemActions(listener: ItemActionsListener): () => void {
  ensureItemActionsBridge();
  itemActionsListeners.add(listener);
  return () => {
    itemActionsListeners.delete(listener);
  };
}

/** Ask the active panel iframe to run a published item action by id. */
export function runPluginItemAction(pluginId: string, actionId: string): void {
  const session = panelSessionsByPlugin.get(pluginId);
  if (!session?.iframe.contentWindow) return;
  session.iframe.contentWindow.postMessage(
    {
      type: "qx:run-item-action",
      pluginId,
      runtimeId: session.runtimeId,
      actionId,
    },
    "*",
  );
}

function ensureItemActionsBridge(): void {
  const g = globalThis as typeof globalThis & { __qxItemActionsBridge?: boolean };
  if (g.__qxItemActionsBridge) return;
  g.__qxItemActionsBridge = true;
  window.addEventListener("message", (event: MessageEvent) => {
    if (!isExpectedPluginMessageOrigin(event)) return;
    const data = event.data || {};
    if (data.type !== "qx:plugin:item-actions") return;
    const pluginId = String(data.pluginId || "");
    const runtimeId = String(data.runtimeId || "");
    if (!pluginId || !runtimeId || !event.source) return;
    const panelSession = panelSessionsByPlugin.get(pluginId);
    if (
      !panelSession ||
      panelSession.runtimeId !== runtimeId ||
      panelSession.iframe.contentWindow !== event.source ||
      !isPluginRuntimeSource(pluginId, runtimeId, event.source as Window)
    ) {
      return;
    }
    const actions = Array.isArray(data.actions)
      ? data.actions
          .slice(0, 64)
          .map((raw: { id?: string; title?: string; kbd?: string }) => ({
            id: String(raw?.id || "").slice(0, 128),
            title: String(raw?.title || "Action").slice(0, 256),
            kbd: raw?.kbd ? String(raw.kbd).slice(0, 64) : undefined,
          }))
          .filter((a: PluginItemActionDescriptor) => Boolean(a.id))
      : [];
    const payload: PluginItemActionsPayload = {
      pluginId,
      runtimeId,
      selectionTitle: data.selectionTitle
        ? String(data.selectionTitle).slice(0, 256)
        : undefined,
      actions,
    };
    for (const listener of itemActionsListeners) {
      try {
        listener(payload);
      } catch {
        /* ignore listener errors */
      }
    }
  });
}

export function isExpectedPluginMessageOrigin(event: MessageEvent): boolean {
  return event.origin === window.location.origin || event.origin === "null";
}

function registerPluginRuntime(
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

function unregisterPluginRuntime(pluginId: string, runtimeId: string): void {
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

export function unloadPluginRuntime(
  pluginId: string,
  iframe: HTMLIFrameElement,
  runtimeId: string,
): void {
  runtimeLogger.debug("Unloading plugin runtime", { pluginId, runtimeId });
  iframe.contentWindow?.postMessage({ type: "qx:unload", pluginId, runtimeId }, "*");
  unregisterPluginRuntime(pluginId, runtimeId);
}

function serializeForInlineScript(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function pluginDisplaySettingsSnapshot(): PluginDisplaySettings {
  return {
    ...DEFAULT_SETTINGS.plugin_display,
    ...useSettingsStore.getState().settings.plugin_display,
  };
}

export function buildPluginRuntimeHtml(
  pluginId: string,
  entrySource: string,
  runtimeId: string,
  pluginDisplay: PluginDisplaySettings = pluginDisplaySettingsSnapshot(),
): string {
  const raycastActionPanel = pluginDisplay.raycast_action_panel !== false;
  const runtime = `
    <style>
      html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}
      *{scrollbar-width:none}
      ::-webkit-scrollbar{width:0;height:0;display:none}
      .qx-plugin-scrollbar{position:fixed;z-index:2147483646;border-radius:999px;background:rgba(127,127,127,.46);opacity:0;pointer-events:none;transition:opacity 160ms ease;will-change:left,top,width,height,opacity}
      .qx-plugin-scrollbar.is-visible{opacity:1}
      .qx-plugin-scrollbar.is-vertical{width:3px}
      .qx-plugin-scrollbar.is-horizontal{height:3px}
    </style>
    <script type="module">
      ${PLUGIN_WORKBENCH_RUNTIME_JS}
      ${PLUGIN_OVERLAY_SCROLLBAR_RUNTIME_JS}
      const pluginId = ${JSON.stringify(pluginId)};
      const runtimeId = ${JSON.stringify(runtimeId)};
      globalThis.__qxPluginRuntimeId = runtimeId;
      const entrySource = ${serializeForInlineScript(entrySource)};
      const pluginDisplay = ${JSON.stringify({
        raycastActionPanel,
      })};
      let plugin = null;
      const pending = new Map();
      const contextTimers = new Map();
      let timerCounter = 0;

      function generateId() {
        return 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      }

      function postToParent(message) {
        parent.postMessage(message, '*');
      }

      function summarizeLogValue(value) {
        if (value instanceof Error) {
          return value.stack || (value.name + ': ' + value.message);
        }
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value);
        } catch (_) {
          return String(value);
        }
      }

      function postPluginLog(level, message, fields = {}) {
        postToParent({
          type: 'qx:plugin-log',
          pluginId,
          runtimeId,
          level,
          message: String(message || ''),
          fields,
        });
      }

      for (const level of ['error', 'warn', 'info', 'debug']) {
        const original = console[level] ? console[level].bind(console) : console.log.bind(console);
        console[level] = (...args) => {
          original(...args);
          postPluginLog(level, args.map(summarizeLogValue).join(' '), {
            args: args.map(summarizeLogValue),
          });
        };
      }

      window.addEventListener('error', (event) => {
        postPluginLog('error', event.message || 'Unhandled plugin window error', {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          error: summarizeLogValue(event.error),
        });
      });

      window.addEventListener('unhandledrejection', (event) => {
        postPluginLog('error', 'Unhandled plugin promise rejection', {
          reason: summarizeLogValue(event.reason),
        });
      });

      document.documentElement.dataset.qxRaycastActionPanel = pluginDisplay.raycastActionPanel ? 'visible' : 'hidden';
      document.documentElement.dataset.qxPluginActionPanel = pluginDisplay.raycastActionPanel ? 'visible' : 'hidden';

      function rpc(method, payload = {}) {
        const requestId = generateId();
        return new Promise((resolve, reject) => {
          pending.set(requestId, { resolve, reject });
          postToParent({
            type: 'qx:rpc',
            pluginId,
            runtimeId,
            method,
            payload,
            requestId,
          });
        });
      }

      function decodeBase64ToBytes(text) {
        const binary = atob(String(text || ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return bytes;
      }

      function createPluginResponse(value) {
        const body = String(value?.body ?? '');
        const bodyBase64 = value?.bodyBase64 || value?.body_base64 || '';
        const headers = value?.headers || {};
        function responseBytes() {
          if (bodyBase64) return decodeBase64ToBytes(bodyBase64);
          return new TextEncoder().encode(body);
        }
        return {
          status: Number(value?.status ?? 0),
          ok: Boolean(value?.ok),
          headers,
          body,
          bodyBase64,
          binary: Boolean(value?.binary),
          text: async () => {
            if (body) return body;
            return new TextDecoder().decode(responseBytes());
          },
          json: async () => JSON.parse(body || new TextDecoder().decode(responseBytes())),
          arrayBuffer: async () => {
            const bytes = responseBytes();
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          },
          blob: async () => {
            const type = headers['content-type'] || headers['Content-Type'] || '';
            return new Blob([responseBytes()], type ? { type } : undefined);
          },
        };
      }

      function createAiChatPayload(input, options = {}) {
        if (typeof input === 'string') {
          return { ...options, prompt: input };
        }
        if (Array.isArray(input)) {
          return { ...options, messages: input };
        }
        return { ...(input || {}) };
      }

      function clearContextTimers() {
        for (const [id, item] of contextTimers) {
          if (item.type === 'interval') window.clearInterval(item.nativeId);
          else window.clearTimeout(item.nativeId);
          contextTimers.delete(id);
        }
      }

      function registerTimeout(handler, delay, args) {
        const id = ++timerCounter;
        const nativeId = window.setTimeout(() => {
          contextTimers.delete(id);
          if (typeof handler === 'function') handler(...args);
        }, Number(delay) || 0);
        contextTimers.set(id, { type: 'timeout', nativeId });
        return id;
      }

      function registerInterval(handler, delay, args) {
        const id = ++timerCounter;
        const nativeId = window.setInterval(() => {
          if (typeof handler === 'function') handler(...args);
        }, Number(delay) || 0);
        contextTimers.set(id, { type: 'interval', nativeId });
        return id;
      }

      function clearContextTimer(id) {
        const item = contextTimers.get(Number(id));
        if (!item) return;
        if (item.type === 'interval') window.clearInterval(item.nativeId);
        else window.clearTimeout(item.nativeId);
        contextTimers.delete(Number(id));
      }

      window.addEventListener('keydown', (event) => {
        const desktopIdentity = String(navigator.platform || '') + ' ' + String(navigator.userAgent || '');
        const isMacDesktop = desktopIdentity.toLowerCase().includes('mac');
        const hasPrimaryModifier = isMacDesktop
          ? event.metaKey && !event.ctrlKey
          : event.ctrlKey && !event.metaKey;
        const isHostActionMenu = event.key.toLowerCase() === 'k'
          && hasPrimaryModifier
          && !event.altKey
          && !event.shiftKey;
        if (isHostActionMenu) {
          // The iframe is an isolated document, so its key events cannot
          // bubble into the surrounding QxShell. Reserve the portable
          // primary+K chord for the host action menu and forward its exact
          // modifiers; the host compatibility layer decides which primary
          // modifier is valid for the current desktop platform.
          event.preventDefault();
          event.stopPropagation();
          postToParent({
            type: 'qx:host-keydown',
            pluginId,
            runtimeId,
            key: event.key,
            code: event.code,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            altKey: event.altKey,
            shiftKey: event.shiftKey,
          });
          return;
        }

        if (event.key !== 'Escape') return;
        // Let the plugin's own dialog/detail handlers consume Esc first.
        // Only an unhandled event crosses the iframe boundary to QxShell.
        window.setTimeout(() => {
          if (event.defaultPrevented) return;
          postToParent({
            type: 'qx:host-keydown',
            pluginId,
            runtimeId,
            key: 'Escape',
          });
        }, 0);
      }, true);

      const context = {
        pluginId,
        display: pluginDisplay,
        invoke: (cmd, args) => rpc('invoke', { cmd, args }),
        showToast: (msg) => rpc('showToast', { msg }),
        prompt: (label, defaultValue) => rpc('prompt', { label, defaultValue }),
        openUrl: (url) => rpc('openUrl', { url }),
        log: {
          error: (message, fields = {}) => rpc('log', { level: 'error', message, fields }),
          warn: (message, fields = {}) => rpc('log', { level: 'warn', message, fields }),
          info: (message, fields = {}) => rpc('log', { level: 'info', message, fields }),
          debug: (message, fields = {}) => rpc('log', { level: 'debug', message, fields }),
        },
        getPreference: (id) => rpc('getPreference', { id }),
        setTimeout: (handler, delay, ...args) => registerTimeout(handler, delay, args),
        setInterval: (handler, delay, ...args) => registerInterval(handler, delay, args),
        clearTimeout: (id) => clearContextTimer(id),
        clearInterval: (id) => clearContextTimer(id),
        clipboard: {
          read: () => rpc('clipboardRead'),
          write: (text) => rpc('clipboardWrite', { text }),
        },
        island: {
          show: (input) => rpc('islandShow', { input: input || {} }),
          update: (input) => rpc('islandUpdate', { input: input || {} }),
          dismiss: () => rpc('islandDismiss'),
        },
        cli: enhancePluginCli({
          run: (request) => rpc('cliRun', {
            program: request.program,
            args: request.args,
            cwd: request.cwd,
            env: request.env,
            timeoutMs: request.timeoutMs,
          }),
          bash: (request) => {
            const body = typeof request === 'string'
              ? { script: request }
              : {
                  script: request.script,
                  cwd: request.cwd,
                  env: request.env,
                  timeoutMs: request.timeoutMs,
                };
            return rpc('cliBash', body);
          },
          which: (program) => rpc('cliWhich', { program: String(program || '') }),
          start: (request) => rpc('cliStart', {
            kind: request.kind,
            program: request.program,
            args: request.args,
            script: request.script,
            cwd: request.cwd,
            env: request.env,
            timeoutMs: request.timeoutMs,
          }),
          poll: (jobId) => rpc('cliPoll', { jobId: String(jobId || '') }),
          cancel: (jobId) => rpc('cliCancel', { jobId: String(jobId || '') }),
          listJobs: () => rpc('cliListJobs'),
        }),
        ui: createPluginUiKit(),
        http: {
          fetch: async (url, options = {}) => createPluginResponse(await rpc('httpFetch', { url, options })),
        },
        notification: {
          show: (input) => rpc('notificationShow', input || {}),
        },
        ai: {
          providers: () => rpc('aiListProviders'),
          models: async (provider) => {
            const providers = await rpc('aiListProviders');
            const selected = provider
              ? providers.find((item) => item.id === provider)
              : providers[0];
            return selected?.models || [];
          },
          defaultModel: () => rpc('aiDefaultModel'),
          agentSettings: () => rpc('aiAgentSettings'),
          chat: (input, options = {}) => rpc('aiChat', createAiChatPayload(input, options)),
          stream: async (input, onChunk, options = {}) => {
            const chunks = await rpc('aiStreamChat', createAiChatPayload(input, options));
            let full = '';
            for (const chunk of chunks || []) {
              const text = String(chunk || '');
              full += text;
              if (typeof onChunk === 'function') onChunk(text);
              await new Promise((resolve) => window.setTimeout(resolve, 0));
            }
            return full;
          },
          runBash: (script, options = {}) => rpc('aiRunBash', {
            script: String(script || ''),
            cwd: options.cwd,
            timeoutMs: options.timeoutMs,
          }),
          memory: {
            list: () => rpc('aiMemoryList'),
            add: (text, tags = []) => rpc('aiMemoryAdd', { text: String(text || ''), tags }),
            delete: (id) => rpc('aiMemoryDelete', { id: String(id || '') }),
          },
          search: {
            grep: (query, options = {}) => rpc('aiGrepSearch', {
              query: String(query || ''),
              root: options.root,
              maxResults: options.maxResults,
            }),
          },
          tasks: {
            submit: (input) => rpc('aiTaskSubmit', typeof input === 'string' ? { prompt: input } : (input || {})),
            list: () => rpc('aiTaskList'),
            get: (id) => rpc('aiTaskGet', { id: String(id || '') }),
            cancel: (id) => rpc('aiTaskCancel', { id: String(id || '') }),
          },
        },
        tray: {
          setItems: (items) => rpc('traySetItems', { items: items || [] }),
          clear: () => rpc('trayClear'),
          list: () => rpc('trayList'),
        },
        system: {
          env: () => rpc('systemEnv'),
          openPath: (path) => rpc('systemOpenPath', { path: String(path || '') }),
          revealPath: (path) => rpc('systemRevealPath', { path: String(path || '') }),
          stats: async () => {
            const raw = await rpc('invoke', { cmd: 'get_system_stats', args: {} }) || {};
            return {
              cpu: Number(raw.cpu || 0),
              memory: Number(raw.memory || 0),
              memoryUsedGb: Number(raw.memoryUsedGb != null ? raw.memoryUsedGb : raw.memory_used_gb || 0),
              memoryTotalGb: Number(raw.memoryTotalGb != null ? raw.memoryTotalGb : raw.memory_total_gb || 0),
              gpu: raw.gpu == null ? null : Number(raw.gpu),
            };
          },
          networkCounters: async () => {
            const raw = await rpc('invoke', { cmd: 'qx_system_monitor_network_counters', args: {} }) || {};
            const interfaces = Array.isArray(raw.interfaces)
              ? raw.interfaces.map((row) => ({
                  name: String(row.name || ''),
                  bytesIn: Number(row.bytesIn != null ? row.bytesIn : row.bytes_in || 0),
                  bytesOut: Number(row.bytesOut != null ? row.bytesOut : row.bytes_out || 0),
                }))
              : [];
            return {
              totalBytesIn: Number(raw.totalBytesIn != null ? raw.totalBytesIn : raw.total_bytes_in || 0),
              totalBytesOut: Number(raw.totalBytesOut != null ? raw.totalBytesOut : raw.total_bytes_out || 0),
              interfaces,
            };
          },
          info: () => rpc('invoke', { cmd: 'qx_system_information_check_system_info', args: {} }),
          storage: () => rpc('invoke', { cmd: 'qx_system_information_check_storage', args: {} }),
          network: () => rpc('invoke', { cmd: 'qx_system_information_check_network', args: {} }),
          qxStorageOverview: () => rpc('invoke', { cmd: 'qx_storage_overview', args: {} }),
          processes: {
            list: () => rpc('invoke', { cmd: 'qx_system_information_list_processes', args: {} }),
            kill: (pid) => rpc('invoke', { cmd: 'qx_system_information_kill_process', args: { pid: Number(pid) } }),
          },
        },
        permissions: {
          status: () => rpc('invoke', { cmd: 'qx_permissions_status', args: {} }),
          request: (id) => rpc('invoke', { cmd: 'qx_permissions_request', args: { id } }),
          openSettings: (id) => rpc('invoke', { cmd: 'qx_permissions_open_settings', args: { id } }),
        },
        apps: {
          search: (query) => rpc('invoke', { cmd: 'search_apps', args: { query: String(query || '') } }),
        },
        files: {
          search: async (query, limit) => {
            const results = await rpc('invoke', { cmd: 'search_files', args: { query: String(query || '') } });
            return typeof limit === 'number' ? results.slice(0, Math.max(0, limit)) : results;
          },
        },
        qx: {
          invokeRust: (cmd, args) => rpc('invokeRust', { cmd, args }),
        },
        storage: {
          get: (key) => rpc('storageGet', { key }),
          set: (key, value) => rpc('storageSet', { key, value }),
          delete: (key) => rpc('storageDelete', { key }),
          session: {
            get: (key) => rpc('sessionStorageGet', { key }),
            set: (key, value) => rpc('sessionStorageSet', { key, value }),
            delete: (key) => rpc('sessionStorageDelete', { key }),
          },
          persist: {
            get: (key) => rpc('storageGet', { key }),
            set: (key, value) => rpc('storageSet', { key, value }),
            delete: (key) => rpc('storageDelete', { key }),
            keys: () => rpc('storageList'),
            clear: () => rpc('storageClear'),
          },
        },
      };

      window.addEventListener('message', async (event) => {
        if (event.source !== parent) return;
        const data = event.data || {};
        const { type } = data;
        if (type === 'qx:rpc:response') {
          if (data.pluginId !== pluginId || data.runtimeId !== runtimeId) return;
          const { requestId, result, error } = data;
          const req = pending.get(requestId);
          if (!req) return;
          pending.delete(requestId);
          if (error) req.reject(new Error(error));
          else req.resolve(result);
          return;
        }

        if (type === 'qx:runCommand') {
          if (data.pluginId !== pluginId || data.runtimeId !== runtimeId) return;
          const { name, requestId } = data;
          const launchType = data.launchType === 'background' ? 'background' : 'userInitiated';
          try {
            postPluginLog('debug', 'Run command started', { command: name, launchType });
            const cmd = plugin?.commands?.find((c) => c.name === name);
            if (!cmd || typeof cmd.run !== 'function') {
              throw new Error('Command not found: ' + name);
            }
            // Surface to Raycast shims (environment.launchType / Cache throttle).
            globalThis.__qxRaycastLaunchType = launchType;
            const result = typeof cmd.run.length >= 2
              ? await cmd.run(context, { launchType })
              : await cmd.run(context);
            postPluginLog('debug', 'Run command completed', { command: name });
            postToParent({ type: 'qx:runCommand:response', pluginId, runtimeId, requestId, result });
          } catch (err) {
            postPluginLog('error', 'Run command failed', { command: name, error: summarizeLogValue(err) });
            postToParent({ type: 'qx:runCommand:response', pluginId, runtimeId, requestId, error: String(err) });
          }
          return;
        }

        if (type === 'qx:renderPanel') {
          if (data.pluginId !== pluginId || data.runtimeId !== runtimeId) return;
          const { requestId } = data;
          try {
            postPluginLog('debug', 'Render panel started');
            const container = document.getElementById('root') || document.body;
            container.innerHTML = '';
            if (plugin?.panel && typeof plugin.panel.render === 'function') {
              await plugin.panel.render(container, context);
            }
            postPluginLog('debug', 'Render panel completed');
            postToParent({ type: 'qx:renderPanel:response', pluginId, runtimeId, requestId, result: null });
          } catch (err) {
            postPluginLog('error', 'Render panel failed', { error: summarizeLogValue(err) });
            postToParent({ type: 'qx:renderPanel:response', pluginId, runtimeId, requestId, error: String(err) });
          }
          return;
        }

        if (type === 'qx:destroyPanel') {
          if (data.pluginId !== pluginId || data.runtimeId !== runtimeId) return;
          const { requestId } = data;
          try {
            postPluginLog('debug', 'Destroy panel started');
            const container = document.getElementById('root') || document.body;
            if (plugin?.panel && typeof plugin.panel.destroy === 'function') {
              await plugin.panel.destroy(container);
            }
            clearContextTimers();
            container.innerHTML = '';
            postPluginLog('debug', 'Destroy panel completed');
            postToParent({ type: 'qx:destroyPanel:response', pluginId, runtimeId, requestId, result: null });
          } catch (err) {
            postPluginLog('error', 'Destroy panel failed', { error: summarizeLogValue(err) });
            postToParent({ type: 'qx:destroyPanel:response', pluginId, runtimeId, requestId, error: String(err) });
          }
          return;
        }

        if (type === 'qx:unload') {
          if (data.pluginId !== pluginId || data.runtimeId !== runtimeId) return;
          try {
            const container = document.getElementById('root') || document.body;
            if (plugin?.panel && typeof plugin.panel.destroy === 'function') {
              await plugin.panel.destroy(container);
            }
          } catch (_) {
          } finally {
            clearContextTimers();
          }
          return;
        }
      });

      try {
        const entryBlobUrl = URL.createObjectURL(new Blob([entrySource], { type: 'text/javascript' }));
        let mod;
        try {
          mod = await import(entryBlobUrl);
        } finally {
          URL.revokeObjectURL(entryBlobUrl);
        }
        plugin = mod.default || mod;
        postPluginLog('debug', 'Plugin module loaded');
        postToParent({ type: 'qx:plugin:loaded', pluginId, runtimeId });
      } catch (err) {
        postPluginLog('error', 'Plugin module load failed', { error: summarizeLogValue(err) });
        postToParent({ type: 'qx:plugin:error', pluginId, runtimeId, error: String(err) });
      }
    </script>
    <div id="root" style="width:100%;height:100%;"></div>
  `;
  return runtime;
}

function createSandboxIframe(html: string, visible: boolean): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.sandbox.add("allow-scripts");
  iframe.style.cssText = visible
    ? "position:absolute;inset:0;width:100%;height:100%;border:0;visibility:visible;pointer-events:auto;z-index:1;"
    : "position:absolute;inset:0;width:100%;height:100%;border:0;visibility:hidden;pointer-events:none;z-index:-1;";
  iframe.srcdoc = html;
  return iframe;
}

function waitForPluginRuntime(
  plugin: InstalledPlugin,
  iframe: HTMLIFrameElement,
  runtimeId: string,
  timeoutMs: number,
  captureLogs = true,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const handler = (event: MessageEvent) => {
      const data = event.data || {};
      if (!isExpectedPluginMessageOrigin(event)) return;
      if (event.source !== iframe.contentWindow) return;
      if (data.pluginId !== plugin.id || data.runtimeId !== runtimeId) return;
      if (captureLogs && data.type === "qx:plugin-log") {
        qxLog(data.level === "error" || data.level === "warn" || data.level === "debug" ? data.level : "info", "plugin.iframe", String(data.message || ""), {
          pluginId: plugin.id,
          runtimeId,
          ...(data.fields || {}),
        });
        return;
      }
      if (data.type === "qx:plugin:loaded") {
        settled = true;
        clearTimeout(timeout);
        window.removeEventListener("message", handler);
        resolve();
      } else if (data.type === "qx:plugin:error") {
        settled = true;
        clearTimeout(timeout);
        window.removeEventListener("message", handler);
        reject(new Error(data.error || "unknown plugin error"));
      }
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      window.removeEventListener("message", handler);
      reject(new Error(`Plugin ${plugin.id} load timeout`));
    }, timeoutMs);
    window.addEventListener("message", handler);
  });
}

function sendRuntimeRequest(
  plugin: InstalledPlugin,
  iframe: HTMLIFrameElement,
  runtimeId: string,
  type: "qx:runCommand" | "qx:renderPanel" | "qx:destroyPanel",
  responseType: "qx:runCommand:response" | "qx:renderPanel:response" | "qx:destroyPanel:response",
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<void> {
  const requestId = nextRequestId();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const handler = (event: MessageEvent) => {
      const data = event.data || {};
      if (!isExpectedPluginMessageOrigin(event)) return;
      if (event.source !== iframe.contentWindow) return;
      if (data.pluginId !== plugin.id || data.runtimeId !== runtimeId) return;
      if (data.type !== responseType || data.requestId !== requestId) return;
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener("message", handler);
      if (data.error) reject(new Error(data.error));
      else resolve();
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      window.removeEventListener("message", handler);
      reject(new Error(`Plugin ${plugin.id} ${type.replace("qx:", "")} timeout`));
    }, timeoutMs);
    window.addEventListener("message", handler);
    const target = iframe.contentWindow;
    if (!target) {
      clearTimeout(timeout);
      window.removeEventListener("message", handler);
      reject(new Error(`Plugin ${plugin.id} runtime is not available`));
      return;
    }
    target.postMessage(
      { type, pluginId: plugin.id, runtimeId, requestId, ...payload },
      "*",
    );
  });
}

export async function resolvePluginAssetUrl(
  pluginId: string,
  assetPath?: string,
): Promise<string | undefined> {
  const trimmed = assetPath?.trim();
  if (!trimmed) return undefined;
  if (/^(https?:|data:|asset:|blob:)/i.test(trimmed)) return trimmed;
  try {
    const result = await invoke<{ path: string }>("plugin_resolve_asset", {
      id: pluginId,
      assetPath: trimmed,
    });
    return convertFileSrc(result.path);
  } catch (error) {
    console.warn(`Failed to resolve plugin asset ${pluginId}/${trimmed}:`, error);
    return undefined;
  }
}

export async function loadPlugin(
  plugin: InstalledPlugin,
  _options: PluginRuntimeOptions,
): Promise<PluginLoadResult> {
  const loadStartedAt = performance.now();
  runtimeLogger.info("Loading plugin", {
    pluginId: plugin.id,
    pluginName: plugin.name,
    version: plugin.manifest?.version,
  });
  const entrySource = await invoke<string>("read_plugin_entry", { id: plugin.id });
  const workerRuntimeId = nextRequestId();
  const workerHtml = buildPluginRuntimeHtml(plugin.id, entrySource, workerRuntimeId);
  const iframe = createSandboxIframe(workerHtml, false);
  document.body.appendChild(iframe);
  registerPluginRuntime(plugin.id, workerRuntimeId, iframe);
  const pluginLoaded = waitForPluginRuntime(plugin, iframe, workerRuntimeId, 10000);

  const result: PluginLoadResult = {
    plugin,
    iframe,
    runtimeId: workerRuntimeId,
    commands: [],
  };

  const manifest = plugin.manifest;
  const pluginIcon = await resolvePluginAssetUrl(plugin.id, manifest?.icon);

  if (manifest?.commands) {
    for (const cmd of manifest.commands) {
      const commandIcon = await resolvePluginAssetUrl(plugin.id, cmd.icon);
      const registered: RegisteredCommand = {
        ...cmd,
        icon: commandIcon || pluginIcon,
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginIcon,
        async run(_ctx, options) {
          const startedAt = performance.now();
          const launchType = options?.launchType || "userInitiated";
          const timeoutMs =
            typeof options?.timeoutMs === "number" && options.timeoutMs > 0
              ? options.timeoutMs
              : launchType === "background"
                ? 120_000
                : 10_000;
          runtimeLogger.info("Plugin command started", {
            pluginId: plugin.id,
            runtimeId: workerRuntimeId,
            command: cmd.name,
            launchType,
            timeoutMs,
          });
          try {
            await sendRuntimeRequest(
              plugin,
              iframe,
              workerRuntimeId,
              "qx:runCommand",
              "qx:runCommand:response",
              { name: cmd.name, launchType },
              timeoutMs,
            );
            runtimeLogger.info("Plugin command completed", {
              pluginId: plugin.id,
              runtimeId: workerRuntimeId,
              command: cmd.name,
              durationMs: Math.round(performance.now() - startedAt),
            });
          } catch (error) {
            runtimeLogger.error("Plugin command failed", {
              pluginId: plugin.id,
              runtimeId: workerRuntimeId,
              command: cmd.name,
              durationMs: Math.round(performance.now() - startedAt),
              error,
            });
            throw error;
          }
          return undefined;
        },
      };
      result.commands.push(registered);
    }
  }

  if (manifest?.panel) {
    const panelIcon = await resolvePluginAssetUrl(
      plugin.id,
      manifest.panel.icon || manifest.icon,
    );
    result.panel = {
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginIcon,
      title: manifest.panel.title || plugin.name,
      icon: panelIcon || pluginIcon,
      keywords: manifest.panel.keywords || [plugin.name.toLowerCase(), plugin.id.toLowerCase()],
      async render(container, _ctx) {
        const startedAt = performance.now();
        runtimeLogger.info("Plugin panel render started", { pluginId: plugin.id });
        const existing = panelSessions.get(container);
        if (existing) {
          unloadPluginRuntime(plugin.id, existing.iframe, existing.runtimeId);
          existing.iframe.remove();
          panelSessions.delete(container);
          if (panelSessionsByPlugin.get(plugin.id)?.runtimeId === existing.runtimeId) {
            panelSessionsByPlugin.delete(plugin.id);
          }
        }
        container.innerHTML = "";
        const panelRuntimeId = nextRequestId();
        const panelHtml = buildPluginRuntimeHtml(plugin.id, entrySource, panelRuntimeId);
        const panelIframe = createSandboxIframe(panelHtml, true);
        container.appendChild(panelIframe);
        registerPluginRuntime(plugin.id, panelRuntimeId, panelIframe);
        const session: PanelRuntimeSession = {
          iframe: panelIframe,
          runtimeId: panelRuntimeId,
          pluginId: plugin.id,
        };
        panelSessions.set(container, session);
        panelSessionsByPlugin.set(plugin.id, session);
        ensureItemActionsBridge();
        try {
          // Load + first paint only. Plugins must not await long CLI/network in panel.render
          // (host tears down the iframe on timeout). See plugin-development-guide panel rules.
          await waitForPluginRuntime(plugin, panelIframe, panelRuntimeId, 5000, false);
          await sendRuntimeRequest(
            plugin,
            panelIframe,
            panelRuntimeId,
            "qx:renderPanel",
            "qx:renderPanel:response",
            {},
            15_000,
          );
          runtimeLogger.info("Plugin panel render completed", {
            pluginId: plugin.id,
            runtimeId: panelRuntimeId,
            durationMs: Math.round(performance.now() - startedAt),
          });
        } catch (error) {
          runtimeLogger.error("Plugin panel render failed", {
            pluginId: plugin.id,
            runtimeId: panelRuntimeId,
            durationMs: Math.round(performance.now() - startedAt),
            error,
          });
          unregisterPluginRuntime(plugin.id, panelRuntimeId);
          panelIframe.remove();
          panelSessions.delete(container);
          if (panelSessionsByPlugin.get(plugin.id)?.runtimeId === panelRuntimeId) {
            panelSessionsByPlugin.delete(plugin.id);
          }
          throw error;
        }
      },
      async destroy(container) {
        const session = panelSessions.get(container);
        if (!session) return;
        panelSessions.delete(container);
        if (panelSessionsByPlugin.get(plugin.id)?.runtimeId === session.runtimeId) {
          panelSessionsByPlugin.delete(plugin.id);
        }
        try {
          runtimeLogger.debug("Plugin panel destroy started", {
            pluginId: plugin.id,
            runtimeId: session.runtimeId,
          });
          await sendRuntimeRequest(
            plugin,
            session.iframe,
            session.runtimeId,
            "qx:destroyPanel",
            "qx:destroyPanel:response",
            {},
            2000,
          );
        } finally {
          runtimeLogger.debug("Plugin panel destroy completed", {
            pluginId: plugin.id,
            runtimeId: session.runtimeId,
          });
          unregisterPluginRuntime(plugin.id, session.runtimeId);
          session.iframe.remove();
        }
      },
    };
  }

  try {
    await pluginLoaded;
    runtimeLogger.info("Plugin loaded", {
      pluginId: plugin.id,
      runtimeId: workerRuntimeId,
      commandCount: result.commands.length,
      hasPanel: Boolean(result.panel),
      durationMs: Math.round(performance.now() - loadStartedAt),
    });
  } catch (error) {
    runtimeLogger.error("Plugin load failed", {
      pluginId: plugin.id,
      runtimeId: workerRuntimeId,
      durationMs: Math.round(performance.now() - loadStartedAt),
      error,
    });
    unregisterPluginRuntime(plugin.id, workerRuntimeId);
    iframe.remove();
    throw error;
  }

  return result;
}

export { handlePluginRpc };
