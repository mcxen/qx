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
import QxShell from "./components/QxShell";
import { islandHost, showPluginIslandStatus, clearPluginIslandStatus } from "./island";
import IslandFloatBridge from "./island/float/IslandFloatBridge";
import {
  buildSearchTracks,
  patchSearchTracks,
  publishSearchProgress,
  resetSearchProgress,
} from "./launcher/searchProgress";
import { LoadingLabel, Skeleton } from "./components/ui";
import { registerAllBuiltins } from "./plugin/builtin";
import { PluginHost, PluginPanelViewport } from "./plugin/PluginHost";
import { calculateExpression } from "./search/calculator";
import {
  itemMatchesSearchMetadata,
  metadataKeyForEntry,
  metadataMatchesQuery,
  moduleMetadataKey,
  pinnedPortEntriesFromSettings,
  pluginMetadataKey,
  prepareHomeAppList,
} from "./search/searchMetadata";
import {
  encodeModuleLaunchPath,
  isModuleSearchEnabled,
  parseModuleLaunchPath,
  searchModuleSurfaces,
  setPendingModuleLaunch,
} from "./search/moduleSurfaces";
import { rankSearchResultsAsync } from "./search/rankResultsAsync";
import { bestMatchTier, MatchTier, textMatchesQuery, type MatchTierValue } from "./search/rankResults";
import {
  frequentMatchingEntries,
  recordSearchResultClick,
  refreshSearchUsageCache,
  stampUsage,
} from "./search/searchUsage";
import { loadClipboardEntryById, pasteClipboardEntryAtCursor } from "./modules/clipboard/actions";
import { tryModuleEscapeStep } from "./hooks/moduleEscapeHost";
import { useQxModuleShell } from "./hooks/useQxModuleShell";
import { useT } from "./i18n";
import { configureQxLogger, createQxLogger, installDevConsoleCapture } from "./lib/logger";
import { getQxDesktopPlatform, isImeCompositionEvent } from "./utils/keyboard";
import { isBuiltinModuleEnabled } from "./modules/moduleAvailability";
import { captureControlsPinned } from "./modules/screencap/preferences";
import { ensureCaptureToastListener } from "./modules/screencap/store";
import "./App.css";

const ClipboardPanel = lazy(() => import("./modules/clipboard/ClipboardPanel"));
const ScreenRecorder = lazy(() => import("./modules/screencap/ScreenRecorder"));
const DevTxtTool = lazy(() => import("./modules/documents/DevTxtTool"));
const SettingsPanel = lazy(() => import("./modules/settings/SettingsPanel"));
const OnboardingWizard = lazy(() => import("./modules/onboarding/OnboardingWizard"));
const RssReader = lazy(() => import("./modules/rss"));
const V2exPanel = lazy(() => import("./modules/v2ex/V2exPanel"));
const G4fReader = lazy(() => import("./modules/qx-ai"));
const MacroRecorder = lazy(() => import("./modules/macros/MacroRecorder"));
const WeatherPanel = lazy(() => import("./modules/weather/WeatherPanel"));
const QxTTYPanel = lazy(() => import("./modules/qx-tty/QxTTYPanel"));

const SETTINGS_SEARCH_TERMS = [
  "settings",
  "preferences",
  "plugins",
  "extensions",
  "shortcuts",
  "appearance",
  "advanced",
  "qx settings",
  "qx preferences",
  "设置",
  "偏好设置",
  "插件",
  "扩展",
  "快捷键",
  "外观",
  "高级",
  "qx设置",
  "qx 设置",
];
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
  screencap: { key: "launcher.screencap", fallback: "Screen Capture" },
  rss: { key: "launcher.rss", fallback: "RSS Reader" },
  v2ex: { key: "launcher.v2ex", fallback: "V2EX" },
  weather: { key: "launcher.weather", fallback: "Weather" },
  "qx-ai": { key: "module.qx-ai", fallback: "QxAI Chat" },
  macros: { key: "launcher.macros", fallback: "Macro Recorder" },
  documents: { key: "launcher.documents", fallback: "Documents" },
  "qx-tty": { key: "launcher.qx-tty", fallback: "QxTTY" },
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
  // Same Esc / host-cascade registration path as real modules (moduleEscapeHost).
  const shell = useQxModuleShell({
    leave: onBack,
    showActionsMenu: false,
    islandState: {
      title,
      loading: true,
      loadingDetail: t("common.loadingModule", "Loading module"),
    },
    t,
  });

  return (
    <QxShell
      title={title}
      className="qx-module-loading-shell"
      escapeAction={shell.escapeAction}
      onKeyDown={shell.onKeyDown}
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
      island={shell.island}
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
  const shell = useQxModuleShell({
    leave: onBack,
    showActionsMenu: false,
    island: {
      label: t("common.moduleError", "Module Error"),
      detail: title,
      tone: "danger",
      actionLabel: t("common.back", "Back"),
      onAction: onBack,
    },
    t,
  });

  return (
    <QxShell
      title={title}
      className="qx-module-loading-shell"
      escapeAction={shell.escapeAction}
      onKeyDown={shell.onKeyDown}
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
      island={shell.island}
      primaryAction={{
        label: t("common.back", "Back"),
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

function settingsMatchTier(query: string): MatchTierValue {
  return bestMatchTier(query, ...SETTINGS_SEARCH_TERMS, SETTINGS_SEARCH_TERMS.join(" "));
}

function matchesSettings(query: string): boolean {
  return settingsMatchTier(query) < MatchTier.none;
}

function createSettingsSearchEntry(matchScore?: MatchTierValue): AppEntry {
  return {
    name: "Settings",
    display_name: "设置",
    subtitle: "Qx",
    path: "__qx:settings",
    icon: "builtin:settings",
    kind: "command",
    moduleId: "settings",
    matchScore,
  };
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
    (scope === "files" || scope === "all") && trimmed.length > 0;
  const shouldSearchClipboard = (scope === "all" || scope === "clipboard") && trimmed.length > 0;

  return shouldSearchFiles || shouldSearchClipboard;
}

/** Map + merge pinned plugins/modules + home-list prep. Only for empty launcher. */
function mapAppEntries(apps: AppEntry[]): AppEntry[] {
  const settings = useSettingsStore.getState().settings;
  const plugins = usePluginRegistry.getState().plugins;
  const mapped: AppEntry[] = apps.map((a) => ({ ...a, kind: a.kind ?? ("app" as const) }));
  const pinnedPorts: AppEntry[] = pinnedPortEntriesFromSettings(settings, plugins).map((entry) => ({
    name: entry.name,
    display_name: entry.display_name || entry.name,
    path: entry.path,
    icon: entry.icon,
    kind: (entry.kind || "command") as AppEntry["kind"],
    subtitle: entry.subtitle,
  }));
  // Prefer explicit pinned port rows; drop OS-app duplicates by path.
  const seen = new Set(pinnedPorts.map((entry) => entry.path));
  for (const entry of mapped) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    pinnedPorts.push(entry);
  }
  return prepareHomeAppList(pinnedPorts, settings, metadataKeyForEntry);
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
  const rankRequestSeqRef = useRef(0);
  const rankCandidatesRef = useRef<{ query: string; entries: AppEntry[] } | null>(null);
  const resultCommitTimerRef = useRef<ReturnType<typeof window.setTimeout> | undefined>(undefined);
  const lastQueryEditAtRef = useRef(performance.now());
  const previousQueryRef = useRef(query);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchScopeRef = useRef<SearchScope>("all");
  const { settings, load: loadSettings, loaded: settingsLoaded } = useSettingsStore();
  const mainVisible = useStore((state) => state.visible);

  // Keep Rust global-shortcut toggle-to-close in sync with the active tab.
  useEffect(() => {
    void invoke("set_active_route", { route: tab }).catch(() => {});
  }, [tab]);

  // A module disabled from Settings must disappear immediately without ever
  // mounting its lazy view (and therefore without starting its effects/data).
  useEffect(() => {
    if (tab !== "launcher" && tab !== "settings" && !tab.startsWith("plugin:")
        && !isBuiltinModuleEnabled(tab, settings)) {
      setTab("launcher");
    }
  }, [settings, setTab, tab]);
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
  const [mountedTab, setMountedTab] = useState(tab);
  /** macOS first-launch permission wizard (FDA + optional paste/capture). */
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [, startSearchTransition] = useTransition();

  if (previousQueryRef.current !== query) {
    previousQueryRef.current = query;
    lastQueryEditAtRef.current = performance.now();
  }

  /**
   * Host-level Esc staircase while Qx is the foreground UI:
   *   active module stepBack (nested views, e.g. RSS articles → feeds)
   *   then leave module → launcher (when no module handler, or module leave)
   *   launcher with query → clear query
   *   launcher empty → hide panel + restore focus
   *
   * Modules that handle Esc in QxShell call preventDefault so this does not
   * double-step on the same keypress. When focus is outside the shell
   * (body/document), only this path runs — it must still step module cascades
   * via `tryModuleEscapeStep` (registered by useQxModuleShell).
   */
  const performHostEscape = useCallback(() => {
    const state = useStore.getState();
    if (state.tab !== "launcher") {
      // Nested module views first (RSS article list → feed list, etc.).
      // Handlers call leave → setTab("launcher") when already at module root.
      if (tryModuleEscapeStep()) return;
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

  const scheduleResultCommit = useCallback((entries: AppEntry[], expectedQuery: string) => {
    if (resultCommitTimerRef.current) window.clearTimeout(resultCommitTimerRef.current);
    // Zustand is an external store, so wrapping setResults in a React
    // transition does not make the mutation non-blocking. Commit only after a
    // short typing-quiet window and coalesce progressive provider batches.
    const quietFor = performance.now() - lastQueryEditAtRef.current;
    const delay = Math.max(8, 48 - quietFor);
    resultCommitTimerRef.current = window.setTimeout(() => {
      resultCommitTimerRef.current = undefined;
      if (useStore.getState().query.trim() !== expectedQuery) return;
      setResults(entries);
    }, delay);
  }, [setResults]);

  const applyResults = useCallback(
    (entries: AppEntry[], options?: { merge?: boolean; prepend?: boolean }) => {
      // Home list: merge pinned plugins, hide user-hidden, pin-sort.
      // Active search: stamp 30-day click usage, merge frequent matches that
      // still match the query, then rank (relevance first, usage as tie-break).
      const activeQuery = useStore.getState().query.trim();
      if (!activeQuery) {
        rankRequestSeqRef.current += 1;
        rankCandidatesRef.current = null;
        scheduleResultCommit(mapAppEntries(entries), "");
        return;
      }
      const previous = rankCandidatesRef.current;
      const candidates = options?.merge && previous?.query === activeQuery
        ? dedupeEntries(options.prepend
            ? [...entries, ...previous.entries]
            : [...previous.entries, ...entries])
        : entries;
      rankCandidatesRef.current = { query: activeQuery, entries: candidates };

      const stamped = stampUsage(candidates);
      const frequent = frequentMatchingEntries(activeQuery);
      const merged = frequent.length > 0
        ? dedupeEntries([...frequent, ...stamped])
        : stamped;
      // Provider order is already useful enough for the first paint. Never
      // make visible results wait for the ranking worker to start or respond.
      scheduleResultCommit(merged, activeQuery);
      const requestSeq = ++rankRequestSeqRef.current;
      void rankSearchResultsAsync(merged, activeQuery).then((next) => {
        if (requestSeq !== rankRequestSeqRef.current) return;
        if (useStore.getState().query.trim() !== activeQuery) return;
        scheduleResultCommit(next, activeQuery);
      });
    },
    [scheduleResultCommit],
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
    patchSearchTracks(
      {
        apps: { status: "done" },
        files: { status: "done" },
        clipboard: { status: "done" },
      },
      { phase: "settling", seq },
    );
    searchFadeTimerRef.current = setTimeout(() => {
      if (seq === searchSeqRef.current) {
        setIsSearchSettling(false);
        resetSearchProgress();
      }
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
    if (!settingsLoaded || !isTauriRuntime()) return;
    ensureCaptureToastListener();
    const pinned = captureControlsPinned()
      && settings.builtin_modules?.modules?.screencap !== false;
    void invoke("screencap_set_controls_pinned", { pinned }).catch(() => {});
  }, [settings.builtin_modules?.modules?.screencap, settingsLoaded]);

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

  // Plugin tray menu clicks → run the mapped plugin command (if any).
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen<{
      pluginId?: string;
      plugin_id?: string;
      itemId?: string;
      item_id?: string;
      command?: string | null;
    }>("plugin-tray-action", ({ payload }) => {
      const pluginId = String(payload.pluginId || payload.plugin_id || "");
      const commandName = String(payload.command || "").trim();
      if (!pluginId || !commandName) return;
      const command = usePluginRegistry
        .getState()
        .commands.find((c) => c.pluginId === pluginId && c.name === commandName);
      if (!command) {
        appLogger.warn("Plugin tray command not found", { pluginId, commandName });
        return;
      }
      void usePluginRegistry.getState().runCommand(command).catch((error) => {
        appLogger.error("Plugin tray command failed", { pluginId, commandName, error });
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

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
          islandHost.show({
            id: "system.update",
            priority: "task",
            source: "system",
            sticky: true,
            content: {
              primary: "Updating Qx",
              secondary: `Downloading ${versionLabel}`,
              tone: "neutral",
              meter: { kind: "activity", activity: "bounce" },
            },
          });

          await invoke("qx_update_download_and_install");
          appLogger.info("Auto update download and install started", {
            latestVersion: info.latest_version,
          });
          if (!cancelled) {
            islandHost.show({
              id: "system.update",
              priority: "task",
              source: "system",
              sticky: true,
              content: {
                primary: "Installing update",
                secondary: "Qx will restart.",
                tone: "success",
                meter: { kind: "activity", activity: "bounce" },
              },
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
      showPluginIslandStatus(status);
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
        onRunPluginCommand: async (pluginId, commandName) => {
          const registry = usePluginRegistry.getState();
          const command = registry.commands.find(
            (item) => item.pluginId === pluginId && item.name === commandName,
          );
          if (!command) throw new Error(`Plugin command not found: ${pluginId}/${commandName}`);
          await registry.runCommand(command, { launchType: "userInitiated" });
        },
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
      clearPluginIslandStatus();
    };
  }, [loadPlugins, appsReady]);

  // Listen for qx:navigate custom events (from built-in module commands)
  useEffect(() => {
    const handler = (e: Event) => {
      const tabId = (e as CustomEvent).detail as string;
      if (tabId === "clipboard" || tabId === "screencap"
          || tabId === "rss" || tabId === "v2ex" || tabId === "weather" || tabId === "qx-ai" || tabId === "macros" || tabId === "documents" || tabId === "qx-tty" || tabId === "settings") {
        if (tabId !== "settings" && !isBuiltinModuleEnabled(tabId)) return;
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
    const glassEnabled = settings.appearance.glass_enabled;
    const configuredOpacity = Math.min(1, Math.max(0.05, settings.appearance.blur_opacity));
    const configuredBlurRadius = Math.min(30, Math.max(0, settings.appearance.blur_radius));
    const opacityScale = (configuredOpacity - 0.05) / 0.95;
    const configuredRegionOpacity = Math.min(0.35, Math.max(0.03, settings.appearance.shell_region_opacity));
    const configuredSurfaceOpacity = Math.min(0.85, Math.max(0.10, settings.appearance.surface_opacity));
    const configuredControlOpacity = Math.min(0.95, Math.max(0.30, settings.appearance.control_opacity));
    const configuredBottomBarOpacity = Math.min(0.35, Math.max(0.04, settings.appearance.bottom_bar_opacity));
    const isWindows = getQxDesktopPlatform() === "windows";
    document.documentElement.dataset.glassEnabled = String(glassEnabled);

    // WebView2 does not reproduce macOS vibrancy from CSS backdrop-filter.
    // Keep Windows surfaces substantially more opaque while preserving the
    // full settings slider range; native Acrylic remains an optional backdrop.
    const opacity = !glassEnabled
      ? 1
      : isWindows ? 0.82 + opacityScale * 0.18 : configuredOpacity;
    const regionOpacity = !glassEnabled
      ? 1
      : isWindows
        ? 0.76 + ((configuredRegionOpacity - 0.03) / 0.32) * 0.16
        : configuredRegionOpacity;
    const bottomBarOpacity = !glassEnabled
      ? 1
      : isWindows
        ? 0.72 + ((configuredBottomBarOpacity - 0.04) / 0.31) * 0.20
        : configuredBottomBarOpacity;
    const elevatedRegionOpacity = !glassEnabled
      ? 1
      : isWindows
        ? Math.min(0.98, regionOpacity + 0.08)
        : Math.min(0.55, Math.max(regionOpacity, configuredSurfaceOpacity * 0.72));
    const glassRegionOpacity = !glassEnabled
      ? 1
      : isWindows
        ? Math.max(0.70, regionOpacity - 0.06)
        : Math.max(0.025, regionOpacity * 0.72);
    const overlayRegionOpacity = !glassEnabled
      ? 1
      : isWindows
        ? Math.max(0.78, bottomBarOpacity)
        : Math.max(0.05, bottomBarOpacity * 0.90);
    // Popovers share the actions/controls visual tier. The bottom bar is the
    // translucency floor so floating menus never become weaker than shell chrome.
    const popoverOpacity = !glassEnabled
      ? 1
      : isWindows
        ? Math.max(0.90, configuredControlOpacity, bottomBarOpacity)
        : Math.min(0.96, Math.max(configuredControlOpacity, bottomBarOpacity + 0.20));
    const surfaceOpacity1 = !glassEnabled
      ? 1
      : isWindows
        ? 0.88 + ((configuredSurfaceOpacity - 0.10) / 0.75) * 0.10
        : configuredSurfaceOpacity;
    const surfaceOpacity2 = !glassEnabled
      ? 1
      : isWindows
        ? Math.max(0.84, surfaceOpacity1 - 0.05)
        : Math.max(0.08, configuredSurfaceOpacity * 0.82);
    const surfaceOpacity3 = !glassEnabled
      ? 1
      : isWindows
        ? Math.max(0.78, surfaceOpacity1 - 0.10)
        : Math.max(0.06, configuredSurfaceOpacity * 0.68);
    const windowBlur = glassEnabled ? configuredBlurRadius : 0;
    const controlSurfaceOpacity = !glassEnabled
      ? 1
      : isWindows
        ? Math.max(0.92, configuredControlOpacity)
        : configuredControlOpacity;
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
      "--qx-bottom-bar-opacity",
      String(bottomBarOpacity),
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
      "--qx-window-blur",
      `${windowBlur.toFixed(1)}px`,
    );
    document.documentElement.style.setProperty(
      "--qx-shell-chrome-blur",
      glassEnabled ? "24px" : "0px",
    );
    document.documentElement.style.setProperty(
      "--qx-control-surface-opacity",
      String(controlSurfaceOpacity),
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
    settings.appearance.glass_enabled,
    settings.appearance.blur_opacity,
    settings.appearance.blur_radius,
    settings.appearance.shell_region_opacity,
    settings.appearance.surface_opacity,
    settings.appearance.control_opacity,
    settings.appearance.bottom_bar_opacity,
    settings.appearance.border_radius,
    settings.appearance.font_size,
  ]);

  useEffect(() => {
    if (!settingsLoaded || !isTauriRuntime()) return;
    void invoke("set_window_glass_effect", {
      enabled: settings.appearance.glass_enabled,
    }).catch((error) => {
      appLogger.warn("Failed to update native window material", { error });
    });
  }, [settings.appearance.glass_enabled, settingsLoaded]);

  // A fresh install presents the launcher once (and macOS permission onboarding).
  // After that Qx starts as a background helper; the launcher is surfaced only
  // by an explicit shortcut/tray action.
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
      const needsOnboarding =
        getQxDesktopPlatform() === "macos" && !currentSettings.general.has_completed_onboarding;
      const shouldShowFirstLaunch =
        (!currentSettings.general.has_shown_launcher && !hasSavedSize) || needsOnboarding;
      if (!currentSettings.general.has_shown_launcher) {
        useSettingsStore.getState().patch("general", {
          ...currentSettings.general,
          has_shown_launcher: true,
        });
        await useSettingsStore.getState().flush();
      }
      // Non-macOS: mark onboarding complete so the flag stays meaningful.
      if (getQxDesktopPlatform() !== "macos" && !currentSettings.general.has_completed_onboarding) {
        const g = useSettingsStore.getState().settings.general;
        useSettingsStore.getState().patch("general", {
          ...g,
          has_completed_onboarding: true,
        });
        await useSettingsStore.getState().flush();
      }
      if (shouldShowFirstLaunch) {
        // Let the size settle, then show via floating_show (centers on the
        // cursor monitor — do not use win.center() which can land on the wrong display).
        await new Promise((r) => window.setTimeout(r, 50));
        // Onboarding needs longer blur immunity while the user visits System Settings.
        ignoreBlurUntilRef.current = Date.now() + (needsOnboarding ? 120_000 : 2500);
        await invoke("floating_show").catch(() => {});
        // Ensure the onboarding window has app results even if focus events are flaky.
        await loadEmptyLauncherApps(setResults, setLoadingPhase);
        // Re-center once more after the panel is actually visible.
        await invoke("floating_show").catch(() => {});
        if (needsOnboarding) {
          await invoke("floating_set_onboarding_active", { active: true }).catch(() => {});
          setShowOnboarding(true);
        }
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
      // Prefer native hide (lib.rs on_window_event) as the source of truth.
      // Keep a webview fallback for environments where the native event is missed.
      if (!focused && settings.general.autoHideOnBlur) {
        // First-launch / onboarding / panel activation can briefly report blur; don't hide yet.
        if (Date.now() < ignoreBlurUntilRef.current) return;
        // Stay visible while the macOS permission wizard is open (user is in System Settings).
        if (showOnboarding) {
          ignoreBlurUntilRef.current = Date.now() + 60_000;
          return;
        }
        // Go through Rust hide so PANEL_OPEN / last-hide timestamps stay in
        // sync with global-shortcut toggle (otherwise Alt+V re-opens after blur).
        invoke("floating_hide_restore_focus").catch(() => {
          win.hide().catch(() => {});
        });
      }
      if (focused) {
        // activate_app + make_key_window cause focus flicker; ignore blur briefly
        // so we don't hide mid-summon (that felt like a 1s "dead" double-tap).
        ignoreBlurUntilRef.current = Math.max(ignoreBlurUntilRef.current, Date.now() + 280);
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
        }
        // Focus every time the launcher becomes key, not only when the native
        // focus edge is classified as a re-summon. AppKit may emit a micro edge
        // after show, and SearchBar coalesces these into one bounded retry.
        if (useStore.getState().tab === "launcher") requestLauncherSearchFocus();
      }
    });
    const unlistenNav = listen<string>("navigate", (e) => {
      const next = e.payload;
      if (next === "clipboard" || next === "screencap" || next === "rss" || next === "v2ex" || next === "weather" || next === "qx-ai" || next === "macros" || next === "qx-tty" || next === "settings") {
        if (next !== "settings" && !isBuiltinModuleEnabled(next)) return;
        setTab(next);
      } else if (next === "launcher") {
        setTab("launcher");
        // Launcher recall is distinct from visibility-only toggling. Always
        // return focus to search, including when Launcher is already visible.
        window.requestAnimationFrame(() => requestLauncherSearchFocus());
      } else if (next === "documents") {
        if (!isBuiltinModuleEnabled(next)) return;
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
    showOnboarding,
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
      const shouldSearchFiles = (scope === "files" || scope === "all") && trimmed.length > 0;
      const shouldSearchClipboard = (scope === "all" || scope === "clipboard") && trimmed.length > 0;

      if (!shouldSearchFiles && !shouldSearchClipboard) return;

      const controller = searchAbortRef.current;
      if (!controller) return;
      const { signal } = controller;

      if (shouldSearchFiles) {
        patchSearchTracks({ files: { status: "running" } }, { phase: "searching", seq });
      }
      if (shouldSearchClipboard) {
        patchSearchTracks({ clipboard: { status: "running" } }, { phase: "searching", seq });
      }

      // Clipboard once; files run multi-pass (0 quick → 1 expand → 2 system) and
      // each pass merges into the live list so later hits "chase" behind the first paint.
      const clipboardPromise = shouldSearchClipboard
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
        : Promise.resolve([] as AppEntry[]);

      const mergeFileBatch = (batch: AppEntry[]) => {
        if (seq !== searchSeqRef.current || signal.aborted || batch.length === 0) return;
        // applyResults owns the per-query candidate set. Reading the visible
        // store here can pull in the previous query while visual commits are deferred.
        applyResults(batch, { merge: true });
      };

      const clipboardTask = clipboardPromise.then((clipboardEntries) => {
        if (seq !== searchSeqRef.current || signal.aborted) return;
        if (clipboardEntries.length > 0) {
          applyResults(clipboardEntries, { merge: true });
        }
        if (shouldSearchClipboard) {
          patchSearchTracks(
            { clipboard: { status: "done", hits: clipboardEntries.length } },
            { phase: "searching", seq },
          );
        }
      });

      const broaderFilesTask = shouldSearchFiles
        ? (async () => {
            let totalFileHits = 0;
            // Passes within the same provider stay progressive, but this task
            // runs concurrently with clipboard, apps, modules, and usage recall.
            for (const pass of [1, 2] as const) {
              if (seq !== searchSeqRef.current || signal.aborted) return;
              const batch = await abortableInvoke<AppEntry[]>(
                "search_files",
                { query: q, pass },
                signal,
              ).catch(() => [] as AppEntry[]);
              if (seq !== searchSeqRef.current || signal.aborted) return;
              mergeFileBatch(batch);
              totalFileHits += batch.length;
            }
            if (seq !== searchSeqRef.current || signal.aborted) return;
            const currentCandidates = rankCandidatesRef.current?.query === trimmed
              ? rankCandidatesRef.current.entries
              : [];
            const fileHits = currentCandidates.filter(
              (item) => item.kind === "file" || item.kind === "folder",
            ).length;
            patchSearchTracks(
              { files: { status: "done", hits: fileHits || totalFileHits } },
              { phase: "searching", seq },
            );
          })()
        : Promise.resolve(
            patchSearchTracks({ files: { status: "skipped" } }, { phase: "searching", seq }),
          );

      await Promise.allSettled([clipboardTask, broaderFilesTask]);
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
          moduleId: hit.moduleId,
        }));
        applyResults(surfaceEntries, { merge: true, prepend: true });
      } catch {
        // Best-effort; never fail the search pipeline.
      }
    },
    [applyResults],
  );

  const doSearch = useCallback(
    async (q: string) => {
      searchAbortRef.current?.abort();
      if (resultCommitTimerRef.current) {
        window.clearTimeout(resultCommitTimerRef.current);
        resultCommitTimerRef.current = undefined;
      }
      // doSearch also runs directly when the scope changes. Invalidate the
      // previous scope's rank/commit state even when the query text is equal.
      rankRequestSeqRef.current += 1;
      rankCandidatesRef.current = null;
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
        resetSearchProgress();
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

      publishSearchProgress({
        phase: "searching",
        query: trimmed,
        seq,
        tracks: buildSearchTracks(scope, trimmed),
      });

      // File pass 0 is part of the immediate query path: every non-empty edit
      // (typing, deleting, paste) reaches the backend before slower providers.
      const filesPass0Promise = (scope === "all" || scope === "files")
        ? abortableInvoke<AppEntry[]>("search_files", { query: q, pass: 0 }, signal)
            .catch((error) => (isAbortError(error) ? ([] as AppEntry[]) : ([] as AppEntry[])))
        : Promise.resolve([] as AppEntry[]);

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
      if (q.trim()) {
        for (const [pluginId, panel] of Object.entries(pluginState.panels)) {
          const nameSource = panel.pluginName || pluginId;
          const titleSource = panel.title || pluginId;
          const kw = panel.keywords || [];
          const builtinModuleId = pluginId.startsWith("builtin:") ? pluginId.slice("builtin:".length) : null;
          if (builtinModuleId && !isModuleSearchEnabled(builtinModuleId)) continue;
          if (
            textMatchesQuery(q, nameSource, titleSource, ...kw) ||
            itemMatchesSearchMetadata(settingsState, pluginMetadataKey(pluginId), q) ||
            (builtinModuleId ? itemMatchesSearchMetadata(settingsState, moduleMetadataKey(builtinModuleId), q) : false)
          ) {
            syntheticEntries.push({
              name: panel.title || pluginId,
              path: builtinModuleId ? `__qx:${builtinModuleId}` : `__qx:plugin:${pluginId}`,
              icon: panel.icon || `builtin:${pluginId}`,
              kind: "command",
              moduleId: builtinModuleId ?? undefined,
            });
          }
        }
        // Also match panel-less plugins (commands-only) by name/description/keywords
        for (const p of pluginState.plugins) {
          if (p.id.startsWith("builtin:")) continue;
          if (pluginState.panels[p.id]) continue;
          if (!p.enabled) continue;
          const nameSource = p.name;
          const descSource = p.description || "";
          const manifestKw = p.manifest?.keywords || [];
          if (
            textMatchesQuery(q, p.id, nameSource, descSource, ...manifestKw) ||
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
          moduleId: m.command.pluginId.startsWith("builtin:")
            ? m.command.pluginId.slice("builtin:".length)
            : undefined,
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
        syntheticEntries.unshift(createSettingsSearchEntry(settingsMatchTier(q)));
      }

      if (
        (scope === "all" || scope === "apps") &&
        itemMatchesSearchMetadata(settingsState, moduleMetadataKey("settings"), q)
      ) {
        syntheticEntries.unshift(createSettingsSearchEntry());
      }

      if (scope === "all" || scope === "apps") {
        entries.push(...dedupeEntries(syntheticEntries));
      }

      // Fixed, in-memory providers are visible in the same turn. Every IPC
      // provider below starts independently and only merges its own batch.
      const fixedEntries = dedupeEntries(entries);
      applyResults(fixedEntries);

      const appSearchTask = (scope === "all" || scope === "apps")
        ? abortableInvoke<AppEntry[]>("search_apps", { query: q }, signal)
            .then((rows) => {
              if (seq !== searchSeqRef.current || signal.aborted) return;
              const appEntries = rows.map((item) => ({
                ...item,
                kind: item.kind ?? "app" as const,
              }));
              applyResults(appEntries, { merge: true, prepend: true });
              patchSearchTracks(
                { apps: { status: "done", hits: appEntries.length } },
                { phase: "searching", seq },
              );
            })
            .catch((error) => {
              if (isAbortError(error) || seq !== searchSeqRef.current) return;
              patchSearchTracks({ apps: { status: "done", hits: 0 } }, { phase: "searching", seq });
            })
        : Promise.resolve();

      // User aliases/tags are an independent app provider; they never delay
      // the normal in-memory application search.
      const metadataMatches = Object.entries(settingsState.search_metadata)
        .filter(([key, metadata]) => key.startsWith("app:") && metadataMatchesQuery(metadata, q));
      const metadataAppTask = metadataMatches.length > 0 && (scope === "all" || scope === "apps")
        ? abortableInvoke<AppEntry[]>("search_apps", { query: "" }, signal)
            .then((allApps) => {
              if (seq !== searchSeqRef.current || signal.aborted) return;
              const matchingPaths = new Set(metadataMatches.map(([key]) => key.slice("app:".length)));
              const matches = allApps
                .filter((item) => matchingPaths.has(item.path))
                .map((item) => ({ ...item, kind: item.kind ?? "app" as const }));
              if (matches.length > 0) applyResults(matches, { merge: true, prepend: true });
            })
            .catch(() => {})
        : Promise.resolve();

      const filesPass0Task = filesPass0Promise.then((filesPass0) => {
        if (seq !== searchSeqRef.current || signal.aborted || filesPass0.length === 0) return;
        applyResults(filesPass0, { merge: true });
      });

      const moduleSurfaceTask = trimmed && (scope === "all" || scope === "apps")
        ? loadModuleSurfaceProviders(q, scope, seq)
        : Promise.resolve();

      const usageTask = refreshSearchUsageCache().then(() => {
        if (seq !== searchSeqRef.current || signal.aborted) return;
        if (useStore.getState().query.trim() !== trimmed) return;
        const current = rankCandidatesRef.current?.query === trimmed
          ? rankCandidatesRef.current.entries
          : [];
        if (current.length > 0) applyResults(current, { merge: true });
      });

      const slowProvidersTask = shouldLoadSlowSearchProviders(q, scope)
        ? new Promise<void>((resolve) => {
            slowSearchDebounceRef.current = setTimeout(() => {
              void loadSlowSearchProviders(q, scope, fixedEntries, syntheticEntries, seq)
                .finally(resolve);
            }, 80);
          })
        : Promise.resolve();

      void Promise.allSettled([
        appSearchTask,
        metadataAppTask,
        filesPass0Task,
        moduleSurfaceTask,
        usageTask,
        slowProvidersTask,
      ]).then(() => finishSearchActivity(seq));

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
    // Invalidate every provider and ranking callback immediately on edit;
    // do not wait for the debounced replacement search to start.
    searchSeqRef.current += 1;
    rankRequestSeqRef.current += 1;
    rankCandidatesRef.current = null;
    searchAbortRef.current?.abort();
    // Empty query: short delay, and skip if home list already warm (avoids
    // re-search when doSearch identity changes after plugins load).
    // Let the controlled input paint first and collapse rapid edits into one
    // provider run. Old in-flight work is aborted by the effect cleanup.
    const delay = query.trim() ? 45 : 0;
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
      if (resultCommitTimerRef.current) clearTimeout(resultCommitTimerRef.current);
      searchAbortRef.current?.abort();
    };
  }, [query, doSearch]);

  // Re-apply home list prep when the user pins/unpins/hides (only while query is empty).
  useEffect(() => {
    if (query.trim()) return;
    const { results: rows } = useStore.getState();
    if (rows.length === 0) return;
    const ranked = prepareHomeAppList(rows, settings, metadataKeyForEntry);
    const same = ranked.length === rows.length
      && ranked.every((entry, index) => entry.path === rows[index]?.path && entry.kind === rows[index]?.kind);
    if (!same) {
      startSearchTransition(() => setResults(ranked));
    }
  }, [query, settings.search_metadata, setResults, startSearchTransition]);

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
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      // Bubble-phase host cascade for every tab while the panel is open.
      // React/Radix overlays and module useEscBack get first refusal via
      // preventDefault. Do NOT gate on tab===launcher — modules without a
      // focused shell descendant (Screen Capture title slot, post-click body
      // focus) would otherwise trap Esc until the user clicks inside QxShell.
      event.preventDefault();
      event.stopPropagation();
      performHostEscape();
    };
    const onHostEscape = () => {
      performHostEscape();
    };
    window.addEventListener("keydown", onUnhandledEscape);
    window.addEventListener(HOST_ESCAPE_EVENT, onHostEscape);
    return () => {
      window.removeEventListener("keydown", onUnhandledEscape);
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
    // Rolling 30-day search usage — fire-and-forget, never blocks open.
    recordSearchResultClick(item);

    // Module deep launch: open a tab and hand params to the module surface.
    const moduleLaunch = parseModuleLaunchPath(item.path);
    if (moduleLaunch) {
      if (!isBuiltinModuleEnabled(moduleLaunch.tab)) return;
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
    const tabMatch = item.path.match(/^__qx:(clipboard|screencap|rss|v2ex|weather|qx-ai|macros|documents|qx-tty)$/);
    if (tabMatch) {
      if (!isBuiltinModuleEnabled(tabMatch[1])) return;
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
    // Enter confirms an active IME candidate; it must not launch the selected
    // result or trigger another shell action while composition is in progress.
    if (isImeCompositionEvent(e.nativeEvent)) return;

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
      onEscape={performHostEscape}
      onNavigate={setTab}
      searchScopeRef={searchScopeRef}
      onScopeChange={() => doSearch(useStore.getState().query)}
      loadingPhase={loadingPhase}
      isSearching={isSearching}
      isSearchSettling={isSearchSettling}

    />
  );

  const renderBody = () => {
    if (tab !== "launcher" && tab !== "settings" && !tab.startsWith("plugin:")
        && !isBuiltinModuleEnabled(tab, settings)) {
      return renderLauncher();
    }
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
      case "qx-tty":
        return <QxTTYPanel />;
      case "settings":
        return <SettingsPanel onClose={() => setTab("launcher")} />;
      case "launcher":
      default:
        return renderLauncher();
    }
  };

  const completeOnboarding = useCallback(async () => {
    const general = useSettingsStore.getState().settings.general;
    useSettingsStore.getState().patch("general", {
      ...general,
      has_completed_onboarding: true,
    });
    await useSettingsStore.getState().flush();
    await invoke("floating_set_onboarding_active", { active: false }).catch(() => {});
    setShowOnboarding(false);
    // Resume normal blur-to-hide after the wizard closes.
    ignoreBlurUntilRef.current = Date.now() + 800;
  }, []);

  return (
    <ThemeProvider>
      <div className="qx-canvas">
        <IslandFloatBridge
          enabled={settings.appearance.island_float_enabled}
          mainVisible={mainVisible}
          showWhenMainHidden={settings.appearance.island_float_when_main_hidden}
          alwaysOnTop={settings.appearance.island_float_always_on_top}
          preferDockedWhenMainVisible={settings.appearance.island_prefer_docked_when_main_visible}
        />
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
        {showOnboarding && (
          <Suspense fallback={null}>
            <OnboardingWizard onComplete={() => void completeOnboarding()} />
          </Suspense>
        )}
      </div>
    </ThemeProvider>
  );
}

export default App;
