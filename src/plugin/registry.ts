import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { toPortableGlobalShortcut } from "../utils/keyboard";
import {
  handlePluginRpc,
  isExpectedPluginMessageOrigin,
  isPluginRuntimeSource,
  loadPlugin,
  unloadPluginRuntime,
} from "./runtime";
import { createUnavailableContext } from "./context";
import { BUILTIN_PLUGINS } from "./builtin";
import { createQxLogger, qxLog } from "../lib/logger";
import type {
  InstalledPlugin,
  PluginRuntimeStatus,
  RegisteredCommand,
  RegisteredPanel,
} from "./types";
import {
  isBackgroundIntervalCommand,
  parseIntervalMs,
  peekLastRunAt,
  peekNextRunAt,
  usePluginBackgroundStore,
} from "./backgroundActivity";
import { clearPluginIcons } from "./pluginIconRegistry";
import { scoreMatchDescending } from "../search/rankResults";

/** One pending timer per plugin command — never stack duplicates. */
const backgroundTimers = new Map<string, number>();
/** In-flight background runs to prevent overlapping wallpaper sets. */
const backgroundInFlight = new Set<string>();
const registryLogger = createQxLogger("plugin.registry");

function backgroundJobKey(pluginId: string, commandName: string): string {
  return `${pluginId}\0${commandName}`;
}

export interface CommandMatch {
  command: RegisteredCommand;
  score: number;
}

interface PluginRuntimeHooks {
  onToast: (msg: string) => void;
  onPrompt: (label: string, defaultValue?: string) => Promise<string | null>;
  onGetPreference: (pluginId: string, id: string) => Promise<unknown>;
  onPluginStatus?: (status: PluginRuntimeStatus) => void;
  onRunPluginCommand?: (pluginId: string, command: string) => Promise<void>;
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
  runCommand: (
    command: RegisteredCommand,
    options?: import("./types").PluginCommandRunOptions,
  ) => Promise<void>;
  /** Start watching for plugin file changes (dev mode). */
  startDevWatcher: () => void;
  /** Stop watching for plugin file changes. */
  stopDevWatcher: () => void;
  devWatcherActive: boolean;
  /** @internal */ _devWatcherInterval: ReturnType<typeof setInterval> | null;
  /** @internal */ _loadToken: number;
}

function normalizeQuery(q: string): string {
  return q.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function isBuiltinPluginId(id: string): boolean {
  return id.startsWith("builtin:");
}

function clearBackgroundTimers(pluginId?: string): void {
  if (pluginId) {
    for (const [key, timer] of [...backgroundTimers.entries()]) {
      if (key.startsWith(`${pluginId}\0`)) {
        window.clearTimeout(timer);
        backgroundTimers.delete(key);
      }
    }
    for (const key of [...backgroundInFlight]) {
      if (key.startsWith(`${pluginId}\0`)) backgroundInFlight.delete(key);
    }
    usePluginBackgroundStore.getState().clearPlugin(pluginId);
    return;
  }
  for (const timer of backgroundTimers.values()) {
    window.clearTimeout(timer);
  }
  backgroundTimers.clear();
  backgroundInFlight.clear();
  usePluginBackgroundStore.getState().clearAll();
}

function scheduleBackgroundCommand(command: RegisteredCommand): void {
  if (!isBackgroundIntervalCommand(command)) return;
  const intervalMs = parseIntervalMs(command.interval);
  if (!intervalMs) return;
  const jobKey = backgroundJobKey(command.pluginId, command.name);

  // Replace any pending timer for this command (prevents stacked firings).
  const existingTimer = backgroundTimers.get(jobKey);
  if (existingTimer != null) {
    window.clearTimeout(existingTimer);
    backgroundTimers.delete(jobKey);
  }

  const bg = usePluginBackgroundStore.getState();
  const existing = bg.getJob(command.pluginId, command.name);
  const lastRunAt = existing?.lastRunAt ?? peekLastRunAt(command.pluginId, command.name);
  const now = Date.now();
  let nextRunAt =
    existing?.nextRunAt != null && Number.isFinite(existing.nextRunAt) && existing.nextRunAt > 0
      ? existing.nextRunAt
      : peekNextRunAt(command.pluginId, command.name);

  // Host-level throttle: never schedule sooner than a full interval after last run.
  // Protects against ephemeral Cache bugs and delay=0 storm after sleep/wake.
  if (lastRunAt != null && Number.isFinite(lastRunAt)) {
    const earliest = lastRunAt + intervalMs;
    if (nextRunAt == null || nextRunAt < earliest) nextRunAt = earliest;
  }
  if (nextRunAt == null || nextRunAt <= now) {
    // First arm, or overdue: wait a full interval from now (do not fire immediately
    // on every plugin load / resume — that made Bing wallpaper thrash).
    nextRunAt = now + intervalMs;
  }

  const delay = Math.max(1000, nextRunAt - now);
  bg.markScheduled(command, now + delay);

  const timer = window.setTimeout(() => {
    backgroundTimers.delete(jobKey);
    if (backgroundInFlight.has(jobKey)) {
      registryLogger.warn("Background plugin command skipped — previous run still in flight", {
        pluginId: command.pluginId,
        command: command.name,
      });
      const following = Date.now() + intervalMs;
      usePluginBackgroundStore.getState().markScheduled(command, following);
      scheduleBackgroundCommand(command);
      return;
    }

    registryLogger.info("Background plugin command triggered", {
      pluginId: command.pluginId,
      command: command.name,
      interval: command.interval,
    });
    backgroundInFlight.add(jobKey);
    // Arm the following slot before the run so crash mid-run still has a next time.
    const following = Date.now() + intervalMs;
    usePluginBackgroundStore.getState().markScheduled(command, following);
    void usePluginRegistry
      .getState()
      .runCommand(command, {
        launchType: "background",
        // Wallpaper download + AppleScript often exceeds the default 10s RPC timeout.
        timeoutMs: 120_000,
      })
      .finally(() => {
        backgroundInFlight.delete(jobKey);
        scheduleBackgroundCommand(command);
      });
  }, delay);
  registryLogger.debug("Background plugin command scheduled", {
    pluginId: command.pluginId,
    command: command.name,
    delayMs: delay,
    intervalMs,
    nextRunAt: now + delay,
  });
  backgroundTimers.set(jobKey, timer);
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
  const score = scoreMatchDescending(
    query,
    command.title,
    command.name,
    command.description,
    command.pluginName,
    ...(command.keywords || []),
  );
  return score / 100;
}

function summarizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, "").slice(0, 140);
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
    const startedAt = performance.now();
    registryLogger.info("Plugin registry load started", { loadToken });
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
      registryLogger.info("Installed plugins listed", {
        total: plugins.length,
        enabled: enabled.length,
        builtin: BUILTIN_PLUGINS.length,
      });
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
            onRunPluginCommand: hooks.onRunPluginCommand,
          });
          const rpcHandler = (event: MessageEvent) => {
            const data = event.data || {};
            if (!isExpectedPluginMessageOrigin(event)) return;
            if (data.pluginId !== plugin.id) return;
            const runtimeId = String(data.runtimeId || "");
            const source = event.source as Window | null;
            if (!source || typeof source.postMessage !== "function") return;
            if (!isPluginRuntimeSource(plugin.id, runtimeId, source)) return;
            if (data.type === "qx:plugin-log") {
              qxLog(data.level === "error" || data.level === "warn" || data.level === "debug" ? data.level : "info", "plugin.iframe", String(data.message || ""), {
                pluginId: plugin.id,
                runtimeId,
                ...(data.fields || {}),
              });
              return;
            }
            if (data.type === "qx:host-keydown") {
              if (data.key === "Escape") {
                window.dispatchEvent(new CustomEvent("qx:host-escape", {
                  detail: { pluginId: plugin.id, runtimeId },
                }));
              } else {
                // Re-dispatch on the owning iframe element so the keyboard
                // event bubbles through only the QxShell that contains the
                // focused plugin panel. Hidden worker runtimes live outside a
                // shell and therefore cannot open a stale action menu.
                const ownerFrame = Array.from(document.querySelectorAll("iframe"))
                  .find((frame) => frame.contentWindow === source);
                ownerFrame?.dispatchEvent(new KeyboardEvent("keydown", {
                  key: String(data.key || ""),
                  code: String(data.code || ""),
                  metaKey: data.metaKey === true,
                  ctrlKey: data.ctrlKey === true,
                  altKey: data.altKey === true,
                  shiftKey: data.shiftKey === true,
                  bubbles: true,
                  cancelable: true,
                }));
              }
              return;
            }
            if (data.type !== "qx:rpc") return;
            const requestId = String(data.requestId || "");
            const rpcStartedAt = performance.now();
            registryLogger.debug("Plugin RPC started", {
              pluginId: plugin.id,
              runtimeId,
              requestId,
              method: String(data.method),
            });
            void handlePluginRpc(
              plugin,
              String(data.method),
              (data.payload || {}) as Record<string, unknown>,
              hooks,
            )
              .then((rpcResult) => {
                registryLogger.debug("Plugin RPC completed", {
                  pluginId: plugin.id,
                  runtimeId,
                  requestId,
                  method: String(data.method),
                  durationMs: Math.round(performance.now() - rpcStartedAt),
                });
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
                registryLogger.error("Plugin RPC failed", {
                  pluginId: plugin.id,
                  runtimeId,
                  requestId,
                  method: String(data.method),
                  durationMs: Math.round(performance.now() - rpcStartedAt),
                  error,
                });
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
            // A plugin shortcut is process-global. Never reserve a system key
            // unless the manifest/user has explicitly enabled that binding.
            if (shortcut.enabled !== true || !shortcut.key || !shortcut.command) continue;
            const portableKey = toPortableGlobalShortcut(shortcut.key);
            const command = result.commands.find((cmd) => cmd.name === shortcut.command);
            if (!command) continue;
            try {
              await register(portableKey, (event) => {
                if (event.state !== "Pressed") return;
                void get().runCommand(command);
              });
              registeredShortcuts.push(portableKey);
            } catch (error) {
              registryLogger.warn("Plugin shortcut registration failed", {
                pluginId: plugin.id,
                shortcut: portableKey,
                command: shortcut.command,
                error,
              });
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
          clearBackgroundTimers(plugin.id);
          for (const command of result.commands) {
            scheduleBackgroundCommand(command);
          }
          usePluginBackgroundStore.getState().syncFromCommands([
            ...get().commands,
            ...result.commands,
          ]);
          hooks.onPluginStatus?.({
            kind: "success",
            pluginId: plugin.id,
            label: "Plugin loaded",
            detail: plugin.name,
          });
        } catch (err) {
          registryLogger.error("Plugin failed to load into registry", {
            pluginId: plugin.id,
            pluginName: plugin.name,
            error: err,
          });
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
        if (get()._loadToken === loadToken) {
          registryLogger.info("Plugin registry load completed", {
            loadToken,
            durationMs: Math.round(performance.now() - startedAt),
          });
          set({ loading: false });
        }
      });
    } catch (err) {
      registryLogger.error("Plugin registry load failed", {
        loadToken,
        durationMs: Math.round(performance.now() - startedAt),
        error: err,
      });
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
    registryLogger.info("Plugin registry unload started", {
      workers: Object.keys(workers).length,
      shortcuts: Object.values(shortcuts).flat().length,
    });
    clearBackgroundTimers();
    clearPluginIcons();
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
    registryLogger.info("Plugin registry unload completed");
  },

  install: async (path: string) => {
    registryLogger.info("Plugin install started", { path });
    const plugin = await invoke<InstalledPlugin>("install_plugin", { path });
    registryLogger.info("Plugin install completed", {
      pluginId: plugin.id,
      pluginName: plugin.name,
    });
    await get().refresh();
    return plugin;
  },

  uninstall: async (id: string) => {
    registryLogger.info("Plugin uninstall started", { pluginId: id });
    try {
      await invoke("plugin_tray_clear", { plugin_id: id });
    } catch {
      /* tray contribution optional */
    }
    await invoke("uninstall_plugin", { id });
    registryLogger.info("Plugin uninstall completed", { pluginId: id });
    await get().refresh();
  },

  setEnabled: async (id: string, enabled: boolean) => {
    registryLogger.info("Plugin enabled state change started", { pluginId: id, enabled });
    if (!enabled) {
      try {
        await invoke("plugin_tray_clear", { plugin_id: id });
      } catch {
        /* optional */
      }
    }
    await invoke("set_plugin_enabled", { id, enabled });
    registryLogger.info("Plugin enabled state change completed", { pluginId: id, enabled });
    await get().refresh();
  },

  refresh: async () => {
    const hooks = get().hooks;
    registryLogger.info("Plugin registry refresh started", { hasHooks: Boolean(hooks) });
    get().unload();
    if (hooks) {
      await get().load(hooks);
    } else {
      set({ loaded: true, loading: false });
    }
    registryLogger.info("Plugin registry refresh requested");
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

  runCommand: async (command, options) => {
    const startedAt = performance.now();
    const isBackgroundJob =
      options?.launchType === "background" || isBackgroundIntervalCommand(command);
    // Interval commands (manual or timer) update the background-activity port so
    // launcher / settings badges show last execution without coupling to timers.
    if (isBackgroundIntervalCommand(command)) {
      usePluginBackgroundStore.getState().markRunning(command);
    }
    registryLogger.info("Plugin command dispatch started", {
      pluginId: command.pluginId,
      command: command.name,
      mode: command.mode,
      launchType: options?.launchType || (isBackgroundJob ? "background" : "userInitiated"),
    });
    try {
      await command.run(createUnavailableContext(command.pluginId), {
        launchType:
          options?.launchType ||
          (isBackgroundIntervalCommand(command) ? "background" : "userInitiated"),
        timeoutMs: options?.timeoutMs,
      });
      if (isBackgroundIntervalCommand(command)) {
        usePluginBackgroundStore.getState().markFinished(command, null);
      }
      registryLogger.info("Plugin command dispatch completed", {
        pluginId: command.pluginId,
        command: command.name,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      if (isBackgroundIntervalCommand(command)) {
        usePluginBackgroundStore.getState().markFinished(command, summarizeError(error));
      }
      registryLogger.error("Plugin command dispatch failed", {
        pluginId: command.pluginId,
        command: command.name,
        durationMs: Math.round(performance.now() - startedAt),
        error,
      });
      // Background interval failures stay quiet — toast spam made wallpaper thrash feel worse.
      if (options?.launchType !== "background") {
        const message = `Plugin command failed: ${String(error)}`;
        get().hooks?.onToast(message);
        get().hooks?.onPluginStatus?.({
          kind: "error",
          pluginId: command.pluginId,
          label: "Command failed",
          detail: `${command.pluginName}: ${summarizeError(error)}`,
        });
      }
    }
  },

  startDevWatcher: () => {
    if (get().devWatcherActive) return;
    const existing = get()._devWatcherInterval;
    if (existing) clearInterval(existing);
    const interval = setInterval(async () => {
      try {
        registryLogger.debug("Dev watcher refresh tick");
        await get().refresh();
      } catch (error) {
        registryLogger.warn("Dev watcher refresh failed", { error });
        // Ignore errors during auto-refresh
      }
    }, 3000);
    set({ devWatcherActive: true, _devWatcherInterval: interval });
    registryLogger.info("Plugin dev watcher started");
  },

  stopDevWatcher: () => {
    const interval = (get() as any)._devWatcherInterval;
    if (interval) clearInterval(interval);
    set({ devWatcherActive: false, _devWatcherInterval: null });
    registryLogger.info("Plugin dev watcher stopped");
  },
}));
