// Not a marketplace plugin. Import only into a local development Qx instance.
const panels = new WeakMap();
export default {
  panel: {
    render(container, context) {
      const rows = Array.from({ length: 60 }, (_, index) => ({
        id: `test-${index}`, title: index === 0 ? "" : `Test note ${index}`,
        content: `Fixture ${index}: 完整原文，不是摘要。\n\nSecond paragraph with **emphasis**.\n\n[Link](https://example.com)`,
      }));
      let layout = "cards";
      let outcome = "saved";
      let selectedId = rows[0].id;
      let query = "";
      let writes = 0;
      let dead = false;
      const sessions = new Map();
      let view;
      const snapshot = () => ({
        cache: { mode: "disabled" },
        query,
        layout: { kind: layout },
        meta: `Synthetic fixture · writes ${writes}`,
        filters: [
          { id: "layout", label: "Layout", value: layout, options: ["cards", "list", "gallery"].map((value) => ({ label: value, value })) },
          { id: "outcome", label: "Save result", value: outcome, options: ["saved", "error", "conflict", "readonly"].map((value) => ({ label: value, value })) },
        ],
        selectedId,
        items: rows.filter((row) => `${row.title} ${row.content}`.includes(query)).map((row, index) => ({
          id: row.id, title: row.title, subtitle: "Truncated preview — not the write source",
          card: { body: row.content, tags: ["fixture"], timestamp: `09/06 ${index}:00` },
          editor: outcome === "readonly" ? undefined : { rows: 6 },
          detail: { body: row.content },
        })),
      });
      const paint = () => { if (!dead) view?.update(snapshot()); };
      view = context.ui.mountWorkbench(snapshot(), {
        onQuery(value) { query = value; paint(); },
        onSelect(id) { selectedId = id; paint(); },
        onFilter(id, value) { if (id === "layout") layout = value; else outcome = value; paint(); },
        async onEdit(event) {
          const row = rows.find((candidate) => candidate.id === event.itemId);
          if (!row || dead) return { status: "error", message: "Fixture session unavailable" };
          if (event.phase === "start") {
            sessions.set(event.sessionId, row.id);
            return { status: "ready", value: row.content, revision: "fixture-revision" };
          }
          if (sessions.get(event.sessionId) !== row.id) return { status: "error", message: "Fixture identity mismatch" };
          if (event.phase === "input") return { status: "accepted" };
          if (event.phase === "cancel") { sessions.delete(event.sessionId); return { status: "cancelled" }; }
          if (outcome !== "saved") return { status: outcome === "conflict" ? "conflict" : "error", message: "Deliberate fixture failure; keep the draft" };
          row.content = event.value;
          writes += 1;
          sessions.delete(event.sessionId);
          paint();
          return { status: "saved", value: row.content };
        },
      });
      panels.set(container, () => { dead = true; sessions.clear(); view.destroy(); });
    },
    destroy(container) { panels.get(container)?.(); panels.delete(container); },
  },
};
