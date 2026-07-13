import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../components/QxShell";
import { useEscBack } from "../hooks/useEscBack";
import { usePluginRegistry } from "./registry";
import { useStore } from "../store";
import { useSettingsStore } from "../modules/settings/store";
import { shouldIgnoreBareShortcut } from "../utils/keyboard";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [renderState, setRenderState] = useState<{
    kind: "idle" | "loading" | "error";
    detail?: string;
  }>({ kind: "idle" });
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
    if (!containerRef.current || !isPluginTab) return;
    const container = containerRef.current;
    const activePanel = panel;
    if (!activePanel) {
      setRenderState({ kind: "error", detail: "Panel not registered" });
      return;
    }

    let disposed = false;
    let timeout: number | null = null;
    setRenderState({ kind: "loading", detail: "Rendering panel" });
    renderPluginStatus(container, `Loading ${pluginId}...`);

    const renderTimer = window.setTimeout(() => {
      if (disposed) return;
      timeout = window.setTimeout(() => {
        if (!disposed) {
          renderPluginStatus(container, `Plugin ${pluginId} render timed out.`, "danger");
          setRenderState({ kind: "error", detail: "Render timed out" });
        }
      }, 8500);
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
    };
  }, [isPluginTab, panel, pluginId, refreshKey, raycastActionPanel]);

  const shellTitle = panel?.title || plugin?.name || pluginId;

  const actions = useMemo<QxShellAction[]>(() => [
    {
      label: "Refresh",
      kbd: "R",
      onClick: () => setRefreshKey((k) => k + 1),
    },
    ...pluginCommands.map((cmd) => ({
      label: cmd.title,
      onClick: () => void usePluginRegistry.getState().runCommand(cmd),
    })),
  ], [pluginCommands]);

  if (!isPluginTab) return null;

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
        detail: plugin?.version ? `v${plugin.version}` : undefined,
      };

  return (
    <QxShell
      title={shellTitle}
      className="qx-plugin-shell"
      onKeyDown={onKeyDown}
      onBack={goBack}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: goBack }}
      search={
        <div className="qx-rss-detail-title">
          <span>{shellTitle}</span>
        </div>
      }
      context={
        <aside className="qx-action-panel">
          <div className="qx-action-title">Actions</div>
          <button
            className="qx-action-item"
            onClick={() => setRefreshKey((k) => k + 1)}
            type="button"
          >
            <span>Refresh</span>
            <kbd>R</kbd>
          </button>
          {pluginCommands.map((cmd) => (
            <button
              key={cmd.name}
              className="qx-action-item"
              onClick={() => void usePluginRegistry.getState().runCommand(cmd)}
              type="button"
            >
              <span>{cmd.title}</span>
            </button>
          ))}
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
      primaryAction={{
        label: "Refresh",
        kbd: "R",
        tone: "primary",
        onClick: () => setRefreshKey((k) => k + 1),
      }}
      secondaryAction={{ label: "Actions", kbd: "Cmd K" }}
      actionTitle="Plugin Actions"
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
