/**
 * CLI helpers and the declarative Workbench bridge injected into plugin runtimes.
 * Workbench UI is rendered exclusively by Qx; plugins only publish serializable data.
 */

import type {
  PluginCliBashRequest,
  PluginCliJobSnapshot,
  PluginCliRunRequest,
  PluginCliRunResult,
  PluginCliStartRequest,
  PluginContext,
} from "./types";
import type { PluginWorkbenchItem, PluginWorkbenchState } from "./workbenchTypes";

export type PluginCliCore = {
  run: (request: PluginCliRunRequest) => Promise<PluginCliRunResult>;
  bash: (request: PluginCliBashRequest | string) => Promise<PluginCliRunResult>;
  which: (program: string) => Promise<string | null>;
  start: (request: PluginCliStartRequest) => Promise<PluginCliJobSnapshot>;
  poll: (jobId: string) => Promise<PluginCliJobSnapshot>;
  cancel: (jobId: string) => Promise<PluginCliJobSnapshot>;
  listJobs: () => Promise<PluginCliJobSnapshot[]>;
};

export type PluginCliJsonOptions = PluginCliRunRequest & {
  allowNonZero?: boolean;
  jsonl?: boolean;
};

export type PluginCliLinesOptions = PluginCliRunRequest & {
  allowNonZero?: boolean;
  trimEmpty?: boolean;
};

export type PluginUiListItem = PluginWorkbenchItem;
export type PluginUiWorkbenchState = PluginWorkbenchState;

export function parseJsonLoose(text: string): unknown {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) throw new Error("empty JSON stdout");
  try {
    return JSON.parse(trimmed);
  } catch {
    const objectStart = trimmed.indexOf("{");
    const arrayStart = trimmed.indexOf("[");
    let start = -1;
    if (objectStart >= 0 && arrayStart >= 0) start = Math.min(objectStart, arrayStart);
    else start = Math.max(objectStart, arrayStart);
    if (start < 0) throw new Error("stdout is not JSON");
    return JSON.parse(trimmed.slice(start));
  }
}

export function parseJsonLines(text: string): unknown[] {
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const output: unknown[] = [];
  for (const line of lines) {
    try {
      output.push(JSON.parse(line));
    } catch {
      // Ignore command log noise around JSONL output.
    }
  }
  return output;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency = 4,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(32, Math.floor(concurrency) || 4));
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function enhancePluginCli(core: PluginCliCore): PluginContext["cli"] {
  const ensure = async (request: PluginCliRunRequest): Promise<PluginCliRunResult> => {
    const result = await core.run(request);
    if (result.timedOut) {
      throw new Error(`cli timed out: ${request.program} ${(request.args || []).join(" ")}`.trim());
    }
    if (result.status !== 0 && result.status != null) {
      const message = (result.stderr || result.stdout || `exit ${result.status}`).trim();
      throw new Error(message.slice(0, 800) || `cli exit ${result.status}`);
    }
    return result;
  };

  const json = async <T = unknown>(request: PluginCliJsonOptions): Promise<T> => {
    const { allowNonZero, jsonl, ...runRequest } = request;
    const result = allowNonZero ? await core.run(runRequest) : await ensure(runRequest);
    if (result.timedOut) throw new Error(`cli timed out: ${runRequest.program}`);
    if (!allowNonZero && result.status !== 0 && result.status != null) {
      throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim().slice(0, 800));
    }
    return (jsonl ? parseJsonLines(result.stdout) : parseJsonLoose(result.stdout)) as T;
  };

  const lines = async (request: PluginCliLinesOptions): Promise<string[]> => {
    const { allowNonZero, trimEmpty = true, ...runRequest } = request;
    const result = allowNonZero ? await core.run(runRequest) : await ensure(runRequest);
    const rows = String(result.stdout || "").split(/\r?\n/);
    return trimEmpty ? rows.map((line) => line.trimEnd()).filter((line) => line.trim()) : rows;
  };

  const text = async (request: PluginCliRunRequest): Promise<string> => {
    const result = await ensure(request);
    return String(result.stdout || "").trimEnd();
  };

  const jsonBash = async <T = unknown>(
    script: string | PluginCliBashRequest,
    options?: { allowNonZero?: boolean; jsonl?: boolean },
  ): Promise<T> => {
    const result = await core.bash(script);
    if (result.timedOut) throw new Error("cli bash timed out");
    if (!options?.allowNonZero && result.status !== 0 && result.status != null) {
      throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim().slice(0, 800));
    }
    return (options?.jsonl ? parseJsonLines(result.stdout) : parseJsonLoose(result.stdout)) as T;
  };

  const wait = async (
    jobId: string,
    options?: { pollMs?: number; onUpdate?: (job: PluginCliJobSnapshot) => void; signal?: AbortSignal },
  ): Promise<PluginCliJobSnapshot> => {
    const pollMs = Math.max(50, Math.min(5_000, options?.pollMs ?? 500));
    for (;;) {
      if (options?.signal?.aborted) throw new Error("cli wait aborted");
      const snapshot = await core.poll(jobId);
      options?.onUpdate?.(snapshot);
      if (!snapshot.running) return snapshot;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, pollMs);
        options?.signal?.addEventListener("abort", () => {
          window.clearTimeout(timer);
          reject(new Error("cli wait aborted"));
        }, { once: true });
      });
    }
  };

  return {
    ...core,
    wait,
    map: (items, worker, options) => mapWithConcurrency(items, worker, options?.concurrency ?? 4),
    ensure,
    json,
    lines,
    text,
    jsonBash,
    parseJson: parseJsonLoose,
    parseJsonLines,
  };
}

type WorkbenchHandlers = {
  onTab?: (id: string) => void;
  onAction?: (id: string, item?: PluginWorkbenchItem) => void;
  onBackgroundPoll?: (event: { command: string; at: number; ok: boolean; error?: string }) => void;
  onQuery?: (value: string) => void;
  onSelect?: (id: string, item: PluginWorkbenchItem) => void;
};

type WorkbenchWindow = Window & {
  __qxWorkbenchHandler?: (event: MessageEvent) => void;
  __qxPluginUiBridge?: {
    publishWorkbench?: (state: PluginWorkbenchState) => void;
    updateIsland?: (input: PluginWorkbenchState["island"]) => void;
  };
};

function itemId(item: PluginWorkbenchItem): string {
  return String(item.id ?? item.title);
}

export function createPluginUiKit(): PluginContext["ui"] {
  const itemsFromJson = (value: unknown): PluginUiListItem[] => {
    if (Array.isArray(value)) {
      return value.map((entry, index) => {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          const record = entry as Record<string, unknown>;
          const title = String(record.title ?? record.name ?? record.id ?? record.path ?? `Item ${index + 1}`);
          const subtitle = String(record.subtitle ?? record.description ?? record.desc ?? record.version ?? "");
          const meta = String(record.meta ?? record.kind ?? record.type ?? "");
          return {
            id: String(record.id ?? record.name ?? index),
            title,
            subtitle: subtitle || undefined,
            meta: meta || undefined,
            badge: record.badge == null ? meta || undefined : String(record.badge),
            raw: entry,
          };
        }
        return { id: String(index), title: typeof entry === "string" ? entry : JSON.stringify(entry), raw: entry };
      });
    }
    if (value && typeof value === "object") {
      return Object.entries(value as Record<string, unknown>).map(([key, entry]) => ({
        id: key,
        title: key,
        subtitle: typeof entry === "object" ? JSON.stringify(entry) : String(entry),
        raw: entry,
      }));
    }
    return [{ id: "value", title: String(value), raw: value }];
  };

  const mountWorkbench = (state: PluginWorkbenchState, handlers: WorkbenchHandlers = {}): void => {
    const runtimeWindow = window as WorkbenchWindow;
    runtimeWindow.__qxPluginUiBridge?.publishWorkbench?.(state);
    if (Object.prototype.hasOwnProperty.call(state, "island")) {
      runtimeWindow.__qxPluginUiBridge?.updateIsland?.(state.island);
    }

    if (runtimeWindow.__qxWorkbenchHandler) {
      runtimeWindow.removeEventListener("message", runtimeWindow.__qxWorkbenchHandler);
    }
    runtimeWindow.__qxWorkbenchHandler = (event: MessageEvent) => {
      if (event.source !== runtimeWindow.parent) return;
      const message = event.data || {};
      if (message.type !== "qx:workbench:event") return;
      const workbenchEvent = message.event || {};
      if (workbenchEvent.kind === "query") handlers.onQuery?.(String(workbenchEvent.value ?? ""));
      else if (workbenchEvent.kind === "tab") handlers.onTab?.(String(workbenchEvent.id ?? ""));
      else if (workbenchEvent.kind === "select") {
        const id = String(workbenchEvent.id ?? "");
        const item = (state.items || []).find((candidate) => itemId(candidate) === id);
        if (item) handlers.onSelect?.(id, item);
      } else if (workbenchEvent.kind === "action") {
        const id = String(workbenchEvent.id ?? "");
        const selectedId = String(workbenchEvent.selectedId ?? state.selectedId ?? "");
        const item = (state.items || []).find((candidate) => itemId(candidate) === selectedId);
        handlers.onAction?.(id, item);
      } else if (workbenchEvent.kind === "backgroundPoll") {
        handlers.onBackgroundPoll?.({
          command: String(workbenchEvent.command ?? ""),
          at: Number(workbenchEvent.at) || Date.now(),
          ok: workbenchEvent.ok === true,
          error: workbenchEvent.error == null ? undefined : String(workbenchEvent.error),
        });
      }
    };
    runtimeWindow.addEventListener("message", runtimeWindow.__qxWorkbenchHandler);
  };

  return { itemsFromJson, mountWorkbench };
}

/** Inline JavaScript injected into sandboxed plugin iframes. */
export const PLUGIN_WORKBENCH_RUNTIME_JS = String.raw`
function parseJsonLoose(text) {
  const trimmed = String(text == null ? '' : text).trim();
  if (!trimmed) throw new Error('empty JSON stdout');
  try { return JSON.parse(trimmed); } catch (_) {}
  const objectStart = trimmed.indexOf('{');
  const arrayStart = trimmed.indexOf('[');
  let start = -1;
  if (objectStart >= 0 && arrayStart >= 0) start = Math.min(objectStart, arrayStart);
  else start = Math.max(objectStart, arrayStart);
  if (start < 0) throw new Error('stdout is not JSON');
  return JSON.parse(trimmed.slice(start));
}
function parseJsonLines(text) {
  const output = [];
  String(text == null ? '' : text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
    try { output.push(JSON.parse(line)); } catch (_) {}
  });
  return output;
}
async function mapWithConcurrency(items, worker, concurrency) {
  const limit = Math.max(1, Math.min(32, Math.floor(concurrency) || 4));
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
function enhancePluginCli(core) {
  async function ensure(request) {
    const result = await core.run(request);
    if (result.timedOut) throw new Error(('cli timed out: ' + request.program + ' ' + (request.args || []).join(' ')).trim());
    if (result.status !== 0 && result.status != null) {
      const message = (result.stderr || result.stdout || ('exit ' + result.status)).trim();
      throw new Error(message.slice(0, 800) || ('cli exit ' + result.status));
    }
    return result;
  }
  async function json(request) {
    const runRequest = { program: request.program, args: request.args, cwd: request.cwd, env: request.env, timeoutMs: request.timeoutMs };
    const result = request.allowNonZero ? await core.run(runRequest) : await ensure(runRequest);
    if (result.timedOut) throw new Error('cli timed out: ' + runRequest.program);
    return request.jsonl ? parseJsonLines(result.stdout) : parseJsonLoose(result.stdout);
  }
  async function lines(request) {
    const runRequest = { program: request.program, args: request.args, cwd: request.cwd, env: request.env, timeoutMs: request.timeoutMs };
    const result = request.allowNonZero ? await core.run(runRequest) : await ensure(runRequest);
    const rows = String(result.stdout || '').split(/\r?\n/);
    return request.trimEmpty === false ? rows : rows.map((line) => line.trimEnd()).filter((line) => line.trim());
  }
  async function text(request) { return String((await ensure(request)).stdout || '').trimEnd(); }
  async function jsonBash(script, options) {
    options = options || {};
    const result = await core.bash(script);
    if (result.timedOut) throw new Error('cli bash timed out');
    if (!options.allowNonZero && result.status !== 0 && result.status != null) {
      throw new Error((result.stderr || result.stdout || ('exit ' + result.status)).trim().slice(0, 800));
    }
    return options.jsonl ? parseJsonLines(result.stdout) : parseJsonLoose(result.stdout);
  }
  async function wait(jobId, options) {
    options = options || {};
    const pollMs = Math.max(50, Math.min(5000, options.pollMs || 500));
    while (true) {
      if (options.signal && options.signal.aborted) throw new Error('cli wait aborted');
      const snapshot = await core.poll(jobId);
      if (options.onUpdate) options.onUpdate(snapshot);
      if (!snapshot.running) return snapshot;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, pollMs);
        if (options.signal) options.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('cli wait aborted'));
        }, { once: true });
      });
    }
  }
  return Object.assign({}, core, {
    wait,
    map: (items, worker, options) => mapWithConcurrency(items, worker, options && options.concurrency || 4),
    ensure, json, lines, text, jsonBash,
    parseJson: parseJsonLoose,
    parseJsonLines,
  });
}
function createPluginUiKit() {
  function itemId(item) { return String(item.id != null ? item.id : item.title); }
  function itemsFromJson(value) {
    if (Array.isArray(value)) return value.map((entry, index) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const title = String(entry.title != null ? entry.title : entry.name != null ? entry.name : entry.id != null ? entry.id : entry.path != null ? entry.path : ('Item ' + (index + 1)));
        const subtitle = String(entry.subtitle != null ? entry.subtitle : entry.description != null ? entry.description : entry.desc != null ? entry.desc : entry.version != null ? entry.version : '');
        const meta = String(entry.meta != null ? entry.meta : entry.kind != null ? entry.kind : entry.type != null ? entry.type : '');
        return { id: String(entry.id != null ? entry.id : entry.name != null ? entry.name : index), title, subtitle: subtitle || undefined, meta: meta || undefined, badge: entry.badge == null ? meta || undefined : String(entry.badge), raw: entry };
      }
      return { id: String(index), title: typeof entry === 'string' ? entry : JSON.stringify(entry), raw: entry };
    });
    if (value && typeof value === 'object') return Object.entries(value).map(([key, entry]) => ({ id: key, title: key, subtitle: typeof entry === 'object' ? JSON.stringify(entry) : String(entry), raw: entry }));
    return [{ id: 'value', title: String(value), raw: value }];
  }
  function mountWorkbench(state, handlers) {
    state = state || {};
    handlers = handlers || {};
    if (globalThis.__qxPluginUiBridge && globalThis.__qxPluginUiBridge.publishWorkbench) globalThis.__qxPluginUiBridge.publishWorkbench(state);
    if (Object.prototype.hasOwnProperty.call(state, 'island') && globalThis.__qxPluginUiBridge && globalThis.__qxPluginUiBridge.updateIsland) globalThis.__qxPluginUiBridge.updateIsland(state.island);
    if (globalThis.__qxWorkbenchHandler) window.removeEventListener('message', globalThis.__qxWorkbenchHandler);
    globalThis.__qxWorkbenchHandler = function (event) {
      if (event.source !== window.parent) return;
      const message = event.data || {};
      if (message.type !== 'qx:workbench:event') return;
      const workbenchEvent = message.event || {};
      if (workbenchEvent.kind === 'query' && handlers.onQuery) handlers.onQuery(String(workbenchEvent.value == null ? '' : workbenchEvent.value));
      else if (workbenchEvent.kind === 'tab' && handlers.onTab) handlers.onTab(String(workbenchEvent.id == null ? '' : workbenchEvent.id));
      else if (workbenchEvent.kind === 'select' && handlers.onSelect) {
        const id = String(workbenchEvent.id == null ? '' : workbenchEvent.id);
        const item = (state.items || []).find((candidate) => itemId(candidate) === id);
        if (item) handlers.onSelect(id, item);
      } else if (workbenchEvent.kind === 'action' && handlers.onAction) {
        const id = String(workbenchEvent.id == null ? '' : workbenchEvent.id);
        const selectedId = String(workbenchEvent.selectedId == null ? (state.selectedId == null ? '' : state.selectedId) : workbenchEvent.selectedId);
        const item = (state.items || []).find((candidate) => itemId(candidate) === selectedId);
        handlers.onAction(id, item);
      } else if (workbenchEvent.kind === 'backgroundPoll' && handlers.onBackgroundPoll) {
        handlers.onBackgroundPoll({ command: String(workbenchEvent.command == null ? '' : workbenchEvent.command), at: Number(workbenchEvent.at) || Date.now(), ok: workbenchEvent.ok === true, error: workbenchEvent.error == null ? undefined : String(workbenchEvent.error) });
      }
    };
    window.addEventListener('message', globalThis.__qxWorkbenchHandler);
  }
  return { itemsFromJson, mountWorkbench };
}
`;
