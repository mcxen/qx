import { useCallback, useEffect, useMemo } from "react";
import type { KeyboardEvent } from "react";
import type { BottomIslandContent } from "../components/QxBottomIsland";
import type { QxShellAction } from "../components/ShellActionButton";
import { useT } from "../i18n";
import { goHomeToLauncher } from "../modules/settings/openSettings";
import { registerModuleEscapeStep } from "./moduleEscapeHost";
import {
  buildModuleIsland as buildModuleIslandPure,
  qxEscapeAction as qxEscapeActionPure,
  type ModuleIslandState as PureModuleIslandState,
} from "./moduleShellPures";
import { useEscBack, type EscCascade } from "./useEscBack";

/**
 * Module / extension shell chrome — shared Esc, Island, and Actions menu defaults.
 *
 * Built-in panels and external plugin hosts (PluginHost) should assemble QxShell
 * through this port so leave semantics, far-right Esc, and island loading/error
 * states stay consistent without copy-paste.
 *
 * Does **not** own list navigation, master-detail regions, or domain actions —
 * pass those as `navigation` / `actions` / `primaryActionId` on QxShell yourself.
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
 * });
 *
 * <QxShell
 *   escapeAction={shell.escapeAction}
 *   onKeyDown={shell.onKeyDown}
 *   island={shell.island}
 *   actions={actions}
 *   primaryActionId="open"
 *   ...
 * />
 * ```
 */

export type ModuleIslandState = PureModuleIslandState & {
  activity?: BottomIslandContent["activity"];
  tone?: BottomIslandContent["tone"];
};

/** Pure island builder (re-export). Safe for non-React consumers / tests. */
export function buildModuleIsland(state: ModuleIslandState): BottomIslandContent | null {
  return buildModuleIslandPure(state);
}

/** Visible far-right Esc capsule (re-export). */
export function qxEscapeAction(leave: () => void, label = "Back"): QxShellAction {
  return qxEscapeActionPure(leave, label);
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
};

export type QxModuleShellChrome = {
  escapeAction: QxShellAction;
  onKeyDown: (event: KeyboardEvent) => void;
  island: BottomIslandContent | null;
  leave: () => void;
  /** One Esc cascade step (inner → query → leave). Same as escapeAction.onClick. */
  stepBack: () => void;
  /**
   * Bottom-bar house button: jump to main launcher (not one Esc step).
   * QxShell also defaults this for non-launcher surfaces.
   */
  onGoHome: () => void;
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
  } = options;
  const t = useT();

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
  // past open detail / query layers. Visible label is Back (not bare "Esc").
  const escapeAction = useMemo(
    () => qxEscapeAction(stepBack, t("common.back", "Back")),
    [stepBack, t],
  );

  const onGoHome = useCallback(() => {
    goHomeToLauncher();
  }, []);

  const island = useMemo(() => {
    if (islandOverride !== undefined) return islandOverride;
    if (islandState) return buildModuleIsland(islandState);
    return null;
  }, [islandOverride, islandState]);

  return {
    escapeAction,
    onKeyDown,
    island,
    leave,
    stepBack,
    onGoHome,
  };
}
