export type PreferenceSaveValue = string | number | boolean;

export interface PreferenceSaveSnapshot {
  pluginId: string;
  token: number;
  values: Readonly<Record<string, PreferenceSaveValue>>;
}

interface PendingSave {
  snapshot: PreferenceSaveSnapshot;
  waiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }>;
}

export interface PreferenceSaveQueue {
  enqueue(snapshot: PreferenceSaveSnapshot): Promise<void>;
  isBusy(): boolean;
}

export interface PreferenceSaveQueueOptions {
  write: (snapshot: PreferenceSaveSnapshot) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}

function canMerge(a: PreferenceSaveSnapshot, b: PreferenceSaveSnapshot): boolean {
  return a.pluginId === b.pluginId && a.token === b.token;
}

/**
 * Serialize complete preference maps while coalescing only the queued tail.
 *
 * The active write is never cancelled. A queued manual save and later
 * autosave may share one latest snapshot, but every caller stays attached to
 * that write and resolves only after it succeeds. This is important for
 * “Save and check”: the check must not start while its save is merely queued.
 */
export function createPreferenceSaveQueue(options: PreferenceSaveQueueOptions): PreferenceSaveQueue {
  const pending: PendingSave[] = [];
  let active = false;

  const drain = async (): Promise<void> => {
    if (active) return;
    active = true;
    options.onBusyChange?.(true);
    try {
      while (pending.length > 0) {
        const current = pending.shift();
        if (!current) continue;
        try {
          await options.write(current.snapshot);
          current.waiters.forEach(({ resolve }) => resolve());
        } catch (error) {
          current.waiters.forEach(({ reject }) => reject(error));
        }
      }
    } finally {
      active = false;
      options.onBusyChange?.(false);
      // A callback is allowed to enqueue another snapshot while the queue is
      // settling. Keep the writer live without starting a second drain.
      if (pending.length > 0) void drain();
    }
  };

  return {
    enqueue(snapshot) {
      return new Promise<void>((resolve, reject) => {
        const tail = pending[pending.length - 1];
        if (tail && canMerge(tail.snapshot, snapshot)) {
          tail.snapshot = snapshot;
          tail.waiters.push({ resolve, reject });
        } else {
          pending.push({ snapshot, waiters: [{ resolve, reject }] });
        }
        void drain();
      });
    },
    isBusy: () => active || pending.length > 0,
  };
}
