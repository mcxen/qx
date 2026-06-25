import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { loadPlugin, handlePluginRpc } from "./runtime";
import { BUILTIN_PLUGINS } from "./builtin";
import type {
  InstalledPlugin,
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

export const usePluginRegistry = create<PluginRegistryStore>((set, get) => ({
  plugins: [],
  commands: [],
  panels: {},
  workers: {},
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
            void handlePluginRpc(
              plugin,
              String(data.method),
              (data.payload || {}) as Record<string, unknown>,
              hooks,
            )
              .then((rpcResult) => {
                result.iframe.contentWindow?.postMessage(
                  {
                    type: "qx:rpc:response",
                    pluginId: plugin.id,
                    requestId,
                    result: rpcResult,
                  },
                  "*",
                );
              })
              .catch((error) => {
                result.iframe.contentWindow?.postMessage(
                  {
                    type: "qx:rpc:response",
                    pluginId: plugin.id,
                    requestId,
                    error: String(error),
                  },
                  "*",
                );
              });
          };
          window.addEventListener("message", rpcHandler);
          (result.iframe as HTMLIFrameElement & { __qxRpcHandler?: (event: MessageEvent) => void }).__qxRpcHandler = rpcHandler;
          commands.push(...result.commands);
          if (result.panel) {
            panels[result.panel.pluginId] = result.panel;
          }
          workers[plugin.id] = result.iframe;
        } catch (err) {
          console.error(`Failed to load plugin ${plugin.id}:`, err);
        }
      }

      set({
        plugins: [...BUILTIN_PLUGINS, ...plugins],
        commands: [...builtinCommands, ...commands],
        panels: { ...builtinPanels, ...panels },
        workers,
        loaded: true,
        loading: false,
      });
    } catch (err) {
      set({ error: String(err), loading: false, loaded: true });
    }
  },

  unload: () => {
    const { workers } = get();
    Object.values(workers).forEach((iframe) => {
      const handler = (iframe as HTMLIFrameElement & { __qxRpcHandler?: (event: MessageEvent) => void }).__qxRpcHandler;
      if (handler) window.removeEventListener("message", handler);
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
    await command.run({
      pluginId: command.pluginId,
      invoke: async () => {
        throw new Error("Direct invoke not available; command runs inside plugin iframe");
      },
      showToast: () => {},
      prompt: async () => null,
      openUrl: async () => {},
      getPreference: async () => undefined,
      storage: {
        get: async () => undefined,
        set: async () => {},
        delete: async () => {},
      },
    });
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
) {
  return {
    pluginId: plugin.id,
    invoke: (cmd: string, args?: Record<string, unknown>) =>
      handlePluginRpc(plugin, "invoke", { cmd, args }, hooks),
    showToast: (msg: string) =>
      handlePluginRpc(plugin, "showToast", { msg }, hooks),
    prompt: (label: string, defaultValue?: string) =>
      handlePluginRpc(plugin, "prompt", { label, defaultValue }, hooks) as Promise<string | null>,
    openUrl: (url: string) =>
      handlePluginRpc(plugin, "openUrl", { url }, hooks) as Promise<void>,
    getPreference: (id: string) =>
      handlePluginRpc(plugin, "getPreference", { id }, hooks),
    storage: {
      get: (key: string) =>
        handlePluginRpc(plugin, "storageGet", { key }, hooks),
      set: (key: string, value: unknown) =>
        handlePluginRpc(plugin, "storageSet", { key, value }, hooks) as Promise<void>,
      delete: (key: string) =>
        handlePluginRpc(plugin, "storageDelete", { key }, hooks) as Promise<void>,
    },
  };
}
