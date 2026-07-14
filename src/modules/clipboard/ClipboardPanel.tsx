import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { LucideIcon } from "lucide-react";
import { AlignLeft, Code2, File, FileText, Image, Link, Pin, Shrink, Video } from "lucide-react";
import { useStore, type ClipboardEntry } from "../../store";
import QxShell from "../../components/QxShell";
import { Select } from "../../components/ui";
import { useEscBack } from "../../hooks/useEscBack";
import { useLocale, useT } from "../../i18n";
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

type Filter = "all" | "pinned" | "links" | "code" | "long" | "frequent" | "image" | "file";

const FILTER_KEYS: Record<Filter, { key: string; fallback: string }> = {
  all: { key: "clipboard.filter.all", fallback: "All Types" },
  pinned: { key: "clipboard.filter.pinned", fallback: "Pinned" },
  links: { key: "clipboard.filter.links", fallback: "Links" },
  code: { key: "clipboard.filter.code", fallback: "Code" },
  long: { key: "clipboard.filter.long", fallback: "Long" },
  frequent: { key: "clipboard.filter.frequent", fallback: "Frequent" },
  image: { key: "clipboard.filter.image", fallback: "Images" },
  file: { key: "clipboard.filter.file", fallback: "Files" },
};

type ClipboardIconKind = ReturnType<typeof classify> | "pin";

const CLIPBOARD_TYPE_ICONS: Record<ClipboardIconKind, LucideIcon> = {
  pinned: Pin,
  pin: Pin,
  links: Link,
  code: Code2,
  long: AlignLeft,
  frequent: FileText,
  image: Image,
  file: File,
  text: FileText,
};

const IMAGE_CACHE = new Map<string, string>();
const IMAGE_CACHE_LIMIT = 120;

interface FileMetadata {
  path: string;
  name: string;
  extension: string;
  kind: "image" | "video" | "audio" | "folder" | "file";
  size: number;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
  preview_path?: string | null;
}

interface MediaProgress {
  jobId: string;
  operation: string;
  progress: number;
  message: string;
  outputPath?: string | null;
  error?: string | null;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unit]}`;
}

function formatDuration(value?: number | null): string {
  if (!value) return "—";
  const seconds = Math.round(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

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

function ClipboardTypeIcon({ item }: { item: ClipboardEntry }) {
  const kind: ClipboardIconKind = item.pinned ? "pin" : classify(item);
  const Icon = CLIPBOARD_TYPE_ICONS[kind] ?? FileText;
  return (
    <Icon
      className={`qx-clipboard-type-icon is-${kind}`}
      size={15}
      strokeWidth={2.1}
      aria-hidden="true"
    />
  );
}

export default function ClipboardPanel() {
  const t = useT();
  const locale = useLocale();
  const { clipboardHistory, setClipboardHistory, setTab } = useStore();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [fileMetadata, setFileMetadata] = useState<FileMetadata | null>(null);
  const [mediaProgress, setMediaProgress] = useState<MediaProgress | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filterLabel = (id: Filter) => t(FILTER_KEYS[id].key, FILTER_KEYS[id].fallback);

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

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>("[role='option'][aria-selected='true']")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

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

  useEffect(() => {
    const path = selectedItem?.file_path;
    setFileMetadata(null);
    if (!path) return;
    let cancelled = false;
    invoke<FileMetadata>("clipboard_file_metadata", { path })
      .then((metadata) => { if (!cancelled) setFileMetadata(metadata); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedItem?.file_path]);

  useEffect(() => {
    const previewPath = fileMetadata?.preview_path;
    if (!previewPath || imageUrls[previewPath]) return;
    void loadImageAsDataUrl(previewPath)
      .then((url) => setImageUrls((current) => ({ ...current, [previewPath]: url })))
      .catch(() => {});
  }, [fileMetadata?.preview_path, imageUrls]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen<MediaProgress>("clipboard-media-progress", ({ payload }) => {
      setMediaProgress(payload);
      setStatus(payload.error ? payload.error : payload.message);
      if (payload.progress >= 100 || payload.error) {
        void loadHistory();
        window.setTimeout(() => setMediaProgress(null), 1800);
      }
    });
    return () => { unlisten.then((dispose) => dispose()); };
  }, []);

  const grouped = useMemo(() => {
    const sections: { title: string; items: ClipboardEntry[] }[] = [];
    for (const item of filtered) {
      const title = sectionName(item.timestamp, t);
      const last = sections[sections.length - 1];
      if (last?.title === title) {
        last.items.push(item);
      } else {
        sections.push({ title, items: [item] });
      }
    }
    return sections;
  }, [filtered, t]);

  const copyItem = async (item?: ClipboardEntry) => {
    if (!item) return;
    try {
      await writeClipboardEntry(item);
      await loadHistory();
      setStatus(t("clipboard.copied", "Copied"));
      window.setTimeout(() => setStatus(""), 1200);
    } catch {}
  };

  const pasteItem = async (item?: ClipboardEntry, options: { focusAtCursor?: boolean } = {}) => {
    if (!item) return;
    try {
      setStatus(t("clipboard.pasting", "Pasting"));
      await pasteClipboardEntry(item, options);
      await loadHistory();
      window.setTimeout(() => setStatus(""), 1200);
    } catch (err) {
      setStatus(String(err || t("clipboard.pasteFailed", "Paste failed")));
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
    setStatus(item.pinned ? t("clipboard.unpinned", "Unpinned") : t("clipboard.pinned", "Pinned"));
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
    if (e.key === "Enter" && e.metaKey) {
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

  const startMediaTask = async (operation: "compress" | "gif") => {
    if (!selectedItem?.file_path || mediaProgress) return;
    const startMessage = operation === "compress"
      ? t("clipboard.startingCompress", "Starting compression")
      : t("clipboard.startingGif", "Starting GIF conversion");
    setStatus(startMessage);
    try {
      const jobId = await invoke<string>(operation === "compress" ? "clipboard_compress_image" : "clipboard_video_to_gif", {
        path: selectedItem.file_path,
        quality: operation === "compress" ? 78 : undefined,
      });
      setMediaProgress((current) => current?.jobId === jobId ? current : ({
          jobId,
          operation,
          progress: 0,
          message: startMessage,
        }));
    } catch (error) {
      setStatus(String(error));
    }
  };

  let flatIndex = 0;

  const searchSlot = (
        <div className="qx-search-wrap qx-clipboard-search-wrap">
          <span className="qx-search-icon" aria-hidden="true" />
          <input
            type="text"
            value={query}
            autoFocus
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            placeholder={t("clipboard.placeholder", "Type to filter entries...")}
            className="qx-plugin-search qx-clipboard-search"
          />
        </div>
  );

  const itemCountLabel = t("clipboard.items", "{n} items").replace("{n}", String(filtered.length));

  const trailing = (
    <>
      <Select
        value={filter}
        options={(Object.keys(FILTER_KEYS) as Filter[]).map((id) => ({
          value: id,
          label: filterLabel(id),
        }))}
        ariaLabel={t("clipboard.filter", "Clipboard filter")}
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
      title={t("clipboard.title", "Clipboard History")}
      search={searchSlot}
      trailing={trailing}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: () => setTab("launcher") }}
      onKeyDown={handleKeyDown}
      navigation={{
        index: selected,
        count: filtered.length,
        onChange: (index) => { setSelected(index); setDetailOpen(false); },
        onOpen: () => setDetailOpen(true),
        onClose: () => setDetailOpen(false),
      }}
      className="qx-clipboard-shell"
      island={{
        label: mediaProgress?.message || status || t("clipboard.title", "Clipboard History"),
        detail: selectedItem
          ? `${contentType(selectedItem, t)} · ${filterLabel(filter)} · ${itemCountLabel}`
          : `${filterLabel(filter)} · ${itemCountLabel}`,
        progress: mediaProgress ? mediaProgress.progress : undefined,
        tone: mediaProgress?.error ? "danger" : status ? "success" : "neutral",
      }}
      primaryAction={{
        label: t("clipboard.paste", "Paste"),
        kbd: "Enter",
        disabled: !selectedItem,
        onClick: () => pasteItem(selectedItem),
      }}
      secondaryAction={{
        label: selectedItem?.pinned ? t("clipboard.unpin", "Unpin") : t("clipboard.pin", "Pin"),
        kbd: "Cmd P",
        disabled: !selectedItem,
        onClick: () => togglePin(selectedItem),
      }}
      actions={[
        {
          label: t("clipboard.copy", "Copy"),
          kbd: "Cmd C",
          disabled: !selectedItem,
          onClick: () => copyItem(selectedItem),
        },
        {
          label: selectedItem?.pinned ? t("clipboard.unpin", "Unpin") : t("clipboard.pin", "Pin"),
          kbd: "Cmd P",
          disabled: !selectedItem,
          onClick: () => togglePin(selectedItem),
        },
        {
          label: t("clipboard.delete", "Delete"),
          kbd: "Cmd Delete",
          disabled: !selectedItem,
          onClick: () => deleteItem(selectedItem),
        },
        {
          label: t("clipboard.compressImage", "Compress Image"),
          kbd: "Cmd Shift C",
          disabled: fileMetadata?.kind !== "image" || Boolean(mediaProgress),
          onClick: () => void startMediaTask("compress"),
        },
        {
          label: t("clipboard.videoToGif", "Video to GIF"),
          kbd: "Cmd Shift G",
          disabled: fileMetadata?.kind !== "video" || Boolean(mediaProgress),
          onClick: () => void startMediaTask("gif"),
        },
      ]}
    >
      <div className="qx-clipboard-body">
        <div ref={listRef} className="qx-clipboard-list" role="listbox" aria-label={t("clipboard.listAria", "Clipboard history")}>
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
                      <ClipboardTypeIcon item={item} />
                    </span>
                    <span className="qx-clipboard-row-copy">
                      <span className="qx-clipboard-row-title">
                        {item.pinned && <span className="qx-clipboard-pin-dot" />}
                        {isImage ? (
                          <img
                            className="qx-clipboard-thumb"
                            src={imageUrls[item.image_path!] || ""}
                            alt={t("clipboard.imageAlt", "Clipboard image")}
                          />
                        ) : item.file_path ? (
                          item.file_path.split("/").pop() || item.file_path
                        ) : (
                          preview(item.text) || t("clipboard.emptyText", "Empty Text")
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
              {clipboardHistory.length === 0
                ? t("clipboard.emptyHistory", "No clipboard history yet")
                : t("clipboard.noMatch", "No matching items")}
            </div>
          )}
        </div>

        <div className="qx-clipboard-detail">
          {selectedItem ? (
            <>
              {selectedItem.file_path ? (
                <div className="qx-clipboard-file-preview">
                  {fileMetadata?.preview_path && imageUrls[fileMetadata.preview_path] ? (
                    <img
                      className="qx-clipboard-image-preview"
                      src={imageUrls[fileMetadata.preview_path]}
                      alt={fileMetadata.name}
                    />
                  ) : (
                    <div className="qx-clipboard-file-placeholder">
                      {fileMetadata?.kind === "video" ? <Video size={42} /> : <File size={42} />}
                      <strong>{fileMetadata?.name ?? t("clipboard.loadingFile", "Loading file…")}</strong>
                    </div>
                  )}
                </div>
              ) : selectedItem.image_path ? (
                <div className="qx-clipboard-image-wrap">
                  <img
                    className="qx-clipboard-image-preview"
                    src={imageUrls[selectedItem.image_path] || ""}
                    alt={t("clipboard.imageAlt", "Clipboard image")}
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
                <h2>{t("clipboard.info", "Information")}</h2>
                <dl>
                  <div>
                    <dt>{t("clipboard.contentType", "Content type")}</dt>
                    <dd>{contentType(selectedItem, t)}</dd>
                  </div>
                  {!selectedItem.image_path && !selectedItem.file_path && (
                    <>
                      <div>
                        <dt>{t("clipboard.characters", "Characters")}</dt>
                        <dd>{selectedItem.text.length.toLocaleString(locale)}</dd>
                      </div>
                      <div>
                        <dt>{t("clipboard.words", "Words")}</dt>
                        <dd>{wordCount(selectedItem.text).toLocaleString(locale)}</dd>
                      </div>
                    </>
                  )}
                  {selectedItem.file_path && fileMetadata && (
                    <>
                      <div><dt>{t("clipboard.file", "File")}</dt><dd title={fileMetadata.path}>{fileMetadata.name}</dd></div>
                      <div><dt>{t("clipboard.kind", "Kind")}</dt><dd>{fileMetadata.kind}{fileMetadata.extension ? ` · ${fileMetadata.extension.toUpperCase()}` : ""}</dd></div>
                      <div><dt>{t("clipboard.size", "Size")}</dt><dd>{formatBytes(fileMetadata.size)}</dd></div>
                      {fileMetadata.width && fileMetadata.height && <div><dt>{t("clipboard.dimensions", "Dimensions")}</dt><dd>{fileMetadata.width} × {fileMetadata.height}</dd></div>}
                      {fileMetadata.duration_seconds && <div><dt>{t("clipboard.duration", "Duration")}</dt><dd>{formatDuration(fileMetadata.duration_seconds)}</dd></div>}
                      {fileMetadata.kind === "image" && <div><dt>{t("clipboard.quickAction", "Quick action")}</dt><dd><button className="qx-inline-action" onClick={() => void startMediaTask("compress")} disabled={Boolean(mediaProgress)}><Shrink size={13} /> {t("clipboard.compress", "Compress")}</button></dd></div>}
                      {fileMetadata.kind === "video" && <div><dt>{t("clipboard.quickAction", "Quick action")}</dt><dd><button className="qx-inline-action" onClick={() => void startMediaTask("gif")} disabled={Boolean(mediaProgress)}><Video size={13} /> {t("clipboard.convertGif", "Convert to GIF")}</button></dd></div>}
                    </>
                  )}
                  <div>
                    <dt>{t("clipboard.copiedAt", "Copied")}</dt>
                    <dd>{formatCopied(selectedItem.timestamp, locale, t)}</dd>
                  </div>
                </dl>
              </div>
            </>
          ) : (
            <div className="qx-empty-state">{t("clipboard.selectPreview", "Select an item to preview")}</div>
          )}
        </div>
      </div>
    </QxShell>
  );
}
