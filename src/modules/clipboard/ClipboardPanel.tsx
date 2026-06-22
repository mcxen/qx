import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useStore, type ClipboardEntry } from "../../store";

type Filter = "all" | "links" | "code" | "long";

const FILTER_LABELS: Record<Filter, string> = {
  all: "All Items",
  links: "Links",
  code: "Code",
  long: "Long Text",
};

function classify(item: ClipboardEntry): Exclude<Filter, "all"> | "text" {
  const text = item.text.trim();
  if (/^https?:\/\/\S+$/i.test(text)) return "links";
  if (
    /[{}[\];]/.test(text) ||
    /\b(function|const|let|class|import|SELECT|FROM|fn|pub)\b/.test(text)
  ) {
    return "code";
  }
  if (text.length > 280 || text.includes("\n")) return "long";
  return "text";
}

function sectionName(timestamp: string): string {
  const date = new Date(timestamp.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "Recent";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startItem = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((startToday - startItem) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "This Week";
  return "Older";
}

function preview(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatMeta(item: ClipboardEntry): string {
  const kind = classify(item);
  const lines = item.text.split(/\r?\n/).length;
  const count = item.text.length;
  const label = kind === "text" ? "Text" : FILTER_LABELS[kind];
  return `${label} - ${count} chars${lines > 1 ? ` - ${lines} lines` : ""}`;
}

export default function ClipboardPanel() {
  const { clipboardHistory, setClipboardHistory } = useStore();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    loadHistory();
    const unlisten = listen("clipboard-updated", () => loadHistory());
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const loadHistory = async () => {
    try {
      const res = await invoke<ClipboardEntry[]>("get_clipboard_history", {
        limit: 200,
      });
      setClipboardHistory(res);
    } catch {}
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clipboardHistory.filter((item) => {
      const kind = classify(item);
      const matchesFilter = filter === "all" || kind === filter;
      const matchesQuery = !q || item.text.toLowerCase().includes(q);
      return matchesFilter && matchesQuery;
    });
  }, [clipboardHistory, filter, query]);

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const selectedItem = filtered[selected];

  const grouped = useMemo(() => {
    const sections: { title: string; items: ClipboardEntry[] }[] = [];
    for (const item of filtered) {
      const title = sectionName(item.timestamp);
      const last = sections[sections.length - 1];
      if (last?.title === title) {
        last.items.push(item);
      } else {
        sections.push({ title, items: [item] });
      }
    }
    return sections;
  }, [filtered]);

  const copyItem = async (item?: ClipboardEntry) => {
    if (!item) return;
    try {
      await writeText(item.text);
    } catch {}
  };

  const deleteItem = async (item?: ClipboardEntry) => {
    if (!item) return;
    await invoke("delete_clipboard_entry", { id: item.id });
    const next = clipboardHistory.filter((entry) => entry.id !== item.id);
    setClipboardHistory(next);
    if (selected >= next.length) setSelected(Math.max(next.length - 1, 0));
  };

  const clearAll = async () => {
    await invoke("clear_clipboard_history");
    setClipboardHistory([]);
    setSelected(0);
    setDetailOpen(false);
  };

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && e.metaKey) {
      e.preventDefault();
      setDetailOpen(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      await copyItem(selectedItem);
    } else if ((e.key === "Backspace" || e.key === "Delete") && e.metaKey) {
      e.preventDefault();
      await deleteItem(selectedItem);
    } else if (e.key === "Escape") {
      if (detailOpen) setDetailOpen(false);
      else if (query) setQuery("");
    }
  };

  let flatIndex = 0;

  return (
    <div className="qx-raycast" onKeyDown={handleKeyDown}>
      <div className="qx-plugin-toolbar">
        <div className="qx-search-wrap">
          <span className="qx-search-icon" aria-hidden="true" />
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder="Search clipboard history..."
            className="qx-plugin-search"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setSelected(0);
          }}
          className="qx-plugin-dropdown"
          title="Filter clipboard history"
        >
          {(Object.keys(FILTER_LABELS) as Filter[]).map((id) => (
            <option key={id} value={id}>
              {FILTER_LABELS[id]}
            </option>
          ))}
        </select>
      </div>

      <div className="qx-plugin-body">
        <div className="qx-plugin-list" role="listbox" aria-label="Clipboard history">
          {grouped.map((section) => (
            <div key={section.title}>
              <div className="qx-section-header">
                <span style={{ flex: 1 }}>{section.title}</span>
                <span>{section.items.length}</span>
              </div>
              {section.items.map((item) => {
                const index = flatIndex++;
                const active = index === selected;
                return (
                  <button
                    key={item.id}
                    className={`qx-list-row${active ? " is-active" : ""}`}
                    onClick={() => {
                      setSelected(index);
                      setDetailOpen(true);
                    }}
                    onDoubleClick={() => copyItem(item)}
                    role="option"
                    aria-selected={active}
                  >
                    <span className="qx-list-icon">{classify(item) === "links" ? "URL" : "TXT"}</span>
                    <span className="qx-list-copy">
                      <span className="qx-list-title">{preview(item.text) || "Empty Text"}</span>
                      <span className="qx-list-subtitle">{formatMeta(item)}</span>
                    </span>
                    <span className="qx-list-time">{item.timestamp.slice(5, 16)}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="qx-empty-state">
              {clipboardHistory.length === 0 ? "No clipboard history yet" : "No matching items"}
            </div>
          )}
        </div>

        <div className="qx-plugin-detail">
          {selectedItem ? (
            <>
              <div className="qx-detail-header">
                <div>
                  <div className="qx-detail-title">{detailOpen ? "Detail" : "Preview"}</div>
                  <div className="qx-detail-meta">{selectedItem.timestamp}</div>
                </div>
                <button className="qx-icon-button" onClick={() => setDetailOpen((v) => !v)}>
                  {detailOpen ? "List" : "Open"}
                </button>
              </div>
              <pre className={detailOpen ? "qx-detail-content is-open" : "qx-detail-content"}>
                {selectedItem.text}
              </pre>
            </>
          ) : (
            <div className="qx-empty-state">Select an item to preview it</div>
          )}
        </div>

        <aside className="qx-action-panel" aria-label="Action panel">
          <div className="qx-action-title">ActionPanel</div>
          <button className="qx-action-item" onClick={() => copyItem(selectedItem)} disabled={!selectedItem}>
            <span>Copy to Clipboard</span>
            <kbd>↩</kbd>
          </button>
          <button
            className="qx-action-item"
            onClick={() => setDetailOpen(true)}
            disabled={!selectedItem}
          >
            <span>Open Detail</span>
            <kbd>⌘↩</kbd>
          </button>
          <button className="qx-action-item" onClick={() => deleteItem(selectedItem)} disabled={!selectedItem}>
            <span>Delete Item</span>
            <kbd>⌘⌫</kbd>
          </button>
          <button className="qx-action-item danger" onClick={clearAll} disabled={clipboardHistory.length === 0}>
            <span>Clear History</span>
          </button>
        </aside>
      </div>
    </div>
  );
}
