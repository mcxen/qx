// Development-only visual fixture; never a live-service or write-path test.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import PluginWorkbenchCards from "../../src/plugin/PluginWorkbenchCards";
import { Button } from "../../src/components/ui";
import { normalizePluginWorkbenchState, type PluginWorkbenchItem } from "../../src/plugin/workbenchTypes";
import "../../src/App.css";

const examples = [
  { title: "", body: "今天的一点想法。\n\n随手记应当先看到内容，标题可以为空。双击正文才进入编辑，单击只选择。", tags: ["产品", "随手记"] },
  { title: "阅读摘记", body: "**保留段落与重点**，不把正文挤成一行摘要。\n\n- 先看内容\n- 再看时间和标签\n\n[示例链接](https://example.com) 不应触发编辑。", tags: ["阅读"] },
  { title: "Long content", body: "LongUnbrokenTextWithoutSpaces".repeat(12) + "\n\nParagraph two.\n\nParagraph three.", tags: ["LongTagWithoutSpacesForNarrowWidthChecks", "layout"] },
];
const notes: PluginWorkbenchItem[] = Array.from({ length: 80 }, (_, index) => {
  const note = examples[index % examples.length];
  return {
    id: `fixture-${index}`, title: note.title,
    card: { body: note.body, tags: note.tags, timestamp: `09/06 ${String(index % 24).padStart(2, "0")}:20`, pinned: index === 0 },
    editor: { maxBytes: 65536 },
  };
});

function Fixture() {
  const [width, setWidth] = useState(980);
  const [selected, setSelected] = useState(0);
  const [compact, setCompact] = useState(false);
  const [event, setEvent] = useState("No interaction");
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState("");
  return <main style={{ padding: 16, height: "100vh", overflow: "auto", background: "var(--qx-bg-100)" }}>
    <nav style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      {[320, 640, 980].map((size) => <Button key={size} onClick={() => setWidth(size)}>{size}px</Button>)}
      <Button onClick={() => setCompact(!compact)}>Density</Button>
      <Button onClick={() => setSelected(notes.length - 1)}>Last card</Button>
      <Button onClick={() => setSelected(0)}>First card</Button>
      <Button onClick={() => {
        const dark = document.documentElement.dataset.theme !== "dark";
        document.documentElement.dataset.theme = dark ? "dark" : "light";
        document.documentElement.classList.toggle("dark", dark);
      }}>Theme</Button>
    </nav>
    <output>{event} · selected {selected}</output>
    <div className="qx-host-workbench" style={{ width, maxWidth: "100%", height: 540, marginTop: 10, border: "1px solid var(--qx-border-1)" }}>
      <PluginWorkbenchCards pluginId="fixture" state={normalizePluginWorkbenchState({ items: notes, layout: { kind: "cards", density: compact ? "compact" : "comfortable" } })}
        selectedIndex={selected} listTitle="Development cards" loadingText="Loading" emptyText="No cards" regionId="fixture-cards"
        onSelect={(id) => { setSelected(notes.findIndex((note) => note.id === id)); setEvent(`Selected ${id}`); }}
        editingItemId={editing}
        renderEditor={(item) => editing === item.id ? <section>
          <textarea aria-label="Fixture draft" value={draft} rows={Math.min(24, Math.max(4, draft.split("\n").length))}
            style={{ width: "100%", resize: "vertical" }} onChange={(e) => setDraft(e.target.value)} />
          <Button onClick={() => setEditing(undefined)}>Cancel fixture edit</Button>
        </section> : null}
        onEdit={(item) => { setEditing(item.id); setDraft(item.card?.body || ""); setEvent(`Edit requested for ${item.id}`); }}
        onOpenLink={(url) => setEvent(`Link activated: ${url}`)} />
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
