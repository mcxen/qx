import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsStore } from "../modules/settings/store";
import { usePluginRegistry } from "./registry";
import type { PluginIndex, PluginIndexEntry, PluginIndexSourceStatus } from "./types";

export type MarketplaceInstallHooks = {
  onQueued?: (position: number) => void;
  onStart?: () => void;
};

type MarketplaceCatalogState = {
  entries: PluginIndexEntry[];
  sources: PluginIndexSourceStatus[];
  hostVersion: string | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  fetchedRegistriesKey: string | null;
  installingId: string | null;
  queuedIds: string[];
  ensureIndex: (options?: { forceRefresh?: boolean }) => Promise<void>;
  installUpdate: (entry: PluginIndexEntry, hooks?: MarketplaceInstallHooks) => Promise<void>;
};

type UpdateJob = {
  entry: PluginIndexEntry;
  hooks?: MarketplaceInstallHooks;
  resolve: () => void;
  reject: (error: unknown) => void;
};

const updateJobs: UpdateJob[] = [];
const pendingById = new Map<string, Promise<void>>();
let drainingUpdates = false;

function registriesKey(): string {
  const registries = useSettingsStore.getState().settings.plugin_registries ?? [];
  return registries
    .map((registry) => `${registry.id}\0${registry.enabled ? 1 : 0}\0${registry.index_url}`)
    .join("\n");
}

let inflight: Promise<void> | null = null;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function readHostVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "";
  }
}

export const useMarketplaceCatalog = create<MarketplaceCatalogState>((set, get) => ({
  entries: [],
  sources: [],
  hostVersion: null,
  loading: false,
  error: null,
  lastFetchedAt: null,
  fetchedRegistriesKey: null,
  installingId: null,
  queuedIds: [],

  ensureIndex: async (options) => {
    const forceRefresh = options?.forceRefresh === true;
    if (!isTauriRuntime()) return;
    const nextRegistriesKey = registriesKey();
    if (
      !forceRefresh
      && get().lastFetchedAt
      && !get().error
      && get().fetchedRegistriesKey === nextRegistriesKey
    ) {
      return;
    }
    if (inflight) {
      if (!forceRefresh) return inflight;
      await inflight;
    }

    const run = (async () => {
      set({ loading: true, error: null });
      try {
        await useSettingsStore.getState().flush();
        if (get().hostVersion === null) {
          set({ hostVersion: await readHostVersion() });
        }
        const index = await invoke<PluginIndex>("fetch_plugin_index", {
          sourceId: null,
          forceRefresh,
        });
        set({
          entries: index.plugins ?? [],
          sources: index.sources ?? [],
          lastFetchedAt: Date.now(),
          fetchedRegistriesKey: nextRegistriesKey,
          loading: false,
          error: null,
        });
      } catch (error) {
        set({
          loading: false,
          error: String(error),
        });
      }
    })();

    inflight = run;
    try {
      await run;
    } finally {
      if (inflight === run) inflight = null;
    }
  },

  installUpdate: (entry, hooks) => {
    if (!isTauriRuntime()) {
      return Promise.reject(new Error("Plugin updates require the Qx desktop app."));
    }
    const existing = pendingById.get(entry.id);
    if (existing) {
      if (get().installingId !== entry.id) {
        hooks?.onQueued?.(Math.max(1, updateJobs.findIndex((job) => job.entry.id === entry.id) + 1));
      }
      return existing;
    }

    const job: UpdateJob = {
      entry,
      hooks,
      resolve: () => {},
      reject: () => {},
    };
    const pending = new Promise<void>((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    pendingById.set(entry.id, pending);
    updateJobs.push(job);
    if (get().installingId) {
      publishQueueState(get().installingId);
      hooks?.onQueued?.(updateJobs.length);
    }
    void drainUpdateQueue();
    return pending;
  },
}));

function publishQueueState(installingId: string | null): void {
  useMarketplaceCatalog.setState({
    installingId,
    queuedIds: updateJobs.map((job) => job.entry.id),
  });
}

async function drainUpdateQueue(): Promise<void> {
  if (drainingUpdates) return;
  drainingUpdates = true;
  try {
    while (updateJobs.length > 0) {
      const job = updateJobs.shift();
      if (!job) break;
      publishQueueState(job.entry.id);
      job.hooks?.onStart?.();
      try {
        const path = await invoke<string>("download_plugin", {
          url: job.entry.download_url,
          sourceIndexUrl: job.entry.source_index_url || undefined,
        });
        await invoke("install_plugin", { path });
        await usePluginRegistry.getState().refresh();
        job.resolve();
      } catch (error) {
        job.reject(error);
      } finally {
        pendingById.delete(job.entry.id);
      }
    }
  } finally {
    drainingUpdates = false;
    if (updateJobs.length > 0) {
      void drainUpdateQueue();
      return;
    }
    publishQueueState(null);
  }
}

let backgroundStarted = false;

/** Idle catalog fetch — index only, never installs. Safe to call more than once. */
export function startMarketplaceCatalogCheck(): void {
  if (backgroundStarted) return;
  backgroundStarted = true;
  void useMarketplaceCatalog.getState().ensureIndex();
}
