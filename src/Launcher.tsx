import { useEffect, useMemo, useState } from "react";
import QxShell from "./components/QxShell";
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
import { homeIslandDataBus, useResolvedHomeIsland } from "./home-island";
import { islandHost, useHomeIslandContribution } from "./island";
import { mapBottomIslandContent } from "./island/compat/mapBottomIslandContent";

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
  /** @deprecated Plugin status now goes through islandHost bridge */
  pluginIsland?: unknown;
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
  // History loads once on mount. Do not re-fetch when results briefly empty
  // during search transitions — that doubled IPC during every summon.
  const { recentLaunches, recentSearches } = useLauncherHistory({
    shouldRefreshWhenIdle: false,
  });

  const quickEntries: QuickEntry[] = useMemo(() => {
    return toLauncherQuickEntries(settings.quick_entries, onNavigate, t);
  }, [settings.quick_entries, onNavigate, t]);

  const isSearchActivity = (isSearching || isSearchSettling) && !!query.trim();
  const idleHome = !isSearchActivity && results.length === 0 && loadingPhase !== "loading-apps";

  // Always resolve (hooks rules); only show when idle. Rotation + live metrics
  // run for the idle home island (and stay warm while mounted).
  const resolvedHome = useResolvedHomeIsland(
    {
      home_island_mode: appearance.home_island_mode,
      home_island_modes: appearance.home_island_modes,
      home_island_rotate_secs: appearance.home_island_rotate_secs,
      home_island_cpu: appearance.home_island_cpu,
      home_island_gpu: appearance.home_island_gpu,
      home_island_memory: appearance.home_island_memory,
    },
    t,
  );

  // When idle home island is shown, kick metrics so numbers aren't stale.
  useEffect(() => {
    if (!idleHome) return;
    homeIslandDataBus.kick();
  }, [idleHome, appearance.home_island_mode, appearance.home_island_modes]);

  // Keep session store in sync for float/host consumers, but paint via props
  // (QxShell island/customIsland) so a store glitch cannot blank the shell.
  useHomeIslandContribution(
    idleHome,
    idleHome ? resolvedHome : null,
    {
      home_island_mode: appearance.home_island_mode,
      home_island_modes: appearance.home_island_modes,
      home_island_rotate_secs: appearance.home_island_rotate_secs,
      home_island_cpu: appearance.home_island_cpu,
      home_island_gpu: appearance.home_island_gpu,
      home_island_memory: appearance.home_island_memory,
    },
  );

  // Primary docked island content (props path — reliable).
  const island =
    loadingPhase === "loading-apps"
      ? {
          label: t("launcher.loading", "Loading apps..."),
          detail: t("launcher.loading.detail", "Preparing application cache"),
          activity: "bounce" as const,
        }
      : isSearchActivity
        ? {
            label: t("launcher.searching", "Searching"),
            detail: query.trim(),
            activity: (isSearchSettling ? "bounce-exit" : "bounce") as
              | "bounce"
              | "bounce-exit",
          }
        : results.length > 0
          ? {
              label: t("launcher.ready", "Search ready"),
              detail: t("launcher.resultCount", "{n} results").replace(
                "{n}",
                String(results.length),
              ),
              progress: Math.min(100, Math.max(12, results.length * 12)),
            }
          : idleHome
            ? (resolvedHome.shellContent ?? null)
            : null;

  const customIsland = idleHome ? resolvedHome.customNode : undefined;

  // Mirror shell statuses into the session store (optional consumers / float).
  useEffect(() => {
    if (loadingPhase === "loading-apps") {
      islandHost.show({
        id: "launcher.loading",
        priority: "task",
        source: "shell",
        sticky: false,
        content: mapBottomIslandContent({
          label: t("launcher.loading", "Loading apps..."),
          detail: t("launcher.loading.detail", "Preparing application cache"),
          activity: "bounce",
        }),
      });
      islandHost.dismiss("launcher.search");
      islandHost.dismiss("launcher.results");
      return () => {
        islandHost.dismiss("launcher.loading");
      };
    }

    if (isSearchActivity) {
      islandHost.show({
        id: "launcher.search",
        priority: "task",
        source: "shell",
        sticky: false,
        content: mapBottomIslandContent({
          label: t("launcher.searching", "Searching"),
          detail: query.trim(),
          activity: isSearchSettling ? "bounce-exit" : "bounce",
        }),
      });
      islandHost.dismiss("launcher.loading");
      islandHost.dismiss("launcher.results");
      return () => {
        islandHost.dismiss("launcher.search");
      };
    }

    if (results.length > 0) {
      islandHost.show({
        id: "launcher.results",
        priority: "location",
        source: "shell",
        sticky: false,
        content: mapBottomIslandContent({
          label: t("launcher.ready", "Search ready"),
          detail: t("launcher.resultCount", "{n} results").replace(
            "{n}",
            String(results.length),
          ),
          progress: Math.min(100, Math.max(12, results.length * 12)),
        }),
      });
      islandHost.dismiss("launcher.loading");
      islandHost.dismiss("launcher.search");
      return () => {
        islandHost.dismiss("launcher.results");
      };
    }

    islandHost.dismiss("launcher.loading");
    islandHost.dismiss("launcher.search");
    islandHost.dismiss("launcher.results");
  }, [
    loadingPhase,
    isSearchActivity,
    isSearchSettling,
    query,
    results.length,
    t,
  ]);

  const handleLauncherKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === ",") {
      event.preventDefault();
      event.stopPropagation();
      onNavigate("settings");
      return;
    }
    onKeyDown(event);
  };

  const hasQuery = query.length > 0;

  return (
    <QxShell
      title={t("launcher.title", "Qx Launcher")}
      className="launcher-shell"
      islandKey="launcher"
      // Session store is updated separately; paint docked island via props so the
      // main shell never depends solely on the island session layer.
      islandManagedExternally
      island={island}
      customIsland={customIsland}
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
      // Visible Esc: clear search when non-empty; empty query leaves hide to host keyboard Esc.
      escapeAction={
        hasQuery
          ? {
              label: "Esc",
              kbd: "Esc",
              onClick: () => {
                setQuery("");
                useStore.getState().setSelectedIndex(0);
              },
            }
          : undefined
      }
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
        kbd: "CmdOrCtrl+K",
        disabled: results.length === 0,
      }}
      actionTitle={
        selectedItem
          ? getLauncherActionTitle(selectedItem, t)
          : t("launcher.actions", "Actions")
      }
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
