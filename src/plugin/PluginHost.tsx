import { useEffect, useMemo, useRef, useState } from "react";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../components/QxShell";
import { useEscBack } from "../hooks/useEscBack";
import { usePluginRegistry } from "./registry";
import { useStore } from "../store";
import { shouldIgnoreBareShortcut } from "../utils/keyboard";

export function PluginHost() {
  const { workers, loaded } = usePluginRegistry();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !loaded) return;
    const container = containerRef.current;
    container.innerHTML = "";
    Object.values(workers).forEach((iframe) => {
      container.appendChild(iframe);
    });
  }, [workers, loaded]);

  return (
    <div
      ref={containerRef}
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

export function PluginPanelViewport() {
  const { panels, workers, commands, plugins } = usePluginRegistry();
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const containerRef = useRef<HTMLDivElement>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const isPluginTab = tab.startsWith("plugin:");

  const pluginId = isPluginTab ? tab.slice("plugin:".length) : "";
  const panel = isPluginTab ? panels[pluginId] : undefined;
  const iframe = isPluginTab ? workers[pluginId] : undefined;
  const plugin = isPluginTab ? plugins.find((p) => p.id === pluginId) : undefined;
  const pluginCommands = useMemo(
    () => (isPluginTab ? commands.filter((c) => c.pluginId === pluginId) : []),
    [commands, isPluginTab, pluginId],
  );

  const goBack = () => setTab("launcher");

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
    const activePanel = panels[pluginId];
    const activeIframe = workers[pluginId];
    if (!activePanel || !activeIframe) return;

    let disposed = false;
    container.innerHTML = "";
    activeIframe.style.visibility = "visible";
    activeIframe.style.pointerEvents = "auto";
    activeIframe.style.zIndex = "1";
    container.appendChild(activeIframe);
    void Promise.resolve(activePanel.render(container, undefined as never)).catch((err: unknown) => {
      if (!disposed) {
        container.innerHTML = `<div style="padding:20px;color:var(--qx-danger)">Plugin ${pluginId} render failed: ${String(err)}</div>`;
      }
    });

    return () => {
      disposed = true;
      void Promise.resolve(activePanel.destroy?.(container)).catch(() => {});
      activeIframe.style.visibility = "hidden";
      activeIframe.style.pointerEvents = "none";
      activeIframe.style.zIndex = "-1";
    };
  }, [isPluginTab, pluginId, panels, workers, refreshKey]);

  if (!isPluginTab) return null;

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

  const island: BottomIslandContent = {
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
        {panel && !iframe && (
          <div className="qx-empty-state">
            Plugin {pluginId} not loaded
          </div>
        )}
      </div>
    </QxShell>
  );
}
