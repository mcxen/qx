/**
 * Non-blocking launcher calculator port.
 *
 * Mirrors `rankResultsAsync`: one long-lived worker, latest-wins queue, and a
 * main-thread fallback that still yields off the current turn so typing /
 * first paint never wait on expression evaluation.
 *
 * Callers must still discard stale results with their own search generation
 * (`searchSeqRef`) — this module only guarantees request-level latest-wins.
 */

import type { AppEntry } from "../store";
import {
  calculateExpression,
  looksLikeCalculationQuery,
  type CalculationResult,
} from "./calculator";
import { calculationEntryFromResult } from "./calculatorProvider";
import type {
  CalculatorWorkerRequest,
  CalculatorWorkerResponse,
} from "./calculator.worker";

interface PendingCalc {
  resolve: (result: CalculationResult | null) => void;
}

interface QueuedCalc extends PendingCalc {
  id: number;
  input: string;
}

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<number, PendingCalc>();
let activeRequestId: number | null = null;
let queuedLatest: QueuedCalc | null = null;

function settleAllWithNull(): void {
  for (const request of pending.values()) request.resolve(null);
  pending.clear();
  if (queuedLatest) {
    queuedLatest.resolve(null);
    queuedLatest = null;
  }
  activeRequestId = null;
}

function dispatchCalcRequest(calcWorker: Worker, request: QueuedCalc): void {
  activeRequestId = request.id;
  pending.set(request.id, request);
  const message: CalculatorWorkerRequest = { id: request.id, input: request.input };
  try {
    calcWorker.postMessage(message);
  } catch {
    pending.delete(request.id);
    activeRequestId = null;
    request.resolve(evaluateOnMainThread(request.input));
  }
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined") return null;

  try {
    const created = new Worker(new URL("./calculator.worker.ts", import.meta.url), {
      type: "module",
      name: "qx-search-calculator",
    });
    worker = created;
    created.addEventListener("message", (event: MessageEvent<CalculatorWorkerResponse>) => {
      const request = pending.get(event.data.id);
      if (!request) return;
      pending.delete(event.data.id);
      request.resolve(event.data.result);
      if (activeRequestId === event.data.id) activeRequestId = null;
      const next = queuedLatest;
      queuedLatest = null;
      if (next && worker === created) dispatchCalcRequest(created, next);
    });
    created.addEventListener("error", () => {
      created.terminate();
      if (worker !== created) return;
      worker = null;
      settleAllWithNull();
    });
    return worker;
  } catch {
    worker = null;
    return null;
  }
}

function evaluateOnMainThread(input: string): CalculationResult | null {
  try {
    return calculateExpression(input);
  } catch {
    return null;
  }
}

/** Yield so React paint / key handling can finish before sync eval. */
function yieldToNextTask(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof queueMicrotask === "function") {
      queueMicrotask(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

/**
 * Evaluate a math query off the critical path. Returns null when the input is
 * not a calculation or evaluation fails.
 */
export function calculateExpressionAsync(input: string): Promise<CalculationResult | null> {
  if (!looksLikeCalculationQuery(input)) return Promise.resolve(null);

  const calcWorker = getWorker();
  if (!calcWorker) {
    return yieldToNextTask().then(() => evaluateOnMainThread(input));
  }

  const id = ++nextRequestId;
  return new Promise((resolve) => {
    const request: QueuedCalc = { id, input, resolve };
    if (activeRequestId !== null) {
      // Only the newest waiting expression keeps a resolver; older ones settle null.
      queuedLatest?.resolve(null);
      queuedLatest = request;
      return;
    }
    dispatchCalcRequest(calcWorker, request);
  });
}

/**
 * Launcher-facing helper: async evaluation + AppEntry mapping in one call.
 */
export async function resolveCalculationEntryAsync(query: string): Promise<AppEntry | null> {
  const result = await calculateExpressionAsync(query);
  return result ? calculationEntryFromResult(result) : null;
}
