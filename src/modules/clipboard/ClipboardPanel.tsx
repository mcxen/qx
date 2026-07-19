import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { LucideIcon } from "lucide-react";
import { AlignLeft, AudioLines, CalendarDays, Code2, File, FileText, Folder, Image, Link, Pin, Shrink, Video } from "lucide-react";
import { useStore, type ClipboardEntry } from "../../store";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import {
  Calendar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  type CalendarRange,
} from "../../components/ui";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { useLocale, useT } from "../../i18n";
import { setPendingModuleLaunch, takePendingModuleLaunch } from "../../search/moduleSurfaces";
import {
  clearClipboardRestore,
  ensureClipboardRestoreOnHide,
  pasteClipboardEntry,
  queueClipboardRestore,
  writeClipboardEntry,
} from "./actions";
import {
  classify,
  clipboardFileKind,
  dateKey,
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

type ClipboardIconKind = ReturnType<typeof classify> | "pin" | "video" | "audio" | "pdf" | "folder";

const CLIPBOARD_TYPE_ICONS: Record<ClipboardIconKind, LucideIcon> = {
  pinned: Pin,
  pin: Pin,
  links: Link,
  code: Code2,
  long: AlignLeft,
  frequent: FileText,
  image: Image,
  video: Video,
  audio: AudioLines,
  pdf: FileText,
  folder: Folder,
  file: File,
  text: FileText,
};

const IMAGE_CACHE = new Map<string, string>();
const IMAGE_CACHE_LIMIT = 120;

interface FileMetadata {
  path: string;
  name: string;
  extension: string;
  kind: "image" | "video" | "audio" | "folder" | "file" | "pdf";
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

function extensionOf(path: string): string {
  const base = path.split(/[/\\]/).pop() || path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Optimistic kind from path only — paints Information immediately. */
function guessFileKind(path: string): FileMetadata["kind"] {
  return clipboardFileKind(path);
}

function optimisticFileMeta(path: string): FileMetadata {
  const name = path.split(/[/\\]/).pop() || path;
  const extension = extensionOf(path);
  return {
    path,
    name,
    extension,
    kind: guessFileKind(path),
    size: 0,
  };
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function ClipboardTypeIcon({ item }: { item: ClipboardEntry }) {
  const kind: ClipboardIconKind = item.pinned
    ? "pin"
    : item.file_path
      ? item.file_kind || clipboardFileKind(item.file_path)
      : classify(item);
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
  const [dateFilter, setDateFilter] = useState<CalendarRange>({ from: null, to: null });
  const [datePopoverSection, setDatePopoverSection] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [status, setStatus] = useState("");
  const [islandEffectNonce, setIslandEffectNonce] = useState(0);
  const [pasteTargetName, setPasteTargetName] = useState("");
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [fileMetadata, setFileMetadata] = useState<FileMetadata | null>(null);
  /** Right-pane file/PDF/video preview — loaded async, independent of list selection. */
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [filePreviewError, setFilePreviewError] = useState<string | null>(null);
  const [mediaProgress, setMediaProgress] = useState<MediaProgress | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const preserveSelectionId = useRef<string | null>(null);

  const filterLabel = (id: Filter) => t(FILTER_KEYS[id].key, FILTER_KEYS[id].fallback);

  const loadHistory = async (): Promise<ClipboardEntry[]> => {
    try {
      const res = await invoke<ClipboardEntry[]>("get_clipboard_history", {
        limit: 200,
      });
      setClipboardHistory(res);
      return res;
    } catch {
      return [];
    }
  };

  useEffect(() => {
    ensureClipboardRestoreOnHide();
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

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    const refreshTarget = () => {
      void invoke<string | null>("floating_previous_app_name")
        .then((name) => {
          if (!cancelled) setPasteTargetName(name?.trim() || "");
        })
        .catch(() => {
          if (!cancelled) setPasteTargetName("");
        });
    };
    refreshTarget();
    const unlisten = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) refreshTarget();
    });
    return () => {
      cancelled = true;
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  // Deep launch from main search: select a history item by id once list is ready.
  const pendingClipboardId = useRef<string | null>(null);
  useEffect(() => {
    const launch = takePendingModuleLaunch("clipboard");
    if (!launch || launch.surface !== "item") return;
    const id = String(launch.params?.id || "");
    if (id) pendingClipboardId.current = id;
  }, []);

  useEffect(() => {
    const pendingId = pendingClipboardId.current;
    if (!pendingId || clipboardHistory.length === 0) return;
    const index = clipboardHistory.findIndex((item) => item.id === pendingId);
    if (index >= 0) {
      const item = clipboardHistory[index];
      setSelected(index);
      setFilter("all");
      setQuery("");
      // Deep-link into a history row is an explicit pick — restore on hide.
      if (item) queueClipboardRestore(item);
    }
    pendingClipboardId.current = null;
  }, [clipboardHistory]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = clipboardHistory.filter((item) => {
      const kind = classify(item);
      const matchesFilter =
        filter === "all" ||
        (filter === "pinned" && item.pinned) ||
        (filter === "frequent" && item.copy_count > 0) ||
        kind === filter;
      const itemDate = dateKey(item.timestamp);
      const matchesDate =
        (!dateFilter.from || itemDate >= dateFilter.from) &&
        (!dateFilter.to || itemDate <= dateFilter.to);
      return matchesFilter && matchesDate && matchesQuery(item, q);
    });

    if (filter === "frequent") {
      return [...matches].sort((a, b) => {
        if (b.copy_count !== a.copy_count) return b.copy_count - a.copy_count;
        return Date.parse(b.timestamp.replace(" ", "T")) - Date.parse(a.timestamp.replace(" ", "T"));
      });
    }

    return matches;
  }, [clipboardHistory, dateFilter, filter, query]);

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  useEffect(() => {
    const id = preserveSelectionId.current;
    if (!id) return;
    const nextIndex = filtered.findIndex((item) => item.id === id);
    if (nextIndex >= 0) {
      setSelected(nextIndex);
      preserveSelectionId.current = null;
    }
  }, [filtered]);

  // Selection chrome (is-active) + keyboard scroll follow — shared with Launcher.
  const { getItemProps } = useQxListSelection({
    listRef,
    index: selected,
    listSignature: filtered.map((item) => item.id).join("\0"),
  });

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
    const activePaths = new Set([
      ...clipboardHistory.map((entry) => entry.image_path).filter(Boolean),
      fileMetadata?.preview_path,
    ].filter(Boolean));
    for (const [path, url] of IMAGE_CACHE) {
      if (!activePaths.has(path)) {
        URL.revokeObjectURL(url);
        IMAGE_CACHE.delete(path);
      }
    }
  }, [clipboardHistory, fileMetadata?.preview_path]);

  const selectedItem = filtered[selected];
  const isEditing = Boolean(selectedItem && editingId === selectedItem.id);
  const hasDraftChanges = isEditing && draftText !== selectedItem?.text;

  useEffect(() => {
    if (editingId && editingId !== selectedItem?.id) {
      setEditingId(null);
      setDraftText("");
    }
  }, [editingId, selectedItem?.id]);

  // Information paints immediately from the path; size/dims/preview fill in async.
  useEffect(() => {
    const path = selectedItem?.file_path;
    setFilePreviewUrl(null);
    setFilePreviewError(null);
    setFilePreviewLoading(false);
    if (!path) {
      setFileMetadata(null);
      return;
    }

    let cancelled = false;
    // 0) Sync optimistic row — Information never waits on IPC for name/kind.
    setFileMetadata(optimisticFileMeta(path));

    // 1) Fast stat (size + confirmed kind) — no image decode / ffmpeg / QL.
    void invoke<FileMetadata>("clipboard_file_metadata", { path })
      .then((metadata) => {
        if (cancelled) return;
        setFileMetadata((current) => ({
          ...metadata,
          // Keep any probe fields that arrived first (unlikely but safe).
          width: current?.width ?? metadata.width,
          height: current?.height ?? metadata.height,
          duration_seconds: current?.duration_seconds ?? metadata.duration_seconds,
          preview_path: current?.preview_path ?? metadata.preview_path,
        }));
      })
      .catch(() => {
        /* keep optimistic */
      });

    // Delay expensive preview/probe work until keyboard navigation settles. The
    // Rust side also admits at most one preview/probe worker at a time.
    setFilePreviewLoading(true);
    let previewRetryTimer: number | null = null;
    const loadFilePreview = (attempt: number) => {
      // 2) Preview thumbnail asynchronously (image / video frame / PDF page).
      void invoke<string | null>("clipboard_file_preview", { path })
        .then(async (previewPath) => {
          if (cancelled) return;
          if (!previewPath) {
            setFilePreviewLoading(false);
            return;
          }
          const previewUrl = await loadImageAsDataUrl(previewPath);
          if (cancelled) return;
          setFilePreviewUrl(previewUrl);
          setFileMetadata((current) =>
            current ? { ...current, preview_path: previewPath } : current,
          );
          setFilePreviewLoading(false);
        })
        .catch((error) => {
          if (
            !cancelled &&
            String(error).includes("preview worker busy") &&
            attempt < 12
          ) {
            previewRetryTimer = window.setTimeout(() => loadFilePreview(attempt + 1), 300);
            return;
          }
          if (!cancelled) {
            setFilePreviewLoading(false);
            setFilePreviewError(t("clipboard.previewFailed", "Preview unavailable"));
          }
        });
    };

    const heavyTimer = window.setTimeout(() => {
      loadFilePreview(0);

      // 3) Dimensions / duration — slow path, never blocks Information.
      void invoke<FileMetadata>("clipboard_file_media_probe", { path })
        .then((probed) => {
          if (cancelled) return;
          setFileMetadata((current) => {
            if (!current) return probed;
            const same =
              current.path === probed.path ||
              current.path === path ||
              probed.path.endsWith(current.name);
            if (!same) return current;
            return {
              ...current,
              ...probed,
              size: probed.size || current.size,
              width: probed.width ?? current.width,
              height: probed.height ?? current.height,
              duration_seconds: probed.duration_seconds ?? current.duration_seconds,
              preview_path: probed.preview_path ?? current.preview_path,
            };
          });
        })
        .catch(() => {});
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(heavyTimer);
      if (previewRetryTimer !== null) window.clearTimeout(previewRetryTimer);
    };
  }, [selectedItem?.file_path, t]);

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

  const availableDateBounds = useMemo(() => {
    const dates = clipboardHistory.map((item) => dateKey(item.timestamp)).filter(Boolean).sort();
    return { min: dates[0] ?? null, max: dates[dates.length - 1] ?? null };
  }, [clipboardHistory]);

  const formatDateChoice = (value: string) => {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
  };

  const dateFilterLabel = useMemo(() => {
    if (!dateFilter.from) return null;
    if (!dateFilter.to || dateFilter.to === dateFilter.from) return formatDateChoice(dateFilter.from);
    return `${formatDateChoice(dateFilter.from)} – ${formatDateChoice(dateFilter.to)}`;
  }, [dateFilter, locale]);

  const recentRange = (days: number): CalendarRange => {
    const max = availableDateBounds.max ?? dateKey(new Date().toISOString());
    const from = new Date(`${max}T00:00:00`);
    from.setDate(from.getDate() - (days - 1));
    const first = dateKey(from.toISOString());
    return {
      from: availableDateBounds.min && first < availableDateBounds.min ? availableDateBounds.min : first,
      to: max,
    };
  };

  const selectItem = (item: ClipboardEntry, index: number) => {
    preserveSelectionId.current = item.id;
    setSelected(index);
    setDetailOpen(false);
    if (editingId && editingId !== item.id) discardTextEdit();
    // Do not write the system pasteboard while the shell is open — that reloads
    // history (timestamp / copy_count) and jumps the list under the selection.
    // Queue restore; flush when the main window loses focus / hides.
    queueClipboardRestore(item);
  };

  const copyItem = async (item?: ClipboardEntry) => {
    if (!item) return;
    try {
      // Explicit Copy is intentional: write now, skip deferred restore.
      clearClipboardRestore();
      preserveSelectionId.current = item.id;
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

  const beginTextEdit = (item?: ClipboardEntry) => {
    if (!item || item.image_path || item.file_path) return;
    setEditingId(item.id);
    setDraftText(item.text);
    setDetailOpen(true);
  };

  const discardTextEdit = () => {
    setEditingId(null);
    setDraftText("");
  };

  const saveTextEdit = async () => {
    if (!selectedItem || !hasDraftChanges) return;
    try {
      await invoke("update_clipboard_text_entry", { id: selectedItem.id, text: draftText });
      await loadHistory();
      discardTextEdit();
      setIslandEffectNonce((value) => value + 1);
      setStatus(t("clipboard.edit.saved", "Changes saved"));
      window.setTimeout(() => setStatus(""), 1400);
    } catch (error) {
      setStatus(String(error));
    }
  };

  const saveTextEditAsNew = async () => {
    if (!hasDraftChanges) return;
    try {
      const id = await invoke<string>("create_clipboard_text_entry", { text: draftText });
      pendingClipboardId.current = id;
      setFilter("all");
      setDateFilter({ from: null, to: null });
      setQuery("");
      discardTextEdit();
      await loadHistory();
      setIslandEffectNonce((value) => value + 1);
      setStatus(t("clipboard.edit.savedAsNew", "Saved as a new item"));
      window.setTimeout(() => setStatus(""), 1400);
    } catch (error) {
      setStatus(String(error));
    }
  };

  /** Create a new Text Toolbox file with this entry’s text and open documents. */
  const importToTextTool = async (item?: ClipboardEntry) => {
    if (!item?.text?.trim()) {
      setStatus(t("clipboard.importDocs.needText", "Only text clipboard items can be imported"));
      window.setTimeout(() => setStatus(""), 1600);
      return;
    }
    const text = item.text;
    if (text.length > 1_500_000) {
      setStatus(t("clipboard.importDocs.tooLarge", "Text too large for Text Toolbox (~1.5 MB max)"));
      window.setTimeout(() => setStatus(""), 1600);
      return;
    }
    try {
      setStatus(t("clipboard.importDocs.working", "Opening Text Toolbox…"));
      setPendingModuleLaunch({
        tab: "documents",
        surface: "import",
        params: {
          content: text,
          title: text.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 48) ?? "",
        },
      });
      setTab("documents");
    } catch (err) {
      setStatus(String(err || t("clipboard.importDocs.failed", "Import failed")));
      window.setTimeout(() => setStatus(""), 1600);
    }
  };

  const leave = useCallback(() => setTab("launcher"), [setTab]);

  const handleModuleKeys = useCallback(async (e: React.KeyboardEvent) => {
    if (isEditing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (e.shiftKey) await saveTextEditAsNew();
      else await saveTextEdit();
      return;
    }
    if (e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable) {
      return;
    }
    // Chord actions (⌘C / ⌘P / ⌘⌫ / …) are owned by QxShell action matching so
    // they work both with the Actions panel open and while search is focused.
    // Keep Enter here so paste still wins over shell chrome when typing in search.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      // Raycast-style alternate: ⌘↵ copies the selected item (detail is →).
      e.preventDefault();
      await copyItem(selectedItem);
      return;
    }
    if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      await pasteItem(selectedItem, { focusAtCursor: true });
    }
  }, [copyItem, isEditing, pasteItem, saveTextEdit, saveTextEditAsNew, selectedItem]);

  /** File clipboard image, or captured image blob path on disk. */
  const compressSourcePath = useMemo(() => {
    if (!selectedItem || mediaProgress) return null;
    if (fileMetadata?.kind === "image" && selectedItem.file_path) return selectedItem.file_path;
    if (selectedItem.image_path) return selectedItem.image_path;
    return null;
  }, [fileMetadata?.kind, mediaProgress, selectedItem]);

  const gifSourcePath = useMemo(() => {
    if (!selectedItem?.file_path || mediaProgress) return null;
    if (fileMetadata?.kind === "video") return selectedItem.file_path;
    return null;
  }, [fileMetadata?.kind, mediaProgress, selectedItem]);

  const pasteActionLabel = pasteTargetName
    ? t("clipboard.pasteTo", "Paste to {app}").replace("{app}", pasteTargetName)
    : t("clipboard.paste", "Paste");

  const startMediaTask = async (operation: "compress" | "gif") => {
    const path = operation === "compress" ? compressSourcePath : gifSourcePath;
    if (!path || mediaProgress) return;
    const startMessage = operation === "compress"
      ? t("clipboard.startingCompress", "Starting compression")
      : t("clipboard.startingGif", "Starting GIF conversion");
    setStatus(startMessage);
    try {
      const jobId = await invoke<string>(operation === "compress" ? "clipboard_compress_image" : "clipboard_video_to_gif", {
        path,
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

  const clipboardActions = useMemo<QxShellAction[]>(() => {
    // In-window only — never Alt+Space (launcher) or Cmd+Space (Spotlight).
    // menuKey: single letters while Actions panel is open (Raycast-style).
    const list: QxShellAction[] = [
      {
        label: pasteActionLabel,
        kbd: "Enter",
        disabled: !selectedItem,
        onClick: () => void pasteItem(selectedItem, { focusAtCursor: true }),
      },
      {
        label: t("clipboard.copy", "Copy"),
        kbd: "CmdOrCtrl+C",
        menuKey: "c",
        disabled: !selectedItem,
        onClick: () => void copyItem(selectedItem),
      },
      {
        label: selectedItem?.pinned ? t("clipboard.unpin", "Unpin") : t("clipboard.pin", "Pin"),
        kbd: "CmdOrCtrl+P",
        menuKey: "p",
        disabled: !selectedItem,
        onClick: () => void togglePin(selectedItem),
      },
      {
        label: t("clipboard.delete", "Delete"),
        kbd: "CmdOrCtrl+Backspace",
        menuKey: "d",
        disabled: !selectedItem,
        tone: "danger",
        onClick: () => void deleteItem(selectedItem),
      },
      {
        label: t("clipboard.importDocs", "Import to Text Toolbox"),
        kbd: "CmdOrCtrl+Shift+T",
        menuKey: "t",
        disabled: !selectedItem?.text?.trim(),
        onClick: () => void importToTextTool(selectedItem),
      },
    ];

    // Context-sensitive media tools — only when the current item can run them.
    if (compressSourcePath) {
      list.push({
        label: t("clipboard.compressImage", "Compress Image"),
        kbd: "CmdOrCtrl+Shift+C",
        menuKey: "m",
        disabled: Boolean(mediaProgress),
        onClick: () => void startMediaTask("compress"),
      });
    }
    if (gifSourcePath) {
      list.push({
        label: t("clipboard.videoToGif", "Video to GIF"),
        kbd: "CmdOrCtrl+Shift+G",
        menuKey: "g",
        disabled: Boolean(mediaProgress),
        onClick: () => void startMediaTask("gif"),
      });
    }
    if (selectedItem?.file_path) {
      list.push({
        label: t("clipboard.reveal", "Show in Finder"),
        kbd: "CmdOrCtrl+Shift+R",
        menuKey: "r",
        onClick: () => {
          if (selectedItem.file_path) void revealItemInDir(selectedItem.file_path);
        },
      });
      list.push({
        label: t("clipboard.copyPath", "Copy Path"),
        kbd: "CmdOrCtrl+Shift+P",
        menuKey: "y",
        onClick: () => {
          if (selectedItem.file_path) void writeText(selectedItem.file_path);
        },
      });
    } else if (selectedItem?.image_path) {
      list.push({
        label: t("clipboard.reveal", "Show in Finder"),
        kbd: "CmdOrCtrl+Shift+R",
        menuKey: "r",
        onClick: () => {
          if (selectedItem.image_path) void revealItemInDir(selectedItem.image_path);
        },
      });
    }

    return list;
  }, [
    compressSourcePath,
    gifSourcePath,
    mediaProgress,
    pasteActionLabel,
    selectedItem,
    t,
  ]);
  // importToTextTool / paste / pin closed over selectedItem — intentional

  let flatIndex = 0;

  const searchSlot = (
    <QxModuleSearch
      className="qx-clipboard-search-wrap"
      inputClassName="qx-clipboard-search"
      value={query}
      onChange={(next) => {
        setQuery(next);
        setSelected(0);
      }}
      placeholder={t("clipboard.placeholder", "Type to filter entries...")}
    />
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

  const shell = useQxModuleShell({
    leave,
    esc: {
      inner: {
        active: Boolean(editingId) || detailOpen,
        close: () => {
          if (editingId) discardTextEdit();
          else setDetailOpen(false);
        },
      },
      query: { active: query.length > 0, clear: () => setQuery("") },
    },
    onKeyDown: (e) => {
      void handleModuleKeys(e);
    },
    island: {
      label: hasDraftChanges
        ? t("clipboard.edit.unsaved", "Unsaved clipboard edit")
        : mediaProgress?.message || status || t("clipboard.title", "Clipboard History"),
      detail: hasDraftChanges
        ? t("clipboard.edit.unsavedDetail", "Save, save as new, or discard the draft")
        : selectedItem
          ? `${contentType(selectedItem, t)} · ${filterLabel(filter)} · ${itemCountLabel}`
          : `${filterLabel(filter)} · ${itemCountLabel}`,
      progress: mediaProgress ? mediaProgress.progress : undefined,
      tone: hasDraftChanges || mediaProgress?.error ? "danger" : status ? "success" : "neutral",
      actions: hasDraftChanges
        ? [
            {
              id: "save",
              label: t("clipboard.edit.save", "Save"),
              onAction: () => void saveTextEdit(),
            },
            {
              id: "save-as-new",
              label: t("clipboard.edit.saveAsNew", "Save as New"),
              onAction: () => void saveTextEditAsNew(),
            },
          ]
        : undefined,
      effect: islandEffectNonce > 0
        ? { kind: "orbit", nonce: islandEffectNonce }
        : undefined,
    },
    t,
  });

  return (
    <QxShell
      title={t("clipboard.title", "Clipboard History")}
      islandKey="clipboard"
      search={searchSlot}
      trailing={trailing}
      escapeAction={shell.escapeAction}
      onKeyDown={shell.onKeyDown}
      navigation={{
        index: selected,
        count: filtered.length,
        onChange: (index) => {
          setSelected(index);
          setDetailOpen(false);
          const item = filtered[index];
          if (item) queueClipboardRestore(item);
        },
        onOpen: () => setDetailOpen(true),
        onClose: () => setDetailOpen(false),
      }}
      className="qx-clipboard-shell"
      island={shell.island}
      primaryAction={!editingId && selectedItem ? {
        label: pasteActionLabel,
        kbd: "Enter",
        onClick: () => void pasteItem(selectedItem, { focusAtCursor: true }),
      } : undefined}
      secondaryAction={shell.secondaryAction}
      actionTitle={t("clipboard.actions", "Clipboard Actions")}
      actions={clipboardActions}
    >
      <div className="qx-clipboard-body">
        <div ref={listRef} className="qx-clipboard-list" role="listbox" aria-label={t("clipboard.listAria", "Clipboard history")}>
          {grouped.map((section, sectionIndex) => {
            const sectionKey = `${section.title}-${sectionIndex}`;
            return (
            <div key={sectionKey}>
              <Popover
                modal
                open={datePopoverSection === sectionKey}
                onOpenChange={(open) => setDatePopoverSection(open ? sectionKey : null)}
              >
                <PopoverTrigger asChild>
                  <button className="qx-section-header qx-clipboard-date-trigger" type="button">
                    <CalendarDays size={13} aria-hidden="true" />
                    <span className="qx-clipboard-date-title">
                      {dateFilterLabel ?? section.title}
                    </span>
                    <span>{section.items.length}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="qx-clipboard-date-popover" side="right" align="start">
                  <Calendar
                    value={dateFilter}
                    onChange={(range) => {
                      setDateFilter(range);
                      setSelected(0);
                    }}
                    locale={locale}
                    min={availableDateBounds.min}
                    max={availableDateBounds.max}
                    rangeLabel={t("clipboard.dateFilter", "Filter by date range")}
                    previousMonthLabel={t("clipboard.calendar.previousMonth", "Previous month")}
                    nextMonthLabel={t("clipboard.calendar.nextMonth", "Next month")}
                  />
                  <div className="qx-clipboard-date-presets">
                    <button
                      className={!dateFilter.from ? "is-active" : ""}
                      type="button"
                      onClick={() => {
                        setDateFilter({ from: null, to: null });
                        setSelected(0);
                        setDatePopoverSection(null);
                      }}
                    >
                      {t("clipboard.allDates", "All dates")}
                    </button>
                    {[1, 7, 30].map((days) => (
                      <button key={days} type="button" onClick={() => {
                        setDateFilter(recentRange(days));
                        setSelected(0);
                        setDatePopoverSection(null);
                      }}>
                        {days === 1
                          ? t("clipboard.calendar.today", "Today")
                          : t("clipboard.calendar.lastDays", "Last {n} days").replace("{n}", String(days))}
                      </button>
                    ))}
                  </div>
                  <div className="qx-clipboard-date-summary" aria-live="polite">
                    {dateFilterLabel ?? t("clipboard.allDates", "All dates")}
                  </div>
                </PopoverContent>
              </Popover>
              {section.items.map((item) => {
                const index = flatIndex++;
                const kind = classify(item);
                const isImage = kind === "image";
                const itemProps = getItemProps(index);
                return (
                  <button
                    key={item.id}
                    {...itemProps}
                    onClick={() => selectItem(item, index)}
                    onDoubleClick={() => beginTextEdit(item)}
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
            );
          })}
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
                  {filePreviewUrl ? (
                    <img
                      className="qx-clipboard-image-preview"
                      src={filePreviewUrl}
                      alt={fileMetadata?.name || t("clipboard.filePreview", "File preview")}
                    />
                  ) : (
                    <div className="qx-clipboard-file-placeholder">
                      {fileMetadata?.kind === "video" ? (
                        <Video size={42} />
                      ) : fileMetadata?.kind === "folder" || selectedItem.file_kind === "folder" ? (
                        <Folder size={42} />
                      ) : fileMetadata?.kind === "pdf" ||
                        selectedItem.file_path.toLowerCase().endsWith(".pdf") ? (
                        <FileText size={42} />
                      ) : (
                        <File size={42} />
                      )}
                      <strong>
                        {fileMetadata?.name ??
                          selectedItem.file_path.split(/[/\\]/).pop() ??
                          t("clipboard.loadingFile", "Loading file…")}
                      </strong>
                      {filePreviewLoading ? (
                        <span className="qx-clipboard-preview-status" aria-live="polite">
                          {t("clipboard.previewLoading", "Loading preview…")}
                        </span>
                      ) : filePreviewError ? (
                        <span className="qx-clipboard-preview-status is-muted">
                          {filePreviewError}
                        </span>
                      ) : fileMetadata &&
                        !["image", "video", "pdf"].includes(fileMetadata.kind) ? (
                        <span className="qx-clipboard-preview-status is-muted">
                          {t("clipboard.previewUnsupported", "No visual preview for this type")}
                        </span>
                      ) : null}
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
              ) : isEditing ? (
                <textarea
                  className="qx-clipboard-content qx-clipboard-editor"
                  value={draftText}
                  autoFocus
                  aria-label={t("clipboard.edit.editor", "Edit clipboard text")}
                  onChange={(event) => setDraftText(event.target.value)}
                />
              ) : (
                <pre
                  className={`qx-clipboard-content${detailOpen ? " is-expanded" : ""}`}
                  title={t("clipboard.edit.doubleClick", "Double-click to edit")}
                  onDoubleClick={() => beginTextEdit(selectedItem)}
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
                  {selectedItem.file_path && (
                    <>
                      <div>
                        <dt>{t("clipboard.file", "File")}</dt>
                        <dd title={fileMetadata?.path || selectedItem.file_path}>
                          {fileMetadata?.name ||
                            selectedItem.file_path.split(/[/\\]/).pop() ||
                            selectedItem.file_path}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("clipboard.kind", "Kind")}</dt>
                        <dd>
                          {(fileMetadata?.kind || guessFileKind(selectedItem.file_path))}
                          {(fileMetadata?.extension || extensionOf(selectedItem.file_path))
                            ? ` · ${(fileMetadata?.extension || extensionOf(selectedItem.file_path)).toUpperCase()}`
                            : ""}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("clipboard.size", "Size")}</dt>
                        <dd>
                          {fileMetadata && fileMetadata.size > 0
                            ? formatBytes(fileMetadata.size)
                            : t("clipboard.sizePending", "…")}
                        </dd>
                      </div>
                      {fileMetadata?.width && fileMetadata?.height ? (
                        <div>
                          <dt>{t("clipboard.dimensions", "Dimensions")}</dt>
                          <dd>
                            {fileMetadata.width} × {fileMetadata.height}
                          </dd>
                        </div>
                      ) : null}
                      {fileMetadata?.duration_seconds ? (
                        <div>
                          <dt>{t("clipboard.duration", "Duration")}</dt>
                          <dd>{formatDuration(fileMetadata.duration_seconds)}</dd>
                        </div>
                      ) : null}
                      {fileMetadata?.kind === "image" ? (
                        <div>
                          <dt>{t("clipboard.quickAction", "Quick action")}</dt>
                          <dd>
                            <button
                              className="qx-inline-action"
                              onClick={() => void startMediaTask("compress")}
                              disabled={Boolean(mediaProgress)}
                              type="button"
                            >
                              <Shrink size={13} /> {t("clipboard.compress", "Compress")}
                            </button>
                          </dd>
                        </div>
                      ) : null}
                      {fileMetadata?.kind === "video" ? (
                        <div>
                          <dt>{t("clipboard.quickAction", "Quick action")}</dt>
                          <dd>
                            <button
                              className="qx-inline-action"
                              onClick={() => void startMediaTask("gif")}
                              disabled={Boolean(mediaProgress)}
                              type="button"
                            >
                              <Video size={13} /> {t("clipboard.convertGif", "Convert to GIF")}
                            </button>
                          </dd>
                        </div>
                      ) : null}
                    </>
                  )}
                  {selectedItem.image_path && !selectedItem.file_path && (
                    <div>
                      <dt>{t("clipboard.quickAction", "Quick action")}</dt>
                      <dd>
                        <button
                          className="qx-inline-action"
                          onClick={() => void startMediaTask("compress")}
                          disabled={Boolean(mediaProgress)}
                          type="button"
                        >
                          <Shrink size={13} /> {t("clipboard.compress", "Compress")}
                        </button>
                      </dd>
                    </div>
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
