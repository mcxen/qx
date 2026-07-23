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
import QxShell, { type QxShellAction } from "../components/QxShell";
import { QxActionList } from "../components/QxActionPanel";
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
import { useT } from "../i18n";
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

  const shellTitle = panel?.title || plugin?.name || pluginId;

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

  // Raycast ActionPanel[0] and declarative Workbench primary both map to the
  // same QxShell primary/action surfaces.
  const primaryItem = workbench
    ? primaryWorkbenchAction
    : itemActions[0];

  const contextualActions = useMemo<QxShellAction[]>(() => workbench
    ? workbenchActionDescriptors.map((action) => ({
        label: action.label,
        kbd: action.kbd || (action.id === primaryWorkbenchAction?.id ? "Enter" : undefined),
        disabled: action.disabled,
        tone: action.tone === "danger" ? "danger" : action.primary ? "primary" : "normal",
        onClick: () => runWorkbenchAction(action.id),
      }))
    : itemActions.map((action, index) => ({
        label: action.title,
        kbd: action.kbd || (index === 0 ? "Enter" : undefined),
        onClick: () => runItem(action.id),
      })), [
        itemActions,
        primaryWorkbenchAction?.id,
        runItem,
        runWorkbenchAction,
        workbench,
        workbenchActionDescriptors,
      ]);

  const actions = useMemo<QxShellAction[]>(() => {
    // Panel-level ops stay after the selected item's ActionPanel (Raycast order).
    const panelOps: QxShellAction[] = [
      {
        label: t("plugins.reloadPanel", "Reload Panel"),
        kbd: "CmdOrCtrl+Shift+R",
        onClick: () => setRefreshKey((k) => k + 1),
      },
      ...pluginCommands.map((cmd) => ({
        label: cmd.title,
        onClick: () => void usePluginRegistry.getState().runCommand(cmd),
      })),
    ];
    return [...contextualActions, ...panelOps];
  }, [contextualActions, pluginCommands, t]);

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
          detail: plugin?.name || pluginId,
          activity: "wave",
        }
      : renderState.kind === "error"
        ? {
            label: t("plugins.error", "Plugin error"),
            detail: renderState.detail || plugin?.name || pluginId,
            tone: "danger",
            actionLabel: t("common.retry", "Retry"),
            onAction: () => setRefreshKey((k) => k + 1),
          }
        : {
            label: plugin?.name || shellTitle,
            detail: backgroundDetail || (plugin?.version ? `v${plugin.version}` : undefined),
            activity: background?.isRunning ? "pulse" : undefined,
          },
    t,
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
          onOpen: selectedWorkbenchItem && selectedWorkbenchDetail
            ? () => activateWorkbenchItem(selectedWorkbenchItem.id)
            : primaryItem
              ? () => runWorkbenchAction(primaryItem.id)
              : undefined,
        }),
        editable: "search" as const,
      }
    : undefined;
  const actionSelectionTitle = workbench ? selectedWorkbenchItem?.title || "" : selectionTitle;

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
      trailing={
        <div className="qx-plugin-topbar-trailing">
          {activeChrome?.showTabs && activeChrome.tabs?.length ? (
            <div className="qx-shadcn-tabs-list qx-plugin-chrome-tabs" role="tablist">
              {activeChrome.tabs.map((tabItem) => (
                <button
                  key={tabItem.id}
                  type="button"
                  role="tab"
                  data-state={tabItem.active ? "active" : "inactive"}
                  className="qx-shadcn-tabs-trigger"
                  onClick={() => workbench
                    ? selectWorkbenchTab(tabItem.id)
                    : postPluginChromeTab(pluginId, tabItem.id)}
                >
                  {tabItem.label}
                </button>
              ))}
            </div>
          ) : null}
          <PluginBackgroundBadge pluginId={pluginId} />
        </div>
      }
      context={
        <aside className="qx-action-panel">
          {/* Raycast ActionPanel ≡ Qx Actions (same list as bottom bar + ⌘K). */}
          <div className="qx-action-title">{t("common.actions", "Actions")}</div>
          {actionSelectionTitle ? (
            <div className="v2ex-context-copy" style={{ marginBottom: 6 }}>
              <strong>{actionSelectionTitle}</strong>
            </div>
          ) : null}
          {contextualActions.length > 0 ? (
            <QxActionList actions={contextualActions} />
          ) : (
            <div className="v2ex-context-copy" style={{ opacity: 0.7 }}>
              {t("plugins.selectForActions", "Select an item to load its actions")}
            </div>
          )}
          <div className="qx-action-title">{t("plugins.panelActions", "Panel")}</div>
          <QxActionList actions={[{
            label: t("plugins.reloadPanel", "Reload Panel"),
            kbd: "CmdOrCtrl+Shift+R",
            onClick: () => setRefreshKey((k) => k + 1),
          }]} />
          {pluginCommands.map((cmd) => (
            <button
              key={cmd.name}
              className="qx-action-item"
              data-qx-search-focus="preserve"
              onClick={() => void usePluginRegistry.getState().runCommand(cmd)}
              type="button"
            >
              <span className="qx-module-title-with-badge">
                <span>{cmd.title}</span>
                {cmd.mode === "no-view" && cmd.interval ? (
                  <PluginBackgroundBadge
                    pluginId={pluginId}
                    commandName={cmd.name}
                    compact
                  />
                ) : null}
              </span>
            </button>
          ))}
          {background?.hasBackground && (
            <PluginBackgroundPanel pluginId={pluginId} summary={background} />
          )}
          {plugin?.description && (
            <>
              <div className="qx-action-title">{t("common.about", "About")}</div>
              <div className="v2ex-context-copy">
                <strong>{plugin.name}</strong>
                {plugin.author && <span>{plugin.author}</span>}
                <span>{plugin.description}</span>
              </div>
            </>
          )}
        </aside>
      }
      island={shell.island}
      islandManagedExternally={workbenchIslandManaged || pluginIslandSessionActive}
      primaryAction={
        primaryItem
          ? {
              label: "title" in primaryItem ? primaryItem.title : primaryItem.label,
              kbd: primaryItem.kbd || "Enter",
              tone: "primary",
              onClick: () => workbench
                ? runWorkbenchAction(primaryItem.id)
                : runItem(primaryItem.id),
            }
          : {
              label: t("plugins.reloadPanel", "Reload Panel"),
              kbd: "CmdOrCtrl+Shift+R",
              tone: "primary",
              onClick: () => setRefreshKey((k) => k + 1),
            }
      }
      secondaryAction={shell.secondaryAction}
      actionTitle={
        actionSelectionTitle
          ? `${t("common.actions", "Actions")} · ${actionSelectionTitle}`
          : t("common.actions", "Actions")
      }
      actions={actions}
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
            state={workbench}
            detailOpen={workbenchDetailOpen}
            onActivate={activateWorkbenchItem}
            onInput={updateWorkbenchInput}
            onAction={runWorkbenchAction}
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
