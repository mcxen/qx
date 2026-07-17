import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import QxShell, { type QxShellAction } from "../components/QxShell";
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
import PluginWorkbenchView from "./PluginWorkbenchView";
import type { PluginWorkbenchAction, PluginWorkbenchState } from "./workbenchTypes";
import { useStore } from "../store";
import { useSettingsStore } from "../modules/settings/store";
import { shouldIgnoreBareShortcut } from "../utils/keyboard";
import { formatRelativeTime, formatTimestamp } from "./backgroundActivity";
import { useT } from "../i18n";

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

  const handlePluginKeys = useCallback((event: React.KeyboardEvent) => {
    // Do not bind bare R for panel remount — Raycast plugins (e.g. Bing Wallpaper)
    // use Cmd+R for item actions ("Set Random Wallpaper"). Host reload is ⌘⇧R /
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
    }
  }, []);

  useEffect(() => {
    if (!isPluginTab || !pluginId) {
      setItemActions([]);
      setSelectionTitle("");
      setPluginChrome(null);
      setWorkbench(null);
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
      setWorkbench(payload.state);
    });
    return () => {
      unsubscribeActions();
      unsubscribeChrome();
      unsubscribeWorkbench();
    };
  }, [isPluginTab, pluginId]);

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
    return workbench.items.find((item) => String(item.id ?? item.title) === String(workbench.selectedId ?? ""))
      || workbench.items[0];
  }, [workbench]);

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

  const runWorkbenchAction = useCallback((actionId: string) => {
    const descriptor = workbenchActionDescriptors.find((action) => action.id === actionId);
    if (descriptor?.command) {
      const command = pluginCommands.find((candidate) => candidate.name === descriptor.command);
      if (command) {
        void usePluginRegistry.getState().runCommand(command);
        return;
      }
    }
    postPluginWorkbenchEvent(pluginId, { kind: "action", id: actionId });
  }, [pluginCommands, pluginId, workbenchActionDescriptors]);

  // Raycast ActionPanel[0] and declarative Workbench primary both map to the
  // same QxShell primary/action surfaces.
  const primaryItem = workbench
    ? workbenchActionDescriptors.find((action) => action.primary && !action.disabled)
      || workbenchActionDescriptors.find((action) => !action.disabled)
    : itemActions[0];

  const actions = useMemo<QxShellAction[]>(() => {
    const pluginAsQx: QxShellAction[] = workbench
      ? workbenchActionDescriptors.map((action, index) => ({
          label: action.label,
          kbd: action.kbd || (index === 0 ? "Enter" : undefined),
          disabled: action.disabled,
          tone: action.tone === "danger" ? "danger" : action.primary ? "primary" : "normal",
          onClick: () => runWorkbenchAction(action.id),
        }))
      : itemActions.map((action, index) => ({
          label: action.title,
          kbd: action.kbd || (index === 0 ? "Enter" : undefined),
          onClick: () => runItem(action.id),
        }));
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
    return [...pluginAsQx, ...panelOps];
  }, [itemActions, pluginCommands, runItem, runWorkbenchAction, t, workbench, workbenchActionDescriptors]);

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
    onKeyDown: handlePluginKeys,
    island: renderState.kind === "loading"
      ? {
          label: t("plugins.loading", "Plugin loading"),
          detail: plugin?.name || pluginId,
          activity: "bounce",
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
            activity: background?.isRunning ? "bounce" : undefined,
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
        String(item.id ?? item.title) === String(workbench.selectedId ?? "")
      ))
    : -1;
  const workbenchNavigation = workbench?.items?.length
    ? {
        index: workbenchSelectedIndex,
        count: workbench.items.length,
        pageSize: 8,
        regionId: "plugin-workbench-list",
        editable: "search" as const,
        onChange: (index: number) => {
          const item = workbench.items?.[index];
          if (item) postPluginWorkbenchEvent(pluginId, { kind: "select", id: String(item.id ?? item.title) });
        },
        onOpen: primaryItem
          ? () => runWorkbenchAction(primaryItem.id)
          : undefined,
      }
    : undefined;
  const actionSelectionTitle = workbench ? selectedWorkbenchItem?.title || "" : selectionTitle;
  const contextualActions = workbench
    ? workbenchActionDescriptors.map((action) => ({
        id: action.id,
        title: action.label,
        kbd: action.kbd,
        disabled: action.disabled,
        run: () => runWorkbenchAction(action.id),
      }))
    : itemActions.map((action) => ({
        id: action.id,
        title: action.title,
        kbd: action.kbd,
        disabled: false,
        run: () => runItem(action.id),
      }));

  return (
    <QxShell
      title={shellTitle}
      className="qx-plugin-shell"
      onKeyDown={shell.onKeyDown}
      navigation={workbenchNavigation}
      escapeAction={shell.escapeAction}
      search={
        <div className="qx-plugin-chrome">
          {activeChrome?.showSearch !== false && (
            <QxModuleSearch
              value={activeChrome?.query || ""}
              onChange={(value) => workbench
                ? postPluginWorkbenchEvent(pluginId, { kind: "query", value })
                : postPluginChromeQuery(pluginId, value)}
              onKeyDown={(event) => {
                if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  if (workbench) {
                    const delta = event.key === "ArrowDown" ? 1
                      : event.key === "ArrowUp" ? -1
                        : event.key === "PageDown" ? 8
                          : event.key === "PageUp" ? -8
                            : 0;
                    const next = event.key === "Home" ? 0
                      : event.key === "End" ? Math.max(0, (workbench.items?.length || 1) - 1)
                        : Math.max(0, Math.min((workbench.items?.length || 1) - 1, workbenchSelectedIndex + delta));
                    const item = workbench.items?.[next];
                    if (item) postPluginWorkbenchEvent(pluginId, { kind: "select", id: String(item.id ?? item.title) });
                  } else {
                    postPluginChromeKey(pluginId, event.key);
                  }
                }
              }}
              placeholder={activeChrome?.queryPlaceholder || t("plugins.filter", "Filter…")}
              aria-label={activeChrome?.queryPlaceholder || t("plugins.filter", "Filter…")}
            />
          )}
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
                    ? postPluginWorkbenchEvent(pluginId, { kind: "tab", id: tabItem.id })
                    : postPluginChromeTab(pluginId, tabItem.id)}
                >
                  {tabItem.label}
                </button>
              ))}
            </div>
          ) : null}
          {!activeChrome && <span className="qx-rss-detail-title qx-module-title-with-badge">{shellTitle}</span>}
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
            contextualActions.map((action, index) => {
              const kbd = action.kbd || (index === 0 ? "Enter" : undefined);
              return (
                <button
                  key={action.id}
                  className="qx-action-item"
                  type="button"
                  onClick={action.run}
                  disabled={action.disabled}
                >
                  <span>{action.title}</span>
                  {kbd ? <kbd>{kbd}</kbd> : null}
                </button>
              );
            })
          ) : (
            <div className="v2ex-context-copy" style={{ opacity: 0.7 }}>
              {t("plugins.selectForActions", "Select an item to load its actions")}
            </div>
          )}
          <div className="qx-action-title">{t("plugins.panelActions", "Panel")}</div>
          <button
            className="qx-action-item"
            onClick={() => setRefreshKey((k) => k + 1)}
            type="button"
          >
            <span>{t("plugins.reloadPanel", "Reload Panel")}</span>
            <kbd>⇧⌘R</kbd>
          </button>
          {pluginCommands.map((cmd) => (
            <button
              key={cmd.name}
              className="qx-action-item"
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
              <div className="qx-action-title">About</div>
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
      islandManagedExternally={Boolean(workbench && Object.prototype.hasOwnProperty.call(workbench, "island"))}
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
      <div
        className="qx-plugin-runtime-stage"
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          ref={containerRef}
          aria-hidden={workbench ? "true" : undefined}
          style={{
            position: "absolute",
            inset: 0,
            visibility: workbench ? "hidden" : "visible",
            pointerEvents: workbench ? "none" : "auto",
          }}
        />
        {workbench ? (
          <PluginWorkbenchView
            state={workbench}
            onSelect={(id) => postPluginWorkbenchEvent(pluginId, { kind: "select", id })}
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
