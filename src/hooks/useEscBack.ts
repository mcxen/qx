import { useCallback } from "react";

/**
 * UISPEC: Cascading Esc Protocol
 *
 * Every QxShell module must implement a stepped Esc cascade:
 *   1. inner state → close sub-panel/detail/preview
 *   2. search query → clear it (if module has its own query)
 *   3. launcher → leave module / parent view (setTab("launcher") or goBack)
 *
 * After leave, the host cascade continues on the next Esc:
 *   clear launcher query → hide the floating panel.
 *
 * Keyboard handlers MUST call e.preventDefault() + e.stopPropagation() so the
 * window-level host fallback does not double-step in the same keypress.
 */
export interface EscCascade {
  /** Level 1: inner sub-state (detail panel, preview, output view, etc.) */
  inner?: { active: boolean; close: () => void };
  /** Level 2: local search query (only if module manages its own query) */
  query?: { active: boolean; clear: () => void };
  /** Level 3: navigate back to launcher / parent view */
  launcher: () => void;
}

export function useEscBack(cascade: EscCascade) {
  const innerActive = cascade.inner?.active;
  const innerClose = cascade.inner?.close;
  const queryActive = cascade.query?.active;
  const queryClear = cascade.query?.clear;
  const launcher = cascade.launcher;

  /** One cascade step — shared by keyboard Esc and the bottom-left Esc button. */
  const stepBack = useCallback(() => {
    if (innerActive && innerClose) {
      innerClose();
      return;
    }
    if (queryActive && queryClear) {
      queryClear();
      return;
    }
    launcher();
  }, [innerActive, innerClose, queryActive, queryClear, launcher]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      stepBack();
    },
    [stepBack],
  );

  return { onKeyDown, stepBack };
}
