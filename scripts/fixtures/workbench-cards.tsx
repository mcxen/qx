// Development-only visual fixture; never a live-service or write-path test.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import PluginWorkbenchCards from "../../src/plugin/PluginWorkbenchCards";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../src/components/ui";
import PluginWorkbenchInlineEditor from "../../src/plugin/PluginWorkbenchInlineEditor";
import { useWorkbenchEditSession } from "../../src/plugin/workbenchEditSession";
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
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [format, setFormat] = useState<"plaintext" | "markdown">("markdown");
  const [outcome, setOutcome] = useState<"saved" | "error" | "conflict">("saved");
  const [writes, setWrites] = useState(0);
  const [dirtyDialog, setDirtyDialog] = useState(false);
  const discardRef = useRef<((value: "save" | "discard" | "continue") => void) | undefined>(undefined);
  const finishDiscard = (value: "save" | "discard" | "continue") => {
    discardRef.current?.(value);
    discardRef.current = undefined;
    setDirtyDialog(false);
  };
  const edit = useWorkbenchEditSession({
    confirmDiscard: () => new Promise((resolve) => { discardRef.current = resolve; setDirtyDialog(true); }),
    onEdit: async (request) => {
      const identity = { itemId: request.itemId, sessionId: request.sessionId, requestId: request.requestId };
      if (request.phase === "start") {
        await new Promise((resolve) => setTimeout(resolve, 180));
        const note = notes.find((item) => item.id === request.itemId)!;
        return { ...identity, phase: "start", status: "ready", value: bodies[note.id] ?? note.card?.body ?? "" };
      }
      if (request.phase === "cancel") return { ...identity, phase: "cancel", status: "cancelled" };
      if (request.phase === "input") return { ...identity, phase: "input", status: "accepted" };
      if (outcome !== "saved") return { ...identity, phase: "save", status: outcome, message: "Synthetic failure — draft retained" };
      setBodies((previous) => ({ ...previous, [request.itemId]: request.value }));
      setWrites((previous) => previous + 1);
      return { ...identity, phase: "save", status: "saved", value: request.value };
    },
    messages: { inlineUnavailable: "Unavailable", conflict: "Conflict", saveError: "Save failed", startError: "Start failed", unavailable: "Read only", byteLimit: (limit) => `Limit ${limit}` },
  });
  const items = notes.map((note) => ({ ...note, card: { ...note.card, body: bodies[note.id] ?? note.card?.body }, editor: { ...note.editor, format } }));
  return <main style={{ padding: 16, height: "100vh", overflow: "auto", background: "var(--qx-bg-100)" }}>
    <nav style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      {[320, 640, 980].map((size) => <Button key={size} onClick={() => setWidth(size)}>{size}px</Button>)}
      <Button onClick={() => setCompact(!compact)}>Density</Button>
      <Button onClick={() => setSelected(notes.length - 1)}>Last card</Button>
      <Button onClick={() => setSelected(0)}>First card</Button>
      <Button disabled={!!edit.session} onClick={() => setFormat(format === "markdown" ? "plaintext" : "markdown")}>Format: {format}</Button>
      <Button onClick={() => setOutcome(outcome === "saved" ? "error" : outcome === "error" ? "conflict" : "saved")}>Save: {outcome}</Button>
      <Button onClick={() => {
        const dark = document.documentElement.dataset.theme !== "dark";
        document.documentElement.dataset.theme = dark ? "dark" : "light";
        document.documentElement.classList.toggle("dark", dark);
      }}>Theme</Button>
    </nav>
    <output>{event} · selected {selected} · writes {writes} · {edit.session?.status || "browsing"}</output>
    <div className="qx-host-workbench" style={{ width, maxWidth: "100%", height: 540, marginTop: 10, border: "1px solid var(--qx-border-1)" }}>
      <PluginWorkbenchCards pluginId="fixture" state={normalizePluginWorkbenchState({ items, layout: { kind: "cards", density: compact ? "compact" : "comfortable" } })}
        selectedIndex={selected} listTitle="Development cards" loadingText="Loading" emptyText="No cards" regionId="fixture-cards"
        onSelect={(id) => { setSelected(notes.findIndex((note) => note.id === id)); setEvent(`Selected ${id}`); }}
        editingItemId={edit.session?.itemId}
        renderEditor={(item) => edit.session?.itemId === item.id ? <PluginWorkbenchInlineEditor session={edit.session} onInput={edit.input} onSave={edit.save} onCancel={edit.cancel} /> : null}
        onEdit={(item) => { void edit.start(item); setEvent(`Edit requested for ${item.id}`); }}
        onOpenLink={(url) => setEvent(`Link activated: ${url}`)} />
    </div>
    <Dialog open={dirtyDialog} onOpenChange={(open) => { if (!open) finishDiscard("continue"); }}>
      <DialogContent><DialogHeader><DialogTitle>Unsaved draft</DialogTitle><DialogDescription>Choose what to do with this synthetic draft.</DialogDescription></DialogHeader>
        <Button onClick={() => finishDiscard("save")}>Save draft</Button>
        <Button onClick={() => finishDiscard("discard")}>Discard draft</Button>
        <Button onClick={() => finishDiscard("continue")}>Continue editing</Button>
      </DialogContent>
    </Dialog>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
