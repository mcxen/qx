import { useEffect, useState } from "react";
import type { IslandSlotContent } from "../types";

export interface IslandProgressSnapshot {
  progress: number | null;
  countdownMs: number | null;
}

function clampProgress(value?: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function countdownRemaining(
  content: IslandSlotContent | null | undefined,
  now: number,
): number | null {
  if (!content?.countdown) return null;
  const { endsAt, remainingMs, paused } = content.countdown;
  if (paused || endsAt == null) {
    return typeof remainingMs === "number" && Number.isFinite(remainingMs)
      ? Math.max(0, remainingMs)
      : null;
  }
  return Math.max(0, endsAt - now);
}

/**
 * Single timer owner for a rendered island. Surface and content consume the
 * same snapshot so countdown progress never creates duplicate intervals.
 */
export function useIslandProgress(
  content: IslandSlotContent | null | undefined,
): IslandProgressSnapshot {
  const [now, setNow] = useState(() => Date.now());
  const countdownRunning = Boolean(
    content?.countdown
    && !content.countdown.paused
    && typeof content.countdown.endsAt === "number"
    && Number.isFinite(content.countdown.endsAt),
  );

  useEffect(() => {
    if (!countdownRunning) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [countdownRunning, content?.countdown?.endsAt]);

  const countdownMs = countdownRemaining(content, now);
  const countdownProgress = countdownMs != null
    && typeof content?.countdown?.durationMs === "number"
    && content.countdown.durationMs > 0
    ? clampProgress(
        ((content.countdown.durationMs - countdownMs) / content.countdown.durationMs) * 100,
      )
    : null;
  const progress = countdownProgress ?? (
    content?.meter?.kind === "progress"
      ? clampProgress(content.meter.progress)
      : null
  );

  return { progress, countdownMs };
}
