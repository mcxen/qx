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
  PluginAiModelSelection,
  PluginAiProvider,
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
  onPluginStatus?: (status: PluginRuntimeStatus) => void;
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
  /** @internal */ _loadToken: number;
}

export interface PluginRuntimeStatus {
  kind: "activity" | "success" | "error";
  pluginId?: string;
  label: string;
  detail?: string;
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

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, "").slice(0, 140);
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
    ai: {
      providers: unavailable,
      models: unavailable,
      defaultModel: unavailable,
      agentSettings: unavailable,
      chat: unavailable,
      stream: unavailable,
      runBash: unavailable,
      memory: {
        list: unavailable,
        add: unavailable,
        delete: unavailable,
      },
      search: {
        grep: unavailable,
      },
      tasks: {
        submit: unavailable,
        list: unavailable,
        get: unavailable,
        cancel: unavailable,
      },
    },
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
  _loadToken: 0,

  load: async (hooks) => {
    if (get().loading || get().loaded) return;
    const loadToken = get()._loadToken + 1;
    set({ loading: true, error: null, hooks, _loadToken: loadToken });
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
      set({
        plugins: [...BUILTIN_PLUGINS, ...plugins],
        commands: builtinCommands,
        panels: builtinPanels,
        workers: {},
        shortcuts: {},
        loaded: true,
      });

      if (sorted.length > 0) {
        hooks.onPluginStatus?.({
          kind: "activity",
          label: "Plugins",
          detail: `Loading ${sorted.length} plugin${sorted.length === 1 ? "" : "s"}`,
        });
      }

      const loadOne = async (plugin: InstalledPlugin) => {
        if (get()._loadToken !== loadToken) return;
        try {
          const result = await loadPlugin(plugin, {
            onToast: hooks.onToast,
            onPrompt: hooks.onPrompt,
            onGetPreference: hooks.onGetPreference,
            onPluginStatus: hooks.onPluginStatus,
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
          const pluginShortcuts = plugin.manifest?.shortcuts || [];
          const registeredShortcuts: string[] = [];
          for (const shortcut of pluginShortcuts) {
            if (shortcut.enabled === false || !shortcut.key || !shortcut.command) continue;
            const command = result.commands.find((cmd) => cmd.name === shortcut.command);
            if (!command) continue;
            try {
              await register(shortcut.key, (event) => {
                if (event.state !== "Pressed") return;
                void get().runCommand(command);
              });
              registeredShortcuts.push(shortcut.key);
            } catch (error) {
              console.warn(`Failed to register shortcut ${shortcut.key} for ${plugin.id}:`, error);
              hooks.onPluginStatus?.({
                kind: "error",
                pluginId: plugin.id,
                label: "Shortcut failed",
                detail: `${plugin.name}: ${summarizeError(error)}`,
              });
            }
          }
          if (get()._loadToken !== loadToken) {
            unloadPluginRuntime(plugin.id, result.iframe, result.runtimeId);
            result.iframe.remove();
            return;
          }
          set((state) => ({
            commands: [...state.commands, ...result.commands],
            panels: result.panel
              ? { ...state.panels, [result.panel.pluginId]: result.panel }
              : state.panels,
            workers: { ...state.workers, [plugin.id]: result.iframe },
            shortcuts: registeredShortcuts.length
              ? { ...state.shortcuts, [plugin.id]: registeredShortcuts }
              : state.shortcuts,
          }));
          hooks.onPluginStatus?.({
            kind: "success",
            pluginId: plugin.id,
            label: "Plugin loaded",
            detail: plugin.name,
          });
        } catch (err) {
          console.error(`Failed to load plugin ${plugin.id}:`, err);
          hooks.onPluginStatus?.({
            kind: "error",
            pluginId: plugin.id,
            label: "Plugin failed",
            detail: `${plugin.name}: ${summarizeError(err)}`,
          });
        }
      };

      void Promise.allSettled(sorted.map(loadOne)).then(() => {
        if (get()._loadToken === loadToken) set({ loading: false });
      });
    } catch (err) {
      if (get()._loadToken === loadToken) {
        set({ error: String(err), loading: false, loaded: true });
      }
      hooks.onPluginStatus?.({
        kind: "error",
        label: "Plugins failed",
        detail: summarizeError(err),
      });
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
      loading: false,
      _loadToken: get()._loadToken + 1,
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
      get().hooks?.onPluginStatus?.({
        kind: "error",
        pluginId: command.pluginId,
        label: "Command failed",
        detail: `${command.pluginName}: ${summarizeError(error)}`,
      });
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
  const createAiChatPayload = (
    input: Parameters<PluginContext["ai"]["chat"]>[0],
    options: Parameters<PluginContext["ai"]["chat"]>[1] = {},
  ) => {
    if (typeof input === "string") return { ...options, prompt: input };
    if (Array.isArray(input)) return { ...options, messages: input };
    return { ...input };
  };

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
    ai: {
      providers: () => rpc("aiListProviders") as Promise<PluginAiProvider[]>,
      models: async (provider) => {
        const providers = await rpc("aiListProviders") as PluginAiProvider[];
        const selected = provider
          ? providers.find((item) => item.id === provider)
          : providers[0];
        return selected?.models ?? [];
      },
      defaultModel: () => rpc("aiDefaultModel") as Promise<PluginAiModelSelection | null>,
      agentSettings: () =>
        rpc("aiAgentSettings") as ReturnType<PluginContext["ai"]["agentSettings"]>,
      chat: (input, options) =>
        rpc("aiChat", createAiChatPayload(input, options)) as Promise<string>,
      stream: async (input, onChunk, options) => {
        const chunks = await rpc("aiStreamChat", createAiChatPayload(input, options)) as string[];
        let full = "";
        for (const chunk of chunks) {
          const text = String(chunk ?? "");
          full += text;
          onChunk(text);
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        return full;
      },
      runBash: (script, options = {}) =>
        rpc("aiRunBash", {
          script,
          cwd: options.cwd,
          timeoutMs: options.timeoutMs,
        }) as ReturnType<PluginContext["ai"]["runBash"]>,
      memory: {
        list: () => rpc("aiMemoryList") as ReturnType<PluginContext["ai"]["memory"]["list"]>,
        add: (text, tags = []) =>
          rpc("aiMemoryAdd", { text, tags }) as ReturnType<PluginContext["ai"]["memory"]["add"]>,
        delete: (id) =>
          rpc("aiMemoryDelete", { id }) as ReturnType<PluginContext["ai"]["memory"]["delete"]>,
      },
      search: {
        grep: (query, options = {}) =>
          rpc("aiGrepSearch", {
            query,
            root: options.root,
            maxResults: options.maxResults,
          }) as ReturnType<PluginContext["ai"]["search"]["grep"]>,
      },
      tasks: {
        submit: (input) =>
          rpc(
            "aiTaskSubmit",
            typeof input === "string" ? { prompt: input } : { ...input },
          ) as ReturnType<PluginContext["ai"]["tasks"]["submit"]>,
        list: () => rpc("aiTaskList") as ReturnType<PluginContext["ai"]["tasks"]["list"]>,
        get: (id) =>
          rpc("aiTaskGet", { id }) as ReturnType<PluginContext["ai"]["tasks"]["get"]>,
        cancel: (id) =>
          rpc("aiTaskCancel", { id }) as ReturnType<PluginContext["ai"]["tasks"]["cancel"]>,
      },
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
