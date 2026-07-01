import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type {
  InstalledPlugin,
  RegisteredCommand,
  RegisteredPanel,
} from "./types";
import { handlePluginRpc } from "./rpcMethods";

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
}

interface PanelRuntimeSession {
  iframe: HTMLIFrameElement;
  runtimeId: string;
}

const panelSessions = new WeakMap<HTMLElement, PanelRuntimeSession>();
const runtimeSources = new Map<string, Map<string, Window>>();

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
  iframe.contentWindow?.postMessage({ type: "qx:unload", pluginId, runtimeId }, "*");
  unregisterPluginRuntime(pluginId, runtimeId);
}

function serializeForInlineScript(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildPluginRuntimeHtml(
  pluginId: string,
  entrySource: string,
  runtimeId: string,
): string {
  const runtime = `
    <style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}</style>
    <script type="module">
      const pluginId = ${JSON.stringify(pluginId)};
      const runtimeId = ${JSON.stringify(runtimeId)};
      const entrySource = ${serializeForInlineScript(entrySource)};
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

      function createPluginResponse(value) {
        const body = String(value?.body ?? '');
        return {
          status: Number(value?.status ?? 0),
          ok: Boolean(value?.ok),
          headers: value?.headers || {},
          body,
          text: async () => body,
          json: async () => JSON.parse(body),
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
        if (event.key !== 'Escape') return;
        postToParent({
          type: 'qx:host-keydown',
          pluginId,
          runtimeId,
          key: 'Escape',
        });
      }, true);

      const context = {
        pluginId,
        invoke: (cmd, args) => rpc('invoke', { cmd, args }),
        showToast: (msg) => rpc('showToast', { msg }),
        prompt: (label, defaultValue) => rpc('prompt', { label, defaultValue }),
        openUrl: (url) => rpc('openUrl', { url }),
        getPreference: (id) => rpc('getPreference', { id }),
        setTimeout: (handler, delay, ...args) => registerTimeout(handler, delay, args),
        setInterval: (handler, delay, ...args) => registerInterval(handler, delay, args),
        clearTimeout: (id) => clearContextTimer(id),
        clearInterval: (id) => clearContextTimer(id),
        clipboard: {
          read: () => rpc('clipboardRead'),
          write: (text) => rpc('clipboardWrite', { text }),
        },
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
        system: {
          stats: () => rpc('invoke', { cmd: 'get_system_stats', args: {} }),
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
          try {
            const cmd = plugin?.commands?.find((c) => c.name === name);
            if (!cmd || typeof cmd.run !== 'function') {
              throw new Error('Command not found: ' + name);
            }
            const result = await cmd.run(context);
            postToParent({ type: 'qx:runCommand:response', pluginId, runtimeId, requestId, result });
          } catch (err) {
            postToParent({ type: 'qx:runCommand:response', pluginId, runtimeId, requestId, error: String(err) });
          }
          return;
        }

        if (type === 'qx:renderPanel') {
          if (data.pluginId !== pluginId || data.runtimeId !== runtimeId) return;
          const { requestId } = data;
          try {
            const container = document.getElementById('root') || document.body;
            container.innerHTML = '';
            if (plugin?.panel && typeof plugin.panel.render === 'function') {
              await plugin.panel.render(container, context);
            }
            postToParent({ type: 'qx:renderPanel:response', pluginId, runtimeId, requestId, result: null });
          } catch (err) {
            postToParent({ type: 'qx:renderPanel:response', pluginId, runtimeId, requestId, error: String(err) });
          }
          return;
        }

        if (type === 'qx:destroyPanel') {
          if (data.pluginId !== pluginId || data.runtimeId !== runtimeId) return;
          const { requestId } = data;
          try {
            const container = document.getElementById('root') || document.body;
            if (plugin?.panel && typeof plugin.panel.destroy === 'function') {
              await plugin.panel.destroy(container);
            }
            clearContextTimers();
            container.innerHTML = '';
            postToParent({ type: 'qx:destroyPanel:response', pluginId, runtimeId, requestId, result: null });
          } catch (err) {
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
        postToParent({ type: 'qx:plugin:loaded', pluginId, runtimeId });
      } catch (err) {
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
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const handler = (event: MessageEvent) => {
      const data = event.data || {};
      if (!isExpectedPluginMessageOrigin(event)) return;
      if (event.source !== iframe.contentWindow) return;
      if (data.pluginId !== plugin.id || data.runtimeId !== runtimeId) return;
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
        async run(_ctx) {
          return sendRuntimeRequest(
            plugin,
            iframe,
            workerRuntimeId,
            "qx:runCommand",
            "qx:runCommand:response",
            { name: cmd.name },
            10000,
          );
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
        const existing = panelSessions.get(container);
        if (existing) {
          unloadPluginRuntime(plugin.id, existing.iframe, existing.runtimeId);
          existing.iframe.remove();
          panelSessions.delete(container);
        }
        container.innerHTML = "";
        const panelRuntimeId = nextRequestId();
        const panelHtml = buildPluginRuntimeHtml(plugin.id, entrySource, panelRuntimeId);
        const panelIframe = createSandboxIframe(panelHtml, true);
        container.appendChild(panelIframe);
        registerPluginRuntime(plugin.id, panelRuntimeId, panelIframe);
        panelSessions.set(container, { iframe: panelIframe, runtimeId: panelRuntimeId });
        try {
          await waitForPluginRuntime(plugin, panelIframe, panelRuntimeId, 2500);
          await sendRuntimeRequest(
            plugin,
            panelIframe,
            panelRuntimeId,
            "qx:renderPanel",
            "qx:renderPanel:response",
            {},
            5000,
          );
        } catch (error) {
          unregisterPluginRuntime(plugin.id, panelRuntimeId);
          panelIframe.remove();
          panelSessions.delete(container);
          throw error;
        }
      },
      async destroy(container) {
        const session = panelSessions.get(container);
        if (!session) return;
        panelSessions.delete(container);
        try {
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
          unregisterPluginRuntime(plugin.id, session.runtimeId);
          session.iframe.remove();
        }
      },
    };
  }

  try {
    await pluginLoaded;
  } catch (error) {
    unregisterPluginRuntime(plugin.id, workerRuntimeId);
    iframe.remove();
    throw error;
  }

  return result;
}

export { handlePluginRpc };
