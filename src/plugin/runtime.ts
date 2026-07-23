import { invoke } from "@tauri-apps/api/core";
import type {
  InstalledPlugin,
  RegisteredCommand,
  RegisteredPanel,
} from "./types";
import { setPluginIcon } from "./pluginIconRegistry";
import { handlePluginRpc } from "./rpcMethods";
import {
  DEFAULT_SETTINGS,
  useSettingsStore,
  type PluginDisplaySettings,
} from "../modules/settings/store";
import { createQxLogger } from "../lib/logger";
import { PLUGIN_WORKBENCH_RUNTIME_JS } from "./cliWorkbench";
import { PLUGIN_OVERLAY_SCROLLBAR_RUNTIME_JS } from "../utils/overlayScrollbar";
import { PLUGIN_WORKBENCH_HOST_KEYS } from "./workbenchKeyboard";
import {
  deletePanelRuntimeSession,
  ensurePluginShellBridge,
  panelSessions,
  registerPluginRuntime,
  setPanelRuntimeSession,
  unregisterPluginRuntime,
  type PanelRuntimeSession,
} from "./pluginShellBridge";
import { currentPluginThemePayload, PLUGIN_THEME_RUNTIME_JS } from "./pluginTheme";
import { createSandboxIframe, resolvePluginAssetUrl } from "./pluginRuntimeTransport";
import {
  nextRequestId,
  sendRuntimeRequest,
  waitForPluginRuntime,
} from "./pluginRuntimeIpc";
export {
  isExpectedPluginMessageOrigin,
  isPluginRuntimeSource,
  postPluginChromeKey,
  postPluginChromeQuery,
  postPluginChromeTab,
  postPluginWorkbenchEvent,
  runPluginItemAction,
  subscribePluginChrome,
  subscribePluginItemActions,
  subscribePluginWorkbench,
  type PluginChromePayload,
  type PluginItemActionDescriptor,
} from "./pluginShellBridge";
export { resolvePluginAssetUrl } from "./pluginRuntimeTransport";
const runtimeLogger = createQxLogger("plugin.runtime");

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
  const initialTheme = currentPluginThemePayload();
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
      ${PLUGIN_THEME_RUNTIME_JS}
      const initialTheme = JSON.parse(${serializeForInlineScript(JSON.stringify(initialTheme))}); applyPluginTheme(initialTheme.theme, initialTheme.tokens);
      let plugin = null;
      const pending = new Map();
      const contextTimers = new Map();
      let timerCounter = 0;
      let workbenchMounted = false;
      const workbenchHostKeys = new Set(${JSON.stringify(PLUGIN_WORKBENCH_HOST_KEYS)});

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
          url: String(value?.url || ''),
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
        const isHostActionMenu = event.key.toLowerCase() === 'k'
          && (event.metaKey || event.ctrlKey)
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

        const isWorkbenchHostKey = workbenchMounted
          && !event.metaKey
          && !event.ctrlKey
          && !event.altKey
          && !event.shiftKey
          && workbenchHostKeys.has(event.key);
        if (isWorkbenchHostKey) {
          event.preventDefault();
          event.stopPropagation();
          postToParent({
            type: 'qx:host-keydown',
            pluginId,
            runtimeId,
            key: event.key,
            code: event.code,
          });
          return;
        }

        if (event.key !== 'Escape') return;
        // Esc: let plugin handlers run first, then bubble to host.
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

      function serializeWorkbenchState(state) {
        return JSON.parse(JSON.stringify(state || {}, (key, value) => {
          if (key === 'raw' || typeof value === 'function') return undefined;
          return value;
        }));
      }

      globalThis.__qxPluginUiBridge = {
        publishWorkbench: (state) => {
          try {
            workbenchMounted = true;
            postToParent({
              type: 'qx:plugin:workbench',
              pluginId,
              runtimeId,
              state: serializeWorkbenchState(state),
            });
          } catch (error) {
            postPluginLog('error', 'Workbench data is not serializable', {
              error: summarizeLogValue(error),
            });
          }
        },
      };

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
        ocr: {
          status: () => rpc('ocrStatus'),
          recognizePath: (path, options) => rpc('ocrRecognizePath', { path, source: options && options.source }),
          recognizeClipboardImage: (id) => rpc('ocrRecognizeClipboardImage', { id }),
          listHistory: (limit) => rpc('ocrListHistory', { limit }),
          deleteHistory: (id) => rpc('ocrDeleteHistory', { id }),
          clearHistory: () => rpc('ocrClearHistory'),
          copyText: (text) => rpc('ocrCopyText', { text }),
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
          openSettings: (section) => rpc('systemOpenSettings', { section: String(section || '') }),
          setWallpaper: (path, options = {}) => rpc('systemSetWallpaper', { path: String(path || ''), scope: options && options.scope }),
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
          power: () => rpc('invoke', { cmd: 'qx_system_monitor_power', args: {} }),
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
        if (type === 'qx:theme') {
          applyPluginTheme(data.theme, data.tokens);
          return;
        }
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
            workbenchMounted = false;
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
            workbenchMounted = false;
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
            workbenchMounted = false;
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
  setPluginIcon(plugin.id, pluginIcon);

  if (manifest?.commands) {
    for (const cmd of manifest.commands) {
      const commandIcon = await resolvePluginAssetUrl(plugin.id, cmd.icon);
      const registered: RegisteredCommand = {
        ...cmd,
        keywords: Array.from(new Set([
          plugin.name,
          plugin.id,
          ...(manifest.keywords || []),
          ...(cmd.keywords || []),
        ].map((keyword) => keyword.trim()).filter(Boolean))),
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
    setPluginIcon(plugin.id, panelIcon || pluginIcon);
    result.panel = {
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginIcon,
      title: manifest.panel.title || plugin.name,
      icon: panelIcon || pluginIcon,
      keywords: Array.from(new Set([
        plugin.name,
        plugin.id,
        ...(manifest.keywords || []),
        ...(manifest.panel.keywords || []),
      ].map((keyword) => keyword.trim()).filter(Boolean))),
      async render(container, _ctx) {
        const startedAt = performance.now();
        runtimeLogger.info("Plugin panel render started", { pluginId: plugin.id });
        const existing = panelSessions.get(container);
        if (existing) {
          unloadPluginRuntime(plugin.id, existing.iframe, existing.runtimeId);
          existing.iframe.remove();
          panelSessions.delete(container);
          deletePanelRuntimeSession(plugin.id, existing.runtimeId);
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
        setPanelRuntimeSession(session);
        ensurePluginShellBridge();
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
          deletePanelRuntimeSession(plugin.id, panelRuntimeId);
          throw error;
        }
      },
      async destroy(container) {
        const session = panelSessions.get(container);
        if (!session) return;
        panelSessions.delete(container);
        deletePanelRuntimeSession(plugin.id, session.runtimeId);
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
