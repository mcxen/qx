import type { IslandActivity, IslandSlotContent } from "../types";

/** Paused countdowns are visually still even if an older producer sends activity. */
export function visibleIslandActivity(
  content: IslandSlotContent,
): IslandActivity | undefined {
  if (content.countdown?.paused) return undefined;
  return content.meter?.kind === "activity" ? content.meter.activity : undefined;
}
