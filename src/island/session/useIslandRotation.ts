import { useEffect, useMemo, useState } from "react";
import type { IslandSession } from "../types";
import { resolveRotatingWinner } from "./priority";

/**
 * Shared docked/floating rotation controller. Content-only updates do not reset
 * the queue; membership changes do. Higher-priority sessions preempt without
 * destroying the standing location position.
 */
export function useIslandRotation(
  sessions: IslandSession[],
  rotationSeconds: number,
): { winnerId: string | null; rotationIndex: number } {
  const standingIds = useMemo(
    () => sessions
      .filter((session) => session.priority === "location" && session.sticky)
      .map((session) => session.id)
      .sort(),
    [sessions],
  );
  const standingSignature = standingIds.join("\u0000");
  const standingCount = standingIds.length;
  const [rotationIndex, setRotationIndex] = useState(0);

  useEffect(() => {
    setRotationIndex(0);
    if (standingCount < 2) return undefined;
    const intervalMs = Math.max(3, rotationSeconds || 8) * 1000;
    const timer = window.setInterval(() => {
      setRotationIndex((current) => (current + 1) % standingCount);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [rotationSeconds, standingCount, standingSignature]);

  return {
    winnerId: resolveRotatingWinner(sessions, rotationIndex),
    rotationIndex,
  };
}
