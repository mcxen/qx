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

type WorkbenchHandlers = {
  onTab?: (id: string) => void;
  onAction?: (id: string, item?: PluginWorkbenchItem) => void;
  onCommandComplete?: (event: { command: string; at: number }) => void;
  onBackgroundPoll?: (event: { command: string; at: number; ok: boolean; error?: string }) => void;
  onQuery?: (value: string) => void;
  onSelect?: (id: string, item: PluginWorkbenchItem) => void;
};

type WorkbenchWindow = Window & {
  __qxWorkbenchHandler?: (event: MessageEvent) => void;
  __qxPluginUiBridge?: {
    publishWorkbench?: (state: PluginWorkbenchState) => void;
  };
};

export interface PluginSdkRuntime {
  parseJsonLoose: (text: string) => unknown;
  parseJsonLines: (text: string) => unknown[];
  mapWithConcurrency: <T, R>(
    items: T[],
    worker: (item: T, index: number) => Promise<R>,
    concurrency?: number,
  ) => Promise<R[]>;
  enhancePluginCli: (core: PluginCliCore) => PluginContext["cli"];
  createPluginUiKit: () => PluginContext["ui"];
}

/**
 * One self-contained SDK factory used by both trusted host contexts and the
 * sandboxed iframe bootstrap. Keep every runtime dependency inside this
 * function: `cliWorkbench.ts` serializes it with `Function#toString` so the
 * iframe and host cannot drift into two implementations of the same protocol.
 */
export function createPluginSdkRuntime(): PluginSdkRuntime {
  function parseJsonLoose(text: string): unknown {
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

  function parseJsonLines(text: string): unknown[] {
    const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const output: unknown[] = [];
    for (const line of lines) {
      try {
        output.push(JSON.parse(line));
      } catch {
        // Command output may include logs around JSONL rows.
      }
    }
    return output;
  }

  async function mapWithConcurrency<T, R>(
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

  function enhancePluginCli(core: PluginCliCore): PluginContext["cli"] {
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

    const json = async <T = unknown>(
      request: PluginCliRunRequest & { allowNonZero?: boolean; jsonl?: boolean },
    ): Promise<T> => {
      const { allowNonZero, jsonl, ...runRequest } = request;
      const result = allowNonZero ? await core.run(runRequest) : await ensure(runRequest);
      if (result.timedOut) throw new Error(`cli timed out: ${runRequest.program}`);
      if (!allowNonZero && result.status !== 0 && result.status != null) {
        throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim().slice(0, 800));
      }
      return (jsonl ? parseJsonLines(result.stdout) : parseJsonLoose(result.stdout)) as T;
    };

    const lines = async (
      request: PluginCliRunRequest & { allowNonZero?: boolean; trimEmpty?: boolean },
    ): Promise<string[]> => {
      const { allowNonZero, trimEmpty = true, ...runRequest } = request;
      const result = allowNonZero ? await core.run(runRequest) : await ensure(runRequest);
      const rows = String(result.stdout || "").split(/\r?\n/);
      return trimEmpty ? rows.map((line) => line.trimEnd()).filter((line) => line.trim()) : rows;
    };

    const text = async (request: PluginCliRunRequest): Promise<string> =>
      String((await ensure(request)).stdout || "").trimEnd();

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
      options?: {
        pollMs?: number;
        onUpdate?: (job: PluginCliJobSnapshot) => void;
        signal?: AbortSignal;
      },
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

  function createPluginUiKit(): PluginContext["ui"] {
    const itemsFromJson: PluginContext["ui"]["itemsFromJson"] = (value) => {
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
          return {
            id: String(index),
            title: typeof entry === "string" ? entry : JSON.stringify(entry),
            raw: entry,
          };
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

    const mountWorkbench = (
      state: PluginWorkbenchState,
      handlers: WorkbenchHandlers = {},
    ): void => {
      const runtimeWindow = window as WorkbenchWindow;
      runtimeWindow.__qxPluginUiBridge?.publishWorkbench?.(state);
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
          const item = (state.items || []).find((candidate) => candidate.id === id);
          if (item) handlers.onSelect?.(id, item);
        } else if (workbenchEvent.kind === "action") {
          const id = String(workbenchEvent.id ?? "");
          const selectedId = String(workbenchEvent.selectedId ?? state.selectedId ?? "");
          const item = (state.items || []).find((candidate) => candidate.id === selectedId);
          handlers.onAction?.(id, item);
        } else if (workbenchEvent.kind === "commandComplete") {
          handlers.onCommandComplete?.({
            command: String(workbenchEvent.command ?? ""),
            at: Number(workbenchEvent.at) || Date.now(),
          });
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

  return {
    parseJsonLoose,
    parseJsonLines,
    mapWithConcurrency,
    enhancePluginCli,
    createPluginUiKit,
  };
}
