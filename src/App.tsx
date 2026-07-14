import { Component, Suspense, lazy, useEffect, useCallback, useRef, useState, useTransition } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, LogicalSize, primaryMonitor } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useStore, type AppEntry, type SearchScope } from "./store";
import Launcher from "./Launcher";
import { requestLauncherSearchFocus } from "./SearchBar";
import { useSettingsStore } from "./modules/settings/store";
import { ThemeProvider } from "./ThemeProvider";
import { usePluginRegistry } from "./plugin/registry";
import type { PluginRuntimeStatus } from "./plugin/types";
import type { BottomIslandContent } from "./components/QxShell";
import QxShell from "./components/QxShell";
import { LoadingLabel, Skeleton } from "./components/ui";
import { registerAllBuiltins } from "./plugin/builtin";
import { PluginHost, PluginPanelViewport } from "./plugin/PluginHost";
import { calculateExpression } from "./search/calculator";
import {
  itemMatchesSearchMetadata,
  metadataMatchesQuery,
  moduleMetadataKey,
  pluginMetadataKey,
} from "./search/searchMetadata";
import {
  encodeModuleLaunchPath,
  isModuleSearchEnabled,
  parseModuleLaunchPath,
  searchModuleSurfaces,
  setPendingModuleLaunch,
} from "./search/moduleSurfaces";
import { loadClipboardEntryById, pasteClipboardEntryAtCursor } from "./modules/clipboard/actions";
import { useEscBack } from "./hooks/useEscBack";
import { useT } from "./i18n";
import { configureQxLogger, createQxLogger, installDevConsoleCapture } from "./lib/logger";
import { getQxDesktopPlatform } from "./utils/keyboard";
import "./App.css";

const ClipboardPanel = lazy(() => import("./modules/clipboard/ClipboardPanel"));
const ScreenRecorder = lazy(() => import("./modules/screencap/ScreenRecorder"));
const DevTxtTool = lazy(() => import("./modules/documents/DevTxtTool"));
const SettingsPanel = lazy(() => import("./modules/settings/SettingsPanel"));
const RssReader = lazy(() => import("./modules/rss"));
const V2exPanel = lazy(() => import("./modules/v2ex/V2exPanel"));
const G4fReader = lazy(() => import("./modules/qx-ai"));
const MacroRecorder = lazy(() => import("./modules/macros/MacroRecorder"));
const WeatherPanel = lazy(() => import("./modules/weather/WeatherPanel"));

const SETTINGS_KEYWORDS = ["settings", "preferences", "plugins", "shortcuts", "appearance", "advanced"];
const MIN_WINDOW_WIDTH = 480;
const MIN_WINDOW_HEIGHT = 360;
const MAX_WINDOW_WIDTH = 1500;
const MAX_WINDOW_HEIGHT = 882;
const FIRST_LAUNCH_WINDOW_RATIO = 0.6;
const OVERSIZED_SAVED_WINDOW_RATIO = 0.9;
const MODULE_SWITCH_PAINT_DELAY_MS = 32;
const HOST_ESCAPE_EVENT = "qx:host-escape";
/** Auto-update must never compete with first paint / first summon. */
const AUTO_UPDATE_START_DELAY_MS = 18_000;
/** Reuse empty launcher list without another search_apps("") for this long. */
const EMPTY_LAUNCHER_CACHE_MS = 8_000;
/** External plugins load after apps are ready — keep off the critical path. */
const PLUGIN_LOAD_DELAY_MS = 1_400;
const appLogger = createQxLogger("main.app");

/** Module-level: shared by phase1, focus, apps:updated, and doSearch empty path. */
let lastEmptyAppsFetchAt = 0;

interface QxUpdateInfo {
  available: boolean;
  latest_version: string | null;
  can_install: boolean;
}

const MODULE_LABEL_KEYS: Record<string, { key: string; fallback: string }> = {
  clipboard: { key: "clipboard.title", fallback: "Clipboard History" },
  screencap: { key: "launcher.screencap", fallback: "Screen Recording" },
  rss: { key: "launcher.rss", fallback: "RSS Reader" },
  v2ex: { key: "launcher.v2ex", fallback: "V2EX" },
  weather: { key: "launcher.weather", fallback: "Weather" },
  "qx-ai": { key: "module.qx-ai", fallback: "QxAI Chat" },
  macros: { key: "launcher.macros", fallback: "Macro Recorder" },
  documents: { key: "launcher.documents", fallback: "Documents" },
  settings: { key: "launcher.settings", fallback: "Settings" },
};

function getModuleLabel(tab: string, t: (key: string, fallback: string) => string): string {
  if (tab.startsWith("plugin:")) {
    const pluginId = tab.slice("plugin:".length);
    const panel = usePluginRegistry.getState().panels[pluginId];
    return panel?.title || panel?.pluginName || pluginId;
  }
  const entry = MODULE_LABEL_KEYS[tab];
  if (entry) return t(entry.key, entry.fallback);
  return t("common.module", "Module");
}

function ModuleLoadingShell({
  tab,
  onBack,
}: {
  tab: string;
  onBack: () => void;
}) {
  const t = useT();
  const title = getModuleLabel(tab, t);
  const { onKeyDown } = useEscBack({
    launcher: onBack,
  });

  return (
    <QxShell
      title={title}
      className="qx-module-loading-shell"
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: onBack }}
      onKeyDown={onKeyDown}
      search={
        <div className="qx-search-wrap qx-module-loading-search" aria-hidden="true">
          <span className="qx-search-icon" />
          <Skeleton className="qx-module-loading-search-line" />
        </div>
      }
      context={
        <div className="qx-module-loading-context" aria-hidden="true">
          <Skeleton className="qx-skeleton-line medium" />
          <Skeleton className="qx-skeleton-line long" />
          <Skeleton className="qx-skeleton-line short" />
        </div>
      }
      island={{
        label: title,
        detail: t("common.loadingModule", "Loading module"),
        activity: "bounce",
      }}
      primaryAction={{
        label: t("common.loading", "Loading"),
        disabled: true,
      }}
    >
      <div
        className="qx-module-loading-stage"
        aria-label={t("common.loadingNamed", "Loading {name}...").replace("{name}", title)}
      >
        <div className="qx-skeleton-stack">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="qx-skeleton-row" key={index}>
              <Skeleton className="qx-skeleton-icon" />
              <div className="qx-module-loading-copy">
                <Skeleton className="qx-skeleton-line long" />
                <Skeleton className="qx-skeleton-line medium" />
              </div>
              <Skeleton className="qx-skeleton-line short" />
            </div>
          ))}
        </div>
        <div className="qx-empty-state">
          <LoadingLabel>
            {t("common.loadingNamed", "Loading {name}...").replace("{name}", title)}
          </LoadingLabel>
        </div>
      </div>
    </QxShell>
  );
}

function ModuleErrorShell({
  tab,
  error,
  onBack,
}: {
  tab: string;
  error: string;
  onBack: () => void;
}) {
  const t = useT();
  const title = getModuleLabel(tab, t);
  const { onKeyDown } = useEscBack({
    launcher: onBack,
  });

  return (
    <QxShell
      title={title}
      className="qx-module-loading-shell"
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: onBack }}
      onKeyDown={onKeyDown}
      search={
        <div className="qx-rss-detail-title">
          <span>{title}</span>
        </div>
      }
      context={
        <div className="qx-action-panel">
          <div className="qx-action-title">{t("common.moduleError", "Module Error")}</div>
          <div className="v2ex-context-copy">
            <span>{error}</span>
          </div>
        </div>
      }
      island={{
        label: t("common.moduleError", "Module Error"),
        detail: title,
        tone: "danger",
        actionLabel: t("common.back", "Back"),
        onAction: onBack,
      }}
      primaryAction={{
        label: t("common.back", "Back"),
        kbd: "Esc",
        tone: "primary",
        onClick: onBack,
      }}
    >
      <div className="qx-empty-state">
        {t("common.failedRender", "{name} failed to render.").replace("{name}", title)}
      </div>
    </QxShell>
  );
}

class ModuleErrorBoundary extends Component<
  {
    tab: string;
    onBack: () => void;
    children: ReactNode;
  },
  {
    error: string | null;
  }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    appLogger.error("Module render failed", {
      error,
      componentStack: info.componentStack,
      tab: this.props.tab,
    });
    console.error("Module render failed:", error, info);
  }

  componentDidUpdate(prevProps: { tab: string }) {
    if (prevProps.tab !== this.props.tab && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <ModuleErrorShell
          tab={this.props.tab}
          error={this.state.error}
          onBack={this.props.onBack}
        />
      );
    }

    return this.props.children;
  }
}

function clampWindowSize(width: number, height: number) {
  return {
    width: Math.min(MAX_WINDOW_WIDTH, Math.max(MIN_WINDOW_WIDTH, Math.round(width || 0))),
    height: Math.min(MAX_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, Math.round(height || 0))),
  };
}

async function getMonitorLogicalWorkSize() {
  const monitor = await currentMonitor().then((m) => m ?? primaryMonitor()).catch(() => null);
  return monitor?.workArea.size.toLogical(monitor.scaleFactor) ?? null;
}

function clampWindowSizeForMonitor(width: number, height: number, monitorSize: { width: number; height: number } | null) {
  const base = clampWindowSize(width, height);
  if (!monitorSize) return base;
  const isOversized =
    base.width > monitorSize.width * OVERSIZED_SAVED_WINDOW_RATIO ||
    base.height > monitorSize.height * OVERSIZED_SAVED_WINDOW_RATIO;
  if (!isOversized) return base;

  return clampWindowSize(
    Math.min(base.width, monitorSize.width * FIRST_LAUNCH_WINDOW_RATIO),
    Math.min(base.height, monitorSize.height * FIRST_LAUNCH_WINDOW_RATIO),
  );
}

async function getFirstLaunchWindowSize() {
  const logicalSize = await getMonitorLogicalWorkSize();
  if (!logicalSize) {
    return clampWindowSize(980, 576);
  }

  return clampWindowSize(
    logicalSize.width * FIRST_LAUNCH_WINDOW_RATIO,
    logicalSize.height * FIRST_LAUNCH_WINDOW_RATIO,
  );
}

// Register built-in modules into the plugin registry once at startup.
registerAllBuiltins();

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function matchesSettings(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return SETTINGS_KEYWORDS.some((k) => k === q || k.startsWith(q) || q.startsWith(k));
}

function dedupeEntries(entries: AppEntry[]): AppEntry[] {
  const seen = new Set<string>();
  const next: AppEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.kind ?? "app"}:${entry.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(entry);
  }
  return next;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortableInvoke<T>(command: string, args: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
    invoke<T>(command, args)
      .then((value) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
        else resolve(value);
      })
      .catch((error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
        else reject(error);
      });
  });
}

function shouldLoadSlowSearchProviders(query: string, scope: SearchScope): boolean {
  const trimmed = query.trim();
  const shouldSearchFiles =
    (scope === "files" && trimmed.length >= 2) || (scope === "all" && trimmed.length >= 3);
  const shouldSearchClipboard = (scope === "all" || scope === "clipboard") && trimmed.length > 0;

  return shouldSearchFiles || shouldSearchClipboard;
}

function mapAppEntries(apps: AppEntry[]): AppEntry[] {
  return apps.map((a) => ({ ...a, kind: a.kind ?? ("app" as const) }));
}

/**
 * Load the empty-query launcher app list into the results store.
 * Used on startup, first show, re-focus, and after background app scans.
 */
async function loadEmptyLauncherApps(
  setResults: (entries: AppEntry[]) => void,
  setLoadingPhase: (p: import("./store").LoadingPhase) => void,
  options?: { force?: boolean },
): Promise<number> {
  if (!isTauriRuntime()) {
    setLoadingPhase("ready");
    return 0;
  }
  const force = options?.force === true;
  const now = Date.now();
  if (!force && now - lastEmptyAppsFetchAt < EMPTY_LAUNCHER_CACHE_MS) {
    const existing = useStore.getState().results.filter((r) => (r.kind ?? "app") === "app");
    if (existing.length > 0) {
      setLoadingPhase("ready");
      return existing.length;
    }
  }
  try {
    const apps = await invoke<AppEntry[]>("search_apps", { query: "" });
    const mapped = mapAppEntries(apps);
    lastEmptyAppsFetchAt = Date.now();
    if (mapped.length > 0) {
      setResults(mapped);
      setLoadingPhase("ready");
    }
    return mapped.length;
  } catch {
    setLoadingPhase("ready");
    return 0;
  }
}

/**
 * Phased startup:
 *   Phase 1 (immediate): Load apps DB cache via search_apps("") into results
 *   Phase 2 (background): Preload icons, scan for new apps (apps:updated event triggers refresh)
 *   Phase 3 (lazy): Settings, plugins, clipboard history
 *
 * Cold install: DB/cache is empty until the background scan finishes. Keep the
 * loading skeleton and poll until apps arrive (or give up after a few seconds).
 */
async function triggerPhase1Load(
  appsReady: boolean,
  setAppsReady: (r: boolean) => void,
  setLoadingPhase: (p: import("./store").LoadingPhase) => void,
  setResults: (entries: AppEntry[]) => void,
) {
  if (appsReady) return;
  if (!isTauriRuntime()) {
    setAppsReady(true);
    setLoadingPhase("ready");
    return;
  }
  try {
    setLoadingPhase("loading-apps");
    const count = await loadEmptyLauncherApps(setResults, setLoadingPhase);
    setAppsReady(true);
    if (count > 0) return;

    // Cold first launch: wait for background `apps:updated` scan, with a short poll fallback.
    for (let attempt = 0; attempt < 24; attempt += 1) {
      await new Promise((r) => window.setTimeout(r, 250));
      const n = await loadEmptyLauncherApps(setResults, setLoadingPhase, { force: true });
      if (n > 0) return;
      // Another path may have filled results (apps:updated listener).
      if (useStore.getState().results.some((r) => (r.kind ?? "app") === "app")) {
        setLoadingPhase("ready");
        return;
      }
    }
    // No apps after ~6s — stop the skeleton so the UI is usable.
    setLoadingPhase("ready");
  } catch {
    setAppsReady(true);
    setLoadingPhase("ready");
  }
}

function App() {
  const {
    query,
    setVisible,
    setQuery,
    setResults,
    results,
    selectedIndex,
    setSelectedIndex,
    tab,
    setTab,
    updateResultIcons,
    loadingPhase,
    setLoadingPhase,
    appsReady,
    setAppsReady,
  } = useStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const slowSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const recordSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchFadeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchSeqRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchScopeRef = useRef<SearchScope>("all");
  const { settings, load: loadSettings, loaded: settingsLoaded } = useSettingsStore();

  // Keep Rust global-shortcut toggle-to-close in sync with the active tab.
  useEffect(() => {
    void invoke("set_active_route", { route: tab }).catch(() => {});
  }, [tab]);
  const { load: loadPlugins, findCommands } = usePluginRegistry();
  const pluginCommandCount = usePluginRegistry((state) => state.commands.length);
  const pluginPanelCount = usePluginRegistry((state) => Object.keys(state.panels).length);
  const phase1Ref = useRef(false);
  const startupWindowRestoredRef = useRef(false);
  const autoUpdateStartedRef = useRef(false);
  const resizeSaveTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const pendingWindowSizeRef = useRef<{ width: number; height: number } | null>(null);
  const closeToBackgroundRef = useRef(false);
  const windowFocusedRef = useRef<boolean | null>(null);
  /** Ignore blur-to-hide for a short window after first-launch show (focus can flicker). */
  const ignoreBlurUntilRef = useRef(0);
  /** Throttle empty-launcher reloads — full search_apps("") on every focus made summon lag ~1s. */
  const lastEmptyLauncherLoadAtRef = useRef(0);
  const emptyLauncherLoadInFlightRef = useRef(false);
  const pluginSearchVersionRef = useRef("");
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchSettling, setIsSearchSettling] = useState(false);
  const [pluginIsland, setPluginIsland] = useState<BottomIslandContent | null>(null);
  const pluginIslandTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [mountedTab, setMountedTab] = useState(tab);
  const [, startSearchTransition] = useTransition();

  const performHostEscape = useCallback(() => {
    const state = useStore.getState();
    if (state.tab !== "launcher") {
      setTab("launcher");
      return;
    }
    // Launcher Esc cascade: clear search text first so the user can retype and
    // search again. Only hide the window when the query is already empty.
    if (state.query.length > 0) {
      state.setQuery("");
      state.setSelectedIndex(0);
      return;
    }
    if (isTauriRuntime()) {
      invoke("floating_hide_restore_focus").catch(() => {
        getCurrentWindow().hide().catch(() => {});
      });
    }
  }, [setTab]);

  const applyResults = useCallback(
    (entries: AppEntry[]) => {
      startSearchTransition(() => setResults(entries));
    },
    [setResults, startSearchTransition],
  );

  const persistPendingWindowSize = useCallback(() => {
    const pending = pendingWindowSizeRef.current;
    pendingWindowSizeRef.current = null;
    if (resizeSaveTimerRef.current) {
      window.clearTimeout(resizeSaveTimerRef.current);
      resizeSaveTimerRef.current = null;
    }
    if (!pending) return;

    const { settings, patch } = useSettingsStore.getState();
    if (
      pending.width !== settings.appearance.window_width ||
      pending.height !== settings.appearance.window_height
    ) {
      patch("appearance", {
        ...settings.appearance,
        window_width: pending.width,
        window_height: pending.height,
      });
    }
  }, []);

  const flushSettingsBeforeExit = useCallback(async () => {
    persistPendingWindowSize();
    await useSettingsStore.getState().flush();
  }, [persistPendingWindowSize]);

  const finishSearchActivity = useCallback((seq: number) => {
    if (seq !== searchSeqRef.current) return;
    if (searchFadeTimerRef.current) clearTimeout(searchFadeTimerRef.current);
    setIsSearching(false);
    setIsSearchSettling(true);
    searchFadeTimerRef.current = setTimeout(() => {
      if (seq === searchSeqRef.current) setIsSearchSettling(false);
      searchFadeTimerRef.current = undefined;
    }, 180);
  }, []);

  useEffect(() => {
    if (tab === mountedTab) return;
    if (tab === "launcher") {
      setMountedTab(tab);
      return;
    }

    let frameId: number | undefined;
    let timerId: ReturnType<typeof window.setTimeout> | undefined;
    frameId = window.requestAnimationFrame(() => {
      timerId = window.setTimeout(() => {
        setMountedTab(tab);
      }, MODULE_SWITCH_PAINT_DELAY_MS);
    });

    return () => {
      if (frameId !== undefined) window.cancelAnimationFrame(frameId);
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [mountedTab, tab]);

  // Phase 1: Load app cache into results immediately — runs once on mount
  useEffect(() => {
    if (phase1Ref.current) return;
    phase1Ref.current = true;
    void triggerPhase1Load(appsReady, setAppsReady, setLoadingPhase, setResults);
  }, [appsReady, setAppsReady, setLoadingPhase, setResults]);

  // Settings: start as soon as we can — small JSON; needed for theme before plugins.
  useEffect(() => {
    if (!settingsLoaded) void loadSettings();
  }, [settingsLoaded, loadSettings]);

  useEffect(() => {
    configureQxLogger({
      level: settings.advanced.log_level,
      devMode: settings.advanced.dev_mode,
    });
    if (settings.advanced.dev_mode) {
      installDevConsoleCapture();
    }
  }, [settings.advanced.dev_mode, settings.advanced.log_level]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen("settings-updated", () => {
      void loadSettings();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadSettings]);

  useEffect(() => {
    if (!settingsLoaded || !appsReady || !settings.general.auto_update || !isTauriRuntime()) return;
    if (autoUpdateStartedRef.current) return;
    autoUpdateStartedRef.current = true;

    let cancelled = false;
    const timerId = window.setTimeout(() => {
      const runAutoUpdate = async () => {
        try {
          // Prefer downloading while the panel is hidden so bandwidth/CPU
          // do not hit the launcher critical path.
          if (useStore.getState().visible) {
            appLogger.debug("Auto update deferred: panel visible");
            if (!cancelled) {
              window.setTimeout(() => {
                if (!cancelled) void runAutoUpdate();
              }, 12_000);
            }
            return;
          }
          appLogger.info("Auto update check started");
          const info = await invoke<QxUpdateInfo>("qx_update_check");
          appLogger.debug("Auto update check completed", { info });
          if (cancelled || !info.available || !info.can_install) return;

          const versionLabel = info.latest_version ? `v${info.latest_version}` : "latest release";
          setPluginIsland({
            label: "Updating Qx",
            detail: `Downloading ${versionLabel}`,
            tone: "neutral",
            activity: "bounce",
          });

          await invoke("qx_update_download_and_install");
          appLogger.info("Auto update download and install started", {
            latestVersion: info.latest_version,
          });
          if (!cancelled) {
            setPluginIsland({
              label: "Installing update",
              detail: "Qx will restart.",
              tone: "success",
              activity: "bounce",
            });
          }
        } catch (error) {
          appLogger.debug("Auto update skipped", { error });
          console.info("auto update skipped:", error);
        }
      };

      void runAutoUpdate();
    }, AUTO_UPDATE_START_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [appsReady, settings.general.auto_update, settingsLoaded]);

  // Plugins: after apps ready + idle delay — never block first launcher paint.
  useEffect(() => {
    if (!appsReady) return;
    let cancelled = false;
    const showPluginStatus = (status: PluginRuntimeStatus) => {
      if (pluginIslandTimerRef.current) {
        window.clearTimeout(pluginIslandTimerRef.current);
        pluginIslandTimerRef.current = null;
      }
      const next: BottomIslandContent = {
        label: status.label,
        detail: status.detail,
        tone: status.kind === "error" ? "danger" : status.kind === "success" ? "success" : "neutral",
        activity: status.kind === "activity" ? "bounce" : undefined,
      };
      setPluginIsland(next);
      if (status.kind !== "activity") {
        pluginIslandTimerRef.current = window.setTimeout(() => {
          setPluginIsland(null);
          pluginIslandTimerRef.current = null;
        }, status.kind === "error" ? 8000 : 2600);
      }
    };
    const start = () => {
      if (cancelled) return;
      void loadPlugins({
        onToast: (msg) => window.dispatchEvent(new CustomEvent("qx:toast", { detail: msg })),
        onPrompt: async (label, def) => window.prompt(label, def ?? ""),
        onGetPreference: async (pluginId, id) => {
          const values = await invoke<Record<string, unknown>>("plugin_preferences_get", {
            id: pluginId,
          });
          if (Object.prototype.hasOwnProperty.call(values, id)) {
            return values[id];
          }
          const plugin = usePluginRegistry.getState().plugins.find((item) => item.id === pluginId);
          return plugin?.manifest?.preferences?.find((pref) => pref.id === id)?.default ?? null;
        },
        onPluginStatus: showPluginStatus,
      });
    };
    let idleId: number | undefined;
    let timerId: ReturnType<typeof window.setTimeout> | undefined;
    const ric = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;
    if (typeof ric === "function") {
      idleId = ric(start, { timeout: PLUGIN_LOAD_DELAY_MS });
    } else {
      timerId = window.setTimeout(start, PLUGIN_LOAD_DELAY_MS);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined) {
        (
          window as Window & { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback?.(idleId);
      }
      if (timerId !== undefined) window.clearTimeout(timerId);
      if (pluginIslandTimerRef.current) {
        window.clearTimeout(pluginIslandTimerRef.current);
        pluginIslandTimerRef.current = null;
      }
    };
  }, [loadPlugins, appsReady]);

  // Listen for qx:navigate custom events (from built-in module commands)
  useEffect(() => {
    const handler = (e: Event) => {
      const tabId = (e as CustomEvent).detail as string;
      if (tabId === "clipboard" || tabId === "screencap"
          || tabId === "rss" || tabId === "v2ex" || tabId === "weather" || tabId === "qx-ai" || tabId === "macros" || tabId === "documents" || tabId === "settings") {
        setTab(tabId);
      } else if (tabId?.startsWith("plugin:")) {
        setTab(tabId);
      }
    };
    window.addEventListener("qx:navigate", handler);
    return () => window.removeEventListener("qx:navigate", handler);
  }, [setTab]);

  useEffect(() => {
    const shellRadius = Math.min(8, Math.max(4, settings.appearance.border_radius));
    const controlRadius = Math.min(6, Math.max(4, settings.appearance.border_radius));
    const configuredOpacity = Math.min(0.4, Math.max(0.05, settings.appearance.blur_opacity));
    const opacityScale = (configuredOpacity - 0.05) / 0.35;
    const isWindows = getQxDesktopPlatform() === "windows";

    // WebView2 does not reproduce macOS vibrancy from CSS backdrop-filter.
    // Keep Windows surfaces substantially more opaque while preserving the
    // full settings slider range; native Acrylic remains an optional backdrop.
    const opacity = isWindows ? 0.82 + opacityScale * 0.14 : configuredOpacity;
    const regionOpacity = isWindows
      ? 0.76 + opacityScale * 0.16
      : Math.min(0.16, Math.max(0.02, opacity * 0.32));
    const elevatedRegionOpacity = isWindows
      ? 0.82 + opacityScale * 0.14
      : Math.min(0.20, Math.max(0.03, opacity * 0.46));
    const glassRegionOpacity = isWindows
      ? 0.70 + opacityScale * 0.18
      : Math.min(0.12, Math.max(0.015, opacity * 0.24));
    const overlayRegionOpacity = isWindows
      ? 0.78 + opacityScale * 0.16
      : Math.min(0.18, Math.max(0.025, opacity * 0.38));
    const popoverOpacity = isWindows
      ? 0.90 + opacityScale * 0.08
      : Math.min(0.54, Math.max(0.20, opacity + 0.14));
    const surfaceOpacity1 = isWindows
      ? 0.90 + opacityScale * 0.08
      : Math.min(0.78, Math.max(0.28, opacity * 1.55));
    const surfaceOpacity2 = isWindows
      ? 0.84 + opacityScale * 0.12
      : Math.min(0.66, Math.max(0.22, opacity * 1.28));
    const surfaceOpacity3 = isWindows
      ? 0.78 + opacityScale * 0.14
      : Math.min(0.58, Math.max(0.18, opacity * 1.05));
    document.documentElement.style.setProperty(
      "--qx-canvas-opacity",
      String(opacity),
    );
    document.documentElement.style.setProperty(
      "--qx-window-opacity",
      String(opacity),
    );
    document.documentElement.style.setProperty(
      "--qx-shell-region-opacity",
      String(regionOpacity),
    );
    document.documentElement.style.setProperty(
      "--qx-shell-elevated-region-opacity",
      String(elevatedRegionOpacity),
    );
    document.documentElement.style.setProperty(
      "--qx-shell-glass-region-opacity",
      String(glassRegionOpacity),
    );
    document.documentElement.style.setProperty(
      "--qx-shell-overlay-region-opacity",
      String(overlayRegionOpacity),
    );
    document.documentElement.style.setProperty(
      "--qx-shell-popover-opacity",
      String(popoverOpacity),
    );
    document.documentElement.style.setProperty(
      "--qx-surface-opacity-1",
      String(surfaceOpacity1),
    );
    document.documentElement.style.setProperty(
      "--qx-surface-opacity-2",
      String(surfaceOpacity2),
    );
    document.documentElement.style.setProperty(
      "--qx-surface-opacity-3",
      String(surfaceOpacity3),
    );
    document.documentElement.style.setProperty(
      "--qx-radius",
      `${shellRadius}px`,
    );
    document.documentElement.style.setProperty(
      "--qx-control-radius",
      `${controlRadius}px`,
    );
    document.documentElement.style.setProperty(
      "--radius",
      `${controlRadius}px`,
    );
    document.documentElement.style.setProperty(
      "--qx-card-radius",
      `${shellRadius}px`,
    );
    document.documentElement.style.setProperty(
      "--qx-font-size",
      `${settings.appearance.font_size}px`,
    );
  }, [
    settings.appearance.blur_opacity,
    settings.appearance.border_radius,
    settings.appearance.font_size,
  ]);

  // A fresh install presents the launcher once. After that Qx starts as a
  // background helper and the launcher is surfaced only by an explicit
  // shortcut/tray action.
  useEffect(() => {
    if (!settingsLoaded || !isTauriRuntime()) return;
    if (startupWindowRestoredRef.current) return;
    const restoreWindow = async () => {
      const win = getCurrentWindow();
      const currentSettings = useSettingsStore.getState().settings;
      const appearance = currentSettings.appearance;
      if (!appearance) return;
      const hasSavedSize = appearance.window_width > 0 && appearance.window_height > 0;
      const monitorSize = await getMonitorLogicalWorkSize();
      const { width, height } = hasSavedSize
        ? clampWindowSizeForMonitor(appearance.window_width, appearance.window_height, monitorSize)
        : await getFirstLaunchWindowSize();
      await win.setSize(new LogicalSize(width, height)).catch(() => {});
      if (appearance.window_width !== width || appearance.window_height !== height) {
        useSettingsStore.getState().patch("appearance", {
          ...appearance,
          window_width: width,
          window_height: height,
        });
      }

      startupWindowRestoredRef.current = true;
      setTab("launcher");
      const shouldShowFirstLaunch = !currentSettings.general.has_shown_launcher && !hasSavedSize;
      if (!currentSettings.general.has_shown_launcher) {
        useSettingsStore.getState().patch("general", {
          ...currentSettings.general,
          has_shown_launcher: true,
        });
        await useSettingsStore.getState().flush();
      }
      if (shouldShowFirstLaunch) {
        // Let the size settle, then show via floating_show (centers on the
        // cursor monitor — do not use win.center() which can land on the wrong display).
        await new Promise((r) => window.setTimeout(r, 50));
        ignoreBlurUntilRef.current = Date.now() + 2500;
        await invoke("floating_show").catch(() => {});
        // Ensure the onboarding window has app results even if focus events are flaky.
        await loadEmptyLauncherApps(setResults, setLoadingPhase);
        // Re-center once more after the panel is actually visible.
        await invoke("floating_show").catch(() => {});
      }
    };

    restoreWindow().catch((e) => {
      console.warn("window size restore failed:", e);
    });
  }, [settingsLoaded, setTab, setResults, setLoadingPhase]);

  // Save window size on resize
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const win = getCurrentWindow();
    const unlisten = win.onResized(async ({ payload }) => {
      const scaleFactor = await win.scaleFactor().catch(() => 1);
      const logical = {
        width: payload.width / scaleFactor,
        height: payload.height / scaleFactor,
      };
      const { width, height } = clampWindowSize(logical.width, logical.height);
      if (logical.width !== width || logical.height !== height) {
        await win.setSize(new LogicalSize(width, height)).catch(() => {});
      }
      pendingWindowSizeRef.current = { width, height };
      if (resizeSaveTimerRef.current) {
        window.clearTimeout(resizeSaveTimerRef.current);
      }
      resizeSaveTimerRef.current = window.setTimeout(() => {
        persistPendingWindowSize();
      }, 250);
    });
    return () => {
      if (resizeSaveTimerRef.current) {
        window.clearTimeout(resizeSaveTimerRef.current);
        resizeSaveTimerRef.current = null;
      }
      pendingWindowSizeRef.current = null;
      unlisten.then((fn) => fn());
    };
  }, [persistPendingWindowSize]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const win = getCurrentWindow();
    const flushOnPageExit = () => {
      void flushSettingsBeforeExit();
    };
    const unlisten = win.onCloseRequested(async (event) => {
      event.preventDefault();
      if (closeToBackgroundRef.current) return;
      closeToBackgroundRef.current = true;
      try {
        await flushSettingsBeforeExit();
      } finally {
        await invoke("floating_hide").catch(() => win.hide());
        closeToBackgroundRef.current = false;
      }
    });

    window.addEventListener("pagehide", flushOnPageExit);
    window.addEventListener("beforeunload", flushOnPageExit);
    return () => {
      window.removeEventListener("pagehide", flushOnPageExit);
      window.removeEventListener("beforeunload", flushOnPageExit);
      unlisten.then((fn) => fn());
    };
  }, [flushSettingsBeforeExit]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const win = getCurrentWindow();
    const unlistenFocus = win.onFocusChanged(({ payload: focused }) => {
      if (windowFocusedRef.current === focused) return;
      const wasFocused = windowFocusedRef.current;
      windowFocusedRef.current = focused;
      setVisible(focused);
      if (!focused && settings.general.autoHideOnBlur) {
        // First-launch / panel activation can briefly report blur; don't hide yet.
        if (Date.now() < ignoreBlurUntilRef.current) return;
        // Go through Rust hide so PANEL_OPEN / last-hide timestamps stay in
        // sync with global-shortcut toggle (otherwise Alt+V re-opens after blur).
        invoke("floating_hide_restore_focus").catch(() => {
          win.hide().catch(() => {});
        });
      }
      if (focused) {
        // activate_app + make_key_window cause focus flicker; ignore blur briefly
        // so we don't hide mid-summon (that felt like a 1s "dead" double-tap).
        ignoreBlurUntilRef.current = Math.max(ignoreBlurUntilRef.current, Date.now() + 450);
        if (searchFadeTimerRef.current) clearTimeout(searchFadeTimerRef.current);
        setIsSearching(false);
        setIsSearchSettling(false);

        // True re-summon only (hidden → shown). Ignore micro focus edges while open.
        const isResummon = wasFocused !== true;
        if (isResummon) {
          setQuery("");
          setSelectedIndex(0);
          const state = useStore.getState();
          const appRows = state.results.filter((r) => (r.kind ?? "app") === "app");
          const hasAppRows = appRows.length > 0;
          const missingIcons = appRows.some((r) => !r.icon);
          const stale = Date.now() - lastEmptyAppsFetchAt > EMPTY_LAUNCHER_CACHE_MS;
          // Hot path: keep cached rows. Force refresh when empty, stale, or icons blank
          // (common after reinstall / scan-before-preload race).
          if ((!hasAppRows || stale || missingIcons) && !emptyLauncherLoadInFlightRef.current) {
            emptyLauncherLoadInFlightRef.current = true;
            lastEmptyLauncherLoadAtRef.current = Date.now();
            void loadEmptyLauncherApps(setResults, setLoadingPhase, {
              force: !hasAppRows || missingIcons,
            }).finally(() => {
              emptyLauncherLoadInFlightRef.current = false;
            });
          }
          // One focus request — SearchBar also reacts to `visible`; avoid stacking.
          requestLauncherSearchFocus();
        }
      }
    });
    const unlistenNav = listen<string>("navigate", (e) => {
      const next = e.payload;
      if (next === "clipboard" || next === "screencap" || next === "rss" || next === "v2ex" || next === "weather" || next === "qx-ai" || next === "macros" || next === "settings") {
        setTab(next);
      } else if (next === "launcher") {
        const alreadyLauncher = useStore.getState().tab === "launcher";
        setTab("launcher");
        // Only re-focus when arriving from another module; toggle-open already focuses.
        if (!alreadyLauncher) {
          window.requestAnimationFrame(() => requestLauncherSearchFocus());
        }
      } else if (next === "documents") {
        setTab("documents");
      } else if (next.startsWith("plugin:")) {
        setTab(next);
      }
    });
    return () => {
      unlistenFocus.then((f: () => void) => f());
      unlistenNav.then((f: () => void) => f());
    };
  }, [
    setQuery,
    setResults,
    setSelectedIndex,
    setTab,
    setVisible,
    setLoadingPhase,
    settings.general.autoHideOnBlur,
  ]);

  const loadSlowSearchProviders = useCallback(
    async (
      q: string,
      scope: SearchScope,
      _baseEntries: AppEntry[],
      syntheticEntries: AppEntry[],
      seq: number,
    ) => {
      const trimmed = q.trim();
      const shouldSearchFiles = (scope === "files" && trimmed.length >= 2) || (scope === "all" && trimmed.length >= 3);
      const shouldSearchClipboard = (scope === "all" || scope === "clipboard") && trimmed.length > 0;

      if (!shouldSearchFiles && !shouldSearchClipboard) return;

      const controller = searchAbortRef.current;
      if (!controller) return;
      const { signal } = controller;

      const [files, clipboardEntries] = await Promise.all([
        shouldSearchFiles
          ? abortableInvoke<AppEntry[]>("search_files", { query: q }, signal)
              .catch((error) => isAbortError(error) ? [] as AppEntry[] : [] as AppEntry[])
          : Promise.resolve([] as AppEntry[]),
        shouldSearchClipboard
          ? abortableInvoke<{ id: string; text: string }[]>("get_clipboard_history", { limit: 80 }, signal)
              .then((history) => {
                const lower = trimmed.toLowerCase();
                return history
                  .filter((item) => item.text.toLowerCase().includes(lower))
                  .slice(0, 8)
                  .map((item) => ({
                    name: item.text.replace(/\s+/g, " ").trim().slice(0, 80) || "Clipboard Item",
                    path: `__qx:clipboard:${item.id}`,
                    icon: "builtin:clipboard",
                    kind: "clipboard" as const,
                  }));
              })
              .catch(() => syntheticEntries.filter((item) => item.path.includes("clipboard")))
          : Promise.resolve([] as AppEntry[]),
      ]);

      if (seq !== searchSeqRef.current || signal.aborted) return;
      // Merge into *current* results so concurrent module-surface enrichment is not wiped.
      const current = useStore.getState().results;
      applyResults(dedupeEntries([...current, ...files, ...clipboardEntries]));
    },
    [applyResults],
  );

  /**
   * Module surfaces (RSS feeds, macros, …) are async and must never gate apps/search.
   * Fire-and-forget: merge when ready; discard if a newer search seq superseded us.
   */
  const loadModuleSurfaceProviders = useCallback(
    async (q: string, scope: SearchScope, seq: number) => {
      if (!(scope === "all" || scope === "apps")) return;
      if (!q.trim()) return;
      try {
        const surfaces = await searchModuleSurfaces(q);
        if (seq !== searchSeqRef.current) return;
        if (surfaces.length === 0) return;
        const surfaceEntries: AppEntry[] = surfaces.map((hit) => ({
          name: hit.title,
          subtitle: hit.subtitle,
          path: encodeModuleLaunchPath(hit.launch),
          icon: hit.icon || "builtin:rss",
          kind: "command" as const,
        }));
        const current = useStore.getState().results;
        applyResults(dedupeEntries([...current, ...surfaceEntries]));
      } catch {
        // Best-effort; never fail the search pipeline.
      }
    },
    [applyResults],
  );

  const doSearch = useCallback(
    async (q: string) => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      const { signal } = controller;
      const seq = searchSeqRef.current + 1;
      searchSeqRef.current = seq;
      const trimmed = q.trim();
      const showSearchActivity = trimmed.length > 0;
      if (searchFadeTimerRef.current) clearTimeout(searchFadeTimerRef.current);
      setIsSearching(showSearchActivity);
      setIsSearchSettling(false);

      if (slowSearchDebounceRef.current) clearTimeout(slowSearchDebounceRef.current);
      if (recordSearchDebounceRef.current) clearTimeout(recordSearchDebounceRef.current);

      const scope = searchScopeRef.current;

      // ── Empty-query fast path (home list) ──────────────────────────────
      // Full plugin/metadata pipeline + search_apps on every "" was the main
      // cause of ~1s lag after Option+Space (doSearch re-ran when plugins
      // loaded / focus cleared query / phase1 raced).
      if (!trimmed) {
        if (scope === "files" || scope === "clipboard") {
          applyResults([]);
          setIsSearching(false);
          setIsSearchSettling(false);
          return;
        }
        const current = useStore.getState().results;
        const appOnly = current.filter((r) => (r.kind ?? "app") === "app");
        const cacheFresh = Date.now() - lastEmptyAppsFetchAt < EMPTY_LAUNCHER_CACHE_MS;
        if (appOnly.length > 0 && cacheFresh) {
          if (appOnly.length !== current.length) applyResults(appOnly);
          setIsSearching(false);
          setIsSearchSettling(false);
          return;
        }
        try {
          const res = await abortableInvoke<AppEntry[]>("search_apps", { query: "" }, signal);
          if (seq !== searchSeqRef.current || signal.aborted) return;
          lastEmptyAppsFetchAt = Date.now();
          applyResults(mapAppEntries(res));
        } catch (error) {
          if (isAbortError(error)) return;
        }
        if (seq === searchSeqRef.current) {
          setIsSearching(false);
          setIsSearchSettling(false);
        }
        return;
      }

      const entries: AppEntry[] = [];

      const pluginMatches = findCommands(q).filter((match) => {
        const pluginId = match.command.pluginId;
        if (!pluginId.startsWith("builtin:")) return true;
        return isModuleSearchEnabled(pluginId.slice("builtin:".length));
      });
      const syntheticEntries: AppEntry[] = [];
      const settingsState = useSettingsStore.getState().settings;

      // Also match installed plugin panel names/keywords as navigation entries
      const pluginState = usePluginRegistry.getState();
      const lowerQuery = q.trim().toLowerCase();
      if (lowerQuery) {
        for (const [pluginId, panel] of Object.entries(pluginState.panels)) {
          const nameSource = (panel.pluginName || pluginId).toLowerCase();
          const titleSource = (panel.title || pluginId).toLowerCase();
          const kw = panel.keywords || [];
          const builtinModuleId = pluginId.startsWith("builtin:") ? pluginId.slice("builtin:".length) : null;
          if (builtinModuleId && !isModuleSearchEnabled(builtinModuleId)) continue;
          if (
            nameSource.includes(lowerQuery) ||
            titleSource.includes(lowerQuery) ||
            kw.some((k) => k.toLowerCase().includes(lowerQuery)) ||
            itemMatchesSearchMetadata(settingsState, pluginMetadataKey(pluginId), q) ||
            (builtinModuleId ? itemMatchesSearchMetadata(settingsState, moduleMetadataKey(builtinModuleId), q) : false)
          ) {
            syntheticEntries.push({
              name: panel.title || pluginId,
              path: builtinModuleId ? `__qx:${builtinModuleId}` : `__qx:plugin:${pluginId}`,
              icon: panel.icon || `builtin:${pluginId}`,
              kind: "command",
            });
          }
        }
        // Also match panel-less plugins (commands-only) by name/description/keywords
        for (const p of pluginState.plugins) {
          if (p.id.startsWith("builtin:")) continue;
          if (pluginState.panels[p.id]) continue;
          if (!p.enabled) continue;
          const nameSource = p.name.toLowerCase();
          const descSource = (p.description || "").toLowerCase();
          const manifestKw = p.manifest?.keywords || [];
          if (
            nameSource.includes(lowerQuery) ||
            descSource.includes(lowerQuery) ||
            manifestKw.some((k) => k.toLowerCase().includes(lowerQuery)) ||
            itemMatchesSearchMetadata(settingsState, pluginMetadataKey(p.id), q)
          ) {
            syntheticEntries.push({
              name: p.name,
              path: `__qx:plugin:${p.id}`,
              icon: `builtin:${p.id}`,
              kind: "command",
            });
          }
        }
      }

      syntheticEntries.push(
        ...pluginMatches.map((m) => ({
          name: m.command.title,
          path: `__qx:cmd:${m.command.pluginId}:${m.command.name}`,
          icon: m.command.icon || m.command.pluginIcon || `builtin:${m.command.pluginId}`,
          kind: "command" as const,
        })),
      );

      // Module surfaces load off the critical path (see loadModuleSurfaceProviders).

      const calculation = calculateExpression(q);
      if (calculation && (scope === "all" || scope === "apps")) {
        syntheticEntries.unshift({
          name: `${calculation.expression} = ${calculation.formatted}`,
          path: `__qx:calc:${encodeURIComponent(calculation.formatted)}`,
          icon: "builtin:calculator",
          kind: "calculation",
        });
      }

      if ((scope === "all" || scope === "apps") && matchesSettings(q)) {
        syntheticEntries.unshift({
          name: "Settings",
          path: "__qx:settings",
          icon: "builtin:settings",
          kind: "command",
        });
      }

      if (
        (scope === "all" || scope === "apps") &&
        itemMatchesSearchMetadata(settingsState, moduleMetadataKey("settings"), q)
      ) {
        syntheticEntries.unshift({
          name: "Settings",
          path: "__qx:settings",
          icon: "builtin:settings",
          kind: "command",
        });
      }

      if (scope === "all" || scope === "apps") {
        entries.push(...dedupeEntries(syntheticEntries));
      }

      try {
        if (scope === "all" || scope === "apps") {
          const res = await abortableInvoke<AppEntry[]>("search_apps", { query: q }, signal);
          if (seq !== searchSeqRef.current) return;
          entries.push(...res.map((item) => ({ ...item, kind: item.kind ?? "app" as const })));
          const metadataMatches = Object.entries(settingsState.search_metadata)
            .filter(([key, metadata]) => key.startsWith("app:") && metadataMatchesQuery(metadata, q));
          if (metadataMatches.length > 0) {
            const allApps = await abortableInvoke<AppEntry[]>("search_apps", { query: "" }, signal).catch(() => [] as AppEntry[]);
            if (seq !== searchSeqRef.current) return;
            const matchingPaths = new Set(metadataMatches.map(([key]) => key.slice("app:".length)));
            entries.push(
              ...allApps
                .filter((item) => matchingPaths.has(item.path))
                .map((item) => ({ ...item, kind: item.kind ?? "app" as const })),
            );
          }
        }
      } catch (error) {
        if (isAbortError(error)) return;
      }

      if (seq !== searchSeqRef.current || signal.aborted) return;
      const baseEntries = dedupeEntries(entries);
      // Fast path: apps + sync synthetics only. Never await module surface IPC here.
      applyResults(baseEntries);

      // Async enrichment: module surfaces (RSS/AI/macros/…) — non-blocking, seq-gated.
      if (lowerQuery && (scope === "all" || scope === "apps")) {
        void loadModuleSurfaceProviders(q, scope, seq);
      }

      if (shouldLoadSlowSearchProviders(q, scope)) {
        slowSearchDebounceRef.current = setTimeout(() => {
          void loadSlowSearchProviders(q, scope, baseEntries, syntheticEntries, seq)
            .finally(() => {
              finishSearchActivity(seq);
            });
        }, scope === "files" ? 80 : 260);
      } else if (showSearchActivity) {
        finishSearchActivity(seq);
      } else if (seq === searchSeqRef.current) {
        setIsSearching(false);
        setIsSearchSettling(false);
      }

      if (trimmed.length > 0) {
        recordSearchDebounceRef.current = setTimeout(() => {
          if (seq === searchSeqRef.current) {
            invoke("record_search", { query: trimmed }).catch(() => {});
          }
        }, 900);
      }
    },
    [applyResults, findCommands, finishSearchActivity, loadModuleSurfaceProviders, loadSlowSearchProviders],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    // Empty query: short delay, and skip if home list already warm (avoids
    // re-search when doSearch identity changes after plugins load).
    const delay = query.trim() ? 100 : 0;
    debounceRef.current = setTimeout(() => {
      if (!query.trim()) {
        const { results: rows, appsReady: ready } = useStore.getState();
        const hasApps = rows.some((r) => (r.kind ?? "app") === "app");
        if (ready && hasApps && Date.now() - lastEmptyAppsFetchAt < EMPTY_LAUNCHER_CACHE_MS) {
          return;
        }
      }
      void doSearch(query);
    }, delay);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (slowSearchDebounceRef.current) clearTimeout(slowSearchDebounceRef.current);
      if (recordSearchDebounceRef.current) clearTimeout(recordSearchDebounceRef.current);
      if (searchFadeTimerRef.current) clearTimeout(searchFadeTimerRef.current);
      searchAbortRef.current?.abort();
    };
  }, [query, doSearch]);

  useEffect(() => {
    const version = `${pluginCommandCount}:${pluginPanelCount}`;
    if (pluginSearchVersionRef.current === version) return;
    pluginSearchVersionRef.current = version;
    // Only re-run when the user is actively searching — empty home list must
    // not refetch just because plugins finished loading.
    if (tab !== "launcher" || !query.trim()) return;
    void doSearch(query);
  }, [pluginCommandCount, pluginPanelCount, query, tab, doSearch]);

  useEffect(() => {
    const onUnhandledEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capture now, decide after React/QxShell/window handlers have all had
      // a chance to consume the event. This is only a focus-loss fallback for
      // events targeting document/body, not a competing shortcut router.
      window.setTimeout(() => {
        if (!event.defaultPrevented) performHostEscape();
      }, 0);
    };
    const onHostEscape = () => {
      performHostEscape();
    };
    window.addEventListener("keydown", onUnhandledEscape, true);
    window.addEventListener(HOST_ESCAPE_EVENT, onHostEscape);
    return () => {
      window.removeEventListener("keydown", onUnhandledEscape, true);
      window.removeEventListener(HOST_ESCAPE_EVENT, onHostEscape);
    };
  }, [performHostEscape]);

  // apps:updated — background scan finished. Debounce so scan + icons don't
  // stampede the UI while the user is typing or opening the launcher.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let debounceTimer: ReturnType<typeof window.setTimeout> | undefined;
    const unlisten = listen("apps:updated", () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(async () => {
        const { query: currentQuery, tab: currentTab, visible } = useStore.getState();
        // Skip work while panel hidden unless list is still empty (cold install).
        const hasApps = useStore
          .getState()
          .results.some((r) => (r.kind ?? "app") === "app");
        if (!visible && hasApps) return;
        try {
          if (currentTab !== "launcher" || currentQuery.trim()) {
            if (currentTab !== "launcher") return;
            const apps = await invoke<AppEntry[]>("search_apps", { query: currentQuery });
            const updatedApps = mapAppEntries(apps);
            const state = useStore.getState();
            const nonApps = state.results.filter((r) => r.kind && r.kind !== "app");
            useStore.getState().setResults([...updatedApps, ...nonApps]);
            useStore.getState().setLoadingPhase("ready");
            return;
          }
          await loadEmptyLauncherApps(
            (entries) => useStore.getState().setResults(entries),
            (phase) => useStore.getState().setLoadingPhase(phase),
            { force: true },
          );
        } catch {
          // ignore
        }
      }, 350);
    });
    return () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      unlisten.then((f: () => void) => f());
    };
  }, []);

  // apps:icons-ready — always patch store icons (even when panel is hidden),
  // so the next Option+Space show is not stuck with empty icon paths for 8s.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let debounceTimer: ReturnType<typeof window.setTimeout> | undefined;
    const unlisten = listen("apps:icons-ready", () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(async () => {
        const { query: q, results: rows } = useStore.getState();
        if (rows.length === 0) return;
        try {
          const apps = await invoke<AppEntry[]>("search_apps", { query: q });
          const iconMap = new Map(apps.map((a) => [a.path, a.icon]));
          updateResultIcons((path) => iconMap.get(path));
          // Allow empty-launcher cache to pick up healed icons on next show.
          lastEmptyAppsFetchAt = 0;
        } catch {
          // ignore
        }
      }, 200);
    });
    return () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      unlisten.then((f: () => void) => f());
    };
  }, [updateResultIcons]);

  const openItem = useCallback(async (item: AppEntry) => {
    // Module deep launch: open a tab and hand params to the module surface.
    const moduleLaunch = parseModuleLaunchPath(item.path);
    if (moduleLaunch) {
      setPendingModuleLaunch(moduleLaunch);
      setTab(moduleLaunch.tab);
      return;
    }
    // Handle plugin command execution
    if (item.path.startsWith("__qx:cmd:")) {
      const commandKey = item.path.slice("__qx:cmd:".length);
      const { commands } = usePluginRegistry.getState();
      const cmd = commands.find((c) => `${c.pluginId}:${c.name}` === commandKey);
      if (cmd) {
        await usePluginRegistry.getState().runCommand(cmd);
      }
      return;
    }
    // Handle plugin panel navigation
    if (item.path.startsWith("__qx:plugin:")) {
      const pluginId = item.path.slice("__qx:plugin:".length);
      setTab(`plugin:${pluginId}`);
      return;
    }
    // Handle built-in tab navigation
    if (item.path === "__qx:settings") {
      setTab("settings");
      return;
    }
    if (item.path.startsWith("__qx:clipboard:")) {
      const id = item.path.slice("__qx:clipboard:".length);
      const entry = await loadClipboardEntryById(id);
      if (entry) await pasteClipboardEntryAtCursor(entry);
      return;
    }
    if (item.path.startsWith("__qx:calc:")) {
      await writeText(decodeURIComponent(item.path.slice("__qx:calc:".length)));
      if (isTauriRuntime()) {
        await invoke("floating_hide_restore_focus").catch(() => getCurrentWindow().hide());
      }
      return;
    }
    // Handle __qx:<tabId> style paths (backward compat)
    const tabMatch = item.path.match(/^__qx:(clipboard|screencap|rss|v2ex|weather|qx-ai|macros|documents)$/);
    if (tabMatch) {
      setTab(tabMatch[1] as any);
      return;
    }
    // Open external application or file
    await invoke("open_app", { path: item.path });
    // Record launch history (fire-and-forget)
    invoke("record_launch", { path: item.path, name: item.name }).catch(() => {});
    if (isTauriRuntime()) {
      await invoke("floating_hide_restore_focus").catch(() => getCurrentWindow().hide());
    }
  }, [setTab]);

  const handleKeyDown = useCallback(async (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      performHostEscape();
      return;
    }

    if (tab !== "launcher") {
      return;
    }

    const item = results[selectedIndex];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex(Math.min(selectedIndex + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex(Math.max(selectedIndex - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (item) await openItem(item);
        break;
    }
  }, [openItem, performHostEscape, results, selectedIndex, setSelectedIndex, tab]);

  const renderLauncher = () => (
    <Launcher
      results={results}
      selectedIndex={selectedIndex}
      onItemClick={openItem}
      onKeyDown={handleKeyDown}
      onNavigate={setTab}
      searchScopeRef={searchScopeRef}
      onScopeChange={() => doSearch(useStore.getState().query)}
      loadingPhase={loadingPhase}
      isSearching={isSearching}
      isSearchSettling={isSearchSettling}
      pluginIsland={pluginIsland}
    />
  );

  const renderBody = () => {
    if (tab !== mountedTab) {
      if (tab === "launcher") return renderLauncher();
      return <ModuleLoadingShell tab={tab} onBack={() => setTab("launcher")} />;
    }

    // Handle external plugin panels (tabs like "plugin:<id>")
    if (mountedTab.startsWith("plugin:")) {
      return <PluginPanelViewport />;
    }

    switch (mountedTab) {
      case "clipboard":
        return <ClipboardPanel />;
      case "screencap":
        return <ScreenRecorder />;
      case "rss":
        return <RssReader />;
      case "v2ex":
        return <V2exPanel />;
      case "qx-ai":
        return <G4fReader />;
      case "macros":
        return <MacroRecorder />;
      case "documents":
        return <DevTxtTool />;
      case "weather":
        return <WeatherPanel />;
      case "settings":
        return <SettingsPanel onClose={() => setTab("launcher")} />;
      case "launcher":
      default:
        return renderLauncher();
    }
  };

  return (
    <ThemeProvider>
      <div className="qx-canvas">
        {/* Hidden container for plugin iframes */}
        <PluginHost />
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <ModuleErrorBoundary
            tab={tab}
            onBack={() => {
              if (useStore.getState().tab !== "launcher") {
                setTab("launcher");
              } else {
                performHostEscape();
              }
            }}
          >
            <Suspense fallback={<ModuleLoadingShell tab={tab} onBack={() => setTab("launcher")} />}>
              {renderBody()}
            </Suspense>
          </ModuleErrorBoundary>
        </div>
      </div>
    </ThemeProvider>
  );
}

export default App;
