import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { File, FileText, Folder, Image as ImageIcon, Shrink, Video } from "lucide-react";
import { useStore, type ClipboardEntry } from "../../store";
import QxShell, { type QxShellAction } from "../../components/QxShell";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import { type CalendarRange } from "../../components/ui";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { useLocale, useT } from "../../i18n";
import { setPendingModuleLaunch, takePendingModuleLaunch } from "../../search/moduleSurfaces";
import { ocrRecognizeClipboardImage, revealSystemPath } from "../../system";
import { registerWindowActivationTask } from "../../shell/windowActivation";
import { pinScreenshotToDesktop } from "../screencap/store";
import {
  clearClipboardRestore,
  ensureClipboardRestoreOnHide,
  pasteClipboardEntry,
  queueClipboardRestore,
  writeClipboardEntry,
} from "./actions";
import {
  getClipboardHistorySession,
  loadMoreClipboardHistory,
  prefetchClipboardOpen,
  refreshClipboardHistory,
} from "./openSession";
import ClipboardHistoryVirtualList, {
  type ClipboardHistorySection,
} from "./ClipboardHistoryVirtualList";
import {
  CLIPBOARD_DETAIL_MAX_EDGE,
  CLIPBOARD_THUMBNAIL_MAX_EDGE,
  resolveClipboardPreviewAsset,
} from "./imageAssets";
import {
  classify,
  decodeClipboardUrl,
  clipboardFileLabel,
  clipboardFileKind,
  clipboardFilePaths,
  dateKey,
  sectionName,
  formatCopied,
  wordCount,
  contentType,
  matchesQuery,
  isClipboardImageItem,
  isClipboardUrl,
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

export default function ClipboardPanel() {
  const t = useT();
  const locale = useLocale();
  const clipboardHistory = useStore((state) => state.clipboardHistory);
  const setClipboardHistory = useStore((state) => state.setClipboardHistory);
  const setTab = useStore((state) => state.setTab);
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
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [visibleImagePaths, setVisibleImagePaths] = useState<string[]>([]);
  const [fileMetadata, setFileMetadata] = useState<FileMetadata | null>(null);
  /** Right-pane image/file/PDF/video preview, always backed by a bounded asset. */
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);
  const [filePreviewError, setFilePreviewError] = useState<string | null>(null);
  const [mediaProgress, setMediaProgress] = useState<MediaProgress | null>(null);
  const [hasMoreCold, setHasMoreCold] = useState(false);
  const [loadingMoreCold, setLoadingMoreCold] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const preserveSelectionId = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);

  const filterLabel = (id: Filter) => t(FILTER_KEYS[id].key, FILTER_KEYS[id].fallback);

  const syncSessionFlags = useCallback(() => {
    const session = getClipboardHistorySession();
    setHasMoreCold(session.hasMore);
  }, []);

  const requestColdPage = useCallback(async () => {
    if (loadingMoreRef.current) return;
    const session = getClipboardHistorySession();
    if (!session.hasMore) {
      setHasMoreCold(false);
      return;
    }
    loadingMoreRef.current = true;
    setLoadingMoreCold(true);
    try {
      const next = await loadMoreClipboardHistory();
      setHasMoreCold(next.hasMore);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMoreCold(false);
    }
  }, []);

  const handleVisibleImagePathsChange = useCallback((paths: string[]) => {
    setVisibleImagePaths((current) => (
      current.length === paths.length && current.every((path, index) => path === paths[index])
        ? current
        : paths
    ));
  }, []);

  const bindListRef = useCallback((element: HTMLDivElement | null) => {
    listRef.current = element;
    setListElement(element);
  }, []);

  useEffect(() => {
    ensureClipboardRestoreOnHide();
    // The host open path starts the hot history fetch; join its in-flight work.
    // Live capture belongs to the native listener and is never repeated here.
    void prefetchClipboardOpen().then(syncSessionFlags);
    if (!isTauriRuntime()) return;
    const unlisten = listen("clipboard-updated", () => {
      void refreshClipboardHistory().then(syncSessionFlags);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [syncSessionFlags]);

  // Server-side search covers cold rows; type/date filters still run client-side.
  // Skip the initial mount so we don't race the open-path hot prefetch.
  const searchBootRef = useRef(true);
  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (searchBootRef.current) {
      searchBootRef.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      void refreshClipboardHistory({ query, reset: true }).then(syncSessionFlags);
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query, syncSessionFlags]);

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
    const unregister = registerWindowActivationTask({
      id: "clipboard.paste-target",
      delayMs: 180,
      minIntervalMs: 750,
      run: refreshTarget,
    });
    return () => {
      cancelled = true;
      unregister();
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

  const grouped = useMemo(() => {
    const sections: ClipboardHistorySection[] = [];
    for (const item of filtered) {
      const title = sectionName(item.timestamp, t);
      const last = sections[sections.length - 1];
      if (last?.title === title) last.items.push(item);
      else sections.push({ key: dateKey(item.timestamp), title, items: [item] });
    }
    return sections;
  }, [filtered, t]);

  // Infinite scroll: when the list reaches the bottom, pull the next cold page.
  // Also auto-fill when content does not overflow (short lists / type filters).
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const maybeLoad = () => {
      if (loadingMoreRef.current || !getClipboardHistorySession().hasMore) return;
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (remaining <= 96) void requestColdPage();
    };
    el.addEventListener("scroll", maybeLoad, { passive: true });
    maybeLoad();
    return () => el.removeEventListener("scroll", maybeLoad);
  }, [requestColdPage, clipboardHistory.length, filtered.length, hasMoreCold]);

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
    listSignature: filtered.length === 0
      ? "empty"
      : `${filter}:${query}:${dateFilter.from ?? ""}:${dateFilter.to ?? ""}:${filtered.length}:${filtered[0]?.id}:${filtered[filtered.length - 1]?.id}`,
  });

  // Keyboard near the end of the loaded list also warms the next cold page.
  useEffect(() => {
    if (!hasMoreCold || loadingMoreRef.current) return;
    if (filtered.length === 0) return;
    if (selected >= filtered.length - 4) void requestColdPage();
  }, [filtered.length, hasMoreCold, requestColdPage, selected]);

  const selectedItem = filtered[selected];
  const selectedFilePaths = selectedItem ? clipboardFilePaths(selectedItem) : [];
  const isEditing = Boolean(selectedItem && editingId === selectedItem.id);
  const hasDraftChanges = isEditing && draftText !== selectedItem?.text;

  // Load only bounded derivatives inside the virtual viewport. The backend
  // serializes heavy decodes, so one frontend worker avoids queueing stale
  // full-image jobs while the user scrolls quickly.
  useEffect(() => {
    const selectedImagePath = selectedItem?.image_path ?? null;
    const paths = visibleImagePaths.filter(
      (path) => path !== selectedImagePath && !thumbnailUrls[path],
    );
    if (paths.length === 0) return;
    let cancelled = false;
    const loadVisible = async () => {
      const results: Record<string, string> = {};
      for (const path of paths) {
        if (cancelled) break;
        try {
          const asset = await resolveClipboardPreviewAsset(
            path,
            CLIPBOARD_THUMBNAIL_MAX_EDGE,
          );
          if (asset) results[path] = asset.url;
        } catch {
          // Keep the row usable with its type icon; a later visibility change
          // may retry after a transient file/cache failure.
        }
      }
      if (!cancelled && Object.keys(results).length > 0) {
        setThumbnailUrls((prev) => ({ ...prev, ...results }));
      }
    };
    void loadVisible();
    return () => { cancelled = true; };
  }, [selectedItem?.image_path, thumbnailUrls, visibleImagePaths]);

  useEffect(() => {
    if (editingId && editingId !== selectedItem?.id) {
      setEditingId(null);
      setDraftText("");
    }
  }, [editingId, selectedItem?.id]);

  // Information paints immediately from the path; size/dims/preview fill in async.
  useEffect(() => {
    const path = selectedItem?.file_path ?? selectedItem?.image_path;
    const isCapturedImage = !selectedItem?.file_path && Boolean(selectedItem?.image_path);
    const hasCachedCapturedImageMetadata = isCapturedImage
      && (selectedItem?.image_size_bytes ?? 0) > 0
      && (selectedItem?.image_width ?? 0) > 0
      && (selectedItem?.image_height ?? 0) > 0;
    setFilePreviewUrl(null);
    setFilePreviewError(null);
    setFilePreviewLoading(false);
    if (!path) {
      setFileMetadata(null);
      return;
    }

    let cancelled = false;
    // 0) Captured image dimensions and byte size were known at capture time and
    // are stored with the history row. Reuse them synchronously on selection.
    const optimistic = optimisticFileMeta(path);
    setFileMetadata(hasCachedCapturedImageMetadata
      ? {
          ...optimistic,
          kind: "image",
          size: selectedItem?.image_size_bytes ?? optimistic.size,
          width: selectedItem?.image_width ?? null,
          height: selectedItem?.image_height ?? null,
        }
      : optimistic);

    // 1) Fast stat (size + confirmed kind) — no image decode / ffmpeg / QL.
    // New captured images already have this complete cache, so do not issue an
    // IPC round-trip while the user is moving through the list.
    if (!hasCachedCapturedImageMetadata) void invoke<FileMetadata>("clipboard_file_metadata", { path })
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

    // Delay expensive preview/probe work until keyboard navigation settles.
    // Only a cache path crosses IPC; WebView streams the bounded derivative
    // through Tauri's asset protocol instead of receiving a JSON byte array.
    setFilePreviewLoading(true);
    const loadFilePreview = () => {
      void resolveClipboardPreviewAsset(path, CLIPBOARD_DETAIL_MAX_EDGE)
        .then((asset) => {
          if (cancelled) return;
          if (!asset) {
            setFilePreviewLoading(false);
            return;
          }
          setFilePreviewUrl(asset.url);
          if (isCapturedImage) {
            setThumbnailUrls((current) => current[path]
              ? current
              : { ...current, [path]: asset.url });
          }
          setFileMetadata((current) =>
            current ? { ...current, preview_path: asset.path } : current,
          );
          setFilePreviewLoading(false);
        })
        .catch(() => {
          if (!cancelled) {
            setFilePreviewLoading(false);
            setFilePreviewError(t("clipboard.previewFailed", "Preview unavailable"));
          }
        });
    };

    const heavyTimer = window.setTimeout(() => {
      loadFilePreview();

      // 3) Dimensions / duration — slow path, never blocks Information.
      // Captured images with stored facts do not need to probe themselves again.
      if (hasCachedCapturedImageMetadata) return;
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
    };
  }, [selectedItem?.file_path, selectedItem?.image_path, t]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const unlisten = listen<MediaProgress>("clipboard-media-progress", ({ payload }) => {
      setMediaProgress(payload);
      setStatus(payload.error ? payload.error : payload.message);
      if (payload.progress >= 100 || payload.error) {
        void refreshClipboardHistory();
        window.setTimeout(() => setMediaProgress(null), 1800);
      }
    });
    return () => { unlisten.then((dispose) => dispose()); };
  }, []);

  const availableDateBounds = useMemo(() => {
    let min: string | null = null;
    let max: string | null = null;
    for (const item of clipboardHistory) {
      const date = dateKey(item.timestamp);
      if (!min || date < min) min = date;
      if (!max || date > max) max = date;
    }
    return { min, max };
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
      await refreshClipboardHistory();
      setStatus(t("clipboard.copied", "Copied"));
      window.setTimeout(() => setStatus(""), 1200);
    } catch {}
  };

  const decodeUrlItem = async (item?: ClipboardEntry) => {
    if (!item || !isClipboardUrl(item.text)) return;
    try {
      // This is an explicit clipboard write. Do not let the deferred selection
      // restore overwrite the decoded result when Qx subsequently hides.
      clearClipboardRestore();
      await writeText(decodeClipboardUrl(item.text));
      setStatus(t("clipboard.urlDecoded", "URL decoded and copied"));
      window.setTimeout(() => setStatus(""), 1600);
    } catch (error) {
      setStatus(String(error || t("clipboard.urlDecodeFailed", "Could not decode URL")));
      window.setTimeout(() => setStatus(""), 1600);
    }
  };

  const pasteItem = async (item?: ClipboardEntry, options: { focusAtCursor?: boolean } = {}) => {
    if (!item) return;
    try {
      setStatus(t("clipboard.pasting", "Pasting"));
      await pasteClipboardEntry(item, options);
      await refreshClipboardHistory();
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
    await refreshClipboardHistory();
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
      await refreshClipboardHistory();
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
      await refreshClipboardHistory();
      setIslandEffectNonce((value) => value + 1);
      setStatus(t("clipboard.edit.savedAsNew", "Saved as a new item"));
      window.setTimeout(() => setStatus(""), 1400);
    } catch (error) {
      setStatus(String(error));
    }
  };

  const runOcrOnItem = async (item: ClipboardEntry | undefined, dest: "clipboard" | "editor") => {
    if (!item) return;
    if (!isClipboardImageItem(item)) {
      setStatus(t("ocr.failed", "OCR failed") + ": no image");
      window.setTimeout(() => setStatus(""), 1600);
      return;
    }
    try {
      // Instant path: use already-cached OCR text without waiting on Vision.
      const cached = item.ocr_text?.trim();
      if (cached) {
        if (dest === "clipboard") {
          await writeText(cached);
          setStatus(t("ocr.copied", "OCR text copied"));
          window.setTimeout(() => setStatus(""), 1600);
          return;
        }
        setPendingModuleLaunch({
          tab: "documents",
          surface: "import",
          params: {
            content: cached,
            title: cached.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 48) || "OCR",
          },
        });
        setTab("documents");
        setStatus("");
        return;
      }

      setStatus(t("ocr.running", "Recognizing…"));
      const result = await ocrRecognizeClipboardImage(item.id);
      // Don't block UI on a full history reload — optimistic ocr_text update.
      setClipboardHistory(
        clipboardHistory.map((entry) =>
          entry.id === item.id ? { ...entry, ocr_text: result.text } : entry,
        ),
      );
      void refreshClipboardHistory();
      if (dest === "clipboard") {
        await writeText(result.text);
        setStatus(t("ocr.copied", "OCR text copied"));
      } else {
        setPendingModuleLaunch({
          tab: "documents",
          surface: "import",
          params: {
            content: result.text,
            title: result.text.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 48) || "OCR",
          },
        });
        setTab("documents");
        setStatus("");
        return;
      }
      window.setTimeout(() => setStatus(""), 1600);
    } catch (error) {
      setStatus(String(error || t("ocr.failed", "OCR failed")));
      window.setTimeout(() => setStatus(""), 2200);
    }
  };

  const ocrAllPendingImages = async () => {
    try {
      setStatus(t("clipboard.ocrAll.running", "OCR-ing clipboard images…"));
      const result = await invoke<{ total: number; done: number; failed: number }>(
        "clipboard_ocr_pending",
        { limit: 30 },
      );
      await refreshClipboardHistory();
      setStatus(
        t("clipboard.ocrAll.done", "OCR finished: {done}/{total} (failed {failed})")
          .replace("{done}", String(result.done))
          .replace("{total}", String(result.total))
          .replace("{failed}", String(result.failed)),
      );
      window.setTimeout(() => setStatus(""), 2200);
    } catch (error) {
      setStatus(String(error || t("ocr.failed", "OCR failed")));
      window.setTimeout(() => setStatus(""), 2200);
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
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
      // Raycast-style alternate: ⌘↵ copies the selected item (detail is →).
      e.preventDefault();
      await copyItem(selectedItem);
      return;
    }
  }, [copyItem, isEditing, saveTextEdit, saveTextEditAsNew, selectedItem]);

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
        id: "paste",
        label: pasteActionLabel,
        kbd: "Enter",
        disabled: !selectedItem,
        onClick: () => void pasteItem(selectedItem, { focusAtCursor: true }),
      },
      {
        id: "copy",
        label: t("clipboard.copy", "Copy"),
        kbd: "CmdOrCtrl+C",
        menuKey: "c",
        disabled: !selectedItem,
        onClick: () => void copyItem(selectedItem),
      },
      {
        id: "toggle-pin",
        label: selectedItem?.pinned ? t("clipboard.unpin", "Unpin") : t("clipboard.pin", "Pin"),
        kbd: "CmdOrCtrl+P",
        menuKey: "p",
        disabled: !selectedItem,
        onClick: () => void togglePin(selectedItem),
      },
      {
        id: "delete",
        label: t("clipboard.delete", "Delete"),
        kbd: "CmdOrCtrl+Backspace",
        menuKey: "d",
        disabled: !selectedItem,
        tone: "danger",
        onClick: () => void deleteItem(selectedItem),
      },
      {
        id: "import-text-toolbox",
        label: t("clipboard.importDocs", "Import to Text Toolbox"),
        kbd: "CmdOrCtrl+Shift+T",
        menuKey: "t",
        disabled: !selectedItem?.text?.trim(),
        onClick: () => void importToTextTool(selectedItem),
      },
    ];

    if (selectedItem && classify(selectedItem) === "links") {
      list.splice(2, 0, {
        id: "decode-url",
        label: t("clipboard.decodeUrl", "Decode URL"),
        kbd: "CmdOrCtrl+Shift+U",
        menuKey: "u",
        disabled: decodeClipboardUrl(selectedItem.text) === selectedItem.text.trim(),
        onClick: () => void decodeUrlItem(selectedItem),
      });
    }

    // OCR for every image-shaped clipboard item (bitmap paste + image files).
    if (selectedItem && isClipboardImageItem(selectedItem)) {
      list.push({
        id: "ocr-copy",
        label: t("clipboard.ocrCopy", "OCR and Copy"),
        kbd: "CmdOrCtrl+Shift+O",
        menuKey: "o",
        onClick: () => void runOcrOnItem(selectedItem, "clipboard"),
      });
      list.push({
        id: "ocr-editor",
        label: t("clipboard.ocrEditor", "OCR to Text Toolbox"),
        kbd: "CmdOrCtrl+Shift+E",
        menuKey: "e",
        onClick: () => void runOcrOnItem(selectedItem, "editor"),
      });
      const pinPath = selectedItem.image_path
        || (fileMetadata?.kind === "image" ? selectedItem.file_path : null)
        || (selectedItem.file_path && isClipboardImageItem(selectedItem) ? selectedItem.file_path : null);
      if (pinPath) {
        list.push({
          id: "pin-desktop",
          label: t("screencap.pin.action", "Pin to Desktop"),
          kbd: "CmdOrCtrl+T",
          menuKey: "t",
          onClick: () => {
            void pinScreenshotToDesktop(pinPath).catch((error) => {
              setStatus(String(error));
            });
          },
        });
      }
    }
    if (clipboardHistory.some((item) => isClipboardImageItem(item) && !item.ocr_text?.trim())) {
      list.push({
        id: "ocr-all",
        label: t("clipboard.ocrAll", "OCR All Images"),
        menuKey: "a",
        onClick: () => void ocrAllPendingImages(),
      });
    }

    // Context-sensitive media tools — only when the current item can run them.
    if (compressSourcePath) {
      list.push({
        id: "compress-image",
        label: t("clipboard.compressImage", "Compress Image"),
        kbd: "CmdOrCtrl+Shift+C",
        menuKey: "m",
        disabled: Boolean(mediaProgress),
        onClick: () => void startMediaTask("compress"),
      });
    }
    if (gifSourcePath) {
      list.push({
        id: "video-to-gif",
        label: t("clipboard.videoToGif", "Video to GIF"),
        kbd: "CmdOrCtrl+Shift+G",
        menuKey: "g",
        disabled: Boolean(mediaProgress),
        onClick: () => void startMediaTask("gif"),
      });
    }
    if (selectedItem?.file_path) {
      list.push({
        id: "reveal-file",
        label: t("clipboard.reveal", "Show in Finder"),
        kbd: "CmdOrCtrl+Shift+R",
        menuKey: "r",
        onClick: () => {
          if (selectedItem.file_path) void revealSystemPath(selectedItem.file_path);
        },
      });
      list.push({
        id: "copy-path",
        label: t("clipboard.copyPath", "Copy Path"),
        kbd: "CmdOrCtrl+Shift+P",
        menuKey: "y",
        onClick: () => {
          if (selectedItem.file_path) void writeText(selectedItem.file_path);
        },
      });
    } else if (selectedItem?.image_path) {
      list.push({
        id: "reveal-image",
        label: t("clipboard.reveal", "Show in Finder"),
        kbd: "CmdOrCtrl+Shift+R",
        menuKey: "r",
        onClick: () => {
          if (selectedItem.image_path) void revealSystemPath(selectedItem.image_path);
        },
      });
    }

    return list;
  }, [
    compressSourcePath,
    fileMetadata?.kind,
    gifSourcePath,
    mediaProgress,
    pasteActionLabel,
    selectedItem,
    t,
  ]);
  // importToTextTool / paste / pin closed over selectedItem — intentional

  const searchSlot = (
    <QxModuleSearch
      className="qx-clipboard-search-wrap"
      inputClassName="qx-clipboard-search"
      value={query}
      autoFocus
      onChange={(next) => {
        setQuery(next);
        setSelected(0);
      }}
      placeholder={t("clipboard.placeholder", "Type to filter entries...")}
    />
  );

  const itemCountLabel = t("clipboard.items", "{n} items").replace("{n}", String(filtered.length));

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
  });

  return (
    <QxShell
      title={t("clipboard.title", "Clipboard History")}
      islandKey="clipboard"
      search={searchSlot}
      topbarFilters={[{
        id: "clipboard-kind",
        label: t("clipboard.filter", "Clipboard filter"),
        value: filter,
        options: (Object.keys(FILTER_KEYS) as Filter[]).map((id) => ({
          value: id,
          label: filterLabel(id),
        })),
        onChange: (next) => {
          setFilter(next as Filter);
          setSelected(0);
        },
      }]}
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
      primaryActionId={!editingId && selectedItem ? "paste" : undefined}
      actionTitle={t("clipboard.actions", "Clipboard Actions")}
      actions={clipboardActions}
    >
      <div className={`qx-clipboard-body qx-content-split${detailOpen ? " has-detail" : ""}`}>
        <div ref={bindListRef} className="qx-clipboard-list qx-content-list" role="listbox" aria-label={t("clipboard.listAria", "Clipboard history")}>
          {grouped.length > 0 && (
            <ClipboardHistoryVirtualList
              listElement={listElement}
              sections={grouped}
              selected={selected}
              getItemProps={getItemProps}
              onSelect={selectItem}
              onBeginTextEdit={beginTextEdit}
              thumbnailUrls={thumbnailUrls}
              onVisibleImagePathsChange={handleVisibleImagePathsChange}
              dateFilter={dateFilter}
              setDateFilter={setDateFilter}
              datePopoverSection={datePopoverSection}
              setDatePopoverSection={setDatePopoverSection}
              setSelected={setSelected}
              dateBounds={availableDateBounds}
              dateFilterLabel={dateFilterLabel}
            />
          )}
          {filtered.length === 0 && (
            <div className="qx-empty-state">
              {clipboardHistory.length === 0
                ? t("clipboard.emptyHistory", "No clipboard history yet")
                : t("clipboard.noMatch", "No matching items")}
            </div>
          )}
          {filtered.length > 0 && (loadingMoreCold || hasMoreCold) && (
            <div className="qx-clipboard-cold-footer" aria-live="polite">
              {loadingMoreCold
                ? t("clipboard.loadingOlder", "Loading older history…")
                : t("clipboard.scrollForOlder", "Scroll for older history")}
            </div>
          )}
        </div>

        <div className="qx-clipboard-detail qx-content-detail">
          {selectedItem ? (
            <>
              {selectedItem.file_path ? (
                <div className="qx-clipboard-file-preview">
                  {filePreviewUrl ? (
                    <img
                      className="qx-clipboard-image-preview"
                      src={filePreviewUrl}
                      alt={fileMetadata?.name || t("clipboard.filePreview", "File preview")}
                      decoding="async"
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
                      <strong>{clipboardFileLabel(selectedItem, t)}</strong>
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
                  {filePreviewUrl || thumbnailUrls[selectedItem.image_path] ? (
                    <img
                      className="qx-clipboard-image-preview"
                      src={filePreviewUrl || thumbnailUrls[selectedItem.image_path]}
                      alt={t("clipboard.imageAlt", "Clipboard image")}
                      decoding="async"
                    />
                  ) : (
                    <div className="qx-clipboard-file-placeholder">
                      <ImageIcon size={42} aria-hidden="true" />
                      <span className="qx-clipboard-preview-status" aria-live="polite">
                        {filePreviewError
                          ? t("clipboard.previewFailed", "Preview unavailable")
                          : t("clipboard.previewLoading", "Loading preview…")}
                      </span>
                    </div>
                  )}
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
                        <dt>
                          {selectedFilePaths.length > 1
                            ? t("clipboard.filter.file", "Files")
                            : t("clipboard.file", "File")}
                        </dt>
                        <dd title={selectedFilePaths.join("\n") || selectedItem.file_path}>
                          {clipboardFileLabel(selectedItem, t)}
                        </dd>
                      </div>
                      {selectedFilePaths.length <= 1 ? <div>
                        <dt>{t("clipboard.kind", "Kind")}</dt>
                        <dd>
                          {(fileMetadata?.kind || guessFileKind(selectedItem.file_path))}
                          {(fileMetadata?.extension || extensionOf(selectedItem.file_path))
                            ? ` · ${(fileMetadata?.extension || extensionOf(selectedItem.file_path)).toUpperCase()}`
                            : ""}
                        </dd>
                      </div> : null}
                      {selectedFilePaths.length <= 1 ? <div>
                        <dt>{t("clipboard.size", "Size")}</dt>
                        <dd>
                          {fileMetadata && fileMetadata.size > 0
                            ? formatBytes(fileMetadata.size)
                            : t("clipboard.sizePending", "…")}
                        </dd>
                      </div> : null}
                      {selectedFilePaths.length <= 1 && fileMetadata?.width && fileMetadata?.height ? (
                        <div>
                          <dt>{t("clipboard.dimensions", "Dimensions")}</dt>
                          <dd>
                            {fileMetadata.width} × {fileMetadata.height}
                          </dd>
                        </div>
                      ) : null}
                      {selectedFilePaths.length <= 1 && fileMetadata?.duration_seconds ? (
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
                    <>
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
