import { useEffect, useCallback, useRef, useTransition } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useStore, type AppEntry, type ScreenshotEntry, type MonitorInfo, type SearchScope } from "./store";
import Launcher from "./Launcher";
import ClipboardPanel from "./modules/clipboard/ClipboardPanel";
import ScreenshotPanel, { REGION_CAPTURE_EVENT } from "./modules/screenshot/ScreenshotPanel";
import ScreenshotRegionOverlay, { type Point } from "./modules/screenshot/ScreenshotRegionOverlay";
import ScreenRecorder from "./modules/screencap/ScreenRecorder";
import SettingsPanel from "./modules/settings/SettingsPanel";
import RssReader from "./modules/rss";
import MacroRecorder from "./modules/macros/MacroRecorder";
import { useSettingsStore } from "./modules/settings/store";
import { ThemeProvider } from "./ThemeProvider";
import { usePluginRegistry } from "./plugin/registry";
import { registerAllBuiltins } from "./plugin/builtin";
import { PluginHost, PluginPanelViewport } from "./plugin/PluginHost";
import "./App.css";

const SETTINGS_KEYWORDS = ["settings", "preferences", "plugins", "shortcuts", "appearance", "advanced"];

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
    screenshotCapture,
    setScreenshotCapture,
    updateResultIcons,
    loadingPhase,
    setLoadingPhase,
    appsReady,
    setAppsReady,
  } = useStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const slowSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const recordSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchSeqRef = useRef(0);
  const searchScopeRef = useRef<SearchScope>("all");
  const originalBoundsRef = useRef<{ width: number; height: number; x: number; y: number } | null>(null);
  const { settings, load: loadSettings, loaded: settingsLoaded } = useSettingsStore();
  const { load: loadPlugins, findCommands } = usePluginRegistry();
  const phase1Ref = useRef(false);
  const [, startSearchTransition] = useTransition();

  const applyResults = useCallback(
    (entries: AppEntry[]) => {
      startSearchTransition(() => setResults(entries));
    },
    [setResults, startSearchTransition],
  );

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
      onGetPreference: async () => null,
    });
  }, [loadPlugins, appsReady]);

  // Listen for qx:navigate custom events (from built-in module commands)
  useEffect(() => {
    const handler = (e: Event) => {
      const tabId = (e as CustomEvent).detail as string;
      if (tabId === "clipboard" || tabId === "screenshot" || tabId === "screencap"
          || tabId === "rss" || tabId === "macros" || tabId === "settings") {
        setTab(tabId);
      } else if (tabId?.startsWith("plugin:")) {
        setTab(tabId);
      }
    };
    window.addEventListener("qx:navigate", handler);
    return () => window.removeEventListener("qx:navigate", handler);
  }, [setTab]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--qx-canvas-opacity",
      String(settings.appearance.blur_opacity),
    );
    document.documentElement.style.setProperty(
      "--qx-radius",
      `${settings.appearance.border_radius}px`,
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

  const restoreCaptureWindow = useCallback(async () => {
    if (!isTauriRuntime()) return;
    const win = getCurrentWindow();
    // Restore original window bounds if we saved them
    if (originalBoundsRef.current) {
      const { width, height, x, y } = originalBoundsRef.current;
      await win.setSize(new LogicalSize(width, height)).catch(() => {});
      await win.setPosition(new LogicalPosition(x, y)).catch(() => {});
      originalBoundsRef.current = null;
    }
    await win.show().catch(() => {});
    await win.setFocus().catch(() => {});
  }, []);

  const beginRegionCapture = useCallback(async () => {
    if (useStore.getState().screenshotCapture.status !== "idle") return;
    setTab("screenshot");
    setScreenshotCapture({
      status: "saving",
      backgroundPath: null,
      error: null,
      previewPath: null,
      scaleFactor: 1,
    });

    if (!isTauriRuntime()) {
      setScreenshotCapture({
        status: "idle",
        error: "Screenshot capture requires the Tauri runtime.",
      });
      return;
    }

    const win = getCurrentWindow();
    try {
      // Save current window bounds before expanding to fullscreen
      const innerSize = await win.innerSize();
      const outerPos = await win.outerPosition();
      const scaleFactor = await win.scaleFactor().catch(() => 1);
      originalBoundsRef.current = {
        width: innerSize.width / scaleFactor,
        height: innerSize.height / scaleFactor,
        x: outerPos.x / scaleFactor,
        y: outerPos.y / scaleFactor,
      };

      await win.hide();
      // Small delay to ensure window is fully hidden before capturing
      await new Promise((r) => setTimeout(r, 150));

      // Capture the monitor under the window's current position (cross-platform)
      const windowCenterX = outerPos.x + innerSize.width / 2;
      const windowCenterY = outerPos.y + innerSize.height / 2;
      const background = await invoke<ScreenshotEntry>("capture_at_point", {
        screenX: Math.round(windowCenterX),
        screenY: Math.round(windowCenterY),
      });

      // Find the monitor at that point for overlay positioning
      const monitors = await invoke<MonitorInfo[]>("get_monitors");
      const monitor = monitors.find((m) => {
        const mx = m.x;
        const my = m.y;
        const mw = m.width;
        const mh = m.height;
        return (
          windowCenterX >= mx &&
          windowCenterX < mx + mw &&
          windowCenterY >= my &&
          windowCenterY < my + mh
        );
      }) ?? monitors[0];

      // Expand window to cover the entire monitor.
      // Use the TARGET monitor's scale_factor (not the window's current one),
      // since the window may be moving across monitors with different DPI.
      if (monitor) {
        const monScale = monitor.scale_factor || scaleFactor;
        const logicalW = monitor.width / monScale;
        const logicalH = monitor.height / monScale;
        const logicalX = monitor.x / monScale;
        const logicalY = monitor.y / monScale;
        await win.setSize(new LogicalSize(logicalW, logicalH)).catch(() => {});
        await win.setPosition(new LogicalPosition(logicalX, logicalY)).catch(() => {});
      }

      // store the TARGET monitor's scale so completeRegionCapture can map
      // CSS px -> screenshot physical px correctly when monitors are mixed-DPI.
      const targetScale = monitor ? (monitor.scale_factor || scaleFactor) : scaleFactor;
      setScreenshotCapture({
        status: "selecting",
        backgroundPath: background.path,
        error: null,
        scaleFactor: targetScale,
      });
      await win.show();
      await win.setFocus();
    } catch (error) {
      setScreenshotCapture({
        status: "idle",
        backgroundPath: null,
        error: String(error),
      });
      await restoreCaptureWindow();
    }
  }, [restoreCaptureWindow, setScreenshotCapture, setTab]);

  const cancelRegionCapture = useCallback(async () => {
    setScreenshotCapture({
      status: "idle",
      backgroundPath: null,
    });
    await restoreCaptureWindow();
  }, [restoreCaptureWindow, setScreenshotCapture]);

  const completeRegionCapture = useCallback(
    async (start: Point, end: Point) => {
      const left = Math.min(start.x, end.x);
      const top = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);

      if (width < 8 || height < 8) {
        await cancelRegionCapture();
        return;
      }

      setScreenshotCapture({ status: "saving", error: null });

      try {
        const scaleFactor = useStore.getState().screenshotCapture.scaleFactor || 1;

        // Window is now fullscreen at (0,0) covering the entire monitor,
        // so logical coordinates map directly to screen coordinates.
        const x = Math.max(0, Math.round(left * scaleFactor));
        const y = Math.max(0, Math.round(top * scaleFactor));
        const physicalWidth = Math.max(1, Math.round(width * scaleFactor));
        const physicalHeight = Math.max(1, Math.round(height * scaleFactor));

        if (isTauriRuntime()) {
          await getCurrentWindow().hide().catch(() => {});
        }

        const result = await invoke<ScreenshotEntry>("take_screenshot_area", {
          x,
          y,
          width: physicalWidth,
          height: physicalHeight,
          sourcePath: useStore.getState().screenshotCapture.backgroundPath,
        });

        setScreenshotCapture({
          status: "idle",
          backgroundPath: null,
          error: null,
          previewPath: result.path,
        });
      } catch (error) {
        setScreenshotCapture({
          status: "idle",
          backgroundPath: null,
          error: String(error),
        });
      } finally {
        await restoreCaptureWindow();
      }
    },
    [cancelRegionCapture, restoreCaptureWindow, setScreenshotCapture],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const win = getCurrentWindow();
    const unlistenFocus = win.onFocusChanged(({ payload: focused }) => {
      setVisible(focused);
      // Don't auto-hide during screenshot region selection
      const captureStatus = useStore.getState().screenshotCapture.status;
      const shouldAutoHide = settings.general.autoHideOnBlur && captureStatus === "idle";
      if (!focused && shouldAutoHide) {
        win.hide().catch(() => {});
      }
      if (focused) {
        setQuery("");
        setResults([]);
        setSelectedIndex(0);
      }
    });
    const unlistenNav = listen<string>("navigate", (e) => {
      const next = e.payload;
      if (next === "clipboard" || next === "screenshot" || next === "screencap" || next === "rss" || next === "macros" || next === "settings") {
        setTab(next);
      } else if (next === "launcher") {
        setTab("launcher");
      } else if (next.startsWith("plugin:")) {
        setTab(next);
      }
    });
    const unlistenCapture = listen("screenshot:capture-region", () => {
      void beginRegionCapture();
    });
    const onDomCapture = () => {
      void beginRegionCapture();
    };
    window.addEventListener(REGION_CAPTURE_EVENT, onDomCapture);
    return () => {
      unlistenFocus.then((f: () => void) => f());
      unlistenNav.then((f: () => void) => f());
      unlistenCapture.then((f: () => void) => f());
      window.removeEventListener(REGION_CAPTURE_EVENT, onDomCapture);
    };
  }, [
    beginRegionCapture,
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
      const shouldSearchFiles =
        (scope === "files" && trimmed.length >= 2) || (scope === "all" && trimmed.length >= 3);
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

      if (slowSearchDebounceRef.current) clearTimeout(slowSearchDebounceRef.current);
      if (recordSearchDebounceRef.current) clearTimeout(recordSearchDebounceRef.current);

      const scope = searchScopeRef.current;
      const entries: AppEntry[] = [];

      const pluginMatches = findCommands(q);
      const syntheticEntries: AppEntry[] = pluginMatches.map((m) => ({
        name: m.command.title,
        path: `__qx:cmd:${m.command.pluginId}:${m.command.name}`,
        icon: `builtin:${m.command.pluginId}`,
        kind: "command",
      }));

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

      slowSearchDebounceRef.current = setTimeout(() => {
        void loadSlowSearchProviders(q, scope, baseEntries, syntheticEntries, seq);
      }, scope === "files" ? 80 : 260);

      const trimmed = q.trim();
      if (trimmed.length > 0) {
        recordSearchDebounceRef.current = setTimeout(() => {
          if (seq === searchSeqRef.current) {
            invoke("record_search", { query: trimmed }).catch(() => {});
          }
        }, 900);
      }
    },
    [applyResults, findCommands, loadSlowSearchProviders],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (slowSearchDebounceRef.current) clearTimeout(slowSearchDebounceRef.current);
      if (recordSearchDebounceRef.current) clearTimeout(recordSearchDebounceRef.current);
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
    // Handle built-in tab navigation
    if (item.path === "__qx:settings") {
      setTab("settings");
      return;
    }
    if (item.path.startsWith("__qx:clipboard:")) {
      setTab("clipboard");
      return;
    }
    // Handle __qx:<tabId> style paths (backward compat)
    const tabMatch = item.path.match(/^__qx:(clipboard|screenshot|screencap|rss|macros)$/);
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
      case "screenshot":
        return <ScreenshotPanel />;
      case "screencap":
        return <ScreenRecorder />;
      case "rss":
        return <RssReader />;
      case "macros":
        return <MacroRecorder />;
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
      {screenshotCapture.status === "selecting" && screenshotCapture.backgroundPath && (
        <ScreenshotRegionOverlay
          backgroundPath={screenshotCapture.backgroundPath}
          onComplete={completeRegionCapture}
          onCancel={cancelRegionCapture}
        />
      )}
      <div
        className="qx-actionbar"
        style={
          tab === "launcher" ||
          tab === "clipboard" ||
          tab === "screenshot" ||
          tab === "screencap" ||
          tab === "rss" ||
          tab === "macros" ||
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
