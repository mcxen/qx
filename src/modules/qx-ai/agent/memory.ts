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

/** Selective extractor / consolidator. The backend may validly return no candidates. */
export async function runMemoryDream(
  transcript?: string,
  mode: "manual" | "smart" = "manual",
): Promise<unknown> {
  invalidateMemorySnapshot();
  return invoke("qxai_memory_dream", {
    transcript: transcript?.trim() || null,
    mode,
  });
}

export function shouldExtractMemoryAfterTurn(opts: {
  policy: "manual" | "smart" | "off";
  transcript: string;
}): boolean {
  if (opts.policy !== "smart") return false;
  // This only avoids empty acknowledgements. Candidate selection belongs to the
  // extractor and an empty candidate list is a successful result.
  return opts.transcript.trim().length >= 40;
}
