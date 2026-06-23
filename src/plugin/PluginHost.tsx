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
    const iframe = workers[pluginId];
    if (!iframe) {
      container.innerHTML = `<div style="padding:20px;color:var(--qx-text-secondary)">Plugin ${pluginId} not loaded</div>`;
      return;
    }

    container.innerHTML = "";
    iframe.style.visibility = "visible";
    iframe.style.pointerEvents = "auto";
    iframe.style.zIndex = "1";
    container.appendChild(iframe);

    return () => {
      iframe.style.visibility = "hidden";
      iframe.style.pointerEvents = "none";
      iframe.style.zIndex = "-1";
    };
  }, [tab, workers]);

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
