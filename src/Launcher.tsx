import { useMemo, useState } from "react";
import QxShell, { type BottomIslandContent } from "./components/QxShell";
import ResultsList from "./ResultsList";
import SearchBar from "./SearchBar";
import { Select } from "./components/ui";
import { useStore, type AppEntry, type SearchScope } from "./store";
import { useSettingsStore } from "./modules/settings/store";
import LauncherContext from "./launcher/LauncherContext";
import { createLauncherActions, getLauncherActionTitle } from "./launcher/launcherActions";
import { toLauncherQuickEntries } from "./launcher/quickEntries";
import { useLauncherHistory } from "./launcher/useLauncherHistory";
import type { QuickEntry } from "./launcher/types";
import { useT } from "./i18n";
import { resolveHomeIsland } from "./home-island";

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
    { value: "all", label: t("launcher.scope.all", "All") },
    { value: "apps", label: t("launcher.scope.apps", "Apps") },
    { value: "files", label: t("launcher.scope.files", "Files") },
    { value: "clipboard", label: t("launcher.scope.clipboard", "Clipboard") },
  ];
  const selectedItem = results[selectedIndex] ?? null;
  const launcherActions = useMemo(
    () => createLauncherActions({ item: selectedItem, onItemClick, onNavigate, t }),
    [selectedItem, onItemClick, onNavigate, t],
  );
  const { recentLaunches, recentSearches } = useLauncherHistory({
    shouldRefreshWhenIdle: results.length === 0 && !loadingPhase,
  });

  const quickEntries: QuickEntry[] = useMemo(() => {
    return toLauncherQuickEntries(settings.quick_entries, onNavigate, t);
  }, [settings.quick_entries, onNavigate, t]);

  const isSearchActivity = (isSearching || isSearchSettling) && !!query.trim();
  const idleHome = !isSearchActivity && !pluginIsland && results.length === 0;
  const homeIsland = useMemo(
    () => (idleHome
      ? resolveHomeIsland({
          home_island_mode: appearance.home_island_mode,
          home_island_cpu: appearance.home_island_cpu,
          home_island_gpu: appearance.home_island_gpu,
          home_island_memory: appearance.home_island_memory,
        }, t)
      : null),
    [
      idleHome,
      appearance.home_island_mode,
      appearance.home_island_cpu,
      appearance.home_island_gpu,
      appearance.home_island_memory,
      t,
    ],
  );

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
        detail: t("launcher.resultCount", "{n} results").replace("{n}", String(results.length)),
        progress: Math.min(100, Math.max(12, results.length * 12)),
      }
    : homeIsland?.shellContent ?? null;

  const customIsland = homeIsland?.customNode;

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
      title={t("launcher.title", "Qx Launcher")}
      className="launcher-shell"
      onKeyDown={onKeyDown}
      search={<SearchBar onKeyDown={handleLauncherKeyDown} embedded />}
      trailing={
        <div className="qx-launcher-trailing">
          <Select
            value={scope}
            options={scopeOptions}
            ariaLabel={t("launcher.scope", "Search scope")}
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
      actionTitle={selectedItem ? getLauncherActionTitle(selectedItem, t) : t("launcher.actions", "Actions")}
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
