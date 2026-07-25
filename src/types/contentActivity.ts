export type QxActivityState = "loading" | "success" | "error";

/**
 * Transport-neutral progress fields shared by built-in modules and Workbench.
 * Producers may publish a direct percentage or real completed/total counters.
 */
export interface QxActivityProgress {
  state: QxActivityState;
  label?: string;
  error?: string;
  progress?: number;
  completed?: number;
  total?: number;
  failed?: number;
}

export type QxContentActivityKind = "refresh" | "load-more" | "detail" | "media";

/** One content operation which can project into rows, details and QxIsland. */
export interface QxContentActivity extends QxActivityProgress {
  kind: QxContentActivityKind;
  targetId?: string | number | null;
  detail?: string;
}

export function resolveActivityPercent(
  activity: Pick<QxActivityProgress, "progress" | "completed" | "total">,
): number | undefined {
  const explicit = Number(activity.progress);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, explicit));
  const completed = Number(activity.completed);
  const total = Number(activity.total);
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return undefined;
  return Math.max(0, Math.min(100, (completed / total) * 100));
}
