import { useCallback, useEffect, useRef, useState } from "react";
import {
  isMainWindowAvailable,
  registerWindowActivationTask,
  subscribeMainWindowAvailability,
} from "../shell/windowActivation";

export interface DashboardRefreshStatus {
  error: string | null;
  lastUpdatedAt: number | null;
  refreshing: boolean;
}

interface DashboardRefreshRunnerOptions<T> {
  isActive: () => boolean;
  load: () => Promise<T>;
  onSuccess: (value: T) => void;
  onError: (error: unknown) => void;
}

export interface DashboardRefreshRunner {
  request: () => Promise<void>;
  dispose: () => void;
}

/**
 * Single-flight runner shared by Dashboard sources. Repeated timer/event
 * triggers collapse into at most one trailing refresh, so slow native reads
 * cannot create an unbounded worker or IPC queue.
 */
export function createDashboardRefreshRunner<T>(
  options: DashboardRefreshRunnerOptions<T>,
): DashboardRefreshRunner {
  let disposed = false;
  let inFlight = false;
  let pending = false;

  const request = async (): Promise<void> => {
    if (disposed || !options.isActive()) return;
    if (inFlight) {
      pending = true;
      return;
    }

    inFlight = true;
    try {
      do {
        pending = false;
        try {
          const value = await options.load();
          if (!disposed) options.onSuccess(value);
        } catch (error) {
          if (!disposed) options.onError(error);
        }
      } while (pending && !disposed && options.isActive());
    } finally {
      inFlight = false;
    }
  };

  return {
    request,
    dispose: () => {
      disposed = true;
      pending = false;
    },
  };
}

function dashboardAvailable(): boolean {
  const visible = typeof document === "undefined" || !document.hidden;
  return visible && isMainWindowAvailable();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "failed");
}

/**
 * Dashboard-owned refresh lifecycle:
 * - only polls while the main window is available and the document is visible;
 * - refreshes immediately after activation/re-show;
 * - coalesces timer, event, and activation triggers through one single-flight runner;
 * - preserves the caller's last usable data when a refresh fails.
 */
export function useDashboardRefresh<T>({
  id,
  enabled,
  intervalMs,
  refreshKey = "",
  load,
  onSuccess,
}: {
  id: string;
  enabled: boolean;
  intervalMs: number;
  /** Recreate and immediately run the source when its provider/config identity changes. */
  refreshKey?: string;
  load: () => Promise<T>;
  onSuccess: (value: T) => void;
}): DashboardRefreshStatus & { refresh: () => void } {
  const loadRef = useRef(load);
  const successRef = useRef(onSuccess);
  const requestRef = useRef<() => Promise<void>>(async () => {});
  const [available, setAvailable] = useState(dashboardAvailable);
  const [status, setStatus] = useState<DashboardRefreshStatus>({
    error: null,
    lastUpdatedAt: null,
    refreshing: false,
  });

  loadRef.current = load;
  successRef.current = onSuccess;

  useEffect(() => {
    const sync = () => setAvailable(dashboardAvailable());
    const stopAvailability = subscribeMainWindowAvailability(sync);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", sync);
    }
    sync();
    return () => {
      stopAvailability();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", sync);
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled || !available) {
      requestRef.current = async () => {};
      setStatus((current) => current.refreshing ? { ...current, refreshing: false } : current);
      return;
    }

    const runner = createDashboardRefreshRunner({
      isActive: () => dashboardAvailable(),
      load: () => loadRef.current(),
      onSuccess: (value) => {
        successRef.current(value);
        setStatus({ error: null, lastUpdatedAt: Date.now(), refreshing: false });
      },
      onError: (error) => {
        setStatus((current) => ({ ...current, error: errorMessage(error), refreshing: false }));
      },
    });
    const request = async () => {
      setStatus((current) => current.refreshing ? current : { ...current, refreshing: true });
      await runner.request();
    };
    requestRef.current = request;

    const stopActivation = registerWindowActivationTask({
      id: `home-dashboard.${id}`,
      delayMs: 180,
      minIntervalMs: Math.min(intervalMs, 1_000),
      run: request,
    });
    void request();
    const timer = window.setInterval(() => void request(), Math.max(1_000, intervalMs));

    return () => {
      requestRef.current = async () => {};
      window.clearInterval(timer);
      stopActivation();
      runner.dispose();
    };
  }, [available, enabled, id, intervalMs, refreshKey]);

  const refresh = useCallback(() => {
    void requestRef.current();
  }, []);

  return { ...status, refresh };
}
