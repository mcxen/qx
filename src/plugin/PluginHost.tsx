import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../components/QxShell";
import PluginBackgroundBadge, {
  usePluginBackgroundSummary,
} from "../components/PluginBackgroundBadge";
import PluginBackgroundPanel from "../components/PluginBackgroundPanel";
import { useEscBack } from "../hooks/useEscBack";
import { usePluginRegistry } from "./registry";
import {
  runPluginItemAction,
  subscribePluginItemActions,
  type PluginItemActionDescriptor,
} from "./runtime";
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
  const raycastActionPanel = useSettingsStore(
    (state) => state.settings.plugin_display.raycast_action_panel,
  );
  const goBack = useCallback(() => setTab("launcher"), [setTab]);

  const { onKeyDown: escKeyDown } = useEscBack({
    launcher: goBack,
  });

  const onKeyDown = (event: React.KeyboardEvent) => {
    escKeyDown(event);
    if (event.key === "Escape") return;
    const ignoreBare = shouldIgnoreBareShortcut(event.nativeEvent);
    switch (event.key) {
      case "r":
      case "R":
        if (!ignoreBare && !event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          setRefreshKey((k) => k + 1);
        }
        break;
    }
  };

  useEffect(() => {
    if (!isPluginTab || !pluginId) {
      setItemActions([]);
      setSelectionTitle("");
      return;
    }
    return subscribePluginItemActions((payload) => {
      if (payload.pluginId !== pluginId) return;
      setItemActions(payload.actions);
      setSelectionTitle(payload.selectionTitle || "");
    });
  }, [isPluginTab, pluginId]);

  useEffect(() => {
    if (!containerRef.current || !isPluginTab) return;
    const container = containerRef.current;
    const activePanel = panel;
    if (!activePanel) {
      setRenderState({ kind: "error", detail: "Panel not registered" });
      return;
    }

    let disposed = false;
    let timeout: number | null = null;
    setItemActions([]);
    setSelectionTitle("");
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
    };
  }, [isPluginTab, panel, pluginId, refreshKey, raycastActionPanel]);

  const shellTitle = panel?.title || plugin?.name || pluginId;

  const runItem = useCallback(
    (actionId: string) => {
      runPluginItemAction(pluginId, actionId);
    },
    [pluginId],
  );

  // Raycast ActionPanel[0] === Qx primaryAction; rest + same list for ⌘K.
  const primaryItem = itemActions[0];

  const actions = useMemo<QxShellAction[]>(() => {
    // Full Raycast ActionPanel → Qx action menu (primary included so ⌘K is complete).
    const raycastAsQx: QxShellAction[] = itemActions.map((action, index) => ({
      label: action.title,
      kbd: action.kbd || (index === 0 ? "Enter" : undefined),
      onClick: () => runItem(action.id),
    }));
    const panelOps: QxShellAction[] = [
      {
        label: t("plugins.refresh", "Refresh"),
        kbd: "R",
        onClick: () => setRefreshKey((k) => k + 1),
      },
      ...pluginCommands.map((cmd) => ({
        label: cmd.title,
        onClick: () => void usePluginRegistry.getState().runCommand(cmd),
      })),
    ];
    return [...raycastAsQx, ...panelOps];
  }, [itemActions, pluginCommands, runItem, t]);

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

  const island: BottomIslandContent = renderState.kind === "loading"
    ? {
        label: "Plugin loading",
        detail: plugin?.name || pluginId,
        activity: "bounce",
      }
    : renderState.kind === "error"
    ? {
        label: "Plugin error",
        detail: renderState.detail || plugin?.name || pluginId,
        tone: "danger",
        actionLabel: "Retry",
        onAction: () => setRefreshKey((k) => k + 1),
      }
    : {
        label: plugin?.name || shellTitle,
        detail: backgroundDetail || (plugin?.version ? `v${plugin.version}` : undefined),
        activity: background?.isRunning ? "bounce" : undefined,
      };

  return (
    <QxShell
      title={shellTitle}
      className="qx-plugin-shell"
      onKeyDown={onKeyDown}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: goBack }}
      search={
        <div className="qx-rss-detail-title qx-module-title-with-badge">
          <span>{shellTitle}</span>
          <PluginBackgroundBadge pluginId={pluginId} />
        </div>
      }
      context={
        <aside className="qx-action-panel">
          {/* Raycast ActionPanel ≡ Qx Actions (same list as bottom bar + ⌘K). */}
          <div className="qx-action-title">{t("common.actions", "Actions")}</div>
          {selectionTitle ? (
            <div className="v2ex-context-copy" style={{ marginBottom: 6 }}>
              <strong>{selectionTitle}</strong>
            </div>
          ) : null}
          {itemActions.length > 0 ? (
            itemActions.map((action, index) => {
              const kbd = action.kbd || (index === 0 ? "Enter" : undefined);
              return (
                <button
                  key={action.id}
                  className="qx-action-item"
                  type="button"
                  onClick={() => runItem(action.id)}
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
            <span>{t("plugins.refresh", "Refresh")}</span>
            <kbd>R</kbd>
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
      island={island}
      primaryAction={
        primaryItem
          ? {
              label: primaryItem.title,
              kbd: primaryItem.kbd || "Enter",
              tone: "primary",
              onClick: () => runItem(primaryItem.id),
            }
          : {
              label: t("plugins.refresh", "Refresh"),
              kbd: "R",
              tone: "primary",
              onClick: () => setRefreshKey((k) => k + 1),
            }
      }
      secondaryAction={{ label: t("common.actions", "Actions"), kbd: "CmdOrCtrl+K" }}
      actionTitle={
        selectionTitle
          ? `${t("common.actions", "Actions")} · ${selectionTitle}`
          : t("common.actions", "Actions")
      }
      actions={actions}
    >
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {!panel && (
          <div className="qx-empty-state">
            Plugin {pluginId} panel not registered
          </div>
        )}
      </div>
    </QxShell>
  );
}
