import { useCallback, useRef, useState } from "react";

export type WorkbenchNavigationGuard = () => Promise<boolean>;

/**
 * Serializes host navigation while an inline editor resolves its dirty draft
 * decision. A second pointer/keyboard action cannot replace the open dialog.
 */
export function useWorkbenchNavigationGuard() {
  const guardRef = useRef<WorkbenchNavigationGuard | null>(null);
  const busyRef = useRef(false);
  const [active, setActive] = useState(false);
  const register = useCallback((guard: WorkbenchNavigationGuard | null) => {
    guardRef.current = guard;
    setActive(Boolean(guard));
  }, []);
  const run = useCallback((action: () => void) => {
    if (busyRef.current) return;
    const guard = guardRef.current;
    if (!guard) {
      action();
      return;
    }
    busyRef.current = true;
    void Promise.resolve(guard())
      .then((allowed) => {
        if (allowed) action();
      })
      .catch(() => {})
      .finally(() => {
        busyRef.current = false;
      });
  }, []);
  return { register, run, active };
}
