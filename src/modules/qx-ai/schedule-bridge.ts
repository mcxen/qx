import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useG4fStore } from "./store";
import { readQxAiSkill } from "./skills";

type ScheduleFireEvent = {
  id: string;
  name?: string;
  kind?: string;
  skillId?: string | null;
  prompt?: string;
};

let started = false;

/**
 * Listen for headless schedule fires that need a full agent turn (agent_prompt).
 * Morning desk log runs entirely in Rust; this bridge only handles chat-side jobs.
 */
export function startQxAiScheduleBridge(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void listen<ScheduleFireEvent>("qxai-schedule-fire", async (event) => {
    const payload = event.payload;
    if (!payload?.prompt?.trim()) return;
    try {
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
    } catch (error) {
      console.error("qxai schedule fire failed", error);
    }
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
