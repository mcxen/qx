import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../settings/store";

export interface MacroStep {
  event_type: string;
  key: string | null;
  x: number | null;
  y: number | null;
  button: string | null;
  text?: string | null;
  application?: string | null;
  duration_ms: number;
}

export interface MacroData {
  id: number | null;
  name: string;
  steps: MacroStep[];
  total_duration_ms: number;
  created_at: number | null;
}

export type MacroPlaybackStatus =
  | "idle"
  | "waiting"
  | "playing"
  | "paused"
  | "completed"
  | "cancelled"
  | "error";

export interface MacroPlaybackEvent {
  playback_id: number;
  macro_id: number;
  macro_name: string;
  state: Exclude<MacroPlaybackStatus, "idle">;
  delay_ms: number;
  remaining_delay_ms: number;
  completed_steps: number;
  total_steps: number;
  /** One-based current step number. */
  current_step_index: number | null;
  current_step: MacroStep | null;
  error: string | null;
}

export interface MacroPlaybackStarted {
  playback_id: number;
  macro_id: number;
  macro_name: string;
  total_steps: number;
  delay_ms: number;
}

export interface MacroRecordingEvent {
  elapsed_ms: number;
  steps: number;
  cursor_x: number | null;
  cursor_y: number | null;
  mouse_button: string | null;
  button_pressed: boolean;
}

export interface MacroRecordingState {
  elapsedMs: number;
  steps: number;
  cursorX: number | null;
  cursorY: number | null;
  mouseButton: string | null;
  buttonPressed: boolean;
}

export const idleMacroRecording: MacroRecordingState = {
  elapsedMs: 0,
  steps: 0,
  cursorX: null,
  cursorY: null,
  mouseButton: null,
  buttonPressed: false,
};

export interface MacroPlaybackState {
  status: MacroPlaybackStatus;
  playbackId: number | null;
  macroId: number | null;
  macroName: string;
  delayMs: number;
  remainingDelayMs: number;
  completedSteps: number;
  totalSteps: number;
  currentStepIndex: number | null;
  currentStep: MacroStep | null;
  error: string | null;
}

export const idleMacroPlayback: MacroPlaybackState = {
  status: "idle",
  playbackId: null,
  macroId: null,
  macroName: "",
  delayMs: 0,
  remainingDelayMs: 0,
  completedSteps: 0,
  totalSteps: 0,
  currentStepIndex: null,
  currentStep: null,
  error: null,
};

interface MacroStore {
  isRecording: boolean;
  lastRecordedSteps: MacroStep[] | null;
  lastTotalDurationMs: number;
  savedMacros: MacroData[];
  error: string | null;
  recording: MacroRecordingState;
  playback: MacroPlaybackState;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  saveMacro: (name: string) => Promise<number | null>;
  createDemoMacro: (name: string) => Promise<void>;
  listMacros: () => Promise<void>;
  deleteMacro: (id: number) => Promise<void>;
  playMacro: (id: number, delayMs?: number) => Promise<void>;
  togglePlaybackPause: () => Promise<void>;
  stopPlayback: () => Promise<void>;
  applyPlaybackEvent: (event: MacroPlaybackEvent) => void;
  applyRecordingEvent: (event: MacroRecordingEvent) => void;
  clearLast: () => void;
  setError: (e: string | null) => void;
}

// Esc, the visible Stop controls, and module teardown can converge on the
// same store action. Keep one in-flight request so an unmount cannot issue a
// second stop against a newly-started or already-stopped native session.
let stopInFlight: Promise<void> | null = null;
let startInFlight: Promise<void> | null = null;
let stopRequested = false;
let playbackStartInFlight: Promise<void> | null = null;
let playbackStopInFlight: Promise<void> | null = null;
let playbackStopRequested = false;

function configuredStopTailMs(): number {
  const seconds = Number(useSettingsStore.getState().settings.macros?.stop_tail_seconds ?? 2);
  if (!Number.isFinite(seconds)) return 2_000;
  return Math.max(0, Math.min(60, Math.round(seconds))) * 1_000;
}

export const useMacroStore = create<MacroStore>((set, get) => ({
  isRecording: false,
  lastRecordedSteps: null,
  lastTotalDurationMs: 0,
  savedMacros: [],
  error: null,
  recording: idleMacroRecording,
  playback: idleMacroPlayback,

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
          recording: idleMacroRecording,
        });
        await invoke("macro_cursor_overlay_show").catch(() => {
          // The native recorder remains usable if a transparent overlay cannot
          // be created (for example, while a display is being reconfigured).
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
        const data = await invoke<MacroData>("macro_stop_recording", {
          excludeTailMs: configuredStopTailMs(),
        });
        set({
          isRecording: false,
          lastRecordedSteps: data.steps,
          lastTotalDurationMs: data.total_duration_ms,
          recording: idleMacroRecording,
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

  createDemoMacro: async (name) => {
    try {
      await invoke("macro_create_demo", { name });
      await get().listMacros();
    } catch (e) {
      set({ error: String(e) });
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

  playMacro: (id, delayMs = 0) => {
    if (playbackStartInFlight) return playbackStartInFlight;
    if (playbackStopInFlight) return playbackStopInFlight;
    if (get().playback.status === "waiting"
      || get().playback.status === "playing"
      || get().playback.status === "paused") {
      return Promise.resolve();
    }

    playbackStopRequested = false;
    const normalizedDelay = Math.max(0, Math.min(60_000, Math.round(delayMs)));
    set({
      error: null,
      playback: {
        ...idleMacroPlayback,
        status: "waiting",
        macroId: id,
        delayMs: normalizedDelay,
      },
    });
    playbackStartInFlight = (async () => {
      try {
        const started = await invoke<MacroPlaybackStarted>("macro_play", {
          id,
          delay_ms: normalizedDelay,
        });
        set((state) => {
          if (state.playback.status !== "waiting" || state.playback.macroId !== id) {
            return state;
          }
          return {
            ...state,
            playback: {
              ...state.playback,
              playbackId: started.playback_id,
              macroName: started.macro_name,
              totalSteps: started.total_steps,
              delayMs: started.delay_ms,
            },
          };
        });
        if (playbackStopRequested) {
          await invoke("macro_stop_playback");
        }
      } catch (e) {
        const message = String(e);
        set((state) => ({
          error: message,
          playback: {
            ...state.playback,
            status: "error",
            error: message,
          },
        }));
      } finally {
        playbackStartInFlight = null;
      }
    })();
    return playbackStartInFlight;
  },

  togglePlaybackPause: async () => {
    try {
      const paused = await invoke<boolean>("macro_toggle_playback_pause");
      set((state) => {
        if (!isMacroPlaybackActive(state.playback.status)) return state;
        return {
          ...state,
          playback: {
            ...state.playback,
            status: paused
              ? "paused"
              : state.playback.status === "paused"
                ? "playing"
                : state.playback.status,
          },
        };
      });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  stopPlayback: () => {
    playbackStopRequested = true;
    if (playbackStopInFlight) return playbackStopInFlight;
    playbackStopInFlight = (async () => {
      try {
        if (playbackStartInFlight) await playbackStartInFlight;
        const status = get().playback.status;
        if (status === "waiting" || status === "playing") {
          await invoke("macro_stop_playback");
        }
      } catch (e) {
        const message = String(e);
        set((state) => ({
          error: message,
          playback: { ...state.playback, status: "error", error: message },
        }));
      } finally {
        playbackStopInFlight = null;
      }
    })();
    return playbackStopInFlight;
  },

  applyPlaybackEvent: (event) => {
    const status = event.state as MacroPlaybackStatus;
    set((state) => {
      if (
        state.playback.playbackId != null
        && event.playback_id < state.playback.playbackId
      ) {
        return state;
      }
      return {
        playback: {
          status,
          playbackId: event.playback_id,
          macroId: event.macro_id,
          macroName: event.macro_name,
          delayMs: event.delay_ms,
          remainingDelayMs: event.remaining_delay_ms,
          completedSteps: event.completed_steps,
          totalSteps: event.total_steps,
          currentStepIndex: event.current_step_index,
          currentStep: event.current_step,
          error: event.error,
        },
        error: event.state === "error" ? event.error : null,
      };
    });
  },

  applyRecordingEvent: (event) => {
    set({
      recording: {
        elapsedMs: event.elapsed_ms,
        steps: event.steps,
        cursorX: event.cursor_x,
        cursorY: event.cursor_y,
        mouseButton: event.mouse_button,
        buttonPressed: event.button_pressed,
      },
    });
  },

  clearLast: () => set({ lastRecordedSteps: null, lastTotalDurationMs: 0 }),
  setError: (error) => set({ error }),
}));

function isMacroPlaybackActive(status: MacroPlaybackStatus): boolean {
  return status === "waiting" || status === "playing" || status === "paused";
}
