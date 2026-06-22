import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface ScreencapEntry {
  id: number;
  path: string;
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
}

export type RecordingStatus = "idle" | "recording" | "processing" | "done" | "error";

interface ScreencapStore {
  isRecording: boolean;
  status: RecordingStatus;
  lastGifPath: string | null;
  history: ScreencapEntry[];
  error: string | null;
  startRecording: (area?: RecordArea | null) => Promise<void>;
  stopRecording: () => Promise<void>;
  loadHistory: () => Promise<void>;
  deleteEntry: (id: number) => Promise<void>;
  clearHistory: () => Promise<void>;
  setPreview: (path: string) => void;
  reset: () => void;
}

export const useScreencapStore = create<ScreencapStore>((set, get) => ({
  isRecording: false,
  status: "idle",
  lastGifPath: null,
  history: [],
  error: null,

  startRecording: async (area) => {
    set({ error: null });
    try {
      await invoke("start_recording", { area: area ?? null });
      set({ isRecording: true, status: "recording" });
    } catch (e) {
      set({ status: "error", error: String(e) });
    }
  },

  stopRecording: async () => {
    set({ status: "processing" });
    try {
      const path = await invoke<string>("stop_recording");
      set({ isRecording: false, status: "done", lastGifPath: path });
      await get().loadHistory();
    } catch (e) {
      set({ isRecording: false, status: "error", error: String(e) });
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
      await invoke("delete_screencap", { id });
      set({ history: get().history.filter((h) => h.id !== id) });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearHistory: async () => {
    const ids = get().history.map((h) => h.id);
    try {
      await Promise.all(ids.map((id) => invoke("delete_screencap", { id })));
      set({ history: [] });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setPreview: (path) => set({ lastGifPath: path, status: "done" }),

  reset: () => set({ status: "idle", error: null, lastGifPath: null }),
}));
