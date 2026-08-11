/**
 * Main-window activation port.
 *
 * Focus/show handlers publish one cheap signal. Registered background work is
 * coalesced by id, delayed until after the activation paint, rate-limited, and
 * never awaited by the native focus callback or input path.
 */

export type WindowActivationReason = "focus" | "navigate" | "show";

export interface WindowActivationTask {
  id: string;
  run: (reason: WindowActivationReason) => void | Promise<void>;
  /** Delay before entering the browser idle queue. */
  delayMs?: number;
  /** Minimum interval between completed/scheduled runs for this task. */
  minIntervalMs?: number;
}

interface TaskState extends WindowActivationTask {
  timer: ReturnType<typeof window.setTimeout> | null;
  idleId: number | null;
  lastScheduledAt: number;
  inFlight: boolean;
}

const tasks = new Map<string, TaskState>();
const activityListeners = new Set<(available: boolean) => void>();
// A hidden Tauri WebView can keep document.hidden=false on Windows. Start
// paused until App confirms show/focus; browser-only development remains live.
let mainWindowAvailable = typeof window === "undefined"
  || !("__TAURI_INTERNALS__" in window);

function cancelScheduled(state: TaskState): void {
  if (state.timer != null) {
    window.clearTimeout(state.timer);
    state.timer = null;
  }
  if (state.idleId != null) {
    const idleWindow = window as Window & { cancelIdleCallback?: (id: number) => void };
    idleWindow.cancelIdleCallback?.(state.idleId);
    state.idleId = null;
  }
}

function runWhenIdle(state: TaskState, reason: WindowActivationReason): void {
  const run = () => {
    state.idleId = null;
    if (!tasks.has(state.id) || state.inFlight || !mainWindowAvailable) return;
    state.inFlight = true;
    void Promise.resolve(state.run(reason)).finally(() => {
      state.inFlight = false;
    });
  };
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (typeof idleWindow.requestIdleCallback === "function") {
    state.idleId = idleWindow.requestIdleCallback(run, { timeout: 650 });
  } else {
    state.timer = window.setTimeout(() => {
      state.timer = null;
      run();
    }, 0);
  }
}

export function registerWindowActivationTask(task: WindowActivationTask): () => void {
  const previous = tasks.get(task.id);
  if (previous) cancelScheduled(previous);
  const state: TaskState = {
    ...task,
    timer: null,
    idleId: null,
    lastScheduledAt: 0,
    inFlight: false,
  };
  tasks.set(task.id, state);
  return () => {
    if (tasks.get(task.id) !== state) return;
    cancelScheduled(state);
    tasks.delete(task.id);
  };
}

export function publishWindowActivation(reason: WindowActivationReason): void {
  if (typeof window === "undefined" || !mainWindowAvailable) return;
  const now = Date.now();
  for (const state of tasks.values()) {
    const minIntervalMs = Math.max(0, state.minIntervalMs ?? 750);
    if (state.inFlight || now - state.lastScheduledAt < minIntervalMs) continue;
    state.lastScheduledAt = now;
    cancelScheduled(state);
    state.timer = window.setTimeout(() => {
      state.timer = null;
      runWhenIdle(state, reason);
    }, Math.max(0, state.delayMs ?? 120));
  }
}

export function setMainWindowAvailable(available: boolean): void {
  if (mainWindowAvailable === available) return;
  mainWindowAvailable = available;
  if (!available) {
    for (const state of tasks.values()) {
      cancelScheduled(state);
      state.lastScheduledAt = 0;
    }
  }
  for (const listener of activityListeners) listener(available);
}

export function isMainWindowAvailable(): boolean {
  return mainWindowAvailable;
}

export function subscribeMainWindowAvailability(
  listener: (available: boolean) => void,
): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}
