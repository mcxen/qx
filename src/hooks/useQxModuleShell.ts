import { useCallback, useEffect, useMemo } from "react";
import type { KeyboardEvent } from "react";
import type { BottomIslandContent } from "../components/QxBottomIsland";
import type { QxShellAction } from "../components/ShellActionButton";
import { getQxShortcutPreset } from "../utils/keyboard";
import { registerModuleEscapeStep } from "./moduleEscapeHost";
import { useEscBack, type EscCascade } from "./useEscBack";

/**
 * Module / extension shell chrome — shared Esc, Island, and Actions menu defaults.
 *
 * Built-in panels and external plugin hosts (PluginHost) should assemble QxShell
 * through this port so leave semantics, bottom-left Esc, and island loading/error
 * states stay consistent without copy-paste.
 *
 * Does **not** own list navigation, master-detail regions, or domain actions —
 * pass those as `navigation` / `primaryAction` / `actions` on QxShell yourself.
 *
 * @example
 * ```tsx
 * const shell = useQxModuleShell({
 *   leave: () => setTab("launcher"),
 *   esc: {
 *     inner: { active: showDetail, close: () => setShowDetail(false) },
 *     query: { active: !!query, clear: () => setQuery("") },
 *   },
 *   islandState: { title: "V2EX", loading, error, count: items.length, detail: mode },
 *   onKeyDown: (e) => { if (e.key === "r") refresh(); },
 *   t,
 * });
 *
 * <QxShell
 *   escapeAction={shell.escapeAction}
 *   onKeyDown={shell.onKeyDown}
 *   island={shell.island}
 *   secondaryAction={shell.secondaryAction}
 *   ...
 * />
 * ```
 */

export type ModuleIslandState = {
  /** Fallback label when idle label omitted (usually module title). */
  title: string;
  loading?: boolean;
  loadingDetail?: string;
  error?: string | null;
  /** Idle label (defaults to title). */
  label?: string;
  detail?: string;
  /** When `detail` omitted, renders as count string. */
  count?: number;
  progress?: number;
  activity?: BottomIslandContent["activity"];
  tone?: BottomIslandContent["tone"];
  actionLabel?: string;
  onAction?: () => void;
};

/**
 * Pure island builder: loading → error → idle.
 * Safe for plugins (no React hooks).
 */
export function buildModuleIsland(state: ModuleIslandState): BottomIslandContent | null {
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

/** Visible bottom-left Esc capsule (never put Esc on primaryAction). */
export function qxEscapeAction(leave: () => void): QxShellAction {
  return {
    label: "Esc",
    kbd: "Esc",
    onClick: leave,
  };
}

export type UseQxModuleShellOptions = {
  /**
   * Final leave target (launcher, parent view, or host hide).
   * Used by `escapeAction.onClick` and Esc cascade level 3.
   */
  leave: () => void;
  /**
   * Optional Esc cascade layers above `leave` (detail → clear query → leave).
   * Same shape as `useEscBack` without `launcher`.
   */
  esc?: Omit<EscCascade, "launcher">;
  /**
   * Module/plugin keys after Esc is handled.
   * Not called for Escape or when Esc cascade already preventDefault'd.
   */
  onKeyDown?: (event: KeyboardEvent) => void;
  /**
   * Explicit island content. Wins over `islandState` when both set
   * (including `null` to force-hide).
   */
  island?: BottomIslandContent | null;
  /** Declarative loading / error / idle island. */
  islandState?: ModuleIslandState;
  /** Bottom-right Actions menu label. */
  actionsLabel?: string;
  /** Default true — pass false for modules without an actions menu. */
  showActionsMenu?: boolean;
  /**
   * i18n helper. Defaults to English fallback only so plugins can call without
   * `useT` (still preferred for built-ins).
   */
  t?: (key: string, fallback: string) => string;
};

export type QxModuleShellChrome = {
  escapeAction: QxShellAction;
  onKeyDown: (event: KeyboardEvent) => void;
  island: BottomIslandContent | null;
  secondaryAction: QxShellAction | undefined;
  actionMenuShortcut: string;
  leave: () => void;
  /** One Esc cascade step (inner → query → leave). Same as escapeAction.onClick. */
  stepBack: () => void;
};

/**
 * Assemble standard QxShell chrome for built-in modules and extensions.
 */
export function useQxModuleShell(options: UseQxModuleShellOptions): QxModuleShellChrome {
  const {
    leave,
    esc,
    onKeyDown: extraKeyDown,
    island: islandOverride,
    islandState,
    actionsLabel,
    showActionsMenu = true,
    t = (_key, fallback) => fallback,
  } = options;

  const actionMenuShortcut = getQxShortcutPreset().actionMenu;

  const { onKeyDown: escKeyDown, stepBack } = useEscBack({
    inner: esc?.inner,
    query: esc?.query,
    launcher: leave,
  });

  // Host window Esc (focus outside shell) must step the same cascade — e.g.
  // RSS articles → feeds — instead of jumping straight to the launcher.
  useEffect(() => registerModuleEscapeStep(stepBack), [stepBack]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      escKeyDown(event);
      if (event.defaultPrevented || event.key === "Escape") return;
      extraKeyDown?.(event);
    },
    [escKeyDown, extraKeyDown],
  );

  // Bottom-left Esc matches keyboard cascade (one step per press), not a jump
  // past open detail / query layers.
  const escapeAction = useMemo(() => qxEscapeAction(stepBack), [stepBack]);

  const island = useMemo(() => {
    if (islandOverride !== undefined) return islandOverride;
    if (islandState) return buildModuleIsland(islandState);
    return null;
  }, [islandOverride, islandState]);

  const secondaryAction = useMemo(() => {
    if (!showActionsMenu) return undefined;
    return {
      label: actionsLabel ?? t("common.actions", "Actions"),
      kbd: actionMenuShortcut,
    } satisfies QxShellAction;
  }, [actionMenuShortcut, actionsLabel, showActionsMenu, t]);

  return {
    escapeAction,
    onKeyDown,
    island,
    secondaryAction,
    actionMenuShortcut,
    leave,
    stepBack,
  };
}
