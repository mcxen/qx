import { invoke } from "@tauri-apps/api/core";
import { openUrl as openerOpenUrl } from "@tauri-apps/plugin-opener";
import type {
  InstalledPlugin,
  RegisteredCommand,
  RegisteredPanel,
} from "./types";

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
}

export interface PluginRuntimeOptions {
  onToast: (msg: string) => void;
  onPrompt: (label: string, defaultValue?: string) => Promise<string | null>;
  onGetPreference: (pluginId: string, id: string) => Promise<unknown>;
}

function serializeForInlineScript(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildPluginRuntimeHtml(
  pluginId: string,
  entrySource: string,
): string {
  const runtime = `
    <style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}</style>
    <script type="module">
      const pluginId = ${JSON.stringify(pluginId)};
      const entrySource = ${serializeForInlineScript(entrySource)};
      let plugin = null;
      const pending = new Map();

      function generateId() {
        return 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      }

      function rpc(method, payload = {}) {
        const requestId = generateId();
        return new Promise((resolve, reject) => {
          pending.set(requestId, { resolve, reject });
          parent.postMessage({
            type: 'qx:rpc',
            pluginId,
            method,
            payload,
            requestId,
          }, '*');
        });
      }

      const context = {
        pluginId,
        invoke: (cmd, args) => rpc('invoke', { cmd, args }),
        showToast: (msg) => rpc('showToast', { msg }),
        prompt: (label, defaultValue) => rpc('prompt', { label, defaultValue }),
        openUrl: (url) => rpc('openUrl', { url }),
        getPreference: (id) => rpc('getPreference', { id }),
        storage: {
          get: (key) => rpc('storageGet', { key }),
          set: (key, value) => rpc('storageSet', { key, value }),
          delete: (key) => rpc('storageDelete', { key }),
        },
      };

      window.addEventListener('message', async (event) => {
        const { type } = event.data || {};
        if (type === 'qx:rpc:response') {
          const { requestId, result, error } = event.data;
          const req = pending.get(requestId);
          if (!req) return;
          pending.delete(requestId);
          if (error) req.reject(new Error(error));
          else req.resolve(result);
          return;
        }

        if (type === 'qx:runCommand') {
          const { name, requestId } = event.data;
          try {
            const cmd = plugin?.commands?.find((c) => c.name === name);
            if (!cmd || typeof cmd.run !== 'function') {
              throw new Error('Command not found: ' + name);
            }
            const result = await cmd.run(context);
            parent.postMessage({ type: 'qx:runCommand:response', requestId, result }, '*');
          } catch (err) {
            parent.postMessage({ type: 'qx:runCommand:response', requestId, error: String(err) }, '*');
          }
          return;
        }

        if (type === 'qx:renderPanel') {
          const { requestId } = event.data;
          try {
            const container = document.getElementById('root') || document.body;
            container.innerHTML = '';
            if (plugin?.panel && typeof plugin.panel.render === 'function') {
              await plugin.panel.render(container, context);
            }
            parent.postMessage({ type: 'qx:renderPanel:response', requestId, result: null }, '*');
          } catch (err) {
            parent.postMessage({ type: 'qx:renderPanel:response', requestId, error: String(err) }, '*');
          }
          return;
        }

        if (type === 'qx:destroyPanel') {
          const { requestId } = event.data;
          try {
            const container = document.getElementById('root') || document.body;
            if (plugin?.panel && typeof plugin.panel.destroy === 'function') {
              await plugin.panel.destroy(container);
            }
            container.innerHTML = '';
            parent.postMessage({ type: 'qx:destroyPanel:response', requestId, result: null }, '*');
          } catch (err) {
            parent.postMessage({ type: 'qx:destroyPanel:response', requestId, error: String(err) }, '*');
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
        parent.postMessage({ type: 'qx:plugin:loaded', pluginId }, '*');
      } catch (err) {
        parent.postMessage({ type: 'qx:plugin:error', pluginId, error: String(err) }, '*');
      }
    </script>
    <div id="root" style="width:100%;height:100%;"></div>
  `;
  return runtime;
}

function createSandboxIframe(_pluginId: string, html: string): HTMLIFrameElement {
  const iframe = document.createElement("iframe");
  iframe.sandbox.add("allow-scripts");
  iframe.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;border:0;visibility:hidden;pointer-events:none;z-index:-1;";
  iframe.srcdoc = html;
  return iframe;
}

export async function loadPlugin(
  plugin: InstalledPlugin,
  _options: PluginRuntimeOptions,
): Promise<PluginLoadResult> {
  const entrySource = await invoke<string>("read_plugin_entry", { id: plugin.id });
  const html = buildPluginRuntimeHtml(plugin.id, entrySource);
  const iframe = createSandboxIframe(plugin.id, html);
  const pluginLoaded = new Promise<void>((resolve, reject) => {
    let settled = false;
    const handler = (event: MessageEvent) => {
      const data = event.data || {};
      if (data.pluginId !== plugin.id) return;
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
    }, 10000);
    window.addEventListener("message", handler);
  });
  document.body.appendChild(iframe);

  const result: PluginLoadResult = {
    plugin,
    iframe,
    commands: [],
  };

  const manifest = plugin.manifest;
  const pluginIcon = manifest?.icon
    ? `plugin://${plugin.id}/${manifest.icon}`
    : undefined;

  if (manifest?.commands) {
    for (const cmd of manifest.commands) {
      const registered: RegisteredCommand = {
        ...cmd,
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginIcon,
        async run(_ctx) {
          const requestId = nextRequestId();
          return new Promise<void>((resolve, reject) => {
            const handler = (event: MessageEvent) => {
              const data = event.data || {};
              if (
                data.type === "qx:runCommand:response" &&
                data.requestId === requestId
              ) {
                window.removeEventListener("message", handler);
                if (data.error) reject(new Error(data.error));
                else resolve(data.result);
              }
            };
            window.addEventListener("message", handler);
            iframe.contentWindow?.postMessage(
              { type: "qx:runCommand", pluginId: plugin.id, name: cmd.name, requestId },
              "*",
            );
          });
        },
      };
      result.commands.push(registered);
    }
  }

  if (manifest?.panel) {
    result.panel = {
      pluginId: plugin.id,
      pluginName: plugin.name,
      pluginIcon,
      title: manifest.panel.title || plugin.name,
      icon: manifest.panel.icon || pluginIcon,
      keywords: manifest.panel.keywords || [plugin.name.toLowerCase(), plugin.id.toLowerCase()],
      async render(_container, _ctx) {
        const requestId = nextRequestId();
        return new Promise<void>((resolve, reject) => {
          const handler = (event: MessageEvent) => {
            const data = event.data || {};
            if (
              data.type === "qx:renderPanel:response" &&
              data.requestId === requestId
            ) {
              window.removeEventListener("message", handler);
              if (data.error) reject(new Error(data.error));
              else resolve(data.result);
            }
          };
          window.addEventListener("message", handler);
          iframe.contentWindow?.postMessage(
            { type: "qx:renderPanel", pluginId: plugin.id, requestId },
            "*",
          );
        });
      },
      async destroy(_container) {
        const requestId = nextRequestId();
        return new Promise<void>((resolve, reject) => {
          const handler = (event: MessageEvent) => {
            const data = event.data || {};
            if (
              data.type === "qx:destroyPanel:response" &&
              data.requestId === requestId
            ) {
              window.removeEventListener("message", handler);
              if (data.error) reject(new Error(data.error));
              else resolve(data.result);
            }
          };
          window.addEventListener("message", handler);
          iframe.contentWindow?.postMessage(
            { type: "qx:destroyPanel", pluginId: plugin.id, requestId },
            "*",
          );
        });
      },
    };
  }

  try {
    await pluginLoaded;
  } catch (error) {
    iframe.remove();
    throw error;
  }

  return result;
}

export async function handlePluginRpc(
  plugin: InstalledPlugin,
  method: string,
  payload: Record<string, unknown>,
  options: PluginRuntimeOptions,
): Promise<unknown> {
  const perms = new Set(plugin.manifest?.permissions || []);

  switch (method) {
    case "invoke": {
      const { cmd, args } = payload;
      const cmdStr = String(cmd);
      if (!perms.has(cmdStr) && !perms.has(`invoke:${cmdStr}`) && !perms.has("*")) {
        throw new Error(`Plugin ${plugin.id} lacks permission: ${cmdStr}`);
      }
      return invoke(cmdStr, (args as Record<string, unknown>) || {});
    }
    case "showToast": {
      options.onToast(String(payload.msg));
      return undefined;
    }
    case "prompt": {
      return options.onPrompt(String(payload.label), payload.defaultValue as string);
    }
    case "openUrl": {
      const url = String(payload.url);
      if (!perms.has("open-url") && !perms.has("*")) {
        throw new Error(`Plugin ${plugin.id} lacks permission: open-url`);
      }
      await openerOpenUrl(url);
      return undefined;
    }
    case "getPreference": {
      return options.onGetPreference(plugin.id, String(payload.id));
    }
    case "storageGet": {
      return invoke("plugin_storage_get", { id: plugin.id, key: String(payload.key) });
    }
    case "storageSet": {
      return invoke("plugin_storage_set", {
        id: plugin.id,
        key: String(payload.key),
        value: payload.value,
      });
    }
    case "storageDelete": {
      return invoke("plugin_storage_delete", {
        id: plugin.id,
        key: String(payload.key),
      });
    }
    default:
      throw new Error(`Unknown RPC method: ${method}`);
  }
}
