import { useCallback, useRef, useState } from "react";
import { useIslandError } from "../island/feedback/useIslandError";
import { useT } from "../i18n";

export type WorkbenchNavigationGuard = () => Promise<boolean>;

/**
 * Serializes host navigation while an inline editor resolves its dirty draft
 * decision. A second pointer/keyboard action cannot replace the open dialog.
 */
export function useWorkbenchNavigationGuard() {
  const guardRef = useRef<WorkbenchNavigationGuard | null>(null);
  const busyRef = useRef(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  useIslandError({ id: "workbench.navigation", title: t("common.actions", "Actions"), error });
  const register = useCallback((guard: WorkbenchNavigationGuard | null) => {
    guardRef.current = guard;
    setActive(Boolean(guard));
  }, []);
  const run = useCallback(async (action: () => void | Promise<void>) => {
    if (busyRef.current) return;
    const guard = guardRef.current;
    setError(null);
    try {
      if (guard) {
        busyRef.current = true;
        let allowed: boolean;
        try { allowed = await guard(); }
        finally { busyRef.current = false; }
        if (!allowed) return;
      }
      // Only a dirty-draft decision serializes navigation. Shell isolates
      // pending business commands by action identity instead of this guard.
      await action();
    } catch (failure) {
      setError(String(failure instanceof Error ? failure.message : failure));
    }
  }, []);
  return { register, run, active };
}
