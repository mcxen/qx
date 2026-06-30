import { useCallback } from "react";

/**
 * UISPEC: Cascading Esc Protocol
 *
 * Every QxShell module must implement 3-level Esc cascade:
 *   1. inner state → close sub-panel/detail/preview
 *   2. search query → clear it (if module has its own query)
 *   3. launcher → setTab("launcher")
 *
 * All Esc handlers MUST call e.preventDefault() + e.stopPropagation().
 * Use this hook to ensure compliance.
 */
export interface EscCascade {
  /** Level 1: inner sub-state (detail panel, preview, output view, etc.) */
  inner?: { active: boolean; close: () => void };
  /** Level 2: local search query (only if module manages its own query) */
  query?: { active: boolean; clear: () => void };
  /** Level 3: navigate back to launcher */
  launcher: () => void;
}

export function useEscBack(cascade: EscCascade) {
  const innerActive = cascade.inner?.active;
  const innerClose = cascade.inner?.close;
  const queryActive = cascade.query?.active;
  const queryClear = cascade.query?.clear;
  const launcher = cascade.launcher;

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (innerActive && innerClose) {
        innerClose();
        return;
      }
      if (queryActive && queryClear) {
        queryClear();
        return;
      }
      launcher();
    },
    [innerActive, innerClose, queryActive, queryClear, launcher],
  );
  return { onKeyDown };
}
