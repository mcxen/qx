// Production Workbench rendering with synthetic devices; never hardware evidence.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import PluginWorkbenchView from "../../src/plugin/PluginWorkbenchView";
import { normalizePluginWorkbenchState } from "../../src/plugin/workbenchTypes";
import { Button } from "../../src/components/ui";
import "../../src/App.css";

function Fixture() {
  const [width, setWidth] = useState(640);
  const [dark, setDark] = useState(false);
  const [value, setValue] = useState("50");
  const [mode, setMode] = useState("hardware");
  const state = normalizePluginWorkbenchState({
    detail: {
      title: "External Display / 外接显示器", subtitle: mode === "software" ? "软件调光" : "DDC/CI",
      status: mode === "error" ? { state: "error", error: "DDC/CI read failed · 显示器已断开" } : undefined,
      form: { controls: [
        { id: "brightness", label: `亮度 · ${value}%`, type: "slider", value, min: 0, max: 100, step: 1, disabled: mode === "error" },
        ...(mode === "baseline" ? [
          { id: "text", label: "Text baseline", value: "Native editing" },
          { id: "number", label: "Number baseline", type: "number", value: "42" },
          { id: "select", label: "Select baseline", type: "select", value: "a", options: [{ value: "a", label: "Option A" }] },
        ] : []),
      ] },
    },
  });
  return <div style={{ padding: 16, minHeight: "100vh", background: "var(--qx-bg-100)", color: "var(--qx-text-primary)" }}>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      {[320, 640, 980].map((w) => <Button key={w} onClick={() => setWidth(w)}>{w}px</Button>)}
      <Button onClick={() => { setDark(!dark); document.documentElement.classList.toggle("dark", !dark); document.documentElement.dataset.theme = dark ? "light" : "dark"; }}>{dark ? "Light" : "Dark"}</Button>
      {["hardware", "software", "error", "baseline"].map((m) => <Button key={m} onClick={() => setMode(m)}>{m}</Button>)}
    </div>
    <div data-testid="brightness-frame" style={{ width, maxWidth: "100%", height: 440, display: "flex", border: "1px solid var(--qx-border-1)" }}>
      <PluginWorkbenchView pluginId="brightness-fixture" state={state} detailOpen
        onActivate={() => {}} onAction={() => {}} onDownload={() => {}}
        onInput={(id, next) => { if (id === "brightness") setValue(next); }} />
    </div>
    <output aria-label="brightness-result">{value}</output>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
