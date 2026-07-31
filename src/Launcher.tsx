import { useCallback, useEffect, useMemo, useState } from "react";
import QxShell, {
  type QxShellAction,
  type QxShellActionMenuRequest,
} from "./components/QxShell";
import ResultsList from "./ResultsList";
import SearchBar, { requestLauncherSearchFocus } from "./SearchBar";
import { useStore, type AppEntry, type SearchScope } from "./store";
import { useSettingsStore } from "./modules/settings/store";
import LauncherEntryManageDialogs, {
  type LauncherManageDialogRequest,
} from "./launcher/LauncherEntryManageDialogs";
import { createLauncherActions, getLauncherActionTitle } from "./launcher/launcherActions";
import { quickEntryToAppEntry, toLauncherAllModules, toLauncherQuickEntries } from "./launcher/quickEntries";
import { useLauncherHistory } from "./launcher/useLauncherHistory";
import type { QuickEntry } from "./launcher/types";
import type { SearchTrackId } from "./launcher/searchProgress";
import { useLocale, useT } from "./i18n";
import { homeIslandDataBus, useResolvedHomeIsland } from "./home-island";
import { islandHost, useHomeIslandContribution } from "./island";
import { mapBottomIslandContent } from "./island/compat/mapBottomIslandContent";
import { usePluginRegistry } from "./plugin/registry";
import type { LauncherResultRow } from "./launcher/resultRows";
import HomeDashboard from "./home-dashboard/HomeDashboard";
import LauncherContext from "./launcher/LauncherContext";

interface LauncherProps {
  results: AppEntry[];
  resultRows: LauncherResultRow[];
  selectedItem: AppEntry | null;
  onToggleCategory: (categoryId: string) => void;
  onSelectResultRow: (index: number) => void;
  onItemClick: (item: AppEntry) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onEscape: () => void;
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
  resultRows,
  selectedItem,
  onToggleCategory,
  onSelectResultRow,
  onItemClick,
  onKeyDown,
  onEscape,
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
  const [manageDialog, setManageDialog] = useState<LauncherManageDialogRequest | null>(null);
  const [actionMenuRequest, setActionMenuRequest] =
    useState<QxShellActionMenuRequest | null>(null);
  const [contextMenuItem, setContextMenuItem] = useState<AppEntry | null>(null);
  const query = useStore((state) => state.query);
  const hasQuery = query.trim().length > 0;
  const setQuery = useStore((state) => state.setQuery);
  const selectedIndex = useStore((state) => state.selectedIndex);
  const selectedRow = resultRows[selectedIndex];
  const selectedCategory = hasQuery && selectedRow?.kind === "category" ? selectedRow : null;
  const scopeOptions: { value: SearchScope; label: string }[] = [
    { value: "all", label: t("launcher.scope.all", "All") },
    { value: "apps", label: t("launcher.scope.apps", "Apps") },
    { value: "files", label: t("launcher.scope.files", "Files") },
    { value: "clipboard", label: t("launcher.scope.clipboard", "Clipboard") },
  ];
  const actionsForItem = useCallback(
    (item: AppEntry | null) =>
      createLauncherActions({
        item,
        onItemClick,
        onNavigate,
        t,
        settings,
        onEditAliases: (item) => setManageDialog({ kind: "aliases", item }),
        onRecordShortcut: (item) => setManageDialog({ kind: "shortcut", item }),
      }),
    [onItemClick, onNavigate, t, settings],
  );
  const activeSelectedItem = contextMenuItem ?? (hasQuery ? selectedItem : null);
  const launcherActions = useMemo(
    () => actionsForItem(activeSelectedItem),
    [actionsForItem, activeSelectedItem],
  );
  const shellActions = useMemo<QxShellAction[]>(() => {
    if (selectedCategory) {
      return [{
        id: "toggle-category",
        label: selectedCategory.collapsed
          ? t("launcher.expandCategory", "Expand")
          : t("launcher.collapseCategory", "Collapse"),
        kbd: "Enter",
        onClick: () => onToggleCategory(selectedCategory.categoryId),
      }];
    }
    return launcherActions.map((action) => ({
      id: action.id,
      label: action.label,
      kbd: action.kbd,
      menuKey: action.menuKey,
      disabled: action.disabled,
      tone: action.danger ? "danger" : "normal",
      onClick: () => void action.run(),
    }));
  }, [launcherActions, onToggleCategory, selectedCategory, t]);
  const primaryActionId = selectedCategory
    ? "toggle-category"
    : activeSelectedItem
      ? launcherActions[0]?.id
      : undefined;
  const requestItemContextMenu = useCallback((item: AppEntry, x: number, y: number) => {
    setContextMenuItem(item);
    window.requestAnimationFrame(() => {
      setActionMenuRequest((request) => ({
        id: (request?.id ?? 0) + 1,
        x,
        y,
      }));
    });
  }, []);

  useEffect(() => {
    if (hasQuery) setContextMenuItem(null);
  }, [hasQuery]);
  // History loads once on mount. Do not re-fetch when results briefly empty
  // during search transitions — that doubled IPC during every summon.
  const { recentSearches } = useLauncherHistory({
    shouldRefreshWhenIdle: false,
  });

  const plugins = usePluginRegistry((state) => state.plugins);
  const locale = useLocale();
  const openLauncherTarget = useCallback((target: string) => {
    if (target === "file-search") {
      setScope("files");
      searchScopeRef.current = "files";
      setQuery("");
      useStore.getState().setSelectedIndex(0);
      onScopeChange();
      window.requestAnimationFrame(requestLauncherSearchFocus);
      return;
    }
    // plugin:<id> opens the plugin panel tab (same as launcher openItem).
    onNavigate(target);
  }, [onNavigate, onScopeChange, searchScopeRef, setQuery]);
  const quickEntries: QuickEntry[] = useMemo(() => {
    return toLauncherQuickEntries(
      settings.quick_entries,
      openLauncherTarget,
      t,
      plugins,
      locale,
    );
  }, [settings.quick_entries, openLauncherTarget, plugins, t, locale]);
  const allModules: QuickEntry[] = useMemo(
    () => toLauncherAllModules(openLauncherTarget, t, plugins, locale),
    [openLauncherTarget, plugins, t, locale],
  );
  const launcherDirectory = useMemo(() => {
    const entries = [...results, ...quickEntries, ...allModules]
      .map((entry) => "path" in entry ? entry : quickEntryToAppEntry(entry, plugins))
      .filter((entry): entry is AppEntry => Boolean(entry));
    const byPath = new Map(entries.map((entry) => [entry.path, entry]));
    return [...byPath.values()];
  }, [allModules, plugins, quickEntries, results]);

  const isSearchActivity = (isSearching || isSearchSettling) && !!query.trim();
  const idleHome = !isSearchActivity && !hasQuery;

  // Always resolve (hooks rules); only show when idle. Rotation + live metrics
  // run for the idle home island (and stay warm while mounted).
  const resolvedHome = useResolvedHomeIsland(
    {
      home_island_mode: appearance.home_island_mode,
      home_island_modes: appearance.home_island_modes,
      home_island_rotate_secs: appearance.home_island_rotate_secs,
      home_island_cpu: appearance.home_island_cpu,
      home_island_memory: appearance.home_island_memory,
    },
    t,
  );

  // When idle home island is shown, kick metrics so numbers aren't stale.
  useEffect(() => {
    if (!idleHome) return;
    homeIslandDataBus.kick();
  }, [idleHome, appearance.home_island_mode, appearance.home_island_modes]);

  // Launcher is the single writer for the global home session.
  useHomeIslandContribution(
    idleHome,
    idleHome ? resolvedHome : null,
    {
      home_island_mode: appearance.home_island_mode,
      home_island_modes: appearance.home_island_modes,
      home_island_rotate_secs: appearance.home_island_rotate_secs,
      home_island_cpu: appearance.home_island_cpu,
      home_island_memory: appearance.home_island_memory,
    },
  );

  const searchHits = useMemo(() => {
    const hits: Partial<Record<SearchTrackId, number>> = {
      apps: 0,
      files: 0,
      clipboard: 0,
    };
    for (const item of results) {
      const kind = item.kind ?? "app";
      if (kind === "app" || kind === "command" || kind === "calculation") {
        hits.apps = (hits.apps ?? 0) + 1;
      } else if (kind === "file" || kind === "folder") {
        hits.files = (hits.files ?? 0) + 1;
      } else if (kind === "clipboard") {
        hits.clipboard = (hits.clipboard ?? 0) + 1;
      }
    }
    return hits;
  }, [results]);

  // Search/result/loading statuses are ordinary sessions. Docked and floating
  // surfaces consume the same winner and action registry.
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
          activity: "wave",
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
        content: {
          primary: t("launcher.searching", "Searching"),
          secondary: query.trim(),
          componentId: "launcher.search-progress",
          componentProps: {
            query: query.trim(),
            isSearching,
            isSearchSettling,
            hits: searchHits,
          },
          tone: "neutral",
        },
      });
      islandHost.dismiss("launcher.loading");
      islandHost.dismiss("launcher.results");
      return () => {
        islandHost.dismiss("launcher.search");
      };
    }

    if (hasQuery && results.length > 0) {
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
          progressStyle: "compact-line",
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
    isSearching,
    isSearchSettling,
    query,
    results.length,
    hasQuery,
    searchHits,
    t,
  ]);

  const handleLauncherKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === ",") {
      event.preventDefault();
      event.stopPropagation();
      onNavigate("settings");
      return;
    }
    if (!hasQuery && ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Enter"].includes(event.key)) {
      return;
    }
    onKeyDown(event);
  };

  return (
    <QxShell
      title={t("launcher.title", "Qx Launcher")}
      className={`launcher-shell${hasQuery ? " has-query" : ""}`}
      islandKey="launcher"
      islandManagedExternally
      onKeyDown={handleLauncherKeyDown}
      search={<SearchBar onKeyDown={handleLauncherKeyDown} embedded />}
      topbarFilters={[{
        id: "launcher-scope",
        label: t("launcher.scope", "Search scope"),
        value: scope,
        options: scopeOptions,
        onChange: (next) => {
          const nextScope = next as SearchScope;
          setScope(nextScope);
          searchScopeRef.current = nextScope;
          onScopeChange();
        },
      }]}
      context={(
        <LauncherContext
          quickEntries={quickEntries}
          allModules={allModules}
          selectedItem={activeSelectedItem}
        />
      )}
      // Launcher: Esc = Back (clear query) or Hide (empty → hide panel). No house button.
      escapeAction={
        hasQuery
          ? {
              id: "escape",
              label: t("common.back", "Back"),
              kbd: "Esc",
              onClick: () => {
                setQuery("");
                useStore.getState().setSelectedIndex(0);
              },
            }
          : {
              id: "escape",
              label: t("shell.hide", "Hide"),
              kbd: "Esc",
              onClick: onEscape,
            }
      }
      onGoHome={null}
      primaryActionId={primaryActionId}
      actionMenuRequest={actionMenuRequest}
      actionTitle={
        activeSelectedItem
          ? getLauncherActionTitle(activeSelectedItem, t)
          : t("launcher.actions", "Actions")
      }
      actions={shellActions}
    >
      {hasQuery ? (
        <ResultsList
          items={results}
          rows={resultRows}
          onItemClick={(item) => {
            const primary = actionsForItem(item)[0];
            if (primary && !primary.disabled) void primary.run();
          }}
          onToggleCategory={onToggleCategory}
          onSelectRow={onSelectResultRow}
          onOpenActionsAt={(x, y) => {
            // Selection must commit before QxShell snapshots the selected row's
            // actions; otherwise a fast right-click can display the prior item.
            window.requestAnimationFrame(() => {
              setActionMenuRequest((request) => ({
                id: (request?.id ?? 0) + 1,
                x,
                y,
              }));
            });
          }}
          loadingPhase={loadingPhase}
          showPinnedStrip
        />
      ) : (
        <HomeDashboard
          items={launcherDirectory}
          recentSearches={recentSearches}
          onItemClick={(item) => {
            const primary = actionsForItem(item)[0];
            if (primary && !primary.disabled) void primary.run();
          }}
          onSearchSelect={setQuery}
          onNavigate={onNavigate}
          onItemContextMenu={requestItemContextMenu}
        />
      )}
      <LauncherEntryManageDialogs
        request={manageDialog}
        onClose={() => setManageDialog(null)}
      />
    </QxShell>
  );
}
