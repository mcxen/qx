import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useStore, type ClipboardEntry } from "../../store";
import QxShell from "../../components/QxShell";
import { Select } from "../../components/ui";
import { useEscBack } from "../../hooks/useEscBack";
import { pasteClipboardEntry, writeClipboardEntry } from "./actions";
import {
  classify,
  sectionName,
  preview,
  formatCopied,
  wordCount,
  contentType,
  matchesQuery,
} from "./utils";

type Filter = "all" | "pinned" | "links" | "code" | "long" | "frequent" | "image";

const FILTER_LABELS: Record<Filter, string> = {
  all: "All Types",
  pinned: "Pinned",
  links: "Links",
  code: "Code",
  long: "Long",
  frequent: "Frequent",
  image: "Images",
};

const IMAGE_CACHE = new Map<string, string>();
const IMAGE_CACHE_LIMIT = 120;

function imageMimeType(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  return "application/octet-stream";
}

function cacheImageUrl(path: string, url: string): void {
  const previous = IMAGE_CACHE.get(path);
  if (previous) URL.revokeObjectURL(previous);
  IMAGE_CACHE.set(path, url);
  while (IMAGE_CACHE.size > IMAGE_CACHE_LIMIT) {
    const oldest = IMAGE_CACHE.keys().next().value;
    if (!oldest) break;
    const oldUrl = IMAGE_CACHE.get(oldest);
    if (oldUrl) URL.revokeObjectURL(oldUrl);
    IMAGE_CACHE.delete(oldest);
  }
}

async function loadImageAsDataUrl(path: string): Promise<string> {
  const cached = IMAGE_CACHE.get(path);
  if (cached) return cached;
  const bytes = await invoke<number[]>("read_image_file", { path });
  const binary = Uint8Array.from(bytes);
  const blob = new Blob([binary], { type: imageMimeType(binary) });
  const url = URL.createObjectURL(blob);
  cacheImageUrl(path, url);
  return url;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export default function ClipboardPanel() {
  const { clipboardHistory, setClipboardHistory, setTab } = useStore();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  const loadHistory = async () => {
    try {
      const res = await invoke<ClipboardEntry[]>("get_clipboard_history", {
        limit: 200,
      });
      setClipboardHistory(res);
    } catch {}
  };

  useEffect(() => {
    loadHistory();
    // Try to read any image currently on the clipboard
    invoke("read_clipboard_image_now")
      .then((saved: unknown) => {
        if (saved) loadHistory();
      })
      .catch(() => {});
    if (!isTauriRuntime()) return;
    const unlisten = listen("clipboard-updated", () => loadHistory());
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = clipboardHistory.filter((item) => {
      const kind = classify(item);
      const matchesFilter =
        filter === "all" ||
        (filter === "pinned" && item.pinned) ||
        (filter === "frequent" && item.copy_count > 0) ||
        kind === filter;
      return matchesFilter && matchesQuery(item, q);
    });

    if (filter === "frequent") {
      return [...matches].sort((a, b) => {
        if (b.copy_count !== a.copy_count) return b.copy_count - a.copy_count;
        return Date.parse(b.timestamp.replace(" ", "T")) - Date.parse(a.timestamp.replace(" ", "T"));
      });
    }

    return matches;
  }, [clipboardHistory, filter, query]);

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  // Load clipboard images as data URLs (avoids asset protocol issues)
  useEffect(() => {
    const paths = filtered.filter((e) => e.image_path).map((e) => e.image_path!);
    const uniquePaths = [...new Set(paths)];
    const loadAll = async () => {
      const results: Record<string, string> = {};
      await Promise.all(
        uniquePaths.map(async (p) => {
          try {
            results[p] = await loadImageAsDataUrl(p);
          } catch {}
        }),
      );
      setImageUrls((prev) => ({ ...prev, ...results }));
    };
    void loadAll();
  }, [filtered]);

  useEffect(() => {
    const activePaths = new Set(clipboardHistory.map((entry) => entry.image_path).filter(Boolean));
    for (const [path, url] of IMAGE_CACHE) {
      if (!activePaths.has(path)) {
        URL.revokeObjectURL(url);
        IMAGE_CACHE.delete(path);
      }
    }
  }, [clipboardHistory]);

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
      await writeClipboardEntry(item);
      await loadHistory();
      setStatus("Copied");
      window.setTimeout(() => setStatus(""), 1200);
    } catch {}
  };

  const pasteItem = async (item?: ClipboardEntry, options: { focusAtCursor?: boolean } = {}) => {
    if (!item) return;
    try {
      setStatus("Pasting");
      await pasteClipboardEntry(item, options);
      await loadHistory();
      window.setTimeout(() => setStatus(""), 1200);
    } catch (err) {
      setStatus(String(err || "Paste failed"));
      window.setTimeout(() => setStatus(""), 1600);
    }
  };

  const deleteItem = async (item?: ClipboardEntry) => {
    if (!item) return;
    await invoke("delete_clipboard_entry", { id: item.id });
    const next = clipboardHistory.filter((entry) => entry.id !== item.id);
    setClipboardHistory(next);
    if (selected >= next.length) setSelected(Math.max(next.length - 1, 0));
  };

  const togglePin = async (item?: ClipboardEntry) => {
    if (!item) return;
    await invoke("toggle_clipboard_pin", { id: item.id });
    await loadHistory();
    setStatus(item.pinned ? "Unpinned" : "Pinned");
    window.setTimeout(() => setStatus(""), 1200);
  };

  const { onKeyDown: escKeyDown } = useEscBack({
    inner: { active: detailOpen, close: () => setDetailOpen(false) },
    query: { active: query.length > 0, clear: () => setQuery("") },
    launcher: () => setTab("launcher"),
  });

  const handleKeyDown = async (e: React.KeyboardEvent) => {
    escKeyDown(e);
    if (e.key === "Escape") return;
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
      await pasteItem(selectedItem, { focusAtCursor: true });
    } else if (e.key.toLowerCase() === "p" && e.metaKey) {
      e.preventDefault();
      await togglePin(selectedItem);
    } else if ((e.key === "Backspace" || e.key === "Delete") && e.metaKey) {
      e.preventDefault();
      await deleteItem(selectedItem);
    }
  };

  let flatIndex = 0;

  const searchSlot = (
        <div className="qx-clipboard-search-wrap">
          <span className="qx-search-icon" aria-hidden="true" />
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder="Type to filter entries..."
            className="qx-clipboard-search"
          />
        </div>
  );

  const trailing = (
    <>
      <Select
        value={filter}
        options={(Object.keys(FILTER_LABELS) as Filter[]).map((id) => ({
          value: id,
          label: FILTER_LABELS[id],
        }))}
        ariaLabel="Clipboard filter"
        className="qx-clipboard-filter"
        onChange={(next) => {
          setFilter(next);
          setSelected(0);
        }}
      />
      <div className="qx-clipboard-status" aria-live="polite">
        {status}
      </div>
    </>
  );

  return (
    <QxShell
      title="Clipboard History"
      search={searchSlot}
      trailing={trailing}
      onBack={() => setTab("launcher")}
      onKeyDown={handleKeyDown}
      className="qx-clipboard-shell"
      island={{
        label: status || "Clipboard History",
        detail: selectedItem
          ? `${contentType(selectedItem)} · ${FILTER_LABELS[filter]} · ${filtered.length} items`
          : `${FILTER_LABELS[filter]} · ${filtered.length} items`,
        tone: status ? "success" : "neutral",
      }}
      primaryAction={{
        label: "Paste",
        kbd: "Enter",
        disabled: !selectedItem,
        onClick: () => pasteItem(selectedItem),
      }}
      secondaryAction={{
        label: selectedItem?.pinned ? "Unpin" : "Pin",
        kbd: "Cmd P",
        disabled: !selectedItem,
        onClick: () => togglePin(selectedItem),
      }}
      actions={[
        {
          label: "Copy",
          kbd: "Cmd C",
          disabled: !selectedItem,
          onClick: () => copyItem(selectedItem),
        },
        {
          label: selectedItem?.pinned ? "Unpin" : "Pin",
          kbd: "Cmd P",
          disabled: !selectedItem,
          onClick: () => togglePin(selectedItem),
        },
        {
          label: "Delete",
          kbd: "Cmd Delete",
          disabled: !selectedItem,
          onClick: () => deleteItem(selectedItem),
        },
      ]}
    >
      <div className="qx-clipboard-body">
        <div className="qx-clipboard-list" role="listbox" aria-label="Clipboard history">
          {grouped.map((section) => (
            <div key={section.title}>
              <div className="qx-section-header">
                <span style={{ flex: 1 }}>{section.title}</span>
                <span>{section.items.length}</span>
              </div>
              {section.items.map((item) => {
                const index = flatIndex++;
                const active = index === selected;
                const kind = classify(item);
                const isImage = kind === "image";
                return (
                  <button
                    key={item.id}
                    className={`qx-list-row${active ? " is-active" : ""}`}
                    onClick={() => {
                      setSelected(index);
                      setDetailOpen(false);
                    }}
                    onDoubleClick={() => pasteItem(item)}
                    role="option"
                    aria-selected={active}
                  >
                    <span className="qx-clipboard-row-icon" aria-hidden="true">
                      <span
                        className={`qx-symbol-icon ${
                          isImage ? "image" : item.pinned ? "pin" : kind === "links" ? "link" : kind === "code" ? "code" : "doc"
                        }`}
                      />
                    </span>
                    <span className="qx-clipboard-row-copy">
                      <span className="qx-clipboard-row-title">
                        {item.pinned && <span className="qx-clipboard-pin-dot" />}
                        {isImage ? (
                          <img
                            className="qx-clipboard-thumb"
                            src={imageUrls[item.image_path!] || ""}
                            alt="Clipboard image"
                          />
                        ) : (
                          preview(item.text) || "Empty Text"
                        )}
                      </span>
                    </span>
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

        <div className="qx-clipboard-detail">
          {selectedItem ? (
            <>
              {selectedItem.image_path ? (
                <div className="qx-clipboard-image-wrap">
                  <img
                    className="qx-clipboard-image-preview"
                    src={imageUrls[selectedItem.image_path] || ""}
                    alt="Clipboard image"
                  />
                </div>
              ) : (
                <pre
                  className={`qx-clipboard-content${detailOpen ? " is-expanded" : ""}`}
                >
                  {selectedItem.text}
                </pre>
              )}
              <div className="qx-clipboard-info">
                <h2>Information</h2>
                <dl>
                  <div>
                    <dt>Content type</dt>
                    <dd>{contentType(selectedItem)}</dd>
                  </div>
                  {!selectedItem.image_path && (
                    <>
                      <div>
                        <dt>Characters</dt>
                        <dd>{selectedItem.text.length.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Words</dt>
                        <dd>{wordCount(selectedItem.text).toLocaleString()}</dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt>Copied</dt>
                    <dd>{formatCopied(selectedItem.timestamp)}</dd>
                  </div>
                </dl>
              </div>
            </>
          ) : (
            <div className="qx-empty-state">Select an item to preview</div>
          )}
        </div>
      </div>
    </QxShell>
  );
}
