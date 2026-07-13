import { useMemo, useState } from "react";
import QxShell, { type BottomIslandContent } from "./components/QxShell";
import HomeDateIsland from "./components/HomeDateIsland";
import HomeSystemIsland from "./components/HomeSystemIsland";
import ResultsList from "./ResultsList";
import SearchBar from "./SearchBar";
import { Select } from "./components/ui";
import { useStore, type AppEntry, type SearchScope } from "./store";
import { useSettingsStore } from "./modules/settings/store";
import LauncherContext from "./launcher/LauncherContext";
import { createLauncherActions, getLauncherActionTitle } from "./launcher/launcherActions";
import { toLauncherQuickEntries } from "./launcher/quickEntries";
import QuickEntryIcons from "./launcher/QuickEntryIcons";
import { useLauncherHistory } from "./launcher/useLauncherHistory";
import type { QuickEntry } from "./launcher/types";
import { useT } from "./i18n";

interface LauncherProps {
  results: AppEntry[];
  selectedIndex: number;
  onItemClick: (item: AppEntry) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onNavigate: (tab: string) => void;
  searchScopeRef: React.MutableRefObject<SearchScope>;
  onScopeChange: () => void;
  loadingPhase?: string;
  isSearching?: boolean;
  isSearchSettling?: boolean;
  pluginIsland?: BottomIslandContent | null;
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
  isSearching = false,
  isSearchSettling = false,
  pluginIsland = null,
}: LauncherProps) {
  const { settings } = useSettingsStore();
  const t = useT();
  const appearance = settings.appearance;
  const [scope, setScope] = useState<SearchScope>(searchScopeRef.current);
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

  const quickEntries: QuickEntry[] = useMemo(() => {
    return toLauncherQuickEntries(settings.quick_entries, onNavigate);
  }, [settings.quick_entries, onNavigate]);

  const isSearchActivity = (isSearching || isSearchSettling) && !!query.trim();
  const island: BottomIslandContent | null = loadingPhase === "loading-apps"
    ? {
        label: t("launcher.loading", "Loading apps..."),
        detail: t("launcher.loading.detail", "Preparing application cache"),
        activity: "bounce",
      }
    : isSearchActivity
    ? {
        label: t("launcher.searching", "Searching"),
        detail: query.trim(),
        activity: isSearchSettling ? "bounce-exit" : "bounce",
      }
    : pluginIsland
    ? pluginIsland
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

  const customIsland = !isSearchActivity && !pluginIsland && !results.length && appearance.home_island_mode === "date" ? (
    <HomeDateIsland />
  ) : !isSearchActivity && !pluginIsland && !results.length && appearance.home_island_mode === "system" ? (
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
      onNavigate("settings");
      return;
    }
    onKeyDown(event);
  };

  return (
    <QxShell
      title="Launcher"
      className="launcher-shell"
      onKeyDown={onKeyDown}
      search={<SearchBar onKeyDown={handleLauncherKeyDown} embedded />}
      trailing={
        <div className="qx-launcher-trailing">
          <QuickEntryIcons entries={quickEntries} />
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
        </div>
      }
      context={
        <LauncherContext
          quickEntries={quickEntries}
          recentLaunches={recentLaunches}
          recentSearches={recentSearches}
          query={query}
          selectedItem={selectedItem}
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
      }}
      actionTitle={selectedItem ? getLauncherActionTitle(selectedItem) : t("launcher.actions", "Actions")}
      actions={launcherActions.map((action) => ({
        label: action.label,
        kbd: action.kbd,
        disabled: action.disabled,
        tone: action.danger ? "danger" : "normal",
        onClick: () => void action.run(),
      }))}
    >
      <ResultsList items={results} onItemClick={onItemClick} loadingPhase={loadingPhase} />
    </QxShell>
  );
}
