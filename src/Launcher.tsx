import { useEffect, useMemo, useState } from "react";
import QxShell, { type BottomIslandContent } from "./components/QxShell";
import HomeDateIsland from "./components/HomeDateIsland";
import HomeSystemIsland from "./components/HomeSystemIsland";
import ResultsList from "./ResultsList";
import SearchBar from "./SearchBar";
import { Select } from "./components/ui";
import { useStore, type AppEntry, type SearchScope } from "./store";
import { useSettingsStore } from "./modules/settings/store";
import LauncherActionPopover from "./launcher/LauncherActionPopover";
import LauncherContext from "./launcher/LauncherContext";
import { createLauncherActions } from "./launcher/launcherActions";
import { useLauncherHistory } from "./launcher/useLauncherHistory";
import type { QuickEntry } from "./launcher/types";
import { useT } from "./i18n";

function clampActionIndex(index: number, actionCount: number): number {
  return Math.max(0, Math.min(index, Math.max(0, actionCount - 1)));
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
  const query = useStore((state) => state.query);
  const setQuery = useStore((state) => state.setQuery);
  const scopeOptions: { value: SearchScope; label: string }[] = [
    { value: "all", label: "All" },
    { value: "apps", label: "Apps" },
    { value: "files", label: "Files" },
    { value: "clipboard", label: "Clipboard" },
  ];
  const selectedItem = results[selectedIndex] ?? null;
  const launcherActions = useMemo(
    () => createLauncherActions({ item: selectedItem, onItemClick, onNavigate }),
    [selectedItem, onItemClick, onNavigate],
  );
  const { recentLaunches, recentSearches } = useLauncherHistory({
    shouldRefreshWhenIdle: results.length === 0 && !loadingPhase,
  });

  useEffect(() => {
    setActionPanelOpen(false);
    setActionIndex(0);
  }, [selectedItem?.path]);

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
        setActionIndex((index) => clampActionIndex(index + 1, launcherActions.length));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActionIndex((index) => clampActionIndex(index - 1, launcherActions.length));
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
        <LauncherContext
          quickEntries={quickEntries}
          recentLaunches={recentLaunches}
          recentSearches={recentSearches}
          query={query}
          onSearchSelect={setQuery}
        />
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
        <LauncherActionPopover
          actions={launcherActions}
          activeIndex={actionIndex}
          selectedItem={selectedItem}
          onHover={setActionIndex}
          onRun={(action) => {
            setActionPanelOpen(false);
            void action.run();
          }}
        />
      )}
    </QxShell>
  );
}
