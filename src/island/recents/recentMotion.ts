/** Narrow spring contract for Island chrome: recents tiles and trailing actions. */

export const ISLAND_RECENT_SLOT_PX = 28;
export const ISLAND_RECENT_STAGGER_S = 0.038;
export const ISLAND_RECENT_EXIT_STAGGER_S = 0.026;

/** Framer `type: "spring"` matching the previous CSS linear() sample (~stiffness 400 / damping 28). */
export const ISLAND_RECENT_SPRING = {
  type: "spring" as const,
  stiffness: 400,
  damping: 28,
  mass: 0.85,
};

export function recentTileHiddenX(index: number, slotPx = ISLAND_RECENT_SLOT_PX): number {
  return -(index + 1) * slotPx;
}

export function recentTileStagger(
  index: number,
  exiting: boolean,
  count: number,
): number {
  if (exiting) return Math.max(0, count - 1 - index) * ISLAND_RECENT_EXIT_STAGGER_S;
  return index * ISLAND_RECENT_STAGGER_S;
}

export function recentTileTransition(
  index: number,
  options: { exiting?: boolean; count?: number; reducedMotion?: boolean } = {},
) {
  if (options.reducedMotion) {
    return { duration: 0 };
  }
  const delay = recentTileStagger(index, Boolean(options.exiting), options.count ?? index + 1);
  return {
    x: { ...ISLAND_RECENT_SPRING, delay },
    scale: { ...ISLAND_RECENT_SPRING, delay },
    opacity: { duration: 0.16, ease: "easeOut" as const, delay },
  };
}

/** Trailing action capsules enter from the right; same spring as recents. */
export function islandActionHidden(): { x: number; scale: number; opacity: number } {
  return { x: 8, scale: 0.94, opacity: 0 };
}

export function islandActionTransition(
  index: number,
  options: { exiting?: boolean; count?: number; reducedMotion?: boolean } = {},
) {
  return recentTileTransition(index, options);
}
