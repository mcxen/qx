import { useEffect, useCallback, useRef, useState, useTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, LogicalSize, primaryMonitor } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useStore, type AppEntry, type SearchScope } from "./store";
import Launcher from "./Launcher";
import ClipboardPanel from "./modules/clipboard/ClipboardPanel";
import ScreenRecorder from "./modules/screencap/ScreenRecorder";
import DevTxtTool from "./modules/documents/DevTxtTool";
import SettingsPanel from "./modules/settings/SettingsPanel";
import RssReader from "./modules/rss";
import V2exPanel from "./modules/v2ex/V2exPanel";
import G4fReader from "./modules/qx-ai";
import MacroRecorder from "./modules/macros/MacroRecorder";
import { useSettingsStore } from "./modules/settings/store";
import { ThemeProvider } from "./ThemeProvider";
import { usePluginRegistry } from "./plugin/registry";
import { registerAllBuiltins } from "./plugin/builtin";
import { PluginHost, PluginPanelViewport } from "./plugin/PluginHost";
import { calculateExpression } from "./search/calculator";
import "./App.css";

const SETTINGS_KEYWORDS = ["settings", "preferences", "plugins", "shortcuts", "appearance", "advanced"];
const MIN_WINDOW_WIDTH = 480;
const MIN_WINDOW_HEIGHT = 360;
const MAX_WINDOW_WIDTH = 1500;
const MAX_WINDOW_HEIGHT = 882;
const FIRST_LAUNCH_WINDOW_RATIO = 0.6;
const OVERSIZED_SAVED_WINDOW_RATIO = 0.9;

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

function shouldLoadSlowSearchProviders(query: string, scope: SearchScope): boolean {
  const trimmed = query.trim();
  const shouldSearchFiles =
    (scope === "files" && trimmed.length >= 2) || (scope === "all" && trimmed.length >= 3);
  const shouldSearchClipboard = (scope === "all" || scope === "clipboard") && trimmed.length > 0;

  return shouldSearchFiles || shouldSearchClipboard;
}

/**
 * Phased startup:
 *   Phase 1 (immediate): Load apps DB cache via search_apps("") — instant from memory
 *   Phase 2 (background): Preload icons, scan for new apps (apps:updated event triggers refresh)
 *   Phase 3 (lazy): Settings, plugins, clipboard history
 */
async function triggerPhase1Load(appsReady: boolean, setAppsReady: (r: boolean) => void, setLoadingPhase: (p: import("./store").LoadingPhase) => void) {
  if (appsReady) return;
  if (!isTauriRuntime()) {
    // Non-Tauri: just mark ready immediately
    setAppsReady(true);
    setLoadingPhase("ready");
    return;
  }
  try {
    // Phase 1: warm the cache by doing one search (triggers DB load)
    await invoke<AppEntry[]>("search_apps", { query: "" });
    setAppsReady(true);
    setLoadingPhase("ready");
  } catch {
    // Fallback: mark ready anyway so UI isn't stuck
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
  const searchScopeRef = useRef<SearchScope>("all");
  const { settings, load: loadSettings, loaded: settingsLoaded } = useSettingsStore();
  const { load: loadPlugins, findCommands } = usePluginRegistry();
  const phase1Ref = useRef(false);
  const startupWindowShownRef = useRef(false);
  const resizeSaveTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchSettling, setIsSearchSettling] = useState(false);
  const [, startSearchTransition] = useTransition();

  const applyResults = useCallback(
    (entries: AppEntry[]) => {
      startSearchTransition(() => setResults(entries));
    },
    [setResults, startSearchTransition],
  );

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

  // Phase 1: Load app cache immediately — runs once on mount
  useEffect(() => {
    if (phase1Ref.current) return;
    phase1Ref.current = true;
    triggerPhase1Load(appsReady, setAppsReady, setLoadingPhase);
  }, [appsReady, setAppsReady, setLoadingPhase]);

  // Phase 3 (lazy): Load settings on first mount — deferred slightly
  useEffect(() => {
    if (!appsReady) return; // Wait for phase 1
    if (!settingsLoaded) void loadSettings();
  }, [settingsLoaded, loadSettings, appsReady]);

  // Phase 3 (lazy): Load external plugins — deferred
  useEffect(() => {
    if (!appsReady) return; // Wait for phase 1
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
    });
  }, [loadPlugins, appsReady]);

  // Listen for qx:navigate custom events (from built-in module commands)
  useEffect(() => {
    const handler = (e: Event) => {
      const tabId = (e as CustomEvent).detail as string;
      if (tabId === "clipboard" || tabId === "screencap"
          || tabId === "rss" || tabId === "v2ex" || tabId === "qx-ai" || tabId === "macros" || tabId === "documents" || tabId === "settings") {
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
    document.documentElement.style.setProperty(
      "--qx-canvas-opacity",
      String(settings.appearance.blur_opacity),
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

  // Restore window size from saved settings; first launch derives size from the active monitor.
  useEffect(() => {
    if (!settingsLoaded || !isTauriRuntime()) return;
    if (startupWindowShownRef.current) return;
    const restoreAndShow = async () => {
      const win = getCurrentWindow();
      const appearance = useSettingsStore.getState().settings.appearance;
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
      if (!hasSavedSize) {
        await win.center().catch(() => {});
      }

      startupWindowShownRef.current = true;
      setTab("launcher");
      await win.show();
      await win.setFocus();
    };

    restoreAndShow().catch((e) => {
      console.warn("window size restore failed:", e);
    });
  }, [settingsLoaded, setTab]);

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
      if (resizeSaveTimerRef.current) {
        window.clearTimeout(resizeSaveTimerRef.current);
      }
      resizeSaveTimerRef.current = window.setTimeout(() => {
        const { settings, patch } = useSettingsStore.getState();
        if (
          width !== settings.appearance.window_width ||
          height !== settings.appearance.window_height
        ) {
          patch("appearance", {
            ...settings.appearance,
            window_width: width,
            window_height: height,
          });
        }
      }, 250);
    });
    return () => {
      if (resizeSaveTimerRef.current) {
        window.clearTimeout(resizeSaveTimerRef.current);
        resizeSaveTimerRef.current = null;
      }
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const win = getCurrentWindow();
    const unlistenFocus = win.onFocusChanged(({ payload: focused }) => {
      setVisible(focused);
      if (!focused && settings.general.autoHideOnBlur) {
        win.hide().catch(() => {});
      }
      if (focused) {
        if (searchFadeTimerRef.current) clearTimeout(searchFadeTimerRef.current);
        setIsSearching(false);
        setIsSearchSettling(false);
        setQuery("");
        setSelectedIndex(0);
        // Kick off an immediate empty search so apps show right away
        invoke<AppEntry[]>("search_apps", { query: "" })
          .then((apps) => {
            const mapped: AppEntry[] = apps.map((a) => ({ ...a, kind: a.kind ?? "app" }));
            useStore.getState().setResults(mapped);
          })
          .catch(() => {});
      }
    });
    const unlistenNav = listen<string>("navigate", (e) => {
      const next = e.payload;
      if (next === "clipboard" || next === "screencap" || next === "rss" || next === "v2ex" || next === "qx-ai" || next === "macros" || next === "settings") {
        setTab(next);
      } else if (next === "launcher") {
        setTab("launcher");
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
    settings.general.autoHideOnBlur,
    tab,
  ]);

  const loadSlowSearchProviders = useCallback(
    async (
      q: string,
      scope: SearchScope,
      baseEntries: AppEntry[],
      syntheticEntries: AppEntry[],
      seq: number,
    ) => {
      const trimmed = q.trim();
      const shouldSearchFiles = (scope === "files" && trimmed.length >= 2) || (scope === "all" && trimmed.length >= 3);
      const shouldSearchClipboard = (scope === "all" || scope === "clipboard") && trimmed.length > 0;

      if (!shouldSearchFiles && !shouldSearchClipboard) return;

      const [files, clipboardEntries] = await Promise.all([
        shouldSearchFiles
          ? invoke<AppEntry[]>("search_files", { query: q })
              .then((items) => items.map((item) => ({ ...item, kind: "file" as const })))
              .catch(() => [] as AppEntry[])
          : Promise.resolve([] as AppEntry[]),
        shouldSearchClipboard
          ? invoke<{ id: string; text: string }[]>("get_clipboard_history", { limit: 80 })
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

      if (seq !== searchSeqRef.current) return;
      applyResults([...baseEntries, ...files, ...clipboardEntries]);
    },
    [applyResults],
  );

  const doSearch = useCallback(
    async (q: string) => {
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
      const entries: AppEntry[] = [];

      const pluginMatches = findCommands(q);
      const syntheticEntries: AppEntry[] = [];

      // Also match installed plugin panel names/keywords as navigation entries
      const pluginState = usePluginRegistry.getState();
      const lowerQuery = q.trim().toLowerCase();
      if (lowerQuery) {
        for (const [pluginId, panel] of Object.entries(pluginState.panels)) {
          if (pluginId.startsWith("builtin:")) continue;
          const nameSource = (panel.pluginName || pluginId).toLowerCase();
          const titleSource = (panel.title || pluginId).toLowerCase();
          const kw = panel.keywords || [];
          if (nameSource.includes(lowerQuery) || titleSource.includes(lowerQuery) || kw.some((k) => k.toLowerCase().includes(lowerQuery))) {
            syntheticEntries.push({
              name: panel.title || pluginId,
              path: `__qx:plugin:${pluginId}`,
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
          if (nameSource.includes(lowerQuery) || descSource.includes(lowerQuery) || manifestKw.some((k) => k.toLowerCase().includes(lowerQuery))) {
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
          icon: `builtin:${m.command.pluginId}`,
          kind: "command" as const,
        })),
      );

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

      if (scope === "all" || scope === "apps") {
        entries.push(...syntheticEntries);
      }

      try {
        if (scope === "all" || scope === "apps") {
          const res = await invoke<AppEntry[]>("search_apps", { query: q });
          if (seq !== searchSeqRef.current) return;
          entries.push(...res.map((item) => ({ ...item, kind: item.kind ?? "app" as const })));
        }
      } catch {}

      if (seq !== searchSeqRef.current) return;
      const baseEntries = [...entries];
      applyResults(baseEntries);

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
    [applyResults, findCommands, finishSearchActivity, loadSlowSearchProviders],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (slowSearchDebounceRef.current) clearTimeout(slowSearchDebounceRef.current);
      if (recordSearchDebounceRef.current) clearTimeout(recordSearchDebounceRef.current);
      if (searchFadeTimerRef.current) clearTimeout(searchFadeTimerRef.current);
    };
  }, [query, doSearch]);

  // Listen for apps:updated event (background scan completed)
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen("apps:updated", async () => {
      // Refresh search results with updated app list
      const { query: currentQuery } = useStore.getState();
      try {
        const apps = await invoke<AppEntry[]>("search_apps", { query: currentQuery });
        // Merge updated apps into existing results
        const state = useStore.getState();
        const nonApps = state.results.filter((r) => r.kind !== "app" && !(r.kind === undefined));
        // Also keep apps that don't match kind "app" but are not in the app list
        const updatedApps = apps.map((a) => ({ ...a, kind: a.kind ?? "app" as const }));
        useStore.getState().setResults([...nonApps, ...updatedApps]);
      } catch {}
    });
    return () => {
      unlisten.then((f: () => void) => f());
    };
  }, []);

  // Listen for apps:icons-ready event (icon preloading done)
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen("apps:icons-ready", async () => {
      const { query } = useStore.getState();
      try {
        const apps = await invoke<AppEntry[]>("search_apps", { query });
        const iconMap = new Map(apps.map((a) => [a.path, a.icon]));
        updateResultIcons((path) => iconMap.get(path));
      } catch {}
    });
    return () => {
      unlisten.then((f: () => void) => f());
    };
  }, [updateResultIcons]);

  const openItem = async (item: AppEntry) => {
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
      setTab("clipboard");
      return;
    }
    if (item.path.startsWith("__qx:calc:")) {
      await writeText(decodeURIComponent(item.path.slice("__qx:calc:".length)));
      if (isTauriRuntime()) await getCurrentWindow().hide();
      return;
    }
    // Handle __qx:<tabId> style paths (backward compat)
    const tabMatch = item.path.match(/^__qx:(clipboard|screencap|rss|v2ex|qx-ai|macros|documents)$/);
    if (tabMatch) {
      setTab(tabMatch[1] as any);
      return;
    }
    // Open external application or file
    await invoke("open_app", { path: item.path });
    // Record launch history (fire-and-forget)
    invoke("record_launch", { path: item.path, name: item.name }).catch(() => {});
    if (isTauriRuntime()) await getCurrentWindow().hide();
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.metaKey && e.key === ",") {
      e.preventDefault();
      setTab("settings");
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      if (isTauriRuntime()) {
        getCurrentWindow().hide().catch(() => {});
      }
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
  };

  const renderBody = () => {
    // Handle external plugin panels (tabs like "plugin:<id>")
    if (tab.startsWith("plugin:")) {
      return <PluginPanelViewport />;
    }

    switch (tab) {
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
      case "settings":
        return <SettingsPanel onClose={() => setTab("launcher")} />;
      case "launcher":
      default:
        return (
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
          />
        );
    }
  };

  return (
    <ThemeProvider>
      <div className="qx-canvas">
        {/* Hidden container for plugin iframes */}
        <PluginHost />
        <div
          style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
          onKeyDown={tab !== "launcher" ? handleKeyDown : undefined}
        >
          {renderBody()}
        </div>
      <div
        className="qx-actionbar"
        style={
          tab === "launcher" ||
          tab === "clipboard" ||
          tab === "screencap" ||
          tab === "rss" ||
          tab === "v2ex" ||
          tab === "qx-ai" ||
          tab === "macros" ||
          tab === "documents" ||
          tab === "settings"
            ? { display: "none" }
            : undefined
        }
      >
        {tab === "launcher" && (
          <>
            <span className="item">
              <kbd>↩</kbd>Open
            </span>
            <span className="item">
              <kbd>⌘K</kbd>Commands
            </span>
          </>
        )}
        {tab !== "launcher" && (
          <span className="item">
            <kbd>Esc</kbd>Hide
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setTab("settings")}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--qx-text-secondary)",
            fontSize: 12,
            cursor: "pointer",
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
          title="Open Settings (⌘,)"
        >
          <kbd>⌘,</kbd>Settings
        </button>
      </div>
      </div>
    </ThemeProvider>
  );
}

export default App;
