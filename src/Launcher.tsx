import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import QxShell, { type BottomIslandContent } from "./components/QxShell";
import HomeDateIsland from "./components/HomeDateIsland";
import HomeSystemIsland from "./components/HomeSystemIsland";
import ResultsList from "./ResultsList";
import SearchBar from "./SearchBar";
import { Select } from "./components/ui";
import { useStore, type AppEntry, type HistoryEntry, type SearchHistoryEntry, type SearchScope } from "./store";
import { useSettingsStore } from "./modules/settings/store";
import { useT } from "./i18n";

interface QuickEntry {
  id: string;
  title: string;
  subtitle: string;
  onClick: () => void;
}

interface LauncherAction {
  id: string;
  label: string;
  kbd?: string;
  danger?: boolean;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

interface LauncherProps {
  results: AppEntry[];
  selectedIndex: number;
  onItemClick: (item: AppEntry) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onNavigate: (tab: string) => void;
  searchScopeRef: React.MutableRefObject<SearchScope>;
  onScopeChange: () => void;
  loadingPhase?: string;
}

export default function Launcher({
  results,
  selectedIndex,
  onItemClick,
  onKeyDown,
  onNavigate,
  searchScopeRef,
  onScopeChange,
  loadingPhase,
}: LauncherProps) {
  const { settings } = useSettingsStore();
  const t = useT();
  const appearance = settings.appearance;
  const [scope, setScope] = useState<SearchScope>(searchScopeRef.current);
  const [actionPanelOpen, setActionPanelOpen] = useState(false);
  const [actionIndex, setActionIndex] = useState(0);
  const [recentLaunches, setRecentLaunches] = useState<HistoryEntry[]>([]);
  const [recentSearches, setRecentSearches] = useState<SearchHistoryEntry[]>([]);
  const query = useStore((state) => state.query);
  const setQuery = useStore((state) => state.setQuery);
  const scopeOptions: { value: SearchScope; label: string }[] = [
    { value: "all", label: "All" },
    { value: "apps", label: "Apps" },
    { value: "files", label: "Files" },
    { value: "clipboard", label: "Clipboard" },
  ];
  const selectedItem = results[selectedIndex] ?? null;

  const readClipboardText = async (item: AppEntry) => {
    const id = item.path.slice("__qx:clipboard:".length);
    const history = await invoke<{ id: string; text: string }[]>("get_clipboard_history", {
      limit: 200,
    });
    return history.find((entry) => entry.id === id)?.text ?? item.name;
  };

  const launcherActions: LauncherAction[] = selectedItem
    ? (() => {
        const kind = selectedItem.kind ?? (selectedItem.path.startsWith("__qx:") ? "command" : "app");
        if (kind === "clipboard") {
          return [
            {
              id: "copy-text",
              label: "Copy Text",
              kbd: "↵",
              run: async () => writeText(await readClipboardText(selectedItem)),
            },
            {
              id: "open-clipboard",
              label: "Open Clipboard History",
              kbd: "⌘ ↵",
              run: () => onNavigate("clipboard"),
            },
          ];
        }
        if (kind === "command") {
          return [
            {
              id: "run-command",
              label: selectedItem.path === "__qx:settings" ? "Open Settings" : "Run Command",
              kbd: "↵",
              run: () => onItemClick(selectedItem),
            },
          ];
        }
        if (kind === "calculation") {
          return [
            {
              id: "copy-result",
              label: "Copy Result",
              kbd: "↵",
              run: () => onItemClick(selectedItem),
            },
          ];
        }
        return [
          {
            id: "open",
            label: kind === "file" ? "Open File" : "Open Application",
            kbd: "↵",
            run: () => onItemClick(selectedItem),
          },
          {
            id: "reveal",
            label: "Show in Finder",
            kbd: "⌘ ↵",
            run: () => revealItemInDir(selectedItem.path),
          },
          {
            id: "copy-path",
            label: "Copy Path",
            kbd: "⌘ C",
            run: () => writeText(selectedItem.path),
          },
          ...(kind === "app"
            ? [
                {
                  id: "show-package",
                  label: "Show Package Contents",
                  kbd: "⌥ ⌘ ↵",
                  run: () => openPath(`${selectedItem.path}/Contents`),
                },
              ]
            : []),
        ];
      })()
    : [];

  useEffect(() => {
    setActionPanelOpen(false);
    setActionIndex(0);
  }, [selectedItem?.path]);

  // Load recent launches and search history
  const loadHistory = useCallback(async () => {
    try {
      const [launches, searches] = await Promise.all([
        invoke<HistoryEntry[]>("get_launch_history", { limit: 5 }),
        invoke<SearchHistoryEntry[]>("get_search_history", { limit: 5 }),
      ]);
      setRecentLaunches(launches);
      setRecentSearches(searches);
    } catch {}
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Reload history when results become empty (user cleared search or opened app)
  useEffect(() => {
    if (results.length === 0 && !loadingPhase) {
      void loadHistory();
    }
  }, [results.length, loadingPhase, loadHistory]);

  const quickEntries: QuickEntry[] = [
    {
      id: "clipboard",
      title: t("launcher.clipboard", "Clipboard History"),
      subtitle: t("launcher.clipboard.desc", "Pinned, frequent, links"),
      onClick: () => onNavigate("clipboard"),
    },
    {
      id: "screenshot",
      title: t("launcher.screenshot", "Screenshot"),
      subtitle: t("launcher.screenshot.desc", "Capture region or screen"),
      onClick: () => onNavigate("screenshot"),
    },
    {
      id: "rss",
      title: t("launcher.rss", "RSS Reader"),
      subtitle: t("launcher.rss.desc", "Feeds and articles"),
      onClick: () => onNavigate("rss"),
    },
    {
      id: "documents",
      title: t("launcher.documents", "Documents"),
      subtitle: t("launcher.documents.desc", "Text, Markdown, JSON"),
      onClick: () => onNavigate("documents"),
    },
    {
      id: "settings",
      title: t("launcher.settings", "Settings"),
      subtitle: t("launcher.settings.desc", "Appearance and plugins"),
      onClick: () => onNavigate("settings"),
    },
  ];

  const island: BottomIslandContent | null = loadingPhase === "loading-apps"
    ? {
        label: t("launcher.loading", "Loading apps..."),
        detail: t("launcher.loading.detail", "Preparing application cache"),
        progress: 0,
      }
    : results.length
    ? {
        label: t("launcher.ready", "Search ready"),
        detail: `${results.length} ${t("launcher.result", results.length === 1 ? "result" : "results")}`,
        progress: Math.min(100, Math.max(12, results.length * 12)),
      }
    : appearance.home_island_mode === "system" || appearance.home_island_mode === "date"
      ? null
      : {
        label: t("launcher.title", "Qx Launcher"),
        detail: t("launcher.idle", "Type to search apps and commands"),
      };

  const customIsland = !results.length && appearance.home_island_mode === "date" ? (
    <HomeDateIsland />
  ) : !results.length && appearance.home_island_mode === "system" ? (
    <HomeSystemIsland
      showCpu={appearance.home_island_cpu}
      showGpu={appearance.home_island_gpu}
      showMemory={appearance.home_island_memory}
    />
  ) : undefined;

  const handleLauncherKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === ",") {
      event.preventDefault();
      event.stopPropagation();
      setActionPanelOpen(false);
      onNavigate("settings");
      return;
    }

    if (actionPanelOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setActionPanelOpen(false);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setActionIndex((index) => Math.min(index + 1, launcherActions.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActionIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const action = launcherActions[actionIndex];
        if (action) {
          setActionPanelOpen(false);
          void action.run();
        }
        return;
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      event.stopPropagation();
      if (launcherActions.length > 0) {
        setActionIndex(0);
        setActionPanelOpen((open) => !open);
      }
      return;
    }
    onKeyDown(event);
  };

  return (
    <QxShell
      title="Launcher"
      className="launcher-shell"
      search={<SearchBar onKeyDown={handleLauncherKeyDown} embedded />}
      trailing={
        <Select
          value={scope}
          options={scopeOptions}
          ariaLabel="Search scope"
          className="qx-launcher-scope"
          onChange={(next) => {
            setScope(next);
            searchScopeRef.current = next;
            onScopeChange();
          }}
        />
      }
      context={
        <div className="qx-launcher-context">
          <div className="qx-context-title">{t("launcher.quickEntries", "Quick Entries")}</div>
          {quickEntries.map((entry) => (
            <button
              key={entry.id}
              className="qx-context-entry"
              onClick={entry.onClick}
              type="button"
            >
              <span className="qx-context-entry-title">{entry.title}</span>
              <span className="qx-context-entry-subtitle">{entry.subtitle}</span>
            </button>
          ))}
          {recentLaunches.length > 0 && (
            <>
              <div className="qx-context-title" style={{ marginTop: 12 }}>Recent</div>
              {recentLaunches.map((entry) => (
                <button
                  key={`launch-${entry.id}`}
                  className="qx-context-entry"
                  onClick={() => {
                    invoke("open_app", { path: entry.path }).catch(() => {});
                    getCurrentWindow().hide().catch(() => {});
                  }}
                  type="button"
                >
                  <span className="qx-context-entry-title">{entry.name}</span>
                  <span className="qx-context-entry-subtitle">{entry.timestamp}</span>
                </button>
              ))}
            </>
          )}
          {recentSearches.length > 0 && !query && (
            <>
              <div className="qx-context-title" style={{ marginTop: 12 }}>Recent Searches</div>
              {recentSearches.map((entry) => (
                <button
                  key={`search-${entry.id}`}
                  className="qx-context-entry"
                  onClick={() => setQuery(entry.query)}
                  type="button"
                >
                  <span className="qx-context-entry-title">{entry.query}</span>
                  <span className="qx-context-entry-subtitle">{entry.timestamp}</span>
                </button>
              ))}
            </>
          )}
        </div>
      }
      island={island}
      customIsland={customIsland}
      primaryAction={{
        label: results[selectedIndex] ? t("launcher.open", "Open") : t("launcher.search", "Search"),
        kbd: "↵",
        disabled: results.length === 0,
        tone: "primary",
        onClick: () => {
          const item = results[selectedIndex];
          if (item) onItemClick(item);
        },
      }}
      secondaryAction={{
        label: t("launcher.actions", "Actions"),
        kbd: "⌘K",
        disabled: results.length === 0,
        onClick: () => {
          setActionIndex(0);
          setActionPanelOpen((open) => !open);
        },
      }}
    >
      <ResultsList items={results} onItemClick={onItemClick} loadingPhase={loadingPhase} />
      {actionPanelOpen && selectedItem && (
        <div
          className="qx-actions-popover"
          role="menu"
          aria-label={
            selectedItem.kind === "file"
              ? "File Actions"
              : selectedItem.kind === "clipboard"
                ? "Clipboard Actions"
                : selectedItem.kind === "command"
                  ? "Command Actions"
                  : "Application Actions"
          }
        >
          <div className="qx-actions-popover-title">
            {selectedItem.kind === "file"
              ? "File Actions"
              : selectedItem.kind === "clipboard"
                ? "Clipboard Actions"
                : selectedItem.kind === "command"
                  ? "Command Actions"
                  : "Application Actions"}
          </div>
          {launcherActions.map((action, index) => (
            <button
              key={action.id}
              className={`qx-actions-popover-item${index === actionIndex ? " is-active" : ""}${
                action.danger ? " danger" : ""
              }`}
              disabled={action.disabled}
              onMouseEnter={() => setActionIndex(index)}
              onClick={() => {
                setActionPanelOpen(false);
                void action.run();
              }}
              role="menuitem"
              type="button"
            >
              <span>{action.label}</span>
              {action.kbd && <kbd>{action.kbd}</kbd>}
            </button>
          ))}
        </div>
      )}
    </QxShell>
  );
}
