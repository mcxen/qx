/**
 * Pure shell port helpers — no React, no keyboard, no side effects.
 * Used by `useQxModuleShell` and by `scripts/check-module-ports.mjs` unit tests.
 */

export type ModuleIslandTone = "neutral" | "success" | "warning" | "danger" | "accent" | undefined;
export type ModuleIslandActivity = "bounce" | "pulse" | undefined;

export type ModuleIslandState = {
  title: string;
  loading?: boolean;
  loadingDetail?: string;
  error?: string | null;
  label?: string;
  detail?: string;
  count?: number;
  progress?: number;
  activity?: ModuleIslandActivity | "bounce" | string;
  tone?: ModuleIslandTone | string;
  actionLabel?: string;
  onAction?: () => void;
};

export type ModuleIslandContent = {
  label: string;
  detail?: string;
  tone?: string;
  progress?: number;
  activity?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** Pure island builder: loading → error → idle. */
export function buildModuleIsland(state: ModuleIslandState): ModuleIslandContent | null {
  const title = state.title.trim() || "Module";
  const error = state.error?.trim();
  if (error) {
    return {
      label: title,
      detail: error,
      tone: "danger",
      actionLabel: state.actionLabel,
      onAction: state.onAction,
    };
  }
  if (state.loading) {
    return {
      label: title,
      detail: state.loadingDetail?.trim() || "Loading…",
      progress: state.progress,
      activity: state.activity ?? (state.progress == null ? "bounce" : undefined),
      tone: state.tone,
      actionLabel: state.actionLabel,
      onAction: state.onAction,
    };
  }
  const label = (state.label ?? title).trim();
  const detail =
    state.detail?.trim()
    || (typeof state.count === "number" && Number.isFinite(state.count)
      ? String(state.count)
      : undefined);
  if (!label && !detail) return null;
  return {
    label: label || title,
    detail,
    tone: state.tone,
    progress: state.progress,
    activity: state.activity,
    actionLabel: state.actionLabel,
    onAction: state.onAction,
  };
}

export type EscapeAction = {
  label: string;
  kbd: string;
  onClick: () => void;
};

/** Visible bottom-left Esc capsule (never put Esc on primaryAction). */
export function qxEscapeAction(leave: () => void): EscapeAction {
  return {
    label: "Esc",
    kbd: "Esc",
    onClick: leave,
  };
}
