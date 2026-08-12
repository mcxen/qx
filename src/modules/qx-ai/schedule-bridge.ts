import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

type ScheduleFireEvent = {
  id: string;
  name?: string;
  kind?: string;
  skillId?: string | null;
  prompt?: string;
};

let started = false;
let startPromise: Promise<void> | null = null;

/**
 * Listen for headless schedule fires that need a full agent turn (`agent_prompt`).
 * Morning desk log runs entirely in Rust.
 *
 * Isolation rules:
 * - Does **not** import the AI store/agent at module load time (keeps App shell light).
 * - Starts asynchronously; failures never throw into the caller.
 * - Event handling yields to the macrotask queue so UI input is not blocked.
 * - Creates a **background** conversation (no focus steal) and fire-and-forgets
 *   `sendMessage` so the agent turn never blocks the event path or main shell.
 */
export function startQxAiScheduleBridge(): void {
  if (started || typeof window === "undefined") return;
  if (startPromise) return;
  startPromise = (async () => {
    try {
      await listen<ScheduleFireEvent>("qxai-schedule-fire", (event) => {
        // Return immediately; run work off the event delivery path.
        window.setTimeout(() => {
          void handleScheduleFire(event.payload).catch((error) => {
            console.error("qxai schedule fire failed", error);
          });
        }, 0);
      });
      started = true;
    } catch (error) {
      console.error("qxai schedule bridge listen failed", error);
      startPromise = null;
    }
  })();
}

/** Deferred start for App shell — idle/timeout, never blocks first paint. */
export function startQxAiScheduleBridgeDeferred(delayMs = 4_000): () => void {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  let idleId: number | undefined;
  let timerId: ReturnType<typeof window.setTimeout> | undefined;

  const run = () => {
    if (cancelled) return;
    try {
      startQxAiScheduleBridge();
    } catch (error) {
      console.error("qxai schedule bridge deferred start failed", error);
    }
  };

  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }
  ).requestIdleCallback;

  if (typeof ric === "function") {
    idleId = ric(run, { timeout: delayMs });
  } else {
    timerId = window.setTimeout(run, delayMs);
  }

  return () => {
    cancelled = true;
    if (idleId !== undefined) {
      (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(
        idleId,
      );
    }
    if (timerId !== undefined) window.clearTimeout(timerId);
  };
}

/**
 * Kick off a scheduled agent turn in the background:
 * 1. Ensure sessions/providers are loaded (async).
 * 2. Open a **new** conversation without switching the user's current chat.
 * 3. Auto-send the schedule prompt (fire-and-forget — do not await the full turn).
 */
async function handleScheduleFire(payload: ScheduleFireEvent | undefined): Promise<void> {
  if (!payload) return;
  const prompt = payload.prompt?.trim();
  if (!prompt) return;
  const scheduleId = payload.id;
  const scheduleName = payload.name?.trim() || "Scheduled task";
  const skillId = payload.skillId;

  // Yield once more so dynamic imports never run in the same turn as event dispatch.
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });

  // Dynamic import: agent graph only loads when a schedule actually needs chat.
  const [{ useG4fStore }, { readQxAiSkill }] = await Promise.all([
    import("./store"),
    import("./skills"),
  ]);
  const store = useG4fStore.getState();
  if (!store.sessionsLoaded) {
    await store.loadSessions();
  }
  if (store.providers.length === 0) {
    await store.loadProviders();
  }

  const conversationId = store.createConversation(undefined, undefined, {
    background: true,
    name: scheduleName,
  });

  let skill = undefined;
  if (skillId) {
    try {
      skill = await readQxAiSkill(skillId);
    } catch {
      skill = undefined;
    }
  }

  // Fire-and-forget: agent turns can take minutes; never block the bridge or UI.
  // Per-conversation `runs[id]` keeps streaming isolated from the active chat.
  void store.sendMessage(prompt, skill, conversationId).catch((error) => {
    console.error("qxai schedule agent turn failed", {
      scheduleId,
      conversationId,
      error,
    });
  });
}

export async function listQxAiSchedules() {
  return invoke<Array<Record<string, unknown>>>("qxai_list_schedules");
}

export async function upsertQxAiSchedule(schedule: Record<string, unknown>) {
  return invoke("qxai_upsert_schedule", { schedule });
}

export async function deleteQxAiSchedule(id: string) {
  return invoke("qxai_delete_schedule", { id });
}

export async function runQxAiScheduleNow(id: string) {
  return invoke("qxai_run_schedule_now", { id });
}
