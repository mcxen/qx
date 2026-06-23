import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, primaryMonitor, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useStore, type AppEntry, type ScreenshotEntry, type SearchScope } from "./store";
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
  const searchScopeRef = useRef<SearchScope>("all");
  const originalBoundsRef = useRef<{ width: number; height: number; x: number; y: number } | null>(null);
  const { settings, load: loadSettings, loaded: settingsLoaded } = useSettingsStore();
  const { load: loadPlugins, findCommands } = usePluginRegistry();
  const phase1Ref = useRef(false);

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

      const background = await invoke<ScreenshotEntry>("take_screenshot");
      const monitor = await primaryMonitor();

      // Expand window to cover the entire monitor
      if (monitor) {
        const monSize = monitor.size;
        const monPos = monitor.position;
        const logicalW = monSize.width / scaleFactor;
        const logicalH = monSize.height / scaleFactor;
        const logicalX = monPos.x / scaleFactor;
        const logicalY = monPos.y / scaleFactor;
        await win.setSize(new LogicalSize(logicalW, logicalH)).catch(() => {});
        await win.setPosition(new LogicalPosition(logicalX, logicalY)).catch(() => {});
      }

      setScreenshotCapture({
        status: "selecting",
        backgroundPath: background.path,
        error: null,
        scaleFactor,
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

  const doSearch = useCallback(
    async (q: string) => {
      const scope = searchScopeRef.current;

      // Phase 1: Apps results come first — from instant in-memory cache
      const entries: AppEntry[] = [];

      // Build synthetic entries from registry commands (built-in + external plugins)
      const pluginMatches = findCommands(q);
      const syntheticEntries: AppEntry[] = pluginMatches.map((m) => ({
        name: m.command.title,
        path: `__qx:cmd:${m.command.pluginId}:${m.command.name}`,
        icon: `builtin:${m.command.pluginId}`,
        kind: "command",
      }));

      // Settings shortcut
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

      // Phase 1: search_apps returns instantly from memory cache
      try {
        if (scope === "all" || scope === "apps") {
          const res = await invoke<AppEntry[]>("search_apps", { query: q });
          entries.push(...res.map((item) => ({ ...item, kind: item.kind ?? "app" as const })));
        }
      } catch {}

      // Show results immediately with apps + commands (even while other providers load)
      setResults(entries);

      // Phase 2/3: Gradually load other providers
      try {
        if (scope === "all" || scope === "files") {
          const files = await invoke<AppEntry[]>("search_files", { query: q });
          if (files.length > 0) {
            entries.push(...files.map((item) => ({ ...item, kind: "file" as const })));
            setResults([...entries]);
          }
        }
      } catch {}

      try {
        if ((scope === "all" || scope === "clipboard") && q.trim()) {
          const history = await invoke<{ id: string; text: string }[]>("get_clipboard_history", { limit: 80 });
          const lower = q.trim().toLowerCase();
          const clipboardEntries = history
            .filter((item) => item.text.toLowerCase().includes(lower))
            .slice(0, 8)
            .map((item) => ({
              name: item.text.replace(/\s+/g, " ").trim().slice(0, 80) || "Clipboard Item",
              path: `__qx:clipboard:${item.id}`,
              icon: "builtin:clipboard",
              kind: "clipboard" as const,
            }));
          if (clipboardEntries.length > 0) {
            entries.push(...clipboardEntries);
            setResults([...entries]);
          }
        }
      } catch {
        if (scope === "all" || scope === "clipboard") {
          entries.push(...syntheticEntries.filter((item) => item.path.includes("clipboard")));
        }
      }
    },
    [setResults, findCommands],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
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
