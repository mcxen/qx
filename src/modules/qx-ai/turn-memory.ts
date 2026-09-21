/** Turn-owned extraction. Never re-read the active chat or global model. */
import { islandHost } from "../../island";
import { resolveLocale, translate } from "../../i18n";
import { useSettingsStore } from "../settings/store";
import { runMemoryDream, type MemoryContext } from "./agent/memory";

const failedTasks = new Map<string, () => Promise<void>>();
const listeners = new Set<() => void>();
let nextJobId = 0;
export const failedMemoryCount = () => failedTasks.size;
export const subscribeMemoryFailures = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const notify = () => listeners.forEach((listener) => listener());
export async function retryFailedMemories(): Promise<void> {
  for (const retry of [...failedTasks.values()]) await retry();
}

export function memoryBatches(user: string, assistant: string): string[] {
  const chars = Array.from(`user: ${user}\nassistant: ${assistant}`);
  const batches: string[] = [];
  for (let i = 0; i < chars.length; i += 6000) batches.push(chars.slice(i, i + 6000).join(""));
  return batches;
}

export function scheduleTurnMemory(input: {
  user: string; assistant: string; turnKey: string; name: string; context: MemoryContext;
}): void {
  const context = { ...input.context };
  const batches = memoryBatches(input.user, input.assistant);
  let cursor = 0;
  let running = false;
  const id = `qxai.memory.${context.conversationId}`;
  const jobId = `${id}:${++nextJobId}`;
  const run = async () => {
    if (running) return;
    running = true;
    islandHost.dismiss(id);
    try {
      while (cursor < batches.length) {
        const { agent } = useSettingsStore.getState().settings;
        if (!agent.memory_tool_enabled || agent.memory_policy !== "smart") {
          failedTasks.delete(jobId); notify(); return;
        }
        const transcript = batches[cursor];
        await runMemoryDream(transcript, "smart", context, `${input.turnKey}:${cursor}:${transcript}`);
        cursor++; // Success, including a valid empty extraction, advances exactly once.
      }
      failedTasks.delete(jobId); notify();
    } catch (error) {
      if (failedTasks.size < 32 || failedTasks.has(jobId)) failedTasks.set(jobId, run);
      notify();
      const locale = resolveLocale(useSettingsStore.getState().settings.general.language);
      islandHost.show({
        id, priority: "error", source: "module", placement: "docked-or-float", ttlMs: 8000,
        openTarget: { kind: "module", id: "qx-ai" },
        content: {
          primary: translate(locale, "agent.memory.extract.failed", "Memory extraction failed"),
          secondary: `${input.name}: ${String(error)}`, tone: "danger",
          action: { id: "retry", label: translate(locale, "common.retry", "Retry") },
        },
        actions: { retry: run },
      });
    } finally { running = false; }
  };
  void run();
}
