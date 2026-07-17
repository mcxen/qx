/**
 * CLI → GUI workbench helpers injected into every plugin context.
 *
 * - `enhancePluginCli`: parse JSON / lines / fail-loud ensure on top of cli.run
 * - `createPluginUiKit`: HTML escape + workbench chrome + list/JSON renderers
 * - `PLUGIN_WORKBENCH_RUNTIME_JS`: same logic for sandboxed iframe runtimes
 */

import type {
  PluginCliBashRequest,
  PluginCliJobSnapshot,
  PluginCliRunRequest,
  PluginCliRunResult,
  PluginCliStartRequest,
  PluginContext,
} from "./types";

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
  /** When true, accept non-zero exit if stdout still parses as JSON. */
  allowNonZero?: boolean;
  /** Parse as JSON Lines (one value per line). */
  jsonl?: boolean;
};

export type PluginCliLinesOptions = PluginCliRunRequest & {
  allowNonZero?: boolean;
  /** Drop empty lines (default true). */
  trimEmpty?: boolean;
};

export type PluginUiListItem = {
  id?: string;
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: string;
  /** Optional leading glyph (emoji / short mark). */
  icon?: string;
  /** 0–100 progress bar under the subtitle (CI / downloads). */
  progress?: number;
  /** Badge / accent tone for status. */
  tone?: "neutral" | "success" | "danger" | "warning" | "accent" | string;
  raw?: unknown;
};

export type PluginUiWorkbenchState = {
  title?: string;
  meta?: string;
  error?: string | null;
  loading?: boolean;
  query?: string;
  queryPlaceholder?: string;
  tabs?: Array<{ id: string; label: string; active?: boolean }>;
  toolbar?: Array<{ id: string; label: string; primary?: boolean; danger?: boolean }>;
  items?: PluginUiListItem[];
  selectedId?: string | null;
  detailHtml?: string;
  emptyText?: string;
  /**
   * When true (default if a host chrome bridge is available), filter + tabs
   * render in QxShell TopBar instead of inside the iframe workbench.
   */
  hostChrome?: boolean;
};

function isCliRunRequest(value: PluginCliRunRequest | PluginCliBashRequest | string): value is PluginCliRunRequest {
  return typeof value === "object" && value != null && "program" in value;
}

export function parseJsonLoose(text: string): unknown {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    throw new Error("empty JSON stdout");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    // Tolerate leading log noise: take the first {...} or [...] slice.
    const objectStart = trimmed.indexOf("{");
    const arrayStart = trimmed.indexOf("[");
    let start = -1;
    if (objectStart >= 0 && arrayStart >= 0) start = Math.min(objectStart, arrayStart);
    else start = Math.max(objectStart, arrayStart);
    if (start < 0) throw new Error("stdout is not JSON");
    const slice = trimmed.slice(start);
    return JSON.parse(slice);
  }
}

export function parseJsonLines(text: string): unknown[] {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const out: unknown[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      // skip non-json noise lines
    }
  }
  return out;
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
      const msg = (result.stderr || result.stdout || `exit ${result.status}`).trim();
      throw new Error(msg.slice(0, 800) || `cli exit ${result.status}`);
    }
    return result;
  };

  const json = async <T = unknown>(request: PluginCliJsonOptions): Promise<T> => {
    const { allowNonZero, jsonl, ...runReq } = request;
    const result = allowNonZero ? await core.run(runReq) : await ensure(runReq);
    if (result.timedOut) {
      throw new Error(`cli timed out: ${runReq.program}`);
    }
    if (!allowNonZero && result.status !== 0 && result.status != null) {
      throw new Error((result.stderr || result.stdout || `exit ${result.status}`).trim().slice(0, 800));
    }
    if (jsonl) {
      return parseJsonLines(result.stdout) as T;
    }
    return parseJsonLoose(result.stdout) as T;
  };

  const lines = async (request: PluginCliLinesOptions): Promise<string[]> => {
    const { allowNonZero, trimEmpty = true, ...runReq } = request;
    const result = allowNonZero ? await core.run(runReq) : await ensure(runReq);
    const rows = String(result.stdout || "").split(/\r?\n/);
    if (!trimEmpty) return rows;
    return rows.map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
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
    if (options?.jsonl) return parseJsonLines(result.stdout) as T;
    return parseJsonLoose(result.stdout) as T;
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
      if (options?.signal?.aborted) {
        throw new Error("cli wait aborted");
      }
      const snap = await core.poll(jobId);
      options?.onUpdate?.(snap);
      if (!snap.running) return snap;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => resolve(), pollMs);
        options?.signal?.addEventListener(
          "abort",
          () => {
            window.clearTimeout(timer);
            reject(new Error("cli wait aborted"));
          },
          { once: true },
        );
      });
    }
  };

  return {
    run: core.run,
    bash: core.bash,
    which: core.which,
    start: core.start,
    poll: core.poll,
    cancel: core.cancel,
    listJobs: core.listJobs,
    wait,
    map: (items, worker, options) =>
      mapWithConcurrency(items, worker, options?.concurrency ?? 4),
    ensure,
    json,
    lines,
    text,
    jsonBash,
    parseJson: parseJsonLoose,
    parseJsonLines,
  };
}

const WORKBENCH_CSS = `
.qx-wb{box-sizing:border-box;height:100%;display:flex;flex-direction:column;gap:8px;padding:12px;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--qx-text-primary,#111);background:transparent}
.qx-wb *,.qx-wb *::before,.qx-wb *::after{box-sizing:border-box}
.qx-wb-head{display:flex;flex-direction:column;gap:6px}
.qx-wb-title{font-size:15px;font-weight:650;margin:0}
.qx-wb-meta{font-size:12px;color:var(--qx-text-secondary,#666)}
.qx-wb-tabs{display:flex;gap:6px;flex-wrap:wrap}
.qx-wb-tab,.qx-wb-btn{height:30px;border:1px solid var(--qx-border-1,#ddd);border-radius:7px;background:var(--qx-bg-component-1,#fff);color:inherit;padding:0 10px;font:inherit;cursor:pointer}
.qx-wb-tab.is-on,.qx-wb-btn.is-primary{border-color:var(--qx-accent,#2563eb);background:color-mix(in srgb,var(--qx-accent,#2563eb) 12%,transparent)}
.qx-wb-btn.is-danger{color:var(--qx-danger,#b91c1c)}
.qx-wb-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.qx-wb-bar input[type=text],.qx-wb-bar input:not([type]){flex:1;min-width:140px;height:32px;border:1px solid var(--qx-border-1,#ddd);border-radius:7px;padding:0 10px;background:var(--qx-bg-component-1,#fff);color:inherit;font:inherit}
.qx-wb-err{color:var(--qx-danger,#b91c1c);white-space:pre-wrap;font-size:12px;padding:6px 8px;border-radius:6px;background:color-mix(in srgb,var(--qx-danger,#b91c1c) 8%,transparent)}
.qx-wb-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:8px}
@media (max-width:720px){.qx-wb-body{grid-template-columns:1fr}}
.qx-wb-list,.qx-wb-detail{min-height:0;overflow:auto;border:1px solid var(--qx-border-1,#e5e5e5);border-radius:8px;background:var(--qx-bg-component-1,rgba(255,255,255,.55))}
.qx-wb-list{display:flex;flex-direction:column;gap:2px;padding:4px}
.qx-wb-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px 10px;border:1px solid transparent;border-radius:7px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;width:100%}
.qx-wb-row:hover{background:var(--qx-bg-component-2,#f3f4f6)}
.qx-wb-row.is-sel{border-color:var(--qx-accent,#2563eb);background:color-mix(in srgb,var(--qx-accent,#2563eb) 10%,transparent)}
.qx-wb-row:focus{outline:none}
.qx-wb-row:focus-visible{outline:2px solid var(--qx-accent,#2563eb);outline-offset:1px}
.qx-wb-list{outline:none}
.qx-wb-icon{width:1.4em;text-align:center;flex-shrink:0;font-size:14px;line-height:1.2}
.qx-wb-row strong{display:block;font-weight:600}
.qx-wb-row small{display:block;color:var(--qx-text-secondary,#666);margin-top:2px}
.qx-wb-badge{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--qx-text-tertiary,#888);border:1px solid var(--qx-border-1,#ddd);border-radius:4px;padding:2px 6px;white-space:nowrap}
.qx-wb-badge.tone-success{color:#15803d;border-color:color-mix(in srgb,#15803d 35%,var(--qx-border-1,#ddd))}
.qx-wb-badge.tone-danger{color:var(--qx-danger,#b91c1c);border-color:color-mix(in srgb,var(--qx-danger,#b91c1c) 35%,var(--qx-border-1,#ddd))}
.qx-wb-badge.tone-warning{color:#b45309;border-color:color-mix(in srgb,#b45309 35%,var(--qx-border-1,#ddd))}
.qx-wb-badge.tone-accent,.qx-wb-badge.tone-run{color:var(--qx-accent,#2563eb);border-color:color-mix(in srgb,var(--qx-accent,#2563eb) 40%,var(--qx-border-1,#ddd))}
.qx-wb-progress{height:4px;border-radius:2px;background:color-mix(in srgb,var(--qx-text-primary,#111) 10%,transparent);margin-top:6px;overflow:hidden}
.qx-wb-progress>i{display:block;height:100%;border-radius:2px;background:var(--qx-accent,#2563eb);width:0}
.qx-wb-detail{padding:10px 12px}
.qx-wb-empty{padding:24px 12px;text-align:center;color:var(--qx-text-tertiary,#888);font-size:12px}
.qx-wb-pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.qx-wb-kv{display:grid;grid-template-columns:120px minmax(0,1fr);gap:6px 10px;font-size:12px}
.qx-wb-kv dt{color:var(--qx-text-tertiary,#888)}
.qx-wb-kv dd{margin:0;word-break:break-word}
.qx-wb-loading{opacity:.7}
`.trim();

function clampProgress(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toneClass(tone: unknown): string {
  const t = String(tone || "").toLowerCase();
  if (!t || t === "neutral") return "";
  if (t === "success" || t === "danger" || t === "warning" || t === "accent" || t === "run") {
    return ` tone-${t}`;
  }
  return "";
}

function renderListRowHtml(item: PluginUiListItem, selected: boolean, esc: (v: unknown) => string): string {
  const id = String(item.id ?? item.title);
  const progress = clampProgress(item.progress);
  const icon = item.icon ? `<span class="qx-wb-icon">${esc(item.icon)}</span>` : `<span class="qx-wb-icon"></span>`;
  const badgeText = item.badge || item.meta || "";
  const badge = badgeText
    ? `<span class="qx-wb-badge${toneClass(item.tone)}">${esc(badgeText)}</span>`
    : "<span></span>";
  const progressHtml =
    progress != null
      ? `<div class="qx-wb-progress" aria-hidden="true"><i style="width:${progress}%"></i></div>`
      : "";
  return `<button type="button" class="qx-wb-row${selected ? " is-sel" : ""}" data-id="${esc(id)}" role="option" aria-selected="${selected ? "true" : "false"}">
    ${icon}
    <span><strong>${esc(item.title)}</strong>${item.subtitle ? `<small>${esc(item.subtitle)}</small>` : ""}${progressHtml}</span>
    ${badge}
  </button>`;
}

function activeIsListLike(doc: Document, container: HTMLElement): boolean {
  const active = doc.activeElement as HTMLElement | null;
  if (!active || active === doc.body || active === doc.documentElement) return true;
  if (!container.contains(active)) return false;
  if (active.matches("[data-query], input, textarea, select, [contenteditable=true]")) return false;
  if (active.matches("[data-tool], [data-tab]")) return false;
  return true;
}

/**
 * Inline JS for plugin iframes — keep in sync with enhancePluginCli / createPluginUiKit.
 * Injected once per runtime; no TypeScript compile step.
 */
export function createPluginUiKit(): PluginContext["ui"] {
  const esc = (value: unknown): string =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const workbenchStyles = (): string => WORKBENCH_CSS;

  const renderJson = (value: unknown, pretty = true): string => {
    try {
      const text = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
      return `<pre class="qx-wb-pre">${esc(text)}</pre>`;
    } catch {
      return `<pre class="qx-wb-pre">${esc(String(value))}</pre>`;
    }
  };

  const renderKeyValue = (record: Record<string, unknown>): string => {
    const rows = Object.entries(record)
      .map(([key, val]) => {
        const display =
          val == null
            ? "—"
            : typeof val === "object"
              ? JSON.stringify(val)
              : String(val);
        return `<dt>${esc(key)}</dt><dd>${esc(display)}</dd>`;
      })
      .join("");
    return `<dl class="qx-wb-kv">${rows}</dl>`;
  };

  const itemsFromJson = (value: unknown): PluginUiListItem[] => {
    if (Array.isArray(value)) {
      return value.map((entry, index) => {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          const rec = entry as Record<string, unknown>;
          const title = String(rec.title ?? rec.name ?? rec.id ?? rec.path ?? `Item ${index + 1}`);
          const subtitle = String(rec.subtitle ?? rec.description ?? rec.desc ?? rec.version ?? "");
          const meta = String(rec.meta ?? rec.kind ?? rec.type ?? "");
          return {
            id: String(rec.id ?? rec.name ?? index),
            title,
            subtitle: subtitle || undefined,
            meta: meta || undefined,
            badge: rec.badge != null ? String(rec.badge) : meta || undefined,
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
      return Object.entries(value as Record<string, unknown>).map(([key, val]) => ({
        id: key,
        title: key,
        subtitle: typeof val === "object" ? JSON.stringify(val) : String(val),
        raw: val,
      }));
    }
    return [{ id: "value", title: String(value), raw: value }];
  };

  const mountWorkbench = (
    container: HTMLElement,
    state: PluginUiWorkbenchState,
    handlers?: {
      onTab?: (id: string) => void;
      onToolbar?: (id: string) => void;
      onQuery?: (value: string) => void;
      onSelect?: (id: string, item: PluginUiListItem) => void;
    },
  ): void => {
    const items = state.items || [];
    const tabs = (state.tabs || [])
      .map(
        (tab) =>
          `<button type="button" class="qx-wb-tab${tab.active ? " is-on" : ""}" data-tab="${esc(tab.id)}">${esc(tab.label)}</button>`,
      )
      .join("");
    const toolbar = (state.toolbar || [])
      .map(
        (btn) =>
          `<button type="button" class="qx-wb-btn${btn.primary ? " is-primary" : ""}${btn.danger ? " is-danger" : ""}" data-tool="${esc(btn.id)}">${esc(btn.label)}</button>`,
      )
      .join("");
    const rows = items.length
      ? items
          .map((item) => {
            const id = String(item.id ?? item.title);
            const sel = state.selectedId != null && String(state.selectedId) === id;
            return renderListRowHtml(item, sel, esc);
          })
          .join("")
      : `<div class="qx-wb-empty">${esc(state.emptyText || (state.loading ? "Loading…" : "No results"))}</div>`;

    container.innerHTML = `
      <style>${workbenchStyles()}</style>
      <div class="qx-wb${state.loading ? " qx-wb-loading" : ""}">
        <div class="qx-wb-head">
          ${state.title ? `<h2 class="qx-wb-title">${esc(state.title)}</h2>` : ""}
          ${state.meta ? `<div class="qx-wb-meta">${esc(state.meta)}</div>` : ""}
          ${tabs ? `<div class="qx-wb-tabs">${tabs}</div>` : ""}
          <div class="qx-wb-bar">
            <input type="text" data-query placeholder="${esc(state.queryPlaceholder || "Filter…")}" value="${esc(state.query || "")}" />
            ${toolbar}
          </div>
          ${state.error ? `<div class="qx-wb-err">${esc(state.error)}</div>` : ""}
        </div>
        <div class="qx-wb-body">
          <div class="qx-wb-list" data-list>${rows}</div>
          <div class="qx-wb-detail" data-detail>${state.detailHtml || `<div class="qx-wb-empty">${esc("Select an item")}</div>`}</div>
        </div>
      </div>
    `;

    container.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((el) => {
      el.addEventListener("click", () => handlers?.onTab?.(el.dataset.tab || ""));
    });
    container.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((el) => {
      el.addEventListener("click", () => handlers?.onToolbar?.(el.dataset.tool || ""));
    });
    const queryInput = container.querySelector<HTMLInputElement>("[data-query]");
    if (queryInput) {
      queryInput.addEventListener("focus", () => {
        try {
          container.dataset.qxWbFocus = "query";
        } catch {
          /* ignore */
        }
      });
      queryInput.addEventListener("input", () => {
        try {
          container.dataset.qxWbFocus = "query";
        } catch {
          /* ignore */
        }
        handlers?.onQuery?.(queryInput.value);
      });
    }
    container.querySelectorAll<HTMLButtonElement>("[data-id]").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.id || "";
        const item = items.find((row) => String(row.id ?? row.title) === id);
        try {
          container.dataset.qxWbFocus = "list";
        } catch {
          /* ignore */
        }
        if (item) handlers?.onSelect?.(id, item);
      });
    });

    // Keyboard list navigation (ArrowUp/Down/Home/End). Document-level so it
    // still works after remount when focus falls back to body inside the iframe.
    const listEl = container.querySelector<HTMLElement>("[data-list]");
    if (listEl) {
      listEl.setAttribute("role", "listbox");
      listEl.tabIndex = -1;
    }
    const itemId = (item: PluginUiListItem) => String(item.id ?? item.title);
    const currentIndex = () => {
      if (state.selectedId == null || state.selectedId === "") return -1;
      const sel = String(state.selectedId);
      return items.findIndex((row) => itemId(row) === sel);
    };
    const selectIndex = (index: number) => {
      if (!items.length) return;
      const next = Math.max(0, Math.min(items.length - 1, index));
      const item = items[next];
      if (!item) return;
      const id = itemId(item);
      try {
        container.dataset.qxWbFocus = "list";
      } catch {
        /* ignore */
      }
      handlers?.onSelect?.(id, item);
    };
    const move = (delta: number) => {
      if (!items.length) return;
      let idx = currentIndex();
      if (idx < 0) idx = delta > 0 ? 0 : items.length - 1;
      else idx = Math.max(0, Math.min(items.length - 1, idx + delta));
      selectIndex(idx);
    };
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el || typeof el.matches !== "function") return false;
      // Keep arrows free on the filter input; block only true multi-line editors.
      return el.matches("textarea, select, [contenteditable=true]");
    };
    const onWorkbenchKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const ownerDoc = container.ownerDocument;
      const active = ownerDoc.activeElement as HTMLElement | null;
      if (
        active
        && active !== ownerDoc.body
        && active !== ownerDoc.documentElement
        && !container.contains(active)
      ) {
        return;
      }
      if (isEditableTarget(event.target)) return;

      const key = event.key;
      if (key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        move(1);
        return;
      }
      if (key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        move(-1);
        return;
      }
      if (key === "Home" && !active?.matches?.("[data-query]")) {
        event.preventDefault();
        event.stopPropagation();
        selectIndex(0);
        return;
      }
      if (key === "End" && !active?.matches?.("[data-query]")) {
        event.preventDefault();
        event.stopPropagation();
        selectIndex(items.length - 1);
        return;
      }
      if (key === "PageDown") {
        event.preventDefault();
        event.stopPropagation();
        const idx = currentIndex();
        selectIndex((idx < 0 ? 0 : idx) + 8);
        return;
      }
      if (key === "PageUp") {
        event.preventDefault();
        event.stopPropagation();
        const idx = currentIndex();
        selectIndex((idx < 0 ? 0 : idx) - 8);
        return;
      }
      if (key === "Enter" && active?.matches?.("[data-query]")) {
        // Leave query filter as-is (already live); do not block.
        return;
      }
    };

    const doc = container.ownerDocument;
    type WbHost = HTMLElement & { __qxWbKeyHandler?: (event: KeyboardEvent) => void };
    const host = container as WbHost;
    if (host.__qxWbKeyHandler) {
      doc.removeEventListener("keydown", host.__qxWbKeyHandler, true);
    }
    host.__qxWbKeyHandler = onWorkbenchKey;
    doc.addEventListener("keydown", onWorkbenchKey, true);

    // Restore focus after remount (filter typing vs list keyboard nav).
    const focusMode = container.dataset.qxWbFocus || "";
    const selectedBtn =
      container.querySelector<HTMLButtonElement>(".qx-wb-row.is-sel")
      || (state.selectedId != null
        ? container.querySelector<HTMLButtonElement>(
          `[data-id="${CSS.escape(String(state.selectedId))}"]`,
        )
        : null);
    if (selectedBtn) {
      selectedBtn.scrollIntoView({ block: "nearest" });
    }
    if (focusMode === "list") {
      const target = selectedBtn || listEl;
      if (target) {
        try {
          target.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      }
    } else if (focusMode === "query" && queryInput) {
      try {
        queryInput.focus({ preventScroll: true });
        const len = queryInput.value.length;
        queryInput.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    } else if (selectedBtn && activeIsListLike(doc, container)) {
      try {
        selectedBtn.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    }
  };

  return {
    esc,
    styles: { workbench: workbenchStyles() },
    renderJson,
    renderKeyValue,
    itemsFromJson,
    mountWorkbench,
  };
}

export const PLUGIN_WORKBENCH_RUNTIME_JS = [
  "function parseJsonLoose(text) {",
  '  const trimmed = String(text == null ? "" : text).trim();',
  '  if (!trimmed) throw new Error("empty JSON stdout");',
  "  try { return JSON.parse(trimmed); } catch (e) {}",
  '  const objectStart = trimmed.indexOf("{");',
  '  const arrayStart = trimmed.indexOf("[");',
  "  let start = -1;",
  "  if (objectStart >= 0 && arrayStart >= 0) start = Math.min(objectStart, arrayStart);",
  "  else start = Math.max(objectStart, arrayStart);",
  '  if (start < 0) throw new Error("stdout is not JSON");',
  "  return JSON.parse(trimmed.slice(start));",
  "}",
  "function parseJsonLines(text) {",
  '  const lines = String(text == null ? "" : text).split(/\\r?\\n/).map(function (l) { return l.trim(); }).filter(Boolean);',
  "  const out = [];",
  "  for (const line of lines) { try { out.push(JSON.parse(line)); } catch (e) {} }",
  "  return out;",
  "}",
  "function mapWithConcurrency(items, worker, concurrency) {",
  "  concurrency = Math.max(1, Math.min(32, Math.floor(concurrency) || 4));",
  "  const results = new Array(items.length);",
  "  let next = 0;",
  "  const runners = [];",
  "  const n = Math.min(concurrency, items.length);",
  "  for (let i = 0; i < n; i += 1) {",
  "    runners.push((async function () {",
  "      while (true) {",
  "        const index = next;",
  "        next += 1;",
  "        if (index >= items.length) return;",
  "        results[index] = await worker(items[index], index);",
  "      }",
  "    })());",
  "  }",
  "  return Promise.all(runners).then(function () { return results; });",
  "}",
  "function enhancePluginCli(core) {",
  "  async function ensure(request) {",
  "    const result = await core.run(request);",
  '    if (result.timedOut) throw new Error(("cli timed out: " + request.program + " " + (request.args || []).join(" ")).trim());',
  "    if (result.status !== 0 && result.status != null) {",
  '      const msg = (result.stderr || result.stdout || ("exit " + result.status)).trim();',
  '      throw new Error(msg.slice(0, 800) || ("cli exit " + result.status));',
  "    }",
  "    return result;",
  "  }",
  "  async function json(request) {",
  "    const allowNonZero = Boolean(request.allowNonZero);",
  "    const asJsonl = Boolean(request.jsonl);",
  "    const runReq = { program: request.program, args: request.args, cwd: request.cwd, env: request.env, timeoutMs: request.timeoutMs };",
  "    const result = allowNonZero ? await core.run(runReq) : await ensure(runReq);",
  '    if (result.timedOut) throw new Error("cli timed out: " + runReq.program);',
  "    if (!allowNonZero && result.status !== 0 && result.status != null) {",
  '      throw new Error((result.stderr || result.stdout || ("exit " + result.status)).trim().slice(0, 800));',
  "    }",
  "    return asJsonl ? parseJsonLines(result.stdout) : parseJsonLoose(result.stdout);",
  "  }",
  "  async function lines(request) {",
  "    const allowNonZero = Boolean(request.allowNonZero);",
  "    const trimEmpty = request.trimEmpty !== false;",
  "    const runReq = { program: request.program, args: request.args, cwd: request.cwd, env: request.env, timeoutMs: request.timeoutMs };",
  "    const result = allowNonZero ? await core.run(runReq) : await ensure(runReq);",
  '    const rows = String(result.stdout || "").split(/\\r?\\n/);',
  "    if (!trimEmpty) return rows;",
  "    return rows.map(function (l) { return l.trimEnd(); }).filter(function (l) { return l.trim().length > 0; });",
  "  }",
  "  async function text(request) {",
  "    const result = await ensure(request);",
  '    return String(result.stdout || "").trimEnd();',
  "  }",
  "  async function jsonBash(script, options) {",
  "    options = options || {};",
  "    const result = await core.bash(script);",
  '    if (result.timedOut) throw new Error("cli bash timed out");',
  "    if (!options.allowNonZero && result.status !== 0 && result.status != null) {",
  '      throw new Error((result.stderr || result.stdout || ("exit " + result.status)).trim().slice(0, 800));',
  "    }",
  "    return options.jsonl ? parseJsonLines(result.stdout) : parseJsonLoose(result.stdout);",
  "  }",
  "  async function wait(jobId, options) {",
  "    options = options || {};",
  "    const pollMs = Math.max(50, Math.min(5000, options.pollMs || 500));",
  "    while (true) {",
  "      if (options.signal && options.signal.aborted) throw new Error('cli wait aborted');",
  "      const snap = await core.poll(jobId);",
  "      if (options.onUpdate) options.onUpdate(snap);",
  "      if (!snap.running) return snap;",
  "      await new Promise(function (resolve, reject) {",
  "        const timer = setTimeout(resolve, pollMs);",
  "        if (options.signal) {",
  "          options.signal.addEventListener('abort', function () { clearTimeout(timer); reject(new Error('cli wait aborted')); }, { once: true });",
  "        }",
  "      });",
  "    }",
  "  }",
  "  return Object.assign({}, core, {",
  "    wait: wait,",
  "    map: function (items, worker, options) { return mapWithConcurrency(items, worker, (options && options.concurrency) || 4); },",
  "    ensure: ensure, json: json, lines: lines, text: text, jsonBash: jsonBash,",
  "    parseJson: parseJsonLoose, parseJsonLines: parseJsonLines",
  "  });",
  "}",
  "function createPluginUiKit() {",
  "  const WORKBENCH_CSS = " + JSON.stringify(WORKBENCH_CSS) + ";",
  '  const esc = function (value) { return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };',
  "  const workbenchStyles = function () { return WORKBENCH_CSS; };",
  "  function renderJson(value, pretty) {",
  "    try {",
  "      const text = pretty === false ? JSON.stringify(value) : JSON.stringify(value, null, 2);",
  '      return \'<pre class="qx-wb-pre">\' + esc(text) + "</pre>";',
  "    } catch (e) {",
  '      return \'<pre class="qx-wb-pre">\' + esc(String(value)) + "</pre>";',
  "    }",
  "  }",
  "  function renderKeyValue(record) {",
  '    const rows = Object.entries(record || {}).map(function (pair) {',
  '      const key = pair[0], val = pair[1];',
  '      const display = val == null ? "—" : typeof val === "object" ? JSON.stringify(val) : String(val);',
  '      return "<dt>" + esc(key) + "</dt><dd>" + esc(display) + "</dd>";',
  "    }).join(\"\");",
  '    return \'<dl class="qx-wb-kv">\' + rows + "</dl>";',
  "  }",
  "  function itemsFromJson(value) {",
  "    if (Array.isArray(value)) {",
  "      return value.map(function (entry, index) {",
  '        if (entry && typeof entry === "object" && !Array.isArray(entry)) {',
  "          const rec = entry;",
  '          const title = String(rec.title != null ? rec.title : rec.name != null ? rec.name : rec.id != null ? rec.id : rec.path != null ? rec.path : ("Item " + (index + 1)));',
  '          const subtitle = String(rec.subtitle != null ? rec.subtitle : rec.description != null ? rec.description : rec.desc != null ? rec.desc : rec.version != null ? rec.version : "");',
  '          const meta = String(rec.meta != null ? rec.meta : rec.kind != null ? rec.kind : rec.type != null ? rec.type : "");',
  "          return { id: String(rec.id != null ? rec.id : rec.name != null ? rec.name : index), title: title, subtitle: subtitle || undefined, meta: meta || undefined, badge: rec.badge != null ? String(rec.badge) : (meta || undefined), raw: entry };",
  "        }",
  '        return { id: String(index), title: typeof entry === "string" ? entry : JSON.stringify(entry), raw: entry };',
  "      });",
  "    }",
  '    if (value && typeof value === "object") {',
  "      return Object.entries(value).map(function (pair) {",
  '        const key = pair[0], val = pair[1];',
  '        return { id: key, title: key, subtitle: typeof val === "object" ? JSON.stringify(val) : String(val), raw: val };',
  "      });",
  "    }",
  '    return [{ id: "value", title: String(value), raw: value }];',
  "  }",
  "  function toneClass(tone) {",
  '    const t = String(tone || "").toLowerCase();',
  '    if (!t || t === "neutral") return "";',
  '    if (t === "success" || t === "danger" || t === "warning" || t === "accent" || t === "run") return " tone-" + t;',
  '    return "";',
  "  }",
  "  function renderListRow(item, selected) {",
  "    const id = String(item.id != null ? item.id : item.title);",
  "    var progress = typeof item.progress === 'number' ? item.progress : Number(item.progress);",
  "    if (!isFinite(progress)) progress = null; else progress = Math.max(0, Math.min(100, Math.round(progress)));",
  '    const icon = item.icon ? \'<span class="qx-wb-icon">\' + esc(item.icon) + "</span>" : \'<span class="qx-wb-icon"></span>\';',
  '    const badgeText = item.badge || item.meta || "";',
  '    const badge = badgeText ? \'<span class="qx-wb-badge\' + toneClass(item.tone) + \'">\' + esc(badgeText) + "</span>" : "<span></span>";',
  '    const progressHtml = progress != null ? \'<div class="qx-wb-progress" aria-hidden="true"><i style="width:\' + progress + \'%"></i></div>\' : "";',
  '    return \'<button type="button" class="qx-wb-row\' + (selected ? " is-sel" : "") + \'" data-id="\' + esc(id) + \'" role="option" aria-selected="\' + (selected ? "true" : "false") + \'">\' + icon + "<span><strong>" + esc(item.title) + "</strong>" + (item.subtitle ? "<small>" + esc(item.subtitle) + "</small>" : "") + progressHtml + "</span>" + badge + "</button>";',
  "  }",
  "  function mountWorkbench(container, state, handlers) {",
  "    state = state || {};",
  "    handlers = handlers || {};",
  "    const items = state.items || [];",
  '    const tabs = (state.tabs || []).map(function (tab) { return \'<button type="button" class="qx-wb-tab\' + (tab.active ? " is-on" : "") + \'" data-tab="\' + esc(tab.id) + \'">\' + esc(tab.label) + "</button>"; }).join("");',
  '    const toolbar = (state.toolbar || []).map(function (btn) { return \'<button type="button" class="qx-wb-btn\' + (btn.primary ? " is-primary" : "") + (btn.danger ? " is-danger" : "") + \'" data-tool="\' + esc(btn.id) + \'">\' + esc(btn.label) + "</button>"; }).join("");',
  "    const rows = items.length",
  "      ? items.map(function (item) {",
  "          const id = String(item.id != null ? item.id : item.title);",
  "          const sel = state.selectedId != null && String(state.selectedId) === id;",
  "          return renderListRow(item, sel);",
  "        }).join(\"\")",
  '      : \'<div class="qx-wb-empty">\' + esc(state.emptyText || (state.loading ? "Loading…" : "No results")) + "</div>";',
  '    container.innerHTML = "<style>" + workbenchStyles() + \'</style><div class="qx-wb\' + (state.loading ? " qx-wb-loading" : "") + \'"><div class="qx-wb-head">\' +',
  '      (state.title ? \'<h2 class="qx-wb-title">\' + esc(state.title) + "</h2>" : "") +',
  '      (state.meta ? \'<div class="qx-wb-meta">\' + esc(state.meta) + "</div>" : "") +',
  '      (tabs ? \'<div class="qx-wb-tabs">\' + tabs + "</div>" : "") +',
  '      \'<div class="qx-wb-bar"><input type="text" data-query placeholder="\' + esc(state.queryPlaceholder || "Filter…") + \'" value="\' + esc(state.query || "") + \'" />\' + toolbar + "</div>" +',
  '      (state.error ? \'<div class="qx-wb-err">\' + esc(state.error) + "</div>" : "") +',
  '      \'</div><div class="qx-wb-body"><div class="qx-wb-list" data-list role="listbox" tabindex="-1">\' + rows + \'</div><div class="qx-wb-detail" data-detail>\' +',
  '      (state.detailHtml || \'<div class="qx-wb-empty">Select an item</div>\') +',
  '      "</div></div></div>";',
  '    container.querySelectorAll("[data-tab]").forEach(function (el) { el.addEventListener("click", function () { if (handlers.onTab) handlers.onTab(el.dataset.tab || ""); }); });',
  '    container.querySelectorAll("[data-tool]").forEach(function (el) { el.addEventListener("click", function () { if (handlers.onToolbar) handlers.onToolbar(el.dataset.tool || ""); }); });',
  '    const queryInput = container.querySelector("[data-query]");',
  "    if (queryInput) {",
  '      queryInput.addEventListener("focus", function () { try { container.dataset.qxWbFocus = "query"; } catch (e) {} });',
  '      queryInput.addEventListener("input", function () { try { container.dataset.qxWbFocus = "query"; } catch (e) {} if (handlers.onQuery) handlers.onQuery(queryInput.value); });',
  "    }",
  '    container.querySelectorAll("[data-id]").forEach(function (el) { el.addEventListener("click", function () {',
  '      const id = el.dataset.id || "";',
  "      const item = items.find(function (row) { return String(row.id != null ? row.id : row.title) === id; });",
  '      try { container.dataset.qxWbFocus = "list"; } catch (e) {}',
  "      if (item && handlers.onSelect) handlers.onSelect(id, item);",
  "    }); });",
  '    const listEl = container.querySelector("[data-list]");',
  "    function itemId(item) { return String(item.id != null ? item.id : item.title); }",
  "    function currentIndex() {",
  '      if (state.selectedId == null || state.selectedId === "") return -1;',
  "      const sel = String(state.selectedId);",
  "      for (let i = 0; i < items.length; i++) { if (itemId(items[i]) === sel) return i; }",
  "      return -1;",
  "    }",
  "    function selectIndex(index) {",
  "      if (!items.length) return;",
  "      const next = Math.max(0, Math.min(items.length - 1, index));",
  "      const item = items[next];",
  "      if (!item) return;",
  '      try { container.dataset.qxWbFocus = "list"; } catch (e) {}',
  "      if (handlers.onSelect) handlers.onSelect(itemId(item), item);",
  "    }",
  "    function move(delta) {",
  "      if (!items.length) return;",
  "      let idx = currentIndex();",
  "      if (idx < 0) idx = delta > 0 ? 0 : items.length - 1;",
  "      else idx = Math.max(0, Math.min(items.length - 1, idx + delta));",
  "      selectIndex(idx);",
  "    }",
  "    function onWorkbenchKey(event) {",
  "      if (event.defaultPrevented) return;",
  "      if (event.metaKey || event.ctrlKey || event.altKey) return;",
  "      const ownerDoc = container.ownerDocument;",
  "      const active = ownerDoc.activeElement;",
  "      if (active && active !== ownerDoc.body && active !== ownerDoc.documentElement && !container.contains(active)) return;",
  '      if (active && active.matches && active.matches("textarea, select, [contenteditable=true]")) return;',
  "      const key = event.key;",
  '      if (key === "ArrowDown") { event.preventDefault(); event.stopPropagation(); move(1); return; }',
  '      if (key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); move(-1); return; }',
  '      if (key === "Home" && !(active && active.matches && active.matches("[data-query]"))) { event.preventDefault(); event.stopPropagation(); selectIndex(0); return; }',
  '      if (key === "End" && !(active && active.matches && active.matches("[data-query]"))) { event.preventDefault(); event.stopPropagation(); selectIndex(items.length - 1); return; }',
  '      if (key === "PageDown") { event.preventDefault(); event.stopPropagation(); var i1 = currentIndex(); selectIndex((i1 < 0 ? 0 : i1) + 8); return; }',
  '      if (key === "PageUp") { event.preventDefault(); event.stopPropagation(); var i2 = currentIndex(); selectIndex((i2 < 0 ? 0 : i2) - 8); return; }',
  "    }",
  "    const doc = container.ownerDocument;",
  "    if (container.__qxWbKeyHandler) doc.removeEventListener(\"keydown\", container.__qxWbKeyHandler, true);",
  "    container.__qxWbKeyHandler = onWorkbenchKey;",
  '    doc.addEventListener("keydown", onWorkbenchKey, true);',
  '    const focusMode = container.dataset.qxWbFocus || "";',
  '    const selectedBtn = container.querySelector(".qx-wb-row.is-sel");',
  "    if (selectedBtn && selectedBtn.scrollIntoView) selectedBtn.scrollIntoView({ block: \"nearest\" });",
  '    if (focusMode === "list") {',
  "      const target = selectedBtn || listEl;",
  "      if (target && target.focus) try { target.focus({ preventScroll: true }); } catch (e) {}",
  '    } else if (focusMode === "query" && queryInput) {',
  "      try { queryInput.focus({ preventScroll: true }); var len = queryInput.value.length; queryInput.setSelectionRange(len, len); } catch (e) {}",
  "    }",
  "  }",
  "  return { esc: esc, styles: { workbench: workbenchStyles() }, renderJson: renderJson, renderKeyValue: renderKeyValue, itemsFromJson: itemsFromJson, mountWorkbench: mountWorkbench };",
  "}",
].join("\n");

void isCliRunRequest;
