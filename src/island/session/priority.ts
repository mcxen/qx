import type { IslandPriority, IslandSession, DockedRenderMode } from "../types";

export const PRIORITY_RANK: Record<IslandPriority, number> = {
  task: 0,
  error: 1,
  toast: 2,
  location: 3,
  home: 4,
};

/**
 * Pure docked winner selection.
 * Higher priority band wins (lower PRIORITY_RANK number).
 * Within band: sticky task/error > higher rankEpoch > newer createdAt > id.
 */
export function resolveDockedWinner(sessions: IslandSession[]): string | null {
  return resolveRotatingWinner(sessions, 0);
}

/**
 * Resolve one visible session. Important events keep strict priority; the
 * current module's non-sticky location wins over background sticky locations,
 * which share the surface with fair time rotation.
 */
export function resolveRotatingWinner(
  sessions: IslandSession[],
  rotationIndex: number,
): string | null {
  if (sessions.length === 0) return null;
  const ordered = [...sessions].sort(compareSessions);
  const best = ordered[0];
  if (best.priority !== "location") return best.id;
  const foreground = ordered.filter(
    (session) => session.priority === "location" && !session.sticky,
  );
  if (foreground.length > 0) return foreground[0].id;
  const standing = ordered.filter(
    (session) => session.priority === "location" && session.sticky,
  );
  const index = Math.abs(Math.trunc(rotationIndex)) % standing.length;
  return standing[index]?.id ?? best.id;
}

export function countRotatingSessions(sessions: IslandSession[]): number {
  return sessions.filter(
    (session) => session.priority === "location" && session.sticky,
  ).length;
}

/** Returns negative if a should rank above b. */
export function compareSessions(a: IslandSession, b: IslandSession): number {
  const rankA = PRIORITY_RANK[a.priority];
  const rankB = PRIORITY_RANK[b.priority];
  if (rankA !== rankB) return rankA - rankB;

  const stickyA = stickyBoost(a);
  const stickyB = stickyBoost(b);
  if (stickyA !== stickyB) return stickyB - stickyA;

  if (a.rankEpoch !== b.rankEpoch) return b.rankEpoch - a.rankEpoch;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function stickyBoost(session: IslandSession): number {
  if (!session.sticky) return 0;
  if (session.priority === "task" || session.priority === "error") return 1;
  return 0;
}

/**
 * When a classified exception customIsland is mounted (e.g. ScreenRecorder),
 * docked store winner is suppressed but sessions remain in the store.
 */
export function resolveDockedRenderMode(input: {
  exception: boolean;
  winnerId: string | null;
}): DockedRenderMode {
  if (input.exception) return "exception";
  if (input.winnerId) return "store";
  return "empty";
}
