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

async function handleScheduleFire(payload: ScheduleFireEvent | undefined): Promise<void> {
  if (!payload?.prompt?.trim()) return;
  // Dynamic import: agent graph only loads when a schedule actually needs chat.
  const [{ useG4fStore }, { readQxAiSkill }] = await Promise.all([
    import("./store"),
    import("./skills"),
  ]);
  const store = useG4fStore.getState();
  if (!store.sessionsLoaded) await store.loadSessions();
  if (store.providers.length === 0) await store.loadProviders();
  const conversationId = store.createConversation();
  let skill = undefined;
  if (payload.skillId) {
    try {
      skill = await readQxAiSkill(payload.skillId);
    } catch {
      skill = undefined;
    }
  }
  await store.sendMessage(payload.prompt, skill, conversationId);
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
