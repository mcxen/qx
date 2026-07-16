/**
 * Non-blocking launcher ranking port.
 *
 * Sorting runs in a dedicated module worker so progressive provider merges and
 * rapid typing never execute an O(n log n) sort on the UI thread. Callers are
 * responsible for discarding stale responses because query state is owned by
 * the launcher.
 */

import type { AppEntry } from "../store";

interface RankResponse {
  id: number;
  entries: AppEntry[];
}

interface PendingRank {
  fallback: AppEntry[];
  resolve: (entries: AppEntry[]) => void;
}

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, PendingRank>();

function settlePendingWithFallback(): void {
  for (const request of pending.values()) request.resolve(request.fallback);
  pending.clear();
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;

  try {
    const createdWorker = new Worker(new URL("./rankResults.worker.ts", import.meta.url), {
      type: "module",
      name: "qx-search-ranker",
    });
    worker = createdWorker;
    createdWorker.addEventListener("message", (event: MessageEvent<RankResponse>) => {
      const request = pending.get(event.data.id);
      if (!request) return;
      pending.delete(event.data.id);
      request.resolve(event.data.entries);
    });
    createdWorker.addEventListener("error", () => {
      createdWorker.terminate();
      if (worker !== createdWorker) return;
      worker = null;
      // Never move the sort back to the main thread. Unsorted provider order is
      // a safer degradation than introducing typing or paint stalls.
      settlePendingWithFallback();
    });
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

export function rankSearchResultsAsync(
  entries: AppEntry[],
  query: string,
): Promise<AppEntry[]> {
  if (!query.trim() || entries.length <= 1) return Promise.resolve(entries);

  // Search is latest-wins. Do not let an obsolete large sort make the newest
  // keystroke wait in the worker queue.
  if (pending.size > 0 && worker) {
    worker.terminate();
    worker = null;
    settlePendingWithFallback();
  }
  const rankWorker = getWorker();
  if (!rankWorker) return Promise.resolve(entries);

  const id = ++nextRequestId;
  return new Promise((resolve) => {
    pending.set(id, { fallback: entries, resolve });
    try {
      rankWorker.postMessage({ id, entries, query });
    } catch {
      pending.delete(id);
      resolve(entries);
    }
  });
}
