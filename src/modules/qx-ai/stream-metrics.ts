/**
 * Transport-independent timing for a QxAI completion stream.
 *
 * The provider may emit text, reasoning, tool-call turns, or one complete
 * response. This port only consumes normalized "output became available"
 * snapshots; it does not know about React, Tauri, or provider protocols.
 */

/** A pause longer than this is normally a tool/TTFT boundary, not decoding. */
export const STREAM_GENERATION_GAP_MS = 1500;

export interface StreamTiming {
  startedAt: number;
  firstTokenAt?: number;
  lastDeltaAt?: number;
  /** Sum of short output-to-output intervals, excluding long pauses. */
  generationMs: number;
}

/** Timing for the visible reasoning / thought phase. */
export interface ReasoningTiming {
  startedAt?: number;
  lastDeltaAt?: number;
  durationMs: number;
}

type StreamTimingInput = Pick<StreamTiming, "startedAt"> &
  Partial<Pick<StreamTiming, "firstTokenAt" | "lastDeltaAt" | "generationMs">>;

/** Record one published output snapshot, at most once per UI update. */
export function recordStreamOutput(
  input: StreamTimingInput,
  now: number,
  hasOutput: boolean,
): StreamTiming {
  const current: StreamTiming = {
    startedAt: input.startedAt,
    firstTokenAt: input.firstTokenAt,
    lastDeltaAt: input.lastDeltaAt,
    generationMs: input.generationMs ?? 0,
  };
  if (!hasOutput) return current;

  const firstTokenAt = current.firstTokenAt ?? now;
  let generationMs = current.generationMs;
  if (current.lastDeltaAt != null) {
    const gap = now - current.lastDeltaAt;
    if (gap > 0 && gap <= STREAM_GENERATION_GAP_MS) generationMs += gap;
  }
  return { ...current, firstTokenAt, lastDeltaAt: now, generationMs };
}

/** Close the final short output interval before persisting the message. */
export function finishStreamTiming(input: StreamTimingInput, now: number): StreamTiming {
  return recordStreamOutput(input, now, input.lastDeltaAt != null);
}

/**
 * Prefer active decode time. If only one snapshot exists, use request elapsed
 * time instead of a 0/1ms denominator; this is conservative and stable for
 * providers that do not expose observable delta timing.
 */
export function resolveStreamDuration(input: StreamTimingInput, now: number): number {
  if ((input.generationMs ?? 0) > 0) return Math.max(1, input.generationMs ?? 0);
  if (input.startedAt > 0) return Math.max(1, now - input.startedAt);
  return 0;
}

export function recordReasoningOutput(
  input: Partial<ReasoningTiming>,
  now: number,
  hasOutput: boolean,
): ReasoningTiming {
  const current: ReasoningTiming = {
    startedAt: input.startedAt,
    lastDeltaAt: input.lastDeltaAt,
    durationMs: input.durationMs ?? 0,
  };
  if (!hasOutput) return current;

  const startedAt = current.startedAt ?? now;
  let durationMs = current.durationMs;
  if (current.lastDeltaAt != null) {
    const gap = now - current.lastDeltaAt;
    if (gap > 0 && gap <= STREAM_GENERATION_GAP_MS) durationMs += gap;
  }
  return { startedAt, lastDeltaAt: now, durationMs };
}

export function finishReasoningTiming(input: Partial<ReasoningTiming>, now: number): ReasoningTiming {
  return recordReasoningOutput(input, now, input.lastDeltaAt != null);
}

export function resolveReasoningDuration(input: Partial<ReasoningTiming>, now: number): number {
  if ((input.durationMs ?? 0) > 0) return Math.max(1, input.durationMs ?? 0);
  if (input.startedAt != null) return Math.max(1, now - input.startedAt);
  return 0;
}
