import type {
  PluginCliBashRequest,
  PluginCliJobSnapshot,
  PluginCliRunRequest,
  PluginCliRunResult,
  PluginCliStartRequest,
  PluginContext,
  PluginLruCache,
  PluginLruOptions,
} from "./types";
import type {
  PluginWorkbenchController,
  PluginWorkbenchItem,
  PluginWorkbenchItemsUpdate,
  PluginWorkbenchState,
} from "./workbenchTypes";

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
  onFilter?: (id: string, value: string) => void;
  onAction?: (id: string, item?: PluginWorkbenchItem) => void;
  onCommandComplete?: (event: { command: string; at: number }) => void;
  onBackgroundPoll?: (event: { command: string; at: number; ok: boolean; error?: string }) => void;
  onQuery?: (value: string) => void;
  onSelect?: (id: string, item: PluginWorkbenchItem) => void;
  onInput?: (id: string, value: string, item?: PluginWorkbenchItem) => void;
  onDownload?: (id: string, item?: PluginWorkbenchItem) => void;
};

type WorkbenchWindow = Window & {
  __qxPluginId?: string;
  __qxPluginRuntimeId?: string;
  __qxWorkbenchHandler?: (event: MessageEvent) => void;
  __qxPanelActionsHandler?: (event: MessageEvent) => void;
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
  createPluginStateKit: () => PluginContext["state"];
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

  function createPluginStateKit(): PluginContext["state"] {
    const finitePositive = (value: unknown, fallback: number, maximum: number) => {
      const parsed = Math.floor(Number(value));
      return Number.isFinite(parsed) && parsed > 0
        ? Math.min(parsed, maximum)
        : fallback;
    };

    const cloneSerializable = <T>(value: T): T => {
      const serialized = JSON.stringify(value);
      if (serialized === undefined) {
        throw new Error("plugin state snapshot must be JSON-serializable");
      }
      return JSON.parse(serialized) as T;
    };

    const createLatestWriter: PluginContext["state"]["createLatestWriter"] = (writer) => {
      let latestRevision = 0;
      let queue = Promise.resolve();
      return {
        write(value) {
          const revision = ++latestRevision;
          const snapshot = cloneSerializable(value);
          const operation = queue
            .catch(() => undefined)
            .then(async () => {
              if (revision !== latestRevision) return;
              await writer(snapshot);
            });
          queue = operation;
          return operation;
        },
        flush: () => queue,
      };
    };

    const createReadLedger: PluginContext["state"]["createReadLedger"] = (options = {}) => {
      let retentionDays = finitePositive(options.retentionDays, 7, 3_650);
      let maxEntries = finitePositive(options.maxEntries, 5_000, 100_000);
      let values: Record<string, number> = {};

      const normalize = (source: Record<string, number> | undefined) => {
        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1_000;
        return Object.fromEntries(
          Object.entries(source || {})
            .map(([id, at]) => [String(id).trim(), Number(at)] as const)
            .filter(([id, at]) => id && Number.isFinite(at) && at > 0 && at >= cutoff)
            .sort((left, right) => right[1] - left[1])
            .slice(0, maxEntries),
        );
      };
      const prune = () => {
        values = normalize(values);
      };
      const merge = (source: Record<string, number>) => {
        for (const [rawId, rawAt] of Object.entries(source || {})) {
          const id = String(rawId).trim();
          const at = Number(rawAt);
          if (!id || !Number.isFinite(at) || at <= 0) continue;
          values[id] = Math.max(Number(values[id]) || 0, at);
        }
        prune();
      };

      values = normalize(options.initial);
      return {
        has(id) {
          return Boolean(values[String(id || "").trim()]);
        },
        mark(id, at = Date.now()) {
          const key = String(id || "").trim();
          const timestamp = Number(at);
          if (!key || values[key] || !Number.isFinite(timestamp) || timestamp <= 0) return false;
          values[key] = timestamp;
          prune();
          return Boolean(values[key]);
        },
        unmark(id) {
          const key = String(id || "").trim();
          if (!key || !values[key]) return false;
          delete values[key];
          return true;
        },
        markMany(ids, at = Date.now()) {
          const timestamp = Number(at);
          if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
          let changed = 0;
          for (const rawId of ids || []) {
            const id = String(rawId || "").trim();
            if (!id || values[id]) continue;
            values[id] = timestamp;
            changed += 1;
          }
          prune();
          return changed;
        },
        merge,
        replace(source) {
          values = normalize(source);
        },
        configure(next) {
          retentionDays = finitePositive(next.retentionDays, retentionDays, 3_650);
          maxEntries = finitePositive(next.maxEntries, maxEntries, 100_000);
          prune();
        },
        prune,
        snapshot() {
          prune();
          return { ...values };
        },
        ids() {
          prune();
          return Object.keys(values);
        },
        size() {
          prune();
          return Object.keys(values).length;
        },
        clear() {
          values = {};
        },
      };
    };

    const createLru = <T>(options: PluginLruOptions<T> = {}): PluginLruCache<T> => {
      const maxEntries = finitePositive(options.maxEntries, 64, 10_000);
      const maxSize = finitePositive(options.maxSize, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
      const sizeOf = options.sizeOf || ((value: unknown) => typeof value === "string" ? value.length : 1);
      const entries = new Map<string, { value: T; size: number }>();
      let total = 0;
      const remove = (key: string) => {
        const current = entries.get(key);
        if (!current) return false;
        total -= current.size;
        entries.delete(key);
        return true;
      };
      return {
        get(key) {
          const normalized = String(key);
          const current = entries.get(normalized);
          if (!current) return undefined;
          entries.delete(normalized);
          entries.set(normalized, current);
          return current.value;
        },
        set(key, value) {
          const normalized = String(key);
          remove(normalized);
          const measured = Math.max(0, Number(sizeOf(value)) || 0);
          if (measured > maxSize) return false;
          entries.set(normalized, { value, size: measured });
          total += measured;
          while (entries.size > maxEntries || total > maxSize) {
            const oldest = entries.keys().next().value;
            if (oldest == null) break;
            remove(oldest);
          }
          return entries.has(normalized);
        },
        has: (key) => entries.has(String(key)),
        delete: (key) => remove(String(key)),
        clear() {
          entries.clear();
          total = 0;
        },
        size: () => entries.size,
        totalSize: () => total,
      };
    };

    const createGenerationGate: PluginContext["state"]["createGenerationGate"] = () => {
      let generation = 0;
      return {
        current: () => generation,
        next: () => {
          generation += 1;
          return generation;
        },
        invalidate: () => {
          generation += 1;
          return generation;
        },
        isCurrent: (candidate) => candidate === generation,
      };
    };

    return {
      createLatestWriter,
      createReadLedger,
      createLru,
      createGenerationGate,
    };
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
    ): PluginWorkbenchController => {
      const runtimeWindow = window as WorkbenchWindow;
      let currentState = state;
      const publish = () => runtimeWindow.__qxPluginUiBridge?.publishWorkbench?.(currentState);
      publish();
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
        else if (workbenchEvent.kind === "filter") {
          handlers.onFilter?.(
            String(workbenchEvent.id ?? ""),
            String(workbenchEvent.value ?? ""),
          );
        }
        else if (workbenchEvent.kind === "select") {
          const id = String(workbenchEvent.id ?? "");
          const item = (currentState.items || []).find((candidate) => candidate.id === id);
          if (item) handlers.onSelect?.(id, item);
        } else if (workbenchEvent.kind === "action") {
          const id = String(workbenchEvent.id ?? "");
          const selectedId = String(workbenchEvent.selectedId ?? currentState.selectedId ?? "");
          const item = (currentState.items || []).find((candidate) => candidate.id === selectedId);
          handlers.onAction?.(id, item);
        } else if (workbenchEvent.kind === "input") {
          const id = String(workbenchEvent.id ?? "");
          const value = String(workbenchEvent.value ?? "");
          const selectedId = String(workbenchEvent.selectedId ?? currentState.selectedId ?? "");
          const item = (currentState.items || []).find((candidate) => candidate.id === selectedId);
          handlers.onInput?.(id, value, item);
        } else if (workbenchEvent.kind === "download") {
          const id = String(workbenchEvent.id ?? "");
          const selectedId = String(workbenchEvent.selectedId ?? currentState.selectedId ?? "");
          const item = (currentState.items || []).find((candidate) => candidate.id === selectedId);
          if (id) handlers.onDownload?.(id, item);
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
      const update = (patch: Partial<PluginWorkbenchState>) => {
        currentState = { ...currentState, ...patch };
        publish();
      };
      const updateItems = (mutation: PluginWorkbenchItemsUpdate) => {
        const removeIds = new Set((mutation.removeIds || []).map(String));
        const byId = new Map(
          (currentState.items || [])
            .filter((item) => !removeIds.has(item.id))
            .map((item) => [item.id, item]),
        );
        for (const item of mutation.upsert || []) {
          if (!item?.id || removeIds.has(item.id)) continue;
          const previous = byId.get(item.id);
          byId.set(item.id, previous ? { ...previous, ...item } : item);
        }
        const ordered: PluginWorkbenchItem[] = [];
        const emitted = new Set<string>();
        for (const id of mutation.order || []) {
          const item = byId.get(String(id));
          if (!item || emitted.has(item.id)) continue;
          emitted.add(item.id);
          ordered.push(item);
        }
        for (const item of byId.values()) {
          if (emitted.has(item.id)) continue;
          emitted.add(item.id);
          ordered.push(item);
        }
        const requestedSelection = Object.prototype.hasOwnProperty.call(mutation, "selectedId")
          ? mutation.selectedId
          : currentState.selectedId;
        const selectedId = requestedSelection != null && emitted.has(String(requestedSelection))
          ? String(requestedSelection)
          : ordered[0]?.id ?? null;
        currentState = { ...currentState, items: ordered, selectedId };
        publish();
      };
      return {
        update,
        updateItems,
        getState: () => currentState,
      };
    };

    const mountActions: PluginContext["ui"]["mountActions"] = (actions, handlers = {}) => {
      const runtimeWindow = window as WorkbenchWindow;
      let currentActions = actions;
      let currentSelectionTitle = handlers.selectionTitle;
      const publish = () => runtimeWindow.parent.postMessage({
        type: "qx:plugin:item-actions",
        pluginId: runtimeWindow.__qxPluginId,
        runtimeId: runtimeWindow.__qxPluginRuntimeId,
        selectionTitle: currentSelectionTitle,
        actions: currentActions,
      }, "*");
      if (runtimeWindow.__qxPanelActionsHandler) {
        runtimeWindow.removeEventListener("message", runtimeWindow.__qxPanelActionsHandler);
      }
      runtimeWindow.__qxPanelActionsHandler = (event: MessageEvent) => {
        if (event.source !== runtimeWindow.parent) return;
        const message = event.data || {};
        if (message.type !== "qx:run-item-action") return;
        handlers.onAction?.(String(message.actionId ?? ""));
      };
      runtimeWindow.addEventListener("message", runtimeWindow.__qxPanelActionsHandler);
      publish();
      return {
        update(nextActions, selectionTitle) {
          currentActions = nextActions;
          currentSelectionTitle = selectionTitle;
          publish();
        },
        destroy() {
          if (runtimeWindow.__qxPanelActionsHandler) {
            runtimeWindow.removeEventListener("message", runtimeWindow.__qxPanelActionsHandler);
            delete runtimeWindow.__qxPanelActionsHandler;
          }
          currentActions = [];
          currentSelectionTitle = undefined;
          publish();
        },
      };
    };

    return { itemsFromJson, mountWorkbench, mountActions };
  }

  return {
    parseJsonLoose,
    parseJsonLines,
    mapWithConcurrency,
    enhancePluginCli,
    createPluginUiKit,
    createPluginStateKit,
  };
}
