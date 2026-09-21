import type { QxShellAction } from "./actionProtocol";

/** One executor per mounted Shell; pending identity survives React projections. */
export function createActionExecution() {
  const pending = new Set<string>();
  let revision = 0;
  return {
    invalidate() { revision += 1; pending.clear(); },
    isPending(key: string) { return pending.has(key); },
    async run(
      key: string,
      action: QxShellAction,
      invoke: () => void | Promise<void>,
      changed: () => void,
      failed: (error: unknown) => void,
    ) {
      if (action.disabled || pending.has(key)) return;
      const started = revision;
      pending.add(key);
      changed();
      try { await invoke(); }
      catch (error) { if (started === revision) failed(error); }
      finally {
        if (started === revision) { pending.delete(key); changed(); }
      }
    },
  };
}

/** Invalidates asynchronous submenu results without pretending to cancel I/O. */
export function createMenuGeneration() {
  let revision = 0;
  return {
    next() { const current = ++revision; return () => current === revision; },
    invalidate() { revision += 1; },
  };
}
