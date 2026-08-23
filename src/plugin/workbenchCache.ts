import { invoke } from "@tauri-apps/api/core";
import {
  normalizePluginWorkbenchState,
  type PluginWorkbenchItemsUpdate,
  type PluginWorkbenchState,
} from "./workbenchTypes";

const STORAGE_KEY = "__qx_host_workbench_cache_v1__";
const CACHE_VERSION = 1;
const DEFAULT_MAX_AGE_MS = 30 * 86_400_000;
const MAX_CACHE_BYTES = 2_000_000;
const MAX_SCOPES = 6;

interface WorkbenchCacheEntry {
  savedAt: number;
  state: PluginWorkbenchState;
}

interface WorkbenchCacheEnvelope {
  version: 1;
  savedAt: number;
  activeKey: string;
  entries: Record<string, WorkbenchCacheEntry>;
}

interface MemoryWorkbenchCache {
  envelope: WorkbenchCacheEnvelope;
  /** False means the active hot scope is known but disk may contain more scopes. */
  complete: boolean;
}

const memoryCaches = new Map<string, MemoryWorkbenchCache>();
const cacheLoads = new Map<string, Promise<WorkbenchCacheEnvelope | null>>();

export function pluginWorkbenchCacheKey(state: PluginWorkbenchState): string {
  return state.cache?.key || "default";
}

function hasUsableCollection(state: PluginWorkbenchState | null): boolean {
  return Boolean(state && ((state.items?.length || 0) > 0 || state.detail));
}

/** Apply one trusted keyed mutation while preserving stable item order and selection. */
export function applyPluginWorkbenchItemsUpdate(
  state: PluginWorkbenchState,
  update: PluginWorkbenchItemsUpdate,
): PluginWorkbenchState {
  if (
    update.revision != null
    && state.revision != null
    && update.revision < state.revision
  ) return state;

  const removed = new Set((update.removeIds || []).map(String));
  const byId = new Map(
    (state.items || [])
      .filter((item) => !removed.has(item.id))
      .map((item) => [item.id, item]),
  );
  for (const item of update.upsert || []) {
    if (!item.id || removed.has(item.id)) continue;
    const previous = byId.get(item.id);
    byId.set(item.id, previous ? { ...previous, ...item } : item);
  }
  const items = [] as NonNullable<PluginWorkbenchState["items"]>;
  const emitted = new Set<string>();
  for (const id of update.order || []) {
    const item = byId.get(id);
    if (!item || emitted.has(id)) continue;
    emitted.add(id);
    items.push(item);
  }
  for (const item of byId.values()) {
    if (emitted.has(item.id)) continue;
    emitted.add(item.id);
    items.push(item);
  }
  const requested = Object.prototype.hasOwnProperty.call(update, "selectedId")
    ? update.selectedId
    : state.selectedId;
  const selectedId = requested != null && emitted.has(String(requested))
    ? String(requested)
    : items[0]?.id ?? null;
  return {
    ...state,
    revision: update.revision ?? state.revision,
    items,
    selectedId,
  };
}

/** Keep usable stale content visible while a refresh is loading or has failed. */
export function mergePluginWorkbenchSnapshot(
  current: PluginWorkbenchState | null,
  incoming: PluginWorkbenchState,
): PluginWorkbenchState {
  if (!current) return incoming;
  if (pluginWorkbenchCacheKey(current) !== pluginWorkbenchCacheKey(incoming)) return incoming;
  if (
    incoming.revision != null
    && current.revision != null
    && incoming.revision < current.revision
  ) return current;
  // A non-empty incremental/full collection is usable immediately. A settled
  // empty collection is also authoritative. Only loading/error shells need
  // stale preservation; an error-only detail must not erase cached rows.
  if ((incoming.items?.length || 0) > 0 || (!incoming.loading && !incoming.error)) return incoming;
  if (!hasUsableCollection(current)) return incoming;
  const ids = new Set((current.items || []).map((item) => item.id));
  return {
    ...incoming,
    title: incoming.title || current.title,
    meta: incoming.meta || current.meta,
    layout: incoming.layout || current.layout,
    tabs: incoming.tabs?.length ? incoming.tabs : current.tabs,
    filters: incoming.filters?.length ? incoming.filters : current.filters,
    actions: incoming.actions?.length ? incoming.actions : current.actions,
    items: current.items,
    selectedId: current.selectedId != null && ids.has(String(current.selectedId))
      ? current.selectedId
      : current.items?.[0]?.id ?? null,
    detail: incoming.detail || current.detail,
    emptyText: incoming.emptyText || current.emptyText,
    cache: incoming.cache || current.cache,
  };
}

function sanitizeCacheState(state: PluginWorkbenchState): PluginWorkbenchState {
  const cleanStatus = <T extends { status?: unknown }>(value: T | undefined): T | undefined => {
    if (!value) return value;
    const { status: _status, ...rest } = value;
    return rest as T;
  };
  const candidate: Record<string, unknown> = {
    ...state,
    revision: undefined,
    loading: false,
    error: null,
    items: state.items?.map((item) => ({
      ...cleanStatus(item),
      detail: item.detail ? {
        ...cleanStatus(item.detail),
        replies: cleanStatus(item.detail.replies),
      } : undefined,
    })),
    detail: state.detail ? {
      ...cleanStatus(state.detail),
      replies: cleanStatus(state.detail.replies),
    } : undefined,
  };
  delete candidate.island;
  return normalizePluginWorkbenchState(candidate);
}

function parseEnvelope(value: unknown): WorkbenchCacheEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<WorkbenchCacheEnvelope>;
  if (raw.version !== CACHE_VERSION || !raw.entries || typeof raw.entries !== "object") return null;
  return {
    version: CACHE_VERSION,
    savedAt: Number(raw.savedAt) || 0,
    activeKey: String(raw.activeKey || "default").slice(0, 128),
    entries: raw.entries,
  };
}

function restoreCacheEntry(
  envelope: WorkbenchCacheEnvelope,
  requestedKey?: string,
): PluginWorkbenchState | null {
  const entry = envelope.entries[requestedKey || envelope.activeKey];
  if (!entry || !entry.state) return null;
  const state = normalizePluginWorkbenchState(entry.state);
  const maxAgeMs = state.cache?.maxAgeMs || DEFAULT_MAX_AGE_MS;
  if (!Number.isFinite(entry.savedAt) || Date.now() - entry.savedAt > maxAgeMs) return null;
  return { ...state, revision: undefined, loading: true, error: null };
}

/** Synchronous hot-path used before paint when the plugin was opened earlier this process. */
export function peekPluginWorkbenchCache(
  pluginId: string,
  requestedKey?: string,
): PluginWorkbenchState | null {
  const cached = memoryCaches.get(pluginId);
  return cached ? restoreCacheEntry(cached.envelope, requestedKey) : null;
}

export async function loadPluginWorkbenchCache(
  pluginId: string,
  requestedKey?: string,
): Promise<PluginWorkbenchState | null> {
  const hot = peekPluginWorkbenchCache(pluginId, requestedKey);
  if (hot) return hot;
  const known = memoryCaches.get(pluginId);
  if (known?.complete) return null;

  let load = cacheLoads.get(pluginId);
  if (!load) {
    load = invoke<unknown>("plugin_storage_get", {
      id: pluginId,
      key: STORAGE_KEY,
    }).then((value) => {
      const envelope = parseEnvelope(value);
      if (envelope) memoryCaches.set(pluginId, { envelope, complete: true });
      else memoryCaches.delete(pluginId);
      return envelope;
    });
    cacheLoads.set(pluginId, load);
    const clearLoad = () => {
      if (cacheLoads.get(pluginId) === load) cacheLoads.delete(pluginId);
    };
    void load.then(clearLoad, clearLoad);
  }
  const envelope = await load;
  return envelope ? restoreCacheEntry(envelope, requestedKey) : null;
}

const pendingWrites = new Map<string, { state: PluginWorkbenchState; timer: number }>();
const writeChains = new Map<string, Promise<void>>();

async function persistPluginWorkbenchCache(
  pluginId: string,
  state: PluginWorkbenchState,
): Promise<void> {
  if (state.cache?.mode === "disabled") {
    memoryCaches.delete(pluginId);
    await invoke("plugin_storage_delete", { id: pluginId, key: STORAGE_KEY });
    return;
  }
  if (state.loading || state.error) return;
  const clean = sanitizeCacheState(state);
  const encoded = JSON.stringify(clean);
  if (new TextEncoder().encode(encoded).byteLength > MAX_CACHE_BYTES) return;
  const existing = parseEnvelope(await invoke<unknown>("plugin_storage_get", {
    id: pluginId,
    key: STORAGE_KEY,
  }));
  const key = pluginWorkbenchCacheKey(clean);
  const entries = { ...(existing?.entries || {}) };
  const savedAt = Date.now();
  entries[key] = { savedAt, state: clean };
  const retained = Object.entries(entries)
    .sort((left, right) => right[1].savedAt - left[1].savedAt)
    .slice(0, MAX_SCOPES);
  const envelope: WorkbenchCacheEnvelope = {
    version: CACHE_VERSION,
    savedAt,
    activeKey: key,
    entries: Object.fromEntries(retained),
  };
  await invoke("plugin_storage_set", { id: pluginId, key: STORAGE_KEY, value: envelope });
  memoryCaches.set(pluginId, { envelope, complete: true });
}

function rememberPluginWorkbenchCache(pluginId: string, state: PluginWorkbenchState): void {
  if (state.cache?.mode === "disabled") {
    memoryCaches.delete(pluginId);
    return;
  }
  if (state.loading || state.error) return;
  const clean = sanitizeCacheState(state);
  const encoded = JSON.stringify(clean);
  if (new TextEncoder().encode(encoded).byteLength > MAX_CACHE_BYTES) return;
  const savedAt = Date.now();
  const key = pluginWorkbenchCacheKey(clean);
  const current = memoryCaches.get(pluginId);
  const entries = { ...(current?.envelope.entries || {}) };
  entries[key] = { savedAt, state: clean };
  const retained = Object.entries(entries)
    .sort((left, right) => right[1].savedAt - left[1].savedAt)
    .slice(0, MAX_SCOPES);
  memoryCaches.set(pluginId, {
    complete: current?.complete === true,
    envelope: {
      version: CACHE_VERSION,
      savedAt,
      activeKey: key,
      entries: Object.fromEntries(retained),
    },
  });
}

/** Coalesce high-frequency incremental batches into one bounded durable write. */
export function schedulePluginWorkbenchCacheWrite(
  pluginId: string,
  state: PluginWorkbenchState,
): void {
  rememberPluginWorkbenchCache(pluginId, state);
  const pending = pendingWrites.get(pluginId);
  if (pending) window.clearTimeout(pending.timer);
  const timer = window.setTimeout(() => {
    const latest = pendingWrites.get(pluginId);
    if (!latest) return;
    pendingWrites.delete(pluginId);
    const previous = writeChains.get(pluginId) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => persistPluginWorkbenchCache(pluginId, latest.state))
      .catch(() => {});
    writeChains.set(pluginId, next);
    void next.finally(() => {
      if (writeChains.get(pluginId) === next) writeChains.delete(pluginId);
    });
  }, 160);
  pendingWrites.set(pluginId, { state, timer });
}
