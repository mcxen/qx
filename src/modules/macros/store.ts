import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface MacroStep {
  event_type: string;
  key: string | null;
  x: number | null;
  y: number | null;
  button: string | null;
  duration_ms: number;
}

export interface MacroData {
  id: number | null;
  name: string;
  steps: MacroStep[];
  total_duration_ms: number;
  created_at: number | null;
}

interface MacroStore {
  isRecording: boolean;
  lastRecordedSteps: MacroStep[] | null;
  lastTotalDurationMs: number;
  savedMacros: MacroData[];
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  saveMacro: (name: string) => Promise<number | null>;
  listMacros: () => Promise<void>;
  deleteMacro: (id: number) => Promise<void>;
  playMacro: (id: number) => Promise<void>;
  clearLast: () => void;
  setError: (e: string | null) => void;
}

export const useMacroStore = create<MacroStore>((set, get) => ({
  isRecording: false,
  lastRecordedSteps: null,
  lastTotalDurationMs: 0,
  savedMacros: [],
  error: null,

  startRecording: async () => {
    set({ error: null });
    try {
      await invoke("macro_start_recording");
      set({
        isRecording: true,
        lastRecordedSteps: null,
        lastTotalDurationMs: 0,
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  stopRecording: async () => {
    try {
      const data = await invoke<MacroData>("macro_stop_recording");
      set({
        isRecording: false,
        lastRecordedSteps: data.steps,
        lastTotalDurationMs: data.total_duration_ms,
      });
    } catch (e) {
      set({ isRecording: false, error: String(e) });
    }
  },

  saveMacro: async (name) => {
    const { lastRecordedSteps, lastTotalDurationMs } = get();
    if (!lastRecordedSteps) return null;
    const data: MacroData = {
      id: null,
      name,
      steps: lastRecordedSteps,
      total_duration_ms: lastTotalDurationMs,
      created_at: null,
    };
    try {
      const id = await invoke<number>("macro_save", { name, data });
      set({ lastRecordedSteps: null, lastTotalDurationMs: 0 });
      await get().listMacros();
      return id;
    } catch (e) {
      set({ error: String(e) });
      return null;
    }
  },

  listMacros: async () => {
    try {
      const res = await invoke<MacroData[]>("macro_list");
      set({ savedMacros: res });
    } catch {
      // keep existing list on error
    }
  },

  deleteMacro: async (id) => {
    try {
      await invoke("macro_delete", { id });
      set({ savedMacros: get().savedMacros.filter((m) => m.id !== id) });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  playMacro: async (id) => {
    set({ error: null });
    try {
      await invoke("macro_play", { id });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearLast: () => set({ lastRecordedSteps: null, lastTotalDurationMs: 0 }),
  setError: (error) => set({ error }),
}));
