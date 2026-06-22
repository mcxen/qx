import { useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useStore, type AppEntry } from "./store";
import SearchBar from "./SearchBar";
import ResultsList from "./ResultsList";
import ClipboardPanel from "./modules/clipboard/ClipboardPanel";
import ScreenshotPanel from "./modules/screenshot/ScreenshotPanel";
import ScreenRecorder from "./modules/screencap/ScreenRecorder";
import SettingsPanel from "./modules/settings/SettingsPanel";
import RssReader from "./modules/rss";
import { useSettingsStore } from "./modules/settings/store";
import "./App.css";

const SETTINGS_KEYWORDS = ["settings", "preferences", "plugins", "shortcuts", "appearance", "advanced"];
const SCREENCAP_KEYWORDS = ["gif", "recording", "screencap", "screen record", "录屏"];
const RSS_KEYWORDS = ["rss", "feeds", "feed", "articles", "订阅"];

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function matchesSettings(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return SETTINGS_KEYWORDS.some((k) => k === q || k.startsWith(q) || q.startsWith(k));
}

function matchesScreencap(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return SCREENCAP_KEYWORDS.some((k) => k === q || k.startsWith(q) || q.startsWith(k));
}

function matchesRss(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return RSS_KEYWORDS.some((k) => k === q || k.startsWith(q) || q.startsWith(k));
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
  } = useStore();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { settings, load: loadSettings, loaded: settingsLoaded } = useSettingsStore();

  useEffect(() => {
    if (!settingsLoaded) void loadSettings();
  }, [settingsLoaded, loadSettings]);

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

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const win = getCurrentWindow();
    const unlistenFocus = win.onFocusChanged(({ payload: focused }) => {
      setVisible(focused);
      if (focused) {
        setQuery("");
        setResults([]);
        setSelectedIndex(0);
      }
    });
    const unlistenNav = listen<string>("navigate", (e) => {
      const next = e.payload;
      if (next === "clipboard" || next === "screenshot" || next === "screencap" || next === "rss" || next === "settings") {
        setTab(next);
      } else if (next === "launcher") {
        setTab("launcher");
      }
    });
    return () => {
      unlistenFocus.then((f: () => void) => f());
      unlistenNav.then((f: () => void) => f());
    };
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (matchesSettings(q)) {
        const synthetic: AppEntry = {
          name: "Settings",
          path: "__qx:settings",
          icon: "",
        };
        try {
          const res = await invoke<AppEntry[]>("search_apps", { query: q });
          setResults([synthetic, ...res]);
        } catch {
          setResults([synthetic]);
        }
        return;
      }
      if (matchesScreencap(q)) {
        const synthetic: AppEntry = {
          name: "Record Screen GIF",
          path: "__qx:screencap",
          icon: "",
        };
        try {
          const res = await invoke<AppEntry[]>("search_apps", { query: q });
          setResults([synthetic, ...res]);
        } catch {
          setResults([synthetic]);
        }
        return;
      }
      if (matchesRss(q)) {
        const synthetic: AppEntry = {
          name: "RSS Reader",
          path: "__qx:rss",
          icon: "",
        };
        try {
          const res = await invoke<AppEntry[]>("search_apps", { query: q });
          setResults([synthetic, ...res]);
        } catch {
          setResults([synthetic]);
        }
        return;
      }
      try {
        const res = await invoke<AppEntry[]>("search_apps", { query: q });
        setResults(res);
      } catch {
        setResults([]);
      }
    },
    [setResults],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 100);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, doSearch]);

  const openItem = async (item: AppEntry) => {
    if (item.path === "__qx:settings") {
      setTab("settings");
      return;
    }
    if (item.path === "__qx:screencap") {
      setTab("screencap");
      return;
    }
    if (item.path === "__qx:rss") {
      setTab("rss");
      return;
    }
    await invoke("open_app", { path: item.path });
    if (isTauriRuntime()) await getCurrentWindow().hide();
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.metaKey && e.key === ",") {
      e.preventDefault();
      setTab("settings");
      return;
    }

    if (tab !== "launcher") {
      if (e.key === "Escape") {
        e.preventDefault();
        setTab("launcher");
      }
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
      case "Escape":
        if (isTauriRuntime()) await getCurrentWindow().hide();
        break;
    }
  };

  const renderBody = () => {
    switch (tab) {
      case "clipboard":
        return <ClipboardPanel />;
      case "screenshot":
        return <ScreenshotPanel />;
      case "screencap":
        return <ScreenRecorder />;
      case "rss":
        return <RssReader />;
      case "settings":
        return <SettingsPanel onClose={() => setTab("launcher")} />;
      case "launcher":
      default:
        return (
          <>
            <SearchBar onKeyDown={handleKeyDown} />
            <ResultsList items={results} onItemClick={openItem} />
          </>
        );
    }
  };

  return (
    <div className="qx-canvas">
      <div
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onKeyDown={tab !== "launcher" ? handleKeyDown : undefined}
      >
        {renderBody()}
      </div>
      <div className="qx-actionbar" style={tab === "rss" ? { display: "none" } : undefined}>
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
            <kbd>Esc</kbd>Back
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setTab("settings")}
          style={{
            border: "none",
            background: "transparent",
            color: "var(--color-text-secondary)",
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
  );
}

export default App;
