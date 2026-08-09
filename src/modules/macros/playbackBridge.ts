import { listen } from "@tauri-apps/api/event";
import { islandHost } from "../../island";
import {
  useMacroStore,
  type MacroPlaybackEvent,
  type MacroRecordingEvent,
  type MacroStep,
} from "./store";

const MACRO_PLAYBACK_EVENT = "macro:playback";
const MACRO_RECORDING_EVENT = "macro:recording";
const MACRO_PLAYBACK_ISLAND_ID = "macros.playback";
type Translator = (key: string, fallback: string) => string;

let translator: Translator | null = null;
let listenerStarted = false;
let islandShown = false;
let latestPlaybackId = 0;

function replace(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.split(`{${key}}`).join(String(value)),
    template,
  );
}

function translate(key: string, fallback: string): string {
  return translator?.(key, fallback) ?? fallback;
}

export function formatMacroStep(step: MacroStep, t: Translator): string {
  const kind = (() => {
    switch (step.event_type) {
      case "key_press": return t("macros.step.keyPress", "Key press");
      case "key_release": return t("macros.step.keyRelease", "Key release");
      case "mouse_move": return t("macros.step.mouseMove", "Mouse move");
      case "mouse_click": return t("macros.step.mouseClick", "Mouse click");
      case "mouse_release": return t("macros.step.mouseRelease", "Mouse release");
      case "text_input": return t("macros.step.textInput", "Type text");
      case "launch_application": return t("macros.step.launchApplication", "Open application");
      case "wait": return t("macros.step.wait", "Wait");
      default: return t("macros.step.unknown", "Step");
    }
  })();
  const value = step.key ?? step.button ?? step.text ?? step.application ?? (
    step.x != null && step.y != null ? `${step.x}, ${step.y}` : ""
  );
  return value ? `${kind} · ${value}` : kind;
}

function progressPercent(event: MacroPlaybackEvent): number {
  if (event.state === "completed") return 100;
  if (event.total_steps <= 0) return 0;
  return Math.max(0, Math.min(100, (event.completed_steps / event.total_steps) * 100));
}

function playbackContent(event: MacroPlaybackEvent): {
  primary: string;
  secondary: string;
  tone: "neutral" | "success" | "warning" | "danger";
  progress: number;
} {
  const t = translate;
  if (event.state === "waiting") {
    return {
      primary: replace(t("macros.playback.waitingTitle", "Waiting to play {name}"), {
        name: event.macro_name,
      }),
      secondary: replace(t("macros.playback.waiting", "Starts in {time}"), {
        time: t("macros.playback.seconds", "{n}s").replace(
          "{n}",
          String(Math.ceil(event.remaining_delay_ms / 1000)),
        ),
      }),
      tone: "neutral",
      progress: progressPercent(event),
    };
  }
  if (event.state === "playing") {
    const step = event.current_step
      ? formatMacroStep(event.current_step, t)
      : t("macros.playback.running", "Running");
    return {
      primary: replace(t("macros.playback.playing", "Playing {name}"), {
        name: event.macro_name,
      }),
      secondary: replace(t("macros.playback.step", "Step {current}/{total}: {label}"), {
        current: event.current_step_index ?? event.completed_steps,
        total: event.total_steps,
        label: step,
      }),
      tone: "neutral",
      progress: progressPercent(event),
    };
  }
  if (event.state === "paused") {
    const step = event.current_step
      ? formatMacroStep(event.current_step, t)
      : t("macros.playback.running", "Running");
    return {
      primary: replace(t("macros.playback.paused", "Playback paused: {name}"), {
        name: event.macro_name,
      }),
      secondary: replace(t("macros.playback.pausedStep", "Paused at step {current}/{total}: {label}"), {
        current: event.current_step_index ?? event.completed_steps,
        total: event.total_steps,
        label: step,
      }),
      tone: "warning",
      progress: progressPercent(event),
    };
  }
  if (event.state === "completed") {
    return {
      primary: t("macros.playback.completed", "Playback complete"),
      secondary: replace(t("macros.playback.completedSteps", "{n} steps executed"), {
        n: event.total_steps,
      }),
      tone: "success",
      progress: 100,
    };
  }
  if (event.state === "cancelled") {
    return {
      primary: t("macros.playback.cancelled", "Playback stopped"),
      secondary: replace(t("macros.playback.progress", "{done}/{total} steps"), {
        done: event.completed_steps,
        total: event.total_steps,
      }),
      tone: "warning",
      progress: progressPercent(event),
    };
  }
  return {
    primary: t("macros.playback.error", "Playback failed"),
    secondary: event.error || t("macros.playback.errorDetail", "Input playback failed"),
    tone: "danger",
    progress: progressPercent(event),
  };
}

function syncPlaybackIsland(event: MacroPlaybackEvent): void {
  const content = playbackContent(event);
  const active = event.state === "waiting"
    || event.state === "playing"
    || event.state === "paused";
  const toggleAction = active
    ? {
        id: "toggle-pause",
        label: translate(
          event.state === "paused" ? "macros.playback.resume" : "macros.playback.pause",
          event.state === "paused" ? "Resume playback" : "Pause playback",
        ),
        shortcut: "Space",
        icon: event.state === "paused" ? "play" as const : "pause" as const,
      }
    : undefined;
  const stopAction = active
    ? {
        id: "stop",
        label: translate("macros.playback.stop", "Stop playback"),
        icon: "stop" as const,
        variant: "danger" as const,
      }
    : undefined;
  const islandContent = {
    primary: content.primary,
    secondary: content.secondary,
    tone: content.tone,
    meter: {
      kind: "progress" as const,
      progress: content.progress,
      presentation: "compact-line" as const,
    },
    actions: toggleAction && stopAction ? [toggleAction, stopAction] : undefined,
  };
  const actions: Record<string, () => void | Promise<void>> = active
    ? {
        "toggle-pause": () => useMacroStore.getState().togglePlaybackPause(),
        stop: () => useMacroStore.getState().stopPlayback(),
      }
    : {};

  if (!active) {
    islandHost.dismiss(MACRO_PLAYBACK_ISLAND_ID);
    islandShown = false;
  }

  const input = {
    id: MACRO_PLAYBACK_ISLAND_ID,
    priority: active ? "task" as const : event.state === "error" ? "error" as const : "toast" as const,
    source: "module" as const,
    placement: "docked-or-float" as const,
    sticky: active,
    progressSilent: true,
    ttlMs: active ? undefined : event.state === "error" ? 8_000 : 3_000,
    openTarget: { kind: "module" as const, id: "macros" },
    content: islandContent,
    actions,
  };

  if (active && islandShown) {
    const updated = islandHost.update(MACRO_PLAYBACK_ISLAND_ID, {
      priority: input.priority,
      placement: input.placement,
      sticky: input.sticky,
      progressSilent: true,
      ttlMs: null,
      openTarget: input.openTarget,
      content: input.content,
      actions: input.actions,
    });
    if (updated.ok) return;
  }

  islandHost.show(input);
  islandShown = active;
}

/** Install once; the bridge intentionally outlives the module view so a
 * playback island remains usable after navigating away from Macro Recorder. */
export function ensureMacroPlaybackBridge(t: Translator): void {
  translator = t;
  if (listenerStarted) return;
  listenerStarted = true;
  void listen<MacroPlaybackEvent>(MACRO_PLAYBACK_EVENT, ({ payload }) => {
    if (payload.playback_id < latestPlaybackId) return;
    latestPlaybackId = payload.playback_id;
    useMacroStore.getState().applyPlaybackEvent(payload);
    syncPlaybackIsland(payload);
  }).catch(() => {
    // The browser-only preview has no Tauri event bus. Allow a later native
    // mount to retry instead of permanently marking the bridge as installed.
    listenerStarted = false;
  });
  void listen<MacroRecordingEvent>(MACRO_RECORDING_EVENT, ({ payload }) => {
    useMacroStore.getState().applyRecordingEvent(payload);
  });
}
