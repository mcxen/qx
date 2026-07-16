/**
 * Non-blocking launcher ranking port.
 *
 * Sorting runs in a dedicated module worker so progressive provider merges and
 * rapid typing never execute an O(n log n) sort on the UI thread. The worker
 * stays alive, executes one request at a time, and retains only the newest
 * queued request. Callers still discard stale responses because query state is
 * owned by the launcher.
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

interface QueuedRank extends PendingRank {
  id: number;
  entries: AppEntry[];
  query: string;
}

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, PendingRank>();
let activeRequestId: number | null = null;
let queuedLatest: QueuedRank | null = null;

function settlePendingWithFallback(): void {
  for (const request of pending.values()) request.resolve(request.fallback);
  pending.clear();
  queuedLatest?.resolve(queuedLatest.fallback);
  queuedLatest = null;
  activeRequestId = null;
}

function dispatchRankRequest(rankWorker: Worker, request: QueuedRank): void {
  activeRequestId = request.id;
  pending.set(request.id, request);
  try {
    rankWorker.postMessage({ id: request.id, entries: request.entries, query: request.query });
  } catch {
    pending.delete(request.id);
    activeRequestId = null;
    request.resolve(request.fallback);
  }
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
      if (activeRequestId === event.data.id) activeRequestId = null;
      const next = queuedLatest;
      queuedLatest = null;
      if (next && worker === createdWorker) dispatchRankRequest(createdWorker, next);
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

  const rankWorker = getWorker();
  if (!rankWorker) return Promise.resolve(entries);

  const id = ++nextRequestId;
  return new Promise((resolve) => {
    const request: QueuedRank = { id, entries, query, fallback: entries, resolve };
    if (activeRequestId !== null) {
      // The worker stays alive. Keep only the newest waiting sort and resolve
      // the superseded one with provider order so no caller is left pending.
      queuedLatest?.resolve(queuedLatest.fallback);
      queuedLatest = request;
      return;
    }
    dispatchRankRequest(rankWorker, request);
  });
}
