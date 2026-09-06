// Local interaction fixture using the shipped selection hook and result list.
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ResultsList from "../../src/ResultsList";
import { useStore, type AppEntry } from "../../src/store";
import { useSettingsStore } from "../../src/modules/settings/store";
import { buildLauncherResultRows, selectedLauncherItem } from "../../src/launcher/resultRows";
import { useLauncherSelection } from "../../src/launcher/useLauncherSelection";
import { MatchTier } from "../../src/search/rankResults";
import "../../src/App.css";

const pin: AppEntry = { name: "显示器亮度", path: "__qx:plugin:brightness", kind: "command", icon: "" };
const panel: AppEntry = { name: "V2EX", path: "__qx:plugin:v2ex", kind: "command", icon: "" };
const command: AppEntry = { name: "查看通知", path: "__qx:cmd:v2ex:notifications", kind: "command", icon: "", matchScore: MatchTier.prefix, clickCount: 999 };
const file: AppEntry = { name: "v2_test.go", path: "/fixture/v2_test.go", kind: "file", icon: "" };
const exact: AppEntry = { name: "v2", path: "/fixture/v2.app", kind: "app", icon: "" };
const settings = useSettingsStore.getState().settings;
useSettingsStore.setState({ settings: { ...settings, search_metadata: {
  "plugin:brightness": { aliases: [], tags: [], pinned: true, pin_order: 0 },
} } });
useStore.setState({ selectedIndex: 1, query: "" });

function Fixture() {
  const { query, setQuery, selectedIndex: storedIndex, setSelectedIndex } = useStore();
  const currentSettings = useSettingsStore((state) => state.settings);
  const [late, setLate] = useState(false);
  const [scope, setScope] = useState("all");
  const [opened, setOpened] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const items = useMemo(() => scope === "files" ? [file] : [pin, command, panel, file, ...(late ? [exact] : [])], [late, scope]);
  const rows = useMemo(() => buildLauncherResultRows(items, currentSettings.file_search.categories, collapsed, currentSettings), [items, currentSettings, collapsed]);
  const { selectedIndex, selectRow } = useLauncherSelection(rows, query, scope, storedIndex, setSelectedIndex);
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <div style={{ padding: 12, display: "flex", gap: 12 }}>
      <input aria-label="Search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); selectRow(selectedIndex + (event.key === "ArrowDown" ? 1 : -1));
        }
        if (event.key === "Enter") setOpened(selectedLauncherItem(rows, selectedIndex)?.path ?? "");
      }} />
      <button onClick={() => setLate(true)}>Deliver better result</button>
      <button onClick={() => setScope(scope === "all" ? "files" : "all")}>Switch scope</button>
      <output aria-label="Selected">{selectedLauncherItem(rows, selectedIndex)?.name ?? "None"}</output>
      <output aria-label="Opened">{opened}</output>
    </div>
    <ResultsList items={items} rows={rows} onItemClick={(item) => setOpened(item.path)}
      onSelectRow={selectRow} onToggleCategory={(id) => setCollapsed((previous) => {
        const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
      })} onOpenActionsAt={() => {}} showPinnedStrip />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
