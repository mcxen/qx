import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_RECORDING_OPTIONS } from "./preferences";

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

/** Shared capture-selection port used by the main module and floating island. */
export function requestCaptureSelection(mode: CaptureMode): Promise<void> {
  return invoke("screencap_begin_capture_select", { mode });
}

/** Re-shot the last confirmed region without opening the picker (global shortcut path). */
export function recaptureLastRegion(): Promise<void> {
  return invoke("screencap_recapture_last_region");
}

/** One-shot toast path so a late-mounted ScreenRecorder still shows post-capture UI. */
let pendingScreenshotToastPath: string | null = null;
let captureListenerStarted = false;

export function queueScreenshotToast(path: string): void {
  pendingScreenshotToastPath = path;
}

export function takeScreenshotToast(): string | null {
  const path = pendingScreenshotToastPath;
  pendingScreenshotToastPath = null;
  return path;
}

/** Call once from the main webview so captures are queued even if the module is unmounted. */
export function ensureCaptureToastListener(): void {
  if (captureListenerStarted || typeof window === "undefined") return;
  if (!("__TAURI_INTERNALS__" in window)) return;
  captureListenerStarted = true;
  void listen<{ kind?: string; path?: string }>("screencap:captured", (event) => {
    const path = event.payload?.path;
    if (!path || !path.toLowerCase().endsWith(".png")) return;
    queueScreenshotToast(path);
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
  startRecording: (area?: RecordArea | null, options?: RecordingOptions) => Promise<void>;
  stopRecording: () => Promise<void>;
  syncRecordingStatus: () => Promise<RecordingSnapshot | null>;
  showControls: () => Promise<void>;
  loadHistory: () => Promise<void>;
  deleteEntry: (id: number) => Promise<void>;
  clearHistory: () => Promise<void>;
  setPreview: (path: string) => void;
  reset: () => void;
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
  setPreview: (path) => set({ lastGifPath: path, status: "done", error: null }),

  reset: () => {
    if (get().isRecording) return;
    set({
      status: "idle",
      elapsedMs: 0,
      frameCount: 0,
      controlsVisible: false,
      error: null,
      lastGifPath: null,
    });
  },
}));
