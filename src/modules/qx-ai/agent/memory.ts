import { invoke } from "@tauri-apps/api/core";

const cachedSnapshots = new Map<string, { at: number; value: string }>();
let snapshotGeneration = 0;
const SNAPSHOT_TTL_MS = 30_000;

/** Hermes frozen snapshot for system prompt (prefix-cache friendly). */
export async function loadMemorySnapshot(force = false, scope = ""): Promise<string> {
  scope = scope.trim();
  const cachedSnapshot = cachedSnapshots.get(scope);
  const now = Date.now();
  if (!force && cachedSnapshot && now - cachedSnapshot.at < SNAPSHOT_TTL_MS) {
    return cachedSnapshot.value;
  }
  try {
    const generation = snapshotGeneration;
    const value = await invoke<string>("qxai_memory_snapshot", { scope });
    if (generation === snapshotGeneration) {
      if (cachedSnapshots.size >= 32) cachedSnapshots.clear();
      cachedSnapshots.set(scope, { at: now, value: value ?? "" });
    }
    return value ?? "";
  } catch {
    return "";
  }
}

export function invalidateMemorySnapshot(): void {
  snapshotGeneration += 1;
  cachedSnapshots.clear();
}

export interface MemoryDreamResult {
  candidateCount: number;
  beforeChars: number;
  afterChars: number;
  savedChars: number;
  processedCount: number;
  hasMore: boolean;
}

export interface MemoryContext {
  scope?: string;
  conversationId?: string;
  provider?: string;
  model?: string;
}

// One bounded FIFO for automatic, tool and settings extraction. Failure never
// poisons the tail or causes the next turn to disappear behind a busy guard.
let dreamTail: Promise<unknown> | undefined;
let pendingDreams = 0;

export async function mutateMemory(input: Record<string, unknown>): Promise<unknown> {
  try {
    return await invoke("qxai_memory_mutate", input);
  } finally {
    invalidateMemorySnapshot();
  }
}

/** Selective extractor / consolidator. The backend may validly return no candidates. */
export function runMemoryDream(
  transcript?: string,
  mode: "manual" | "smart" | "compress" = "manual",
  context: MemoryContext = {},
  boundary?: string,
): Promise<MemoryDreamResult> {
  if (pendingDreams >= 32) return Promise.reject(new Error("Memory queue is full; retry later"));
  const frozen = { ...context };
  pendingDreams++;
  const run = () => invokeDream(transcript, mode, frozen, boundary);
  const task = dreamTail ? dreamTail.then(run, run) : run();
  const tail = task.finally(() => {
    pendingDreams--;
    if (dreamTail === tail) dreamTail = undefined;
  });
  dreamTail = tail;
  // The returned promise preserves rejection; the internal tail is observed.
  void tail.catch(() => undefined);
  return tail;
}

async function invokeDream(transcript: string | undefined, mode: string, context: MemoryContext, boundary?: string): Promise<MemoryDreamResult> {
  invalidateMemorySnapshot();
  try {
    return await invoke<MemoryDreamResult>("qxai_memory_dream", {
      transcript: transcript?.trim() || null,
      mode,
      context,
      boundary,
    });
  } finally {
    invalidateMemorySnapshot();
  }
}
