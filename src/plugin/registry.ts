import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import {
  handlePluginRpc,
  isPluginRuntimeSource,
  loadPlugin,
  unloadPluginRuntime,
} from "./runtime";
import { BUILTIN_PLUGINS } from "./builtin";
import type {
  InstalledPlugin,
  PluginContext,
  RegisteredCommand,
  RegisteredPanel,
} from "./types";

export interface CommandMatch {
  command: RegisteredCommand;
  score: number;
}

interface PluginRuntimeHooks {
  onToast: (msg: string) => void;
  onPrompt: (label: string, defaultValue?: string) => Promise<string | null>;
  onGetPreference: (pluginId: string, id: string) => Promise<unknown>;
}

interface PluginRegistryStore {
  plugins: InstalledPlugin[];
  commands: RegisteredCommand[];
  panels: Record<string, RegisteredPanel>;
  workers: Record<string, HTMLIFrameElement>;
  shortcuts: Record<string, string[]>;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  hooks: PluginRuntimeHooks | null;

  load: (hooks: PluginRuntimeHooks) => Promise<void>;
  unload: () => void;
  install: (path: string) => Promise<InstalledPlugin>;
  uninstall: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
  findCommands: (query: string) => CommandMatch[];
  getPanel: (id: string) => RegisteredPanel | undefined;
  runCommand: (command: RegisteredCommand) => Promise<void>;
  /** Start watching for plugin file changes (dev mode). */
  startDevWatcher: () => void;
  /** Stop watching for plugin file changes. */
  stopDevWatcher: () => void;
  devWatcherActive: boolean;
  /** @internal */ _devWatcherInterval: ReturnType<typeof setInterval> | null;
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

function isBuiltinPluginId(id: string): boolean {
  return id.startsWith("builtin:");
}

/** Topological sort of plugins based on declared dependencies. */
function topologicalSort(plugins: InstalledPlugin[]): InstalledPlugin[] {
  const byId = new Map(plugins.map((p) => [p.id, p]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: InstalledPlugin[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) return; // cycle detected, skip
    visiting.add(id);
    const plugin = byId.get(id);
    if (plugin?.manifest?.dependencies) {
      for (const dep of plugin.manifest.dependencies) {
        visit(dep);
      }
    }
    visiting.delete(id);
    visited.add(id);
    if (plugin) result.push(plugin);
  }

  for (const p of plugins) visit(p.id);
  return result;
}

function scoreCommand(command: RegisteredCommand, query: string): number {
  if (!query) return 0;
  const haystacks = [
    command.title,
    command.name,
    command.description,
    command.pluginName,
    ...(command.keywords || []),
  ]
    .filter(Boolean)
    .map((s) => s!.toLowerCase());

  for (const text of haystacks) {
    if (text === query) return 1;
    if (text.startsWith(query + " ") || text.startsWith(query + ":")) return 0.95;
    if (text.startsWith(query)) return 0.9;
    if (text.includes(" " + query) || text.includes(query)) return 0.7;
  }
  return 0;
}

function unavailableContext(pluginId: string): PluginContext {
  const unavailable = async () => {
    throw new Error("Direct context not available; command runs inside plugin iframe");
  };
  const unavailableVoid = () => {
    throw new Error("Direct context not available; command runs inside plugin iframe");
  };
  return {
    pluginId,
    invoke: unavailable,
    showToast: unavailableVoid,
    prompt: unavailable,
    openUrl: unavailable,
    getPreference: unavailable,
    setTimeout: () => window.setTimeout(() => {}, 0),
    setInterval: () => window.setInterval(() => {}, 1000),
    clearTimeout: (id) => window.clearTimeout(id),
    clearInterval: (id) => window.clearInterval(id),
    clipboard: { read: unavailable, write: unavailable },
    http: { fetch: unavailable },
    notification: { show: unavailable },
    system: {
      stats: unavailable,
      info: unavailable,
      storage: unavailable,
      network: unavailable,
      qxStorageOverview: unavailable,
      processes: { list: unavailable, kill: unavailable },
    },
    permissions: {
      status: unavailable,
      request: unavailable,
      openSettings: unavailable,
    },
    apps: { search: unavailable },
    files: { search: unavailable },
    qx: { invokeRust: unavailable },
    storage: { get: unavailable, set: unavailable, delete: unavailable },
  };
}

export const usePluginRegistry = create<PluginRegistryStore>((set, get) => ({
  plugins: [],
  commands: [],
  panels: {},
  workers: {},
  shortcuts: {},
  loaded: false,
  loading: false,
  error: null,
  hooks: null,
  devWatcherActive: false,
  _devWatcherInterval: null as ReturnType<typeof setInterval> | null,

  load: async (hooks) => {
    if (get().loading || get().loaded) return;
    set({ loading: true, error: null, hooks });
    try {
      const builtinCommands = get().commands.filter((command) =>
        isBuiltinPluginId(command.pluginId),
      );
      const builtinPanels = Object.fromEntries(
        Object.entries(get().panels).filter(([id]) => isBuiltinPluginId(id)),
      );
      const plugins = await invoke<InstalledPlugin[]>("list_installed_plugins");
      const enabled = plugins.filter((p) => p.enabled);
      // Topological sort: load dependencies first
      const sorted = topologicalSort(enabled);
      const commands: RegisteredCommand[] = [];
      const panels: Record<string, RegisteredPanel> = {};
      const workers: Record<string, HTMLIFrameElement> = {};
      const shortcuts: Record<string, string[]> = {};

      for (const plugin of sorted) {
        try {
          const result = await loadPlugin(plugin, {
            onToast: hooks.onToast,
            onPrompt: hooks.onPrompt,
            onGetPreference: hooks.onGetPreference,
          });
          const rpcHandler = (event: MessageEvent) => {
            const data = event.data || {};
            if (data.type !== "qx:rpc" || data.pluginId !== plugin.id) return;
            const requestId = String(data.requestId || "");
            const runtimeId = String(data.runtimeId || "");
            const source = event.source as Window | null;
            if (!source || typeof source.postMessage !== "function") return;
            if (!isPluginRuntimeSource(plugin.id, runtimeId, source)) return;
            void handlePluginRpc(
              plugin,
              String(data.method),
              (data.payload || {}) as Record<string, unknown>,
              hooks,
            )
              .then((rpcResult) => {
                source.postMessage(
                  {
                    type: "qx:rpc:response",
                    pluginId: plugin.id,
                    runtimeId,
                    requestId,
                    result: rpcResult,
                  },
                  "*",
                );
              })
              .catch((error) => {
                source.postMessage(
                  {
                    type: "qx:rpc:response",
                    pluginId: plugin.id,
                    runtimeId,
                    requestId,
                    error: String(error),
                  },
                  "*",
                );
              });
          };
          window.addEventListener("message", rpcHandler);
          (result.iframe as HTMLIFrameElement & {
            __qxRpcHandler?: (event: MessageEvent) => void;
            __qxRuntimeId?: string;
          }).__qxRpcHandler = rpcHandler;
          (result.iframe as HTMLIFrameElement & { __qxRuntimeId?: string }).__qxRuntimeId = result.runtimeId;
          commands.push(...result.commands);
          if (result.panel) {
            panels[result.panel.pluginId] = result.panel;
          }
          workers[plugin.id] = result.iframe;
          const pluginShortcuts = plugin.manifest?.shortcuts || [];
          for (const shortcut of pluginShortcuts) {
            if (shortcut.enabled === false || !shortcut.key || !shortcut.command) continue;
            const command = result.commands.find((cmd) => cmd.name === shortcut.command);
            if (!command) continue;
            try {
              await register(shortcut.key, (event) => {
                if (event.state !== "Pressed") return;
                void get().runCommand(command);
              });
              shortcuts[plugin.id] = [...(shortcuts[plugin.id] || []), shortcut.key];
            } catch (error) {
              console.warn(`Failed to register shortcut ${shortcut.key} for ${plugin.id}:`, error);
            }
          }
        } catch (err) {
          console.error(`Failed to load plugin ${plugin.id}:`, err);
        }
      }

      set({
        plugins: [...BUILTIN_PLUGINS, ...plugins],
        commands: [...builtinCommands, ...commands],
        panels: { ...builtinPanels, ...panels },
        workers,
        shortcuts,
        loaded: true,
        loading: false,
      });
    } catch (err) {
      set({ error: String(err), loading: false, loaded: true });
    }
  },

  unload: () => {
    const { workers, shortcuts } = get();
    Object.values(shortcuts).flat().forEach((shortcut) => {
      void unregister(shortcut).catch(() => {});
    });
    Object.entries(workers).forEach(([pluginId, iframe]) => {
      const decorated = iframe as HTMLIFrameElement & {
        __qxRpcHandler?: (event: MessageEvent) => void;
        __qxRuntimeId?: string;
      };
      const handler = decorated.__qxRpcHandler;
      if (handler) window.removeEventListener("message", handler);
      if (decorated.__qxRuntimeId) {
        unloadPluginRuntime(pluginId, iframe, decorated.__qxRuntimeId);
      }
      iframe.remove();
    });
    const builtinCommands = get().commands.filter((command) =>
      isBuiltinPluginId(command.pluginId),
    );
    const builtinPanels = Object.fromEntries(
      Object.entries(get().panels).filter(([id]) => isBuiltinPluginId(id)),
    );
    set({
      plugins: BUILTIN_PLUGINS,
      commands: builtinCommands,
      panels: builtinPanels,
      workers: {},
      shortcuts: {},
      loaded: false,
    });
  },

  install: async (path: string) => {
    const plugin = await invoke<InstalledPlugin>("install_plugin", { path });
    await get().refresh();
    return plugin;
  },

  uninstall: async (id: string) => {
    await invoke("uninstall_plugin", { id });
    await get().refresh();
  },

  setEnabled: async (id: string, enabled: boolean) => {
    await invoke("set_plugin_enabled", { id, enabled });
    await get().refresh();
  },

  refresh: async () => {
    const hooks = get().hooks;
    get().unload();
    if (hooks) {
      await get().load(hooks);
    } else {
      set({ loaded: true, loading: false });
    }
  },

  findCommands: (query: string) => {
    const q = normalizeQuery(query);
    if (!q) return [];
    const matches: CommandMatch[] = [];
    for (const command of get().commands) {
      const score = scoreCommand(command, q);
      if (score > 0) {
        matches.push({ command, score });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return matches;
  },

  getPanel: (id: string) => get().panels[id],

  runCommand: async (command) => {
    try {
      await command.run(unavailableContext(command.pluginId));
    } catch (error) {
      const message = `Plugin command failed: ${String(error)}`;
      get().hooks?.onToast(message);
    }
  },

  startDevWatcher: () => {
    if (get().devWatcherActive) return;
    const interval = setInterval(async () => {
      try {
        await get().refresh();
      } catch {
        // Ignore errors during auto-refresh
      }
    }, 3000);
    set({ devWatcherActive: true, _devWatcherInterval: interval });
  },

  stopDevWatcher: () => {
    const interval = (get() as any)._devWatcherInterval;
    if (interval) clearInterval(interval);
    set({ devWatcherActive: false, _devWatcherInterval: null });
  },
}));

export function createPluginContext(
  plugin: InstalledPlugin,
  hooks: {
    onToast: (msg: string) => void;
    onPrompt: (label: string, defaultValue?: string) => Promise<string | null>;
    onGetPreference: (pluginId: string, id: string) => Promise<unknown>;
  },
): PluginContext {
  const rpc = (method: string, payload: Record<string, unknown> = {}) =>
    handlePluginRpc(plugin, method, payload, hooks);

  return {
    pluginId: plugin.id,
    invoke: (cmd: string, args?: Record<string, unknown>) => rpc("invoke", { cmd, args }),
    showToast: (msg: string) => {
      void rpc("showToast", { msg });
    },
    prompt: (label: string, defaultValue?: string) =>
      rpc("prompt", { label, defaultValue }) as Promise<string | null>,
    openUrl: (url: string) => rpc("openUrl", { url }) as Promise<void>,
    getPreference: (id: string) => rpc("getPreference", { id }),
    setTimeout: (handler, delay, ...args) => window.setTimeout(handler, delay, ...args),
    setInterval: (handler, delay, ...args) => window.setInterval(handler, delay, ...args),
    clearTimeout: (id) => window.clearTimeout(id),
    clearInterval: (id) => window.clearInterval(id),
    clipboard: {
      read: () => rpc("clipboardRead") as Promise<string>,
      write: (text: string) => rpc("clipboardWrite", { text }) as Promise<void>,
    },
    http: {
      fetch: async (url, options = {}) => {
        const result = await rpc("httpFetch", { url, options }) as {
          status: number;
          ok: boolean;
          headers: Record<string, string>;
          body: string;
        };
        const body = String(result.body ?? "");
        return {
          ...result,
          body,
          text: async () => body,
          json: async () => JSON.parse(body) as unknown,
        };
      },
    },
    notification: {
      show: (input) => rpc("notificationShow", input) as Promise<void>,
    },
    system: {
      stats: () => rpc("invoke", { cmd: "get_system_stats", args: {} }),
      info: () => rpc("invoke", { cmd: "qx_system_information_check_system_info", args: {} }),
      storage: () => rpc("invoke", { cmd: "qx_system_information_check_storage", args: {} }),
      network: () => rpc("invoke", { cmd: "qx_system_information_check_network", args: {} }),
      qxStorageOverview: () => rpc("invoke", { cmd: "qx_storage_overview", args: {} }),
      processes: {
        list: () => rpc("invoke", { cmd: "qx_system_information_list_processes", args: {} }),
        kill: (pid) => rpc("invoke", {
          cmd: "qx_system_information_kill_process",
          args: { pid },
        }),
      },
    },
    permissions: {
      status: () => rpc("invoke", { cmd: "qx_permissions_status", args: {} }),
      request: (id) => rpc("invoke", {
        cmd: "qx_permissions_request",
        args: { id },
      }) as Promise<boolean>,
      openSettings: (id) => rpc("invoke", {
        cmd: "qx_permissions_open_settings",
        args: { id },
      }) as Promise<void>,
    },
    apps: {
      search: (query) => rpc("invoke", { cmd: "search_apps", args: { query } }) as Promise<unknown[]>,
    },
    files: {
      search: async (query, limit) => {
        const results = await rpc("invoke", {
          cmd: "search_files",
          args: { query },
        }) as unknown[];
        return typeof limit === "number" ? results.slice(0, Math.max(0, limit)) : results;
      },
    },
    qx: {
      invokeRust: (cmd, args) => rpc("invokeRust", { cmd, args }),
    },
    storage: {
      get: (key: string) => rpc("storageGet", { key }),
      set: (key: string, value: unknown) => rpc("storageSet", { key, value }) as Promise<void>,
      delete: (key: string) => rpc("storageDelete", { key }) as Promise<void>,
    },
  };
}
