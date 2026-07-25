/**
 * Pure shell port helpers — no React, no keyboard, no side effects.
 * Used by `useQxModuleShell` and by `scripts/check-module-ports.mjs` unit tests.
 */

import type {
  IslandActivity,
  IslandProgressStyle,
  IslandTone,
} from "../island/types";

export type ModuleIslandTone = IslandTone | undefined;
export type ModuleIslandActivity = IslandActivity | undefined;

export type ModuleIslandState = {
  title: string;
  loading?: boolean;
  loadingDetail?: string;
  error?: string | null;
  label?: string;
  detail?: string;
  count?: number;
  progress?: number;
  progressStyle?: IslandProgressStyle;
  activity?: ModuleIslandActivity;
  tone?: ModuleIslandTone;
  actionLabel?: string;
  onAction?: () => void;
};

export type ModuleIslandContent = {
  label: string;
  detail?: string;
  tone?: IslandTone;
  progress?: number;
  progressStyle?: IslandProgressStyle;
  activity?: IslandActivity;
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
      progressStyle: state.progressStyle,
      activity: state.activity ?? (state.progress == null ? "wave" : undefined),
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
    progressStyle: state.progressStyle,
    activity: state.activity,
    actionLabel: state.actionLabel,
    onAction: state.onAction,
  };
}

export type EscapeAction = {
  id: "escape";
  label: string;
  kbd: string;
  onClick: () => void;
};

/** Visible bottom-left Esc capsule (never put Esc on primaryAction). */
export function qxEscapeAction(leave: () => void): EscapeAction {
  return {
    id: "escape",
    label: "Esc",
    kbd: "Esc",
    onClick: leave,
  };
}
