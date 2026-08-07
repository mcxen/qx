import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useShallow } from "zustand/react/shallow";
import QxShell, {
  type QxShellAction,
  type QxShellTopbarFilter,
} from "../components/QxShell";
import { QxActionSections } from "../components/QxActionPanel";
import PluginBackgroundBadge, {
  usePluginBackgroundJob,
  usePluginBackgroundSummary,
} from "../components/PluginBackgroundBadge";
import PluginBackgroundPanel from "../components/PluginBackgroundPanel";
import { useQxModuleShell } from "../hooks/useQxModuleShell";
import { usePluginRegistry } from "./registry";
import {
  runPluginItemAction,
  subscribePluginItemActions,
  subscribePluginChrome,
  subscribePluginWorkbench,
  postPluginChromeQuery,
  postPluginChromeTab,
  postPluginChromeKey,
  postPluginWorkbenchEvent,
  type PluginChromePayload,
  type PluginItemActionDescriptor,
} from "./runtime";
import QxModuleSearch from "../components/QxModuleSearch";
import PluginWorkbenchView, { PLUGIN_WORKBENCH_REGIONS } from "./PluginWorkbenchView";
import type { PluginWorkbenchAction, PluginWorkbenchState } from "./workbenchTypes";
import { useStore } from "../store";
import { useSettingsStore } from "../modules/settings/store";
import {
  isEditableTarget,
  isImeCompositionEvent,
  shouldIgnoreBareShortcut,
} from "../utils/keyboard";
import { formatRelativeTime, formatTimestamp } from "./backgroundActivity";
import { useLocale, useT } from "../i18n";
import { localizePluginDescription, localizePluginName } from "./pluginLabels";
import { resolveQxGridIndex, shouldHandleQxGridKey } from "../hooks/qxGridNavigation";
import { focusQxRegion, qxMasterDetailNavigation } from "../hooks/useQxMasterDetail";
import {
  hasPluginIslandSession,
  syncPluginWorkbenchIsland,
} from "./pluginIsland";
import { islandHost } from "../island";

export function PluginHost() {
  const loaded = usePluginRegistry((state) => state.loaded);

  return (
    <div
      data-qx-plugin-host={loaded ? "loaded" : "loading"}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        visibility: "hidden",
        zIndex: -1,
      }}
    />
  );
}

function renderPluginStatus(
  container: HTMLElement,
  message: string,
  tone: "neutral" | "danger" = "neutral",
) {
  container.innerHTML = "";
  const status = document.createElement("div");
  status.style.padding = "20px";
  status.style.color = tone === "danger" ? "var(--qx-danger)" : "var(--qx-text-secondary)";
  status.textContent = message;
  container.appendChild(status);
}

export function PluginPanelViewport() {
  const t = useT();
  const locale = useLocale();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const isPluginTab = tab.startsWith("plugin:");
  const pluginId = isPluginTab ? tab.slice("plugin:".length) : "";
  const panel = usePluginRegistry((state) => state.panels[pluginId]);
  const pluginCommands = usePluginRegistry(useShallow(
    (state) => isPluginTab ? state.commands.filter((command) => command.pluginId === pluginId) : [],
  ));
  const plugin = usePluginRegistry(
    (state) => isPluginTab ? state.plugins.find((item) => item.id === pluginId) : undefined,
  );
  const background = usePluginBackgroundSummary(isPluginTab ? pluginId : null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [renderState, setRenderState] = useState<{
    kind: "idle" | "loading" | "error";
    detail?: string;
  }>({ kind: "idle" });
  /** Selected Raycast item ActionPanel → QxShell actions. */
  const [itemActions, setItemActions] = useState<PluginItemActionDescriptor[]>([]);
  const [selectionTitle, setSelectionTitle] = useState<string>("");
  const [pluginChrome, setPluginChrome] = useState<PluginChromePayload | null>(null);
  const [workbench, setWorkbench] = useState<PluginWorkbenchState | null>(null);
  const [workbenchDetailOpen, setWorkbenchDetailOpen] = useState(false);
  const [workbenchIslandManaged, setWorkbenchIslandManaged] = useState(false);
  const pluginIslandSessionActive = useSyncExternalStore(
    islandHost.subscribe,
    () => Boolean(pluginId && hasPluginIslandSession(pluginId)),
    () => false,
  );
  const hasWorkbench = Boolean(workbench);
  const backgroundPollJob = usePluginBackgroundJob(
    isPluginTab ? pluginId : null,
    workbench?.backgroundPoll?.command,
  );
  const observedPollRef = useRef<{ key: string; lastRunAt: number | null }>({
    key: "",
    lastRunAt: null,
  });
  const raycastActionPanel = useSettingsStore(
    (state) => state.settings.plugin_display.raycast_action_panel,
  );
  const goBack = useCallback(() => setTab("launcher"), [setTab]);
  const runPluginIslandCommand = useCallback(async (targetPluginId: string, commandName: string) => {
    const command = usePluginRegistry.getState().commands.find(
      (candidate) => candidate.pluginId === targetPluginId && candidate.name === commandName,
    );
    if (!command) throw new Error(`Plugin island command is not registered: ${commandName}`);
    await usePluginRegistry.getState().runCommand(command);
  }, []);
  const selectWorkbenchItem = useCallback((id: string) => {
    // Keep pointer and keyboard selection responsive even when the plugin iframe
    // is busy. The plugin still receives the event and remains the source of
    // truth for subsequent workbench publications.
    setWorkbench((current) => {
      if (!current || String(current.selectedId ?? "") === id) return current;
      return { ...current, selectedId: id };
    });
    postPluginWorkbenchEvent(pluginId, { kind: "select", id });
  }, [pluginId]);
  const updateWorkbenchQuery = useCallback((value: string) => {
    setWorkbenchDetailOpen(false);
    setWorkbench((current) => current ? { ...current, query: value } : current);
    postPluginWorkbenchEvent(pluginId, { kind: "query", value });
  }, [pluginId]);
  const selectWorkbenchTab = useCallback((id: string) => {
    setWorkbenchDetailOpen(false);
    setWorkbench((current) => current
      ? {
          ...current,
          tabs: current.tabs?.map((tabItem) => ({
            ...tabItem,
            active: tabItem.id === id,
          })),
        }
      : current);
    postPluginWorkbenchEvent(pluginId, { kind: "tab", id });
  }, [pluginId]);
  const updateWorkbenchFilter = useCallback((id: string, value: string) => {
    setWorkbenchDetailOpen(false);
    setWorkbench((current) => current
      ? {
          ...current,
          filters: current.filters?.map((filter) => (
            filter.id === id ? { ...filter, value } : filter
          )),
        }
      : current);
    postPluginWorkbenchEvent(pluginId, { kind: "filter", id, value });
  }, [pluginId]);

  const handlePluginKeys = useCallback((event: React.KeyboardEvent) => {
    // Do not bind bare R for panel remount — plugins may use Cmd+R for item
    // actions. Host reload is ⌘⇧R /
    // Actions → Reload Panel only.
    const ignoreBare = shouldIgnoreBareShortcut(event.nativeEvent);
    if (
      !ignoreBare
      && (event.key === "r" || event.key === "R")
      && (event.metaKey || event.ctrlKey)
      && event.shiftKey
      && !event.altKey
    ) {
      event.preventDefault();
      setRefreshKey((k) => k + 1);
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    const fromSearch = Boolean(target?.closest(".qx-shell-search-slot"));
    const fromDetail = Boolean(target?.closest(
      `[data-qx-region="${PLUGIN_WORKBENCH_REGIONS.detail}"]`,
    ));
    if (
      workbench?.layout?.kind !== "gallery"
      || (workbenchDetailOpen && fromDetail)
      || isImeCompositionEvent(event.nativeEvent)
      || !shouldHandleQxGridKey({
        key: event.key,
        query: workbench.query || "",
        editable: isEditableTarget(event.target),
        fromSearch,
        modified: event.metaKey || event.ctrlKey || event.altKey || event.shiftKey,
      })
    ) return;

    const items = workbench.items || [];
    const selectedIndex = items.length
      ? Math.max(0, items.findIndex((item) =>
          item.id === String(workbench.selectedId ?? "")
        ))
      : -1;
    const gallery = containerRef.current
      ?.closest<HTMLElement>(".qx-shell")
      ?.querySelector<HTMLElement>(".qx-host-workbench-gallery");
    const renderedColumns = gallery
      ? window.getComputedStyle(gallery).gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length
      : 0;
    const nextIndex = resolveQxGridIndex({
      key: event.key,
      index: selectedIndex,
      count: items.length,
      columns: renderedColumns || workbench.layout.columns || 4,
    });
    if (nextIndex === null) return;
    event.preventDefault();
    event.stopPropagation();
    const item = items[nextIndex];
    if (item) {
      selectWorkbenchItem(item.id);
    }
  }, [selectWorkbenchItem, workbench, workbenchDetailOpen]);

  useEffect(() => {
    if (!isPluginTab || !pluginId) {
      setItemActions([]);
      setSelectionTitle("");
      setPluginChrome(null);
      setWorkbench(null);
      setWorkbenchDetailOpen(false);
      setWorkbenchIslandManaged(false);
      return;
    }
    const unsubscribeActions = subscribePluginItemActions((payload) => {
      if (payload.pluginId !== pluginId) return;
      setItemActions(payload.actions);
      setSelectionTitle(payload.selectionTitle || "");
    });
    const unsubscribeChrome = subscribePluginChrome((payload) => {
      if (payload.pluginId !== pluginId) return;
      setPluginChrome(payload);
    });
    const unsubscribeWorkbench = subscribePluginWorkbench((payload) => {
      if (payload.pluginId !== pluginId) return;
      setWorkbench((current) => {
        const nextRevision = payload.state.revision;
        const currentRevision = current?.revision;
        if (
          nextRevision != null
          && currentRevision != null
          && nextRevision < currentRevision
        ) {
          return current;
        }
        return payload.state;
      });
    });
    return () => {
      unsubscribeActions();
      unsubscribeChrome();
      unsubscribeWorkbench();
    };
  }, [isPluginTab, pluginId]);

  useLayoutEffect(() => {
    const hasIslandField = Boolean(
      workbench && Object.prototype.hasOwnProperty.call(workbench, "island"),
    );
    if (!isPluginTab || !pluginId || !plugin) {
      setWorkbenchIslandManaged(false);
      return;
    }
    if (!hasIslandField) {
      setWorkbenchIslandManaged(false);
      return;
    }
    try {
      setWorkbenchIslandManaged(
        syncPluginWorkbenchIsland(plugin, workbench?.island, runPluginIslandCommand),
      );
    } catch {
      setWorkbenchIslandManaged(false);
    }
  }, [isPluginTab, plugin, pluginId, runPluginIslandCommand, workbench]);

  useEffect(() => {
    if (!hasWorkbench) return;
    const frame = window.requestAnimationFrame(() => {
      const shell = containerRef.current?.closest<HTMLElement>(".qx-shell");
      if (!shell) return;
      const active = document.activeElement;
      const focusEscapedToRuntime = active instanceof HTMLIFrameElement
        || active === document.body
        || !active
        || !shell.contains(active);
      if (!focusEscapedToRuntime) return;
      const target = shell.querySelector<HTMLElement>(
        ".qx-shell-search-slot input, [data-qx-region='plugin-workbench-list']",
      );
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasWorkbench, pluginId]);

  useEffect(() => {
    const commandName = workbench?.backgroundPoll?.command || "";
    const command = pluginCommands.find((candidate) =>
      candidate.name === commandName
      && candidate.mode === "no-view"
      && Boolean(candidate.interval)
    );
    const key = command ? `${pluginId}\0${command.name}` : "";
    const lastRunAt = command && backgroundPollJob?.commandName === command.name
      ? backgroundPollJob.lastRunAt
      : null;
    if (observedPollRef.current.key !== key) {
      observedPollRef.current = { key, lastRunAt };
      return;
    }
    if (!command || !lastRunAt || observedPollRef.current.lastRunAt === lastRunAt) return;
    observedPollRef.current.lastRunAt = lastRunAt;
    postPluginWorkbenchEvent(pluginId, {
      kind: "backgroundPoll",
      command: command.name,
      at: lastRunAt,
      ok: backgroundPollJob?.lastOutcome === "success",
      error: backgroundPollJob?.lastError || undefined,
    });
  }, [backgroundPollJob, pluginCommands, pluginId, workbench?.backgroundPoll?.command]);

  useEffect(() => {
    if (!containerRef.current || !isPluginTab) return;
    const container = containerRef.current;
    const activePanel = panel;
    if (!activePanel) {
      // Host only registers a panel when manifest.panel exists (see loadPlugin).
      // Island-only / command-only plugins must still declare a panel if they open as a tab.
      setRenderState({
        kind: "error",
        detail:
          "Panel not registered — add manifest.panel + export default.panel (see plugin AGENTS.md)",
      });
      return;
    }

    let disposed = false;
    let timeout: number | null = null;
    setItemActions([]);
    setSelectionTitle("");
    setWorkbench(null);
    setWorkbenchDetailOpen(false);
    setRenderState({ kind: "loading", detail: "Rendering panel" });
    renderPluginStatus(container, `Loading ${pluginId}...`);

    const renderTimer = window.setTimeout(() => {
      if (disposed) return;
      // Must exceed host panel renderPanel budget (15s) + iframe load headroom.
      timeout = window.setTimeout(() => {
        if (!disposed) {
          renderPluginStatus(container, `Plugin ${pluginId} render timed out.`, "danger");
          setRenderState({ kind: "error", detail: "Render timed out" });
        }
      }, 20_000);
      void Promise.resolve(activePanel.render(container, undefined as never))
        .then(() => {
          if (timeout !== null) window.clearTimeout(timeout);
          timeout = null;
          if (!disposed) setRenderState({ kind: "idle" });
        })
        .catch((err: unknown) => {
          if (timeout !== null) window.clearTimeout(timeout);
          timeout = null;
          if (!disposed) {
            const detail = String(err).replace(/^Error:\s*/i, "").slice(0, 120);
            renderPluginStatus(container, `Plugin ${pluginId} render failed: ${detail}`, "danger");
            setRenderState({ kind: "error", detail });
          }
        });
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(renderTimer);
      if (timeout !== null) window.clearTimeout(timeout);
      void Promise.resolve(activePanel.destroy?.(container)).catch(() => {});
      container.innerHTML = "";
      setRenderState({ kind: "idle" });
      setItemActions([]);
      setSelectionTitle("");
      setWorkbench(null);
      setWorkbenchDetailOpen(false);
    };
  }, [isPluginTab, panel, pluginId, refreshKey, raycastActionPanel]);

  const pluginDisplayName = plugin
    ? localizePluginName(plugin, t, locale)
    : pluginId;
  const pluginDisplayDescription = plugin
    ? localizePluginDescription(plugin, t, locale)
    : "";
  const shellTitle = panel?.title && panel.title !== plugin?.name
    ? panel.title
    : pluginDisplayName;

  const runItem = useCallback(
    (actionId: string) => {
      runPluginItemAction(pluginId, actionId);
    },
    [pluginId],
  );

  const selectedWorkbenchItem = useMemo(() => {
    if (!workbench?.items?.length) return undefined;
    return workbench.items.find((item) => item.id === String(workbench.selectedId ?? ""))
      || workbench.items[0];
  }, [workbench]);

  const selectedWorkbenchDetail = selectedWorkbenchItem?.detail || workbench?.detail;

  useEffect(() => {
    if (workbenchDetailOpen && !selectedWorkbenchDetail) {
      setWorkbenchDetailOpen(false);
    }
  }, [selectedWorkbenchDetail, workbenchDetailOpen]);

  const closeWorkbenchDetail = useCallback(() => {
    setWorkbenchDetailOpen(false);
    window.requestAnimationFrame(() => {
      focusQxRegion(
        PLUGIN_WORKBENCH_REGIONS.list,
        containerRef.current?.closest<HTMLElement>(".qx-shell"),
      );
    });
  }, []);

  const activateWorkbenchItem = useCallback((id: string) => {
    selectWorkbenchItem(id);
    const item = workbench?.items?.find((candidate) => candidate.id === id);
    if (!item?.detail && !workbench?.detail) return;
    setWorkbenchDetailOpen(true);
    window.requestAnimationFrame(() => {
      focusQxRegion(
        PLUGIN_WORKBENCH_REGIONS.detail,
        containerRef.current?.closest<HTMLElement>(".qx-shell"),
      );
    });
  }, [selectWorkbenchItem, workbench]);

  const updateWorkbenchInput = useCallback((id: string, value: string) => {
    postPluginWorkbenchEvent(pluginId, {
      kind: "input",
      id,
      value,
      selectedId: selectedWorkbenchItem?.id,
    });
  }, [pluginId, selectedWorkbenchItem]);
  const downloadWorkbenchImage = useCallback((id: string) => {
    postPluginWorkbenchEvent(pluginId, {
      kind: "download",
      id,
      selectedId: selectedWorkbenchItem?.id,
    });
  }, [pluginId, selectedWorkbenchItem]);

  const workbenchActionDescriptors = useMemo<PluginWorkbenchAction[]>(() => {
    if (!workbench) return [];
    const itemScoped = selectedWorkbenchItem?.actions || [];
    const panelScoped = workbench.actions || [];
    const seen = new Set<string>();
    return [...itemScoped, ...panelScoped].filter((action) => {
      if (!action.id || seen.has(action.id)) return false;
      seen.add(action.id);
      return true;
    });
  }, [selectedWorkbenchItem, workbench]);
  const workbenchFormActionDescriptors = useMemo<PluginWorkbenchAction[]>(() => {
    const form = selectedWorkbenchDetail?.form;
    if (!form) return [];
    const candidates = [
      ...(form.actions || []),
      ...form.controls.flatMap((control) => control.group?.action ? [control.group.action] : []),
    ];
    const seen = new Set<string>();
    return candidates.filter((action) => {
      if (!action.id || seen.has(action.id)) return false;
      seen.add(action.id);
      return true;
    });
  }, [selectedWorkbenchDetail]);

  const primaryWorkbenchAction = workbench
    ? workbenchActionDescriptors.find((action) => action.primary && !action.disabled)
      || workbenchActionDescriptors.find((action) => !action.disabled)
    : undefined;

  const runWorkbenchAction = useCallback((actionId: string) => {
    const descriptor = [...workbenchActionDescriptors, ...workbenchFormActionDescriptors]
      .find((action) => action.id === actionId);
    if (descriptor?.command) {
      const command = pluginCommands.find((candidate) => candidate.name === descriptor.command);
      if (command) {
        void usePluginRegistry.getState().runCommand(command).then(() => {
          postPluginWorkbenchEvent(pluginId, {
            kind: "commandComplete",
            command: command.name,
            at: Date.now(),
          });
        });
        return;
      }
    }
    postPluginWorkbenchEvent(pluginId, {
      kind: "action",
      id: actionId,
      selectedId: selectedWorkbenchItem
          ? selectedWorkbenchItem.id
        : undefined,
    });
  }, [
    pluginCommands,
    pluginId,
    selectedWorkbenchItem,
    workbenchActionDescriptors,
    workbenchFormActionDescriptors,
  ]);

  // Workbench Enter contract:
  // - List + item has detail → Open Details (read first)
  // - Detail open + explicit primary business action → that action (Install / Open / Pause…)
  // - Detail open without primary business action → Back to List
  // - List without detail → explicit primary (or first enabled) business action
  // Esc still closes detail via shell esc.inner; do not force Enter=Back when a
  // real primary is available (that made brew Install / wallpaper Set unreachable).
  const explicitPrimaryWorkbenchAction = useMemo(
    () => workbenchActionDescriptors.find((action) => action.primary && !action.disabled),
    [workbenchActionDescriptors],
  );

  const workbenchOpenDetailAction = useMemo<QxShellAction | undefined>(() => {
    if (!workbench || workbenchDetailOpen || !selectedWorkbenchItem || !selectedWorkbenchDetail) {
      return undefined;
    }
    return {
      id: "__qx:workbench-open-detail",
      label: t("plugins.workbench.openDetail", "Open Details"),
      kbd: "↵",
      menuKey: "d",
      onClick: () => activateWorkbenchItem(selectedWorkbenchItem.id),
    };
  }, [
    activateWorkbenchItem,
    selectedWorkbenchDetail,
    selectedWorkbenchItem,
    t,
    workbench,
    workbenchDetailOpen,
  ]);

  const workbenchCloseDetailAction = useMemo<QxShellAction | undefined>(() => {
    if (!workbench || !workbenchDetailOpen) return undefined;
    return {
      id: "__qx:workbench-close-detail",
      label: t("plugins.workbench.backToList", "Back to List"),
      // Enter is reserved for the business primary when one exists; Esc backs out.
      kbd: explicitPrimaryWorkbenchAction ? undefined : "↵",
      menuKey: "b",
      onClick: closeWorkbenchDetail,
    };
  }, [closeWorkbenchDetail, explicitPrimaryWorkbenchAction, t, workbench, workbenchDetailOpen]);

  // Raycast ActionPanel[0] and declarative Workbench primary both map to the
  // same QxShell primary/action surfaces.
  const hasExplicitPanelPrimary = !workbench
    && itemActions.some((action) => typeof action.primary === "boolean");
  const primaryItem = workbench
    ? primaryWorkbenchAction
    : hasExplicitPanelPrimary
      ? itemActions.find((action) => action.primary && !action.disabled)
      : itemActions.find((action) => !action.disabled);

  const workbenchPrimaryActionId = workbenchOpenDetailAction?.id
    ?? explicitPrimaryWorkbenchAction?.id
    ?? workbenchCloseDetailAction?.id
    ?? (primaryItem && workbench ? primaryItem.id : undefined);

  const contextualActions = useMemo<QxShellAction[]>(() => workbench
    ? [
      ...(workbenchOpenDetailAction ? [workbenchOpenDetailAction] : []),
      ...(workbenchCloseDetailAction ? [workbenchCloseDetailAction] : []),
      ...workbenchActionDescriptors.map((action) => ({
        id: action.id,
        label: action.label,
        menuKey: action.menuKey,
        kbd: action.kbd
          || (action.id === workbenchPrimaryActionId ? "Enter" : undefined),
        disabled: action.disabled,
        tone: (action.tone === "danger" ? "danger" : action.primary ? "primary" : "normal") as QxShellAction["tone"],
        onClick: () => runWorkbenchAction(action.id),
      })),
    ]
    : itemActions.map((action, index) => ({
        id: `item-${action.id}`,
        label: action.title,
        menuKey: action.menuKey,
        kbd: action.kbd || (!hasExplicitPanelPrimary && index === 0 ? "Enter" : undefined),
        disabled: action.disabled,
        tone: action.tone,
        onClick: () => runItem(action.id),
      })), [
        hasExplicitPanelPrimary,
        itemActions,
        runItem,
        runWorkbenchAction,
        workbench,
        workbenchActionDescriptors,
        workbenchCloseDetailAction,
        workbenchOpenDetailAction,
        workbenchPrimaryActionId,
      ]);

  const primaryActionId = workbench
    ? workbenchPrimaryActionId
    : (primaryItem ? `item-${primaryItem.id}` : undefined);
  const contextActions = useMemo(
    () => workbench || !raycastActionPanel
      ? contextualActions.filter((action) => action.id !== primaryActionId)
      : [],
    [contextualActions, primaryActionId, raycastActionPanel, workbench],
  );

  if (!isPluginTab) return null;

  const backgroundDetail = (() => {
    if (!background?.hasBackground) return undefined;
    if (background.isRunning) return t("plugins.background.running", "Background running");
    const failed = background.jobs.some((job) => job.lastOutcome === "error" || job.lastError);
    if (failed) return t("plugins.background.hasErrors", "Background · last run failed");
    if (background.lastRunAt) {
      const rel = formatRelativeTime(background.lastRunAt);
      if (rel.kind === "just_now") {
        return `${t("plugins.background.lastRun", "Last run")}: ${t("plugins.background.justNow", "Just now")}`;
      }
      if (rel.kind === "past" && rel.minutes != null) {
        return `${t("plugins.background.lastRun", "Last run")}: ${t("plugins.background.minutesAgo", "{n}m ago").replace("{n}", String(rel.minutes))}`;
      }
      return `${t("plugins.background.lastRun", "Last run")}: ${formatTimestamp(background.lastRunAt)}`;
    }
    return t("plugins.background.scheduled", "Background scheduled");
  })();

  const shell = useQxModuleShell({
    leave: goBack,
    esc: {
      inner: {
        active: workbenchDetailOpen,
        close: closeWorkbenchDetail,
      },
      query: {
        active: Boolean(workbench?.query),
        clear: () => updateWorkbenchQuery(""),
      },
    },
    onKeyDown: handlePluginKeys,
    island: renderState.kind === "loading"
      ? {
          label: t("plugins.loading", "Plugin loading"),
          detail: pluginDisplayName,
          activity: "wave",
        }
      : renderState.kind === "error"
        ? {
            label: t("plugins.error", "Plugin error"),
            detail: renderState.detail || pluginDisplayName,
            tone: "danger",
            actionLabel: t("common.retry", "Retry"),
            onAction: () => setRefreshKey((k) => k + 1),
          }
        : {
            label: pluginDisplayName,
            detail: backgroundDetail || (plugin?.version ? `v${plugin.version}` : undefined),
            activity: background?.isRunning ? "pulse" : undefined,
          },
  });

  const activeChrome: PluginChromePayload | null = workbench
    ? {
        pluginId,
        runtimeId: "workbench",
        query: workbench.query || "",
        queryPlaceholder: workbench.queryPlaceholder,
        showSearch: true,
        tabs: workbench.tabs || [],
        showTabs: Boolean(workbench.tabs?.length),
      }
    : pluginChrome;
  const workbenchSelectedIndex = workbench?.items?.length
    ? Math.max(0, workbench.items.findIndex((item) =>
        item.id === String(workbench.selectedId ?? "")
      ))
    : -1;
  const workbenchNavigation = workbench?.items?.length
    ? {
        ...qxMasterDetailNavigation({
          ids: PLUGIN_WORKBENCH_REGIONS,
          index: workbenchSelectedIndex,
          count: workbench.items.length,
          pageSize: 8,
          focusDetailOnOpen: false,
          onChange: (index: number) => {
            const item = workbench.items?.[index];
            if (item) selectWorkbenchItem(item.id);
          },
          onOpen: workbenchDetailOpen
            ? (explicitPrimaryWorkbenchAction
              ? () => runWorkbenchAction(explicitPrimaryWorkbenchAction.id)
              : undefined)
            : selectedWorkbenchItem && selectedWorkbenchDetail
              ? () => activateWorkbenchItem(selectedWorkbenchItem.id)
              : primaryItem
                ? () => runWorkbenchAction(primaryItem.id)
                : undefined,
          onClose: workbenchDetailOpen ? closeWorkbenchDetail : undefined,
        }),
        editable: "search" as const,
      }
    : undefined;
  const actionSelectionTitle = workbench ? selectedWorkbenchItem?.title || "" : selectionTitle;
  const topbarFilters = useMemo<QxShellTopbarFilter[]>(() => {
    const filters: QxShellTopbarFilter[] = [];
    if (activeChrome?.showTabs && activeChrome.tabs?.length) {
      const activeTab = activeChrome.tabs.find((tabItem) => tabItem.active)
        ?? activeChrome.tabs[0];
      if (activeTab) {
        filters.push({
          id: "collection-view",
          label: t("plugins.collectionView", "Collection view"),
          value: activeTab.id,
          options: activeChrome.tabs.map((tabItem) => ({
            value: tabItem.id,
            label: tabItem.label,
          })),
          onChange: (id) => {
            if (workbench) selectWorkbenchTab(id);
            else postPluginChromeTab(pluginId, id);
          },
        });
      }
    }
    for (const filter of workbench?.filters ?? []) {
      filters.push({
        id: filter.id,
        label: filter.label,
        value: filter.value,
        options: filter.options,
        onChange: (value) => updateWorkbenchFilter(filter.id, value),
      });
    }
    return filters;
  }, [
    activeChrome?.showTabs,
    activeChrome?.tabs,
    pluginId,
    selectWorkbenchTab,
    t,
    updateWorkbenchFilter,
    workbench,
  ]);

  return (
    <QxShell
      title={shellTitle}
      islandKey={`plugin.${pluginId}`}
      islandOpenTarget={{ kind: "plugin", id: pluginId }}
      className="qx-plugin-shell"
      onKeyDown={shell.onKeyDown}
      navigation={workbenchNavigation}
      escapeAction={shell.escapeAction}
      search={
        activeChrome && activeChrome.showSearch !== false ? (
          <QxModuleSearch
            value={activeChrome?.query || ""}
            autoFocus={false}
            onChange={(value) => workbench
              ? updateWorkbenchQuery(value)
              : postPluginChromeQuery(pluginId, value)}
            onKeyDown={workbench ? undefined : (event) => {
              if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              postPluginChromeKey(pluginId, event.key);
            }}
            placeholder={activeChrome?.queryPlaceholder || t("plugins.filter", "Filter…")}
            aria-label={activeChrome?.queryPlaceholder || t("plugins.filter", "Filter…")}
          />
        ) : (
          <span className="qx-rss-detail-title qx-module-title-with-badge">{shellTitle}</span>
        )
      }
      topbarFilters={topbarFilters}
      trailing={<PluginBackgroundBadge pluginId={pluginId} />}
      context={
        <aside className="qx-action-panel">
          {actionSelectionTitle ? (
            <div className="v2ex-context-copy qx-plugin-action-selection">
              <strong>{actionSelectionTitle}</strong>
            </div>
          ) : null}
          {contextActions.length > 0 ? (
            <QxActionSections
              sections={[{
                id: "actions",
                title: t("common.actions", "Actions"),
                actions: contextActions,
              }]}
            />
          ) : contextualActions.length === 0 ? (
            <div className="v2ex-context-copy qx-plugin-action-empty">
              {t("plugins.selectForActions", "Select an item to load its actions")}
            </div>
          ) : null}
          {background?.hasBackground && (
            <PluginBackgroundPanel pluginId={pluginId} summary={background} />
          )}
          {pluginDisplayDescription && (
            <>
              <div className="qx-action-title">{t("common.about", "About")}</div>
              <div className="v2ex-context-copy">
                <strong>{pluginDisplayName}</strong>
                {plugin?.author && <span>{plugin.author}</span>}
                <span>{pluginDisplayDescription}</span>
              </div>
            </>
          )}
        </aside>
      }
      island={shell.island}
      islandManagedExternally={workbenchIslandManaged || pluginIslandSessionActive}
      primaryActionId={primaryActionId}
      actionTitle={
        actionSelectionTitle
          ? `${t("common.actions", "Actions")} · ${actionSelectionTitle}`
          : t("common.actions", "Actions")
      }
      actions={contextualActions}
    >
      <div className="qx-plugin-runtime-stage">
        <div
          ref={containerRef}
          aria-hidden={workbench ? "true" : undefined}
          style={{
            position: "absolute",
            inset: 0,
            display: workbench ? "none" : "block",
            zIndex: 0,
            pointerEvents: workbench ? "none" : "auto",
          }}
        />
        {workbench ? (
          <PluginWorkbenchView
            pluginId={pluginId}
            state={workbench}
            detailOpen={workbenchDetailOpen}
            onActivate={activateWorkbenchItem}
            onInput={updateWorkbenchInput}
            onAction={runWorkbenchAction}
            onDownload={downloadWorkbenchImage}
          />
        ) : null}
        {!panel && (
          <div className="qx-empty-state">
            Plugin {pluginId} panel not registered
          </div>
        )}
      </div>
    </QxShell>
  );
}
