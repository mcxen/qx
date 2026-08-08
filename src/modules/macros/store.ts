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

// Esc, the visible Stop controls, and module teardown can converge on the
// same store action. Keep one in-flight request so an unmount cannot issue a
// second stop against a newly-started or already-stopped native session.
let stopInFlight: Promise<void> | null = null;
let startInFlight: Promise<void> | null = null;
let stopRequested = false;

export const useMacroStore = create<MacroStore>((set, get) => ({
  isRecording: false,
  lastRecordedSteps: null,
  lastTotalDurationMs: 0,
  savedMacros: [],
  error: null,

  startRecording: () => {
    if (startInFlight) return startInFlight;
    if (stopInFlight) return stopInFlight;

    stopRequested = false;
    set({ error: null });
    startInFlight = (async () => {
      try {
        await invoke("macro_start_recording");
        // A module teardown may have requested stop while native start was
        // waiting for its hook/event-tap thread. Let that stop action perform
        // the matching native stop without publishing a stale recording UI.
        if (stopRequested) return;
        set({
          isRecording: true,
          lastRecordedSteps: null,
          lastTotalDurationMs: 0,
        });
      } catch (e) {
        set({ error: String(e) });
      } finally {
        startInFlight = null;
      }
    })();
    return startInFlight;
  },

  stopRecording: () => {
    stopRequested = true;
    if (stopInFlight) return stopInFlight;
    stopInFlight = (async () => {
      try {
        if (startInFlight) await startInFlight;
        const data = await invoke<MacroData>("macro_stop_recording");
        set({
          isRecording: false,
          lastRecordedSteps: data.steps,
          lastTotalDurationMs: data.total_duration_ms,
        });
      } catch (e) {
        const message = String(e);
        if (message === "Not recording") {
          set({ isRecording: false });
        } else {
          set({ isRecording: false, error: message });
        }
      } finally {
        stopInFlight = null;
      }
    })();
    return stopInFlight;
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
