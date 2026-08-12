import { invoke } from "@tauri-apps/api/core";

let cachedSnapshot: { at: number; value: string } | null = null;
const SNAPSHOT_TTL_MS = 30_000;

/** Hermes frozen snapshot for system prompt (prefix-cache friendly). */
export async function loadMemorySnapshot(force = false): Promise<string> {
  const now = Date.now();
  if (!force && cachedSnapshot && now - cachedSnapshot.at < SNAPSHOT_TTL_MS) {
    return cachedSnapshot.value;
  }
  try {
    const value = await invoke<string>("qxai_memory_snapshot");
    cachedSnapshot = { at: now, value: value ?? "" };
    return cachedSnapshot.value;
  } catch {
    return "";
  }
}

export function invalidateMemorySnapshot(): void {
  cachedSnapshot = null;
}

/** Sleep/dream consolidator — call after long agent turns or on schedule. */
export async function runMemoryDream(transcript?: string): Promise<unknown> {
  invalidateMemorySnapshot();
  return invoke("qxai_memory_dream", {
    transcript: transcript?.trim() || null,
  });
}

export function shouldDreamAfterTurn(opts: {
  toolCallCount: number;
  steps: number;
  memoryToolUsed: boolean;
}): boolean {
  // Hermes-style nudge: consolidate after substantial work, not every turn.
  if (opts.memoryToolUsed) return false;
  return opts.toolCallCount >= 4 || opts.steps >= 8;
}
