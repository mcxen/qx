// Production Shell harness: no network, native actions, or product settings writes.
import { mockIPC } from "@tauri-apps/api/mocks";
mockIPC((command) => command === "plugin:event|listen" ? 1 : null);
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import QxShell, { type QxShellAction } from "../../src/components/QxShell";
import { QxActionList } from "../../src/components/QxActionPanel";
import QxResizableSplit from "../../src/components/QxResizableSplit";
import QxModuleSearch from "../../src/components/QxModuleSearch";
import QxIslandSurface from "../../src/island/surface/QxIslandSurface";
import { useQxModuleShell } from "../../src/hooks/useQxModuleShell";
import { islandHost } from "../../src/island/session/hostApi";
import { useSettingsStore } from "../../src/modules/settings/store";
import { useIslandError } from "../../src/island/feedback/useIslandError";
import { useWorkbenchNavigationGuard } from "../../src/plugin/useWorkbenchNavigationGuard";
import "../../src/App.css";

const params = new URLSearchParams(location.search);
const mode = params.get("mode") ?? "combined";
const layout = mode === "layout" || mode === "combined";
const withActions = mode === "actions" || mode === "combined";
const settings = useSettingsStore.getState().settings;
useSettingsStore.setState({ settings: { ...settings, general: { ...settings.general, language: params.get("locale") === "zh" ? "zh-CN" : "en" } } });
document.documentElement.dataset.theme = params.get("theme") ?? "light";
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
// Browser has no native window backdrop; supply the theme's base behind transparency.
document.documentElement.style.background = "var(--qx-bg-100)";
const calls: string[] = [];
const deferred: Array<() => void> = [];
function Fixture() {
  const navigationGuard = useWorkbenchNavigationGuard();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(false);
  const [panesMounted, setPanesMounted] = useState(true);
  const [revision, render] = useState(0);
  const [route, setRoute] = useState("fixture");
  const shell = useQxModuleShell({ leave: () => calls.push("leave"), esc: { inner: { active: detail, close: () => setDetail(false) }, query: { active: !!query, clear: () => setQuery("") } }, island: { label: "Fixture", detail: "Ready", priority: "location" } });
  useIslandError({ id: "fixture", title: "Operation failed", error, actionLabel: "Retry", onAction: () => { calls.push("retry"); setError(""); }, openTarget: { kind: "launcher" } });
  const actions = useMemo<QxShellAction[]>(() => withActions ? [
    { id: "run", label: "Run a very long primary action", kbd: "Enter", onClick: async () => { calls.push("run"); await new Promise<void>((resolve) => deferred.push(resolve)); } },
    { id: "fail", label: "Fail", kbd: "CmdOrCtrl+F", onClick: async () => { throw new Error("Expected failure with a long explanation ".repeat(12)); } },
    { id: "submenu", label: "Submenu", kbd: "CmdOrCtrl+M", loadChildren: async () => { calls.push("load"); await new Promise<void>((resolve) => deferred.push(resolve)); return [{ id: "child", label: "Child", onClick: () => { calls.push("child"); } }]; }, searchable: true },
    { id: "disabled", label: "Disabled", disabled: true, onClick: () => { calls.push("disabled"); } },
    { id: "fast-submenu", label: "Fast submenu", kbd: "CmdOrCtrl+J", loadChildren: async () => [{ id: "fast-child", label: "Fast child", onClick: () => { calls.push("fast-child"); } }] },
    { id: "failed-submenu", label: "Failed submenu", kbd: "CmdOrCtrl+E", loadChildren: async () => { calls.push("load-failed"); throw new Error("Submenu failure"); } },
    { id: "guarded", label: "Guarded command", kbd: "CmdOrCtrl+G", onClick: () => navigationGuard.run(async () => { calls.push("guarded"); await new Promise<void>((resolve) => deferred.push(resolve)); }) },
  ] : [], [revision]);
  useEffect(() => {
    Object.assign(window, { fixture: {
      calls, deferred, error: setError, detail: setDetail, panes: setPanesMounted, rerender: () => render((x) => x + 1), route: setRoute,
      guard: (decision: string) => navigationGuard.register(async () => { if (decision === "fail") throw new Error("Guard failed"); return decision === "allow"; }),
      snapshot: () => islandHost.getSnapshot().map((s) => ({ id: s.id, rankEpoch: s.rankEpoch, contentUpdatedAt: s.contentUpdatedAt, ttlMs: s.ttlMs })),
      showTask: () => islandHost.show({ id: "fixture-task", source: "module", priority: "task", placement: "docked", content: { primary: "Loading", meter: { kind: "activity", activity: "dots" } } }),
    } });
  });
  const panes = <QxResizableSplit separatorLabel="Resize list" storageKey="fixture.width" className={`qx-content-split${detail ? " has-detail" : ""}`} minLeftWidth={220} minRightWidth={220}>
    <div className="qx-content-list" data-testid="list"><button onClick={() => setDetail(true)}>Open detail</button>{Array.from({ length: 40 }, (_, i) => <p key={i}>Row {i}</p>)}</div>
    <div className="qx-content-detail" data-testid="detail"><textarea aria-label="Editor" defaultValue="Native editor" /></div>
  </QxResizableSplit>;
  return <QxShell title="Fixture" islandKey={route} {...shell.shellProps} contentMode={layout ? "fill" : "scroll"}
    search={<QxModuleSearch value={query} onChange={setQuery} placeholder="Search" />}
    primaryActionId={withActions ? "run" : undefined} actions={actions}
    customIsland={<QxIslandSurface placement="docked"><span data-testid="preview">Preview</span></QxIslandSurface>}
    context={<QxActionList actions={actions} />}>
    {layout && panesMounted ? panes : <p data-testid="plain">Plain content</p>}
  </QxShell>;
}
createRoot(document.getElementById("root")!).render(<div className="qx-canvas"><Fixture /></div>);
