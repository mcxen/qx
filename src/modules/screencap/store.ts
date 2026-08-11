import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_RECORDING_OPTIONS } from "./preferences";
import { islandHost } from "../../island";
import { revealSystemPath, writeImageFileToClipboard } from "../../system";

export interface ScreencapEntry {
  id: number;
  path: string;
  thumbnail_path?: string | null;
  width: number;
  height: number;
  frame_count: number;
  duration_ms: number;
  created_at: number;
}

export interface RecordArea {
  x: number;
  y: number;
  w: number;
  h: number;
  monitorId?: number | null;
}

export interface RecordingOptions {
  outputFormat: "mp4" | "mov";
  fps: 15 | 24 | 30;
  quality: "compact" | "balanced" | "high";
  resolution: "720p" | "1080p" | "native";
}

export type CaptureMode = "screenshot" | "recording";

export interface RelativeCaptureRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CaptureExecutionOptions {
  destination?: "library" | "desktop" | "documents" | "clipboard" | "custom";
  customDirectory?: string | null;
  openAfter?: "none" | "preview" | "player" | "mail";
  showFloatingThumbnail?: boolean;
  rememberSelection?: boolean;
  includeCursor?: boolean;
  showMouseClicks?: boolean;
  microphoneId?: string | null;
  recordingMasks?: RelativeCaptureRect[];
  playSound?: boolean;
}

export interface AudioInput {
  id: string;
  name: string;
  isDefault: boolean;
  available: boolean;
}

/** Shared capture-selection port used by the main module and floating island. */
export function requestCaptureSelection(
  mode: CaptureMode,
  includeMainWindow = false,
): Promise<void> {
  return invoke("screencap_begin_capture_select", { mode, includeMainWindow });
}

/** Re-shot the last confirmed region without opening the picker (global shortcut path). */
export function recaptureLastRegion(): Promise<void> {
  return invoke("screencap_recapture_last_region");
}

/** One-shot toast path so a late-mounted ScreenRecorder still shows post-capture UI. */
let pendingScreenshotToastPath: string | null = null;
let captureListenerStarted = false;
type Translate = (key: string, fallback: string) => string;
let captureTranslate: Translate = (_key, fallback) => fallback;
const CAPTURE_COMPLETE_ISLAND_ID = "screencap.capture-complete";

export function queueScreenshotToast(path: string): void {
  pendingScreenshotToastPath = path;
}

export function takeScreenshotToast(): string | null {
  const path = pendingScreenshotToastPath;
  pendingScreenshotToastPath = null;
  return path;
}

/** Call once from the main webview so captures are queued even if the module is unmounted. */
export function ensureCaptureToastListener(t?: Translate): void {
  if (t) captureTranslate = t;
  if (captureListenerStarted || typeof window === "undefined") return;
  if (!("__TAURI_INTERNALS__" in window)) return;
  captureListenerStarted = true;
  void listen<{
    kind?: string;
    path?: string;
    dismissed?: boolean;
    copied?: boolean;
    showFloatingThumbnail?: boolean;
  }>(
    "screencap:captured",
    (event) => {
    const path = event.payload?.path;
    if (!path || !path.toLowerCase().endsWith(".png")) return;
    // Cmd/Ctrl+C copy-and-continue: image is already on the clipboard and Qx
    // stays hidden — no "Screenshot saved / Copy" toast that would break flow.
    if (event.payload?.dismissed) return;
    if (event.payload?.showFloatingThumbnail === false) return;
    queueScreenshotToast(path);
    const filename = path.split(/[\\/]/).pop() || path;
    const showCaptured = () => {
      islandHost.show({
        id: CAPTURE_COMPLETE_ISLAND_ID,
        priority: "toast",
        source: "module",
        placement: "docked-or-float",
        ttlMs: 10_000,
        content: {
          identity: { iconName: "camera" },
          primary: captureTranslate("screencap.capture.saved", "Screenshot saved"),
          secondary: filename,
          tone: "success",
          action: {
            id: "copy",
            label: captureTranslate("screencap.capture.copy", "Copy"),
          },
        },
        actions: {
          copy: async () => {
            try {
              await invoke("screencap_copy_image_to_clipboard", { path });
              islandHost.show({
                id: CAPTURE_COMPLETE_ISLAND_ID,
                priority: "toast",
                source: "module",
                placement: "docked-or-float",
                ttlMs: 2_400,
                content: {
                  identity: { iconName: "camera" },
                  primary: captureTranslate("screencap.capture.copied", "Screenshot copied"),
                  secondary: filename,
                  tone: "success",
                  effect: { kind: "orbit", nonce: Date.now() },
                },
              });
            } catch (copyError) {
              islandHost.show({
                id: CAPTURE_COMPLETE_ISLAND_ID,
                priority: "error",
                source: "module",
                placement: "docked-or-float",
                ttlMs: 6_000,
                content: {
                  identity: { iconName: "camera" },
                  primary: captureTranslate("screencap.capture.copyFailed", "Copy failed"),
                  secondary: String(copyError),
                  tone: "danger",
                },
              });
            }
          },
        },
      });
    };
    showCaptured();
  });
  // Screenshot → OCR → Text Toolbox (editor destination). Clipboard destination
  // is handled natively in Rust; editor needs a main-webview tab switch.
  void listen<{
    destination?: string;
    text?: string;
    error?: string;
  }>("screencap:ocr", async (event) => {
    const { destination, text, error } = event.payload ?? {};
    if (error || !text?.trim()) return;
    if (destination !== "editor") return;
    try {
      const { setPendingModuleLaunch } = await import("../../search/moduleSurfaces");
      const { useStore } = await import("../../store");
      setPendingModuleLaunch({
        tab: "documents",
        surface: "import",
        params: {
          content: text,
          title: text.split(/\r?\n/).find((line) => line.trim())?.trim().slice(0, 48) || "OCR",
        },
      });
      useStore.getState().setTab("documents");
    } catch {
      /* best-effort */
    }
  });
}

export type RecordingStatus = "idle" | "recording" | "processing" | "done" | "error";

export interface RecordingSnapshot {
  phase: RecordingStatus;
  isRecording: boolean;
  elapsedMs: number;
  frameCount: number;
  area: RecordArea | null;
  outputPath: string | null;
  error: string | null;
  controlsVisible: boolean;
  controlsPinned: boolean;
}

interface ScreencapStore {
  isRecording: boolean;
  status: RecordingStatus;
  elapsedMs: number;
  frameCount: number;
  controlsVisible: boolean;
  lastGifPath: string | null;
  history: ScreencapEntry[];
  error: string | null;
  /** Inline status surfaced in the preview pane for copy / save-as / reveal. */
  previewStatus: { msg: string | null; error: boolean; saving: boolean };
  startRecording: (area?: RecordArea | null, options?: RecordingOptions) => Promise<void>;
  stopRecording: () => Promise<void>;
  syncRecordingStatus: () => Promise<RecordingSnapshot | null>;
  showControls: () => Promise<void>;
  loadHistory: () => Promise<void>;
  deleteEntry: (id: number) => Promise<void>;
  renameEntry: (id: number, newName: string) => Promise<boolean>;
  clearHistory: () => Promise<void>;
  setPreview: (path: string) => void;
  reset: () => void;
  /** Preview-driven actions that share status with the right pane. */
  saveAsCopy: (path: string, t: Translate) => Promise<void>;
  copyImage: (path: string, t: Translate) => Promise<void>;
  revealInFolder: (path: string, t: Translate) => Promise<void>;
  clearPreviewStatus: () => void;
}

export const useScreencapStore = create<ScreencapStore>((set, get) => ({
  isRecording: false,
  status: "idle",
  elapsedMs: 0,
  frameCount: 0,
  controlsVisible: false,
  lastGifPath: null,
  history: [],
  error: null,
  previewStatus: { msg: null, error: false, saving: false },

  startRecording: async (area, options = DEFAULT_RECORDING_OPTIONS) => {
    set({ error: null });
    try {
      await invoke("start_recording", { area: area ?? null, options });
      // Ensure the floating island control strip is visible (backend also opens it).
      await invoke("screencap_show_controls").catch(() => {});
      await get().syncRecordingStatus();
    } catch (e) {
      set({ isRecording: false, status: "error", error: String(e) });
    }
  },

  stopRecording: async () => {
    set({ status: "processing", isRecording: true });
    try {
      const path = await invoke<string>("stop_recording");
      set({
        isRecording: false,
        status: "done",
        elapsedMs: 0,
        controlsVisible: false,
        lastGifPath: path,
        error: null,
      });
      await get().loadHistory();
    } catch (e) {
      set({ isRecording: false, status: "error", error: String(e) });
    }
  },

  syncRecordingStatus: async () => {
    try {
      const snapshot = await invoke<RecordingSnapshot>("recording_status");
      set({
        status: snapshot.phase,
        isRecording: snapshot.isRecording,
        elapsedMs: snapshot.elapsedMs,
        frameCount: snapshot.frameCount,
        controlsVisible: snapshot.controlsVisible,
        lastGifPath: snapshot.outputPath ?? get().lastGifPath,
        error: snapshot.error,
      });
      return snapshot;
    } catch {
      return null;
    }
  },

  showControls: async () => {
    try {
      await invoke("screencap_show_controls");
      await get().syncRecordingStatus();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadHistory: async () => {
    try {
      const res = await invoke<ScreencapEntry[]>("get_screencap_history");
      set({ history: res });
    } catch {
      // keep existing history on error
    }
  },

  deleteEntry: async (id) => {
    try {
      const removed = get().history.find((h) => h.id === id);
      await invoke("delete_screencap", { id });
      const history = get().history.filter((h) => h.id !== id);
      const wasPreviewing = Boolean(removed && get().lastGifPath === removed.path);
      const lastGifPath = wasPreviewing ? (history[0]?.path ?? null) : get().lastGifPath;
      const status = get().status === "recording" || get().status === "processing"
        ? get().status
        : lastGifPath
          ? "done"
          : "idle";
      set({ history, lastGifPath, status });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  renameEntry: async (id, newName) => {
    try {
      const previous = get().history.find((entry) => entry.id === id);
      const renamed = await invoke<ScreencapEntry>("rename_screencap", { id, newName });
      set({
        history: get().history.map((entry) => entry.id === id ? renamed : entry),
        lastGifPath: previous && get().lastGifPath === previous.path
          ? renamed.path
          : get().lastGifPath,
        error: null,
      });
      return true;
    } catch (e) {
      set({ error: String(e) });
      return false;
    }
  },

  clearHistory: async () => {
    const ids = get().history.map((h) => h.id);
    try {
      await Promise.all(ids.map((id) => invoke("delete_screencap", { id })));
      set({ history: [], lastGifPath: null, status: "idle" });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  // Keep status usable for browsing history after a finished capture.
  setPreview: (path) => {
    set({ lastGifPath: path, status: "done", error: null });
    // Switching previews invalidates any in-flight action feedback.
    get().clearPreviewStatus();
  },

  reset: () => {
    if (get().isRecording) return;
    set({
      status: "idle",
      elapsedMs: 0,
      frameCount: 0,
      controlsVisible: false,
      error: null,
      lastGifPath: null,
      previewStatus: { msg: null, error: false, saving: false },
    });
  },

  clearPreviewStatus: () => {
    set((current) => {
      if (current.previewStatus.msg === null && !current.previewStatus.error && !current.previewStatus.saving) {
        return current;
      }
      return { previewStatus: { msg: null, error: false, saving: false } };
    });
  },

  saveAsCopy: async (path, t) => {
    if (!path) return;
    const fileName = path.split(/[\\/]/).pop() ?? path;
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    const escapedExtension = extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const suffix = extension || "mp4";
    const base = fileName.replace(new RegExp(`\\.${escapedExtension}$`, "i"), "") + "_copy";
    const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const dir = path.substring(0, separatorIndex);
    const pathSeparator = path.lastIndexOf("\\") > path.lastIndexOf("/") ? "\\" : "/";
    const dest = `${dir}${pathSeparator}${base}.${suffix}`;
    set({
      previewStatus: { msg: null, error: false, saving: true },
    });
    try {
      await invoke("save_gif", { sourcePath: path, destPath: dest });
      set({
        previewStatus: {
          msg: `${t("screencap.preview.savedTo", "Saved to")} ${dest}`,
          error: false,
          saving: false,
        },
      });
    } catch (e) {
      set({
        previewStatus: {
          msg: `${t("common.error", "Error")}: ${String(e)}`,
          error: true,
          saving: false,
        },
      });
    }
  },

  copyImage: async (path, t) => {
    if (!path) return;
    set({
      previewStatus: { msg: null, error: false, saving: false },
    });
    try {
      await writeImageFileToClipboard(path);
      set({
        previewStatus: {
          msg: t("screencap.toast.copied", "Copied"),
          error: false,
          saving: false,
        },
      });
    } catch (e) {
      set({
        previewStatus: {
          msg: `${t("common.error", "Error")}: ${String(e)}`,
          error: true,
          saving: false,
        },
      });
    }
  },

  revealInFolder: async (path, t) => {
    if (!path) return;
    try {
      await revealSystemPath(path);
    } catch (e) {
      set({
        previewStatus: {
          msg: `${t("screencap.preview.revealFailed", "Show in folder failed")}: ${String(e)}`,
          error: true,
          saving: false,
        },
      });
    }
  },
}));
