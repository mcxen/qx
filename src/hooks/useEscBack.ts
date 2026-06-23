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
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (cascade.inner?.active) {
        cascade.inner.close();
        return;
      }
      if (cascade.query?.active) {
        cascade.query.clear();
        return;
      }
      cascade.launcher();
    },
    [cascade],
  );
  return { onKeyDown };
}
