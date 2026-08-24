import { useEffect, useMemo, useState } from "react";
import PluginWorkbenchView from "../plugin/PluginWorkbenchView";
import { Button, Input } from "../components/ui";
import type { PluginWorkbenchItem } from "../plugin/workbenchTypes";

const ITEM_COUNT = 10_000;
const SHOW_ARTICLE_DETAIL = new URLSearchParams(window.location.search).get("fixture") === "article-detail";

const ARTICLE_DETAIL_FIXTURE = {
  title: "Workbench article metadata fixture",
  subtitle: "空愁居 · 2026年8月23日 21:26",
  body: "A deterministic reading detail used to verify host-owned article metadata layout.",
  fields: [
    { label: "作者", value: "空愁居" },
    { label: "点赞", value: 0 },
    { label: "评论", value: 0 },
    { label: "转发", value: 1 },
    { label: "发布时间", value: "2026年8月23日 21:26" },
    { label: "来源", value: "微博网页版" },
    { label: "地区", value: "发布于 加拿大" },
  ],
};

const ALL_ITEMS: PluginWorkbenchItem[] = Array.from({ length: ITEM_COUNT }, (_, index) => ({
  id: `workbench-perf-${index}`,
  title: index % 127 === 0 ? `Search target ${index}` : `Workbench item ${index}`,
  subtitle: `Synthetic plugin row ${index}`,
  meta: `${index + 1}`,
  icon: "•",
}));

export default function WorkbenchPerformanceLab() {
  const [layout, setLayout] = useState<"list" | "gallery">("list");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(ALL_ITEMS[0].id);

  useEffect(() => {
    if (!input) {
      setQuery("");
      return;
    }
    const timer = window.setTimeout(() => setQuery(input), 140);
    return () => window.clearTimeout(timer);
  }, [input]);

  const items = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return ALL_ITEMS;
    return ALL_ITEMS.filter((item) => (
      `${item.title}\0${item.subtitle || ""}`.toLocaleLowerCase().includes(needle)
    ));
  }, [query]);

  useEffect(() => {
    if (!items.some((item) => item.id === selectedId)) {
      setSelectedId(items[0]?.id || "");
    }
  }, [items, selectedId]);

  const moveSelection = (target: number) => {
    const index = Math.max(0, Math.min(items.length - 1, target));
    setSelectedId(items[index]?.id || "");
  };

  return (
    <main
      className="qx-workbench-performance-lab"
      data-qx-workbench-performance-lab
      onKeyDown={(event) => {
        if (event.target instanceof HTMLInputElement) return;
        const current = Math.max(0, items.findIndex((item) => item.id === selectedId));
        if (event.key === "Home") moveSelection(0);
        else if (event.key === "End") moveSelection(items.length - 1);
        else if (event.key === "ArrowDown") moveSelection(current + 1);
        else if (event.key === "ArrowUp") moveSelection(current - 1);
        else return;
        event.preventDefault();
      }}
    >
      <header className="qx-workbench-performance-toolbar">
        <Button type="button" data-perf-layout="list" onClick={() => setLayout("list")}>List</Button>
        <Button type="button" data-perf-layout="gallery" onClick={() => setLayout("gallery")}>Gallery</Button>
        <Input
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          placeholder="Search 10,000 synthetic rows"
          aria-label="Workbench performance search"
          data-perf-search
        />
        <output data-perf-count>{items.length}</output>
        <output data-perf-selected>{selectedId}</output>
      </header>
      <section className="qx-workbench-performance-surface" tabIndex={0} data-perf-surface>
        <PluginWorkbenchView
          pluginId="dev-workbench-performance"
          state={{
            revision: query ? 2 : 1,
            title: "Workbench Performance",
            query,
            layout: layout === "gallery"
              ? { kind: "gallery", columns: 5, aspectRatio: "landscape" }
              : { kind: "list" },
            items,
            selectedId,
            detail: SHOW_ARTICLE_DETAIL ? ARTICLE_DETAIL_FIXTURE : undefined,
          }}
          detailOpen={SHOW_ARTICLE_DETAIL}
          onActivate={setSelectedId}
          onInput={() => {}}
          onAction={() => {}}
          onDownload={() => {}}
        />
      </section>
    </main>
  );
}
