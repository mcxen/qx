import { useEffect, useRef } from "react";
import { usePluginRegistry } from "./registry";
import { useStore } from "../store";

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
  const { panels, workers } = usePluginRegistry();
  const tab = useStore((s) => s.tab);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    if (!tab.startsWith("plugin:")) {
      container.innerHTML = "";
      return;
    }

    const pluginId = tab.slice("plugin:".length);
    const panel = panels[pluginId];
    const iframe = workers[pluginId];
    if (!panel) {
      container.innerHTML = `<div style="padding:20px;color:var(--qx-text-secondary)">Plugin ${pluginId} panel not registered</div>`;
      return;
    }
    if (!iframe) {
      container.innerHTML = `<div style="padding:20px;color:var(--qx-text-secondary)">Plugin ${pluginId} not loaded</div>`;
      return;
    }

    let disposed = false;
    container.innerHTML = "";
    iframe.style.visibility = "visible";
    iframe.style.pointerEvents = "auto";
    iframe.style.zIndex = "1";
    container.appendChild(iframe);
    void Promise.resolve(panel.render(container, undefined as never)).catch((err: unknown) => {
      if (!disposed) {
        container.innerHTML = `<div style="padding:20px;color:var(--qx-danger)">Plugin ${pluginId} render failed: ${String(err)}</div>`;
      }
    });

    return () => {
      disposed = true;
      void Promise.resolve(panel.destroy?.(container)).catch(() => {});
      iframe.style.visibility = "hidden";
      iframe.style.pointerEvents = "none";
      iframe.style.zIndex = "-1";
    };
  }, [tab, panels, workers]);

  if (!tab.startsWith("plugin:")) return null;
  const pluginId = tab.slice("plugin:".length);
  const panel = panels[pluginId];
  if (!panel) return null;

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
      }}
    />
  );
}
