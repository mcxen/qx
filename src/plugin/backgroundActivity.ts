/**
 * Plugin background-activity port.
 *
 * Owns schedule metadata for `mode: "no-view"` + `interval` commands
 * (e.g. Bing auto-switch wallpapers). UI layers (launcher search, plugin
 * manager, plugin shell) depend only on this store — not on timer internals.
 *
 * Storage keys stay local to this module so registry scheduling and badges
 * cannot drift.
 */
import { create } from "zustand";
import type { RegisteredCommand } from "./types";

export type PluginBackgroundJobState = "scheduled" | "running" | "idle";

export interface PluginBackgroundJob {
  pluginId: string;
  commandName: string;
  commandTitle: string;
  interval: string;
  intervalMs: number;
  /** Unix ms of last completed run (success or failure). */
  lastRunAt: number | null;
  /** Unix ms when the host intends to fire next. */
  nextRunAt: number | null;
  state: PluginBackgroundJobState;
  lastError: string | null;
}

export interface PluginBackgroundSummary {
  pluginId: string;
  /** True when the plugin has at least one interval job registered. */
  hasBackground: boolean;
  /** True when any job is currently executing. */
  isRunning: boolean;
  jobs: PluginBackgroundJob[];
  /** Most recent completed run across jobs. */
  lastRunAt: number | null;
  /** Soonest upcoming schedule across jobs. */
  nextRunAt: number | null;
}

function jobKey(pluginId: string, commandName: string): string {
  return `${pluginId}\0${commandName}`;
}

function storageKey(kind: "next" | "last" | "error", pluginId: string, commandName: string): string {
  const suffix = kind === "next" ? "nextRunAt" : kind === "last" ? "lastRunAt" : "lastError";
  return `qx:plugin-background:${pluginId}:${commandName}:${suffix}`;
}

export function parseIntervalMs(interval?: string): number | null {
  const match = String(interval || "").trim().match(/^(\d+)\s*(s|m|h|d)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (match[2] || "m").toLowerCase();
  const multiplier =
    unit === "s" ? 1000 : unit === "h" ? 3_600_000 : unit === "d" ? 86_400_000 : 60_000;
  return Math.max(1000, value * multiplier);
}

export function isBackgroundIntervalCommand(
  command: Pick<RegisteredCommand, "mode" | "interval">,
): boolean {
  return command.mode === "no-view" && parseIntervalMs(command.interval) != null;
}

/** Durable last-run timestamp even when the in-memory job map was cleared. */
export function peekLastRunAt(pluginId: string, commandName: string): number | null {
  return readNumber(storageKey("last", pluginId, commandName));
}

export function peekNextRunAt(pluginId: string, commandName: string): number | null {
  return readNumber(storageKey("next", pluginId, commandName));
}

function readNumber(key: string): number | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number | null): void {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, String(value));
  } catch {
    // private mode / quota — badges degrade gracefully
  }
}

function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string | null): void {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function buildJobFromCommand(
  command: RegisteredCommand,
  running: Set<string>,
): PluginBackgroundJob | null {
  if (!isBackgroundIntervalCommand(command)) return null;
  const intervalMs = parseIntervalMs(command.interval)!;
  const key = jobKey(command.pluginId, command.name);
  const lastRunAt = readNumber(storageKey("last", command.pluginId, command.name));
  const nextRunAt = readNumber(storageKey("next", command.pluginId, command.name));
  const lastError = readString(storageKey("error", command.pluginId, command.name));
  const state: PluginBackgroundJobState = running.has(key)
    ? "running"
    : nextRunAt != null
      ? "scheduled"
      : "idle";
  return {
    pluginId: command.pluginId,
    commandName: command.name,
    commandTitle: command.title || command.name,
    interval: String(command.interval),
    intervalMs,
    lastRunAt,
    nextRunAt,
    state,
    lastError,
  };
}

interface PluginBackgroundStore {
  /** Bumped on every mutation so shallow UI selectors can re-render. */
  revision: number;
  jobs: Record<string, PluginBackgroundJob>;
  runningKeys: string[];
  /**
   * Recompute snapshots from the current command catalogue (after load /
   * refresh / enable). Preserves running markers already in the store.
   */
  syncFromCommands: (commands: RegisteredCommand[]) => void;
  /** Drop all jobs for a plugin (unload / disable). */
  clearPlugin: (pluginId: string) => void;
  clearAll: () => void;
  markScheduled: (command: RegisteredCommand, nextRunAt: number) => void;
  markRunning: (command: RegisteredCommand) => void;
  markFinished: (command: RegisteredCommand, error?: string | null) => void;
  getJob: (pluginId: string, commandName: string) => PluginBackgroundJob | undefined;
  listJobs: (pluginId?: string) => PluginBackgroundJob[];
  summarizePlugin: (pluginId: string) => PluginBackgroundSummary | null;
  hasBackground: (pluginId: string) => boolean;
}

function collectJobs(
  previous: Record<string, PluginBackgroundJob>,
  commands: RegisteredCommand[],
  runningKeys: string[],
): Record<string, PluginBackgroundJob> {
  const running = new Set(runningKeys);
  const next: Record<string, PluginBackgroundJob> = {};
  for (const command of commands) {
    const job = buildJobFromCommand(command, running);
    if (!job) continue;
    const key = jobKey(job.pluginId, job.commandName);
    // Prefer live store nextRun while a timer is armed this session.
    const prior = previous[key];
    if (prior && prior.state === "running") {
      next[key] = { ...job, state: "running", nextRunAt: prior.nextRunAt ?? job.nextRunAt };
    } else {
      next[key] = job;
    }
  }
  return next;
}

export const usePluginBackgroundStore = create<PluginBackgroundStore>((set, get) => ({
  revision: 0,
  jobs: {},
  runningKeys: [],

  syncFromCommands: (commands) => {
    const runningKeys = get().runningKeys;
    set({
      jobs: collectJobs(get().jobs, commands, runningKeys),
      revision: get().revision + 1,
    });
  },

  clearPlugin: (pluginId) => {
    const jobs = { ...get().jobs };
    for (const key of Object.keys(jobs)) {
      if (jobs[key].pluginId === pluginId) delete jobs[key];
    }
    set({
      jobs,
      runningKeys: get().runningKeys.filter((key) => !key.startsWith(`${pluginId}\0`)),
      revision: get().revision + 1,
    });
  },

  clearAll: () => set({ jobs: {}, runningKeys: [], revision: get().revision + 1 }),

  markScheduled: (command, nextRunAt) => {
    if (!isBackgroundIntervalCommand(command)) return;
    writeNumber(storageKey("next", command.pluginId, command.name), nextRunAt);
    const key = jobKey(command.pluginId, command.name);
    const running = new Set(get().runningKeys);
    const base =
      buildJobFromCommand(command, running) ||
      ({
        pluginId: command.pluginId,
        commandName: command.name,
        commandTitle: command.title || command.name,
        interval: String(command.interval),
        intervalMs: parseIntervalMs(command.interval)!,
        lastRunAt: null,
        nextRunAt,
        state: "scheduled" as const,
        lastError: null,
      } satisfies PluginBackgroundJob);
    set({
      jobs: {
        ...get().jobs,
        [key]: {
          ...base,
          nextRunAt,
          state: running.has(key) ? "running" : "scheduled",
        },
      },
      revision: get().revision + 1,
    });
  },

  markRunning: (command) => {
    if (!isBackgroundIntervalCommand(command)) return;
    const key = jobKey(command.pluginId, command.name);
    const runningKeys = get().runningKeys.includes(key)
      ? get().runningKeys
      : [...get().runningKeys, key];
    const prior = get().jobs[key];
    const job: PluginBackgroundJob = prior
      ? { ...prior, state: "running" }
      : {
          pluginId: command.pluginId,
          commandName: command.name,
          commandTitle: command.title || command.name,
          interval: String(command.interval || ""),
          intervalMs: parseIntervalMs(command.interval) || 0,
          lastRunAt: readNumber(storageKey("last", command.pluginId, command.name)),
          nextRunAt: readNumber(storageKey("next", command.pluginId, command.name)),
          state: "running",
          lastError: null,
        };
    set({
      runningKeys,
      jobs: { ...get().jobs, [key]: job },
      revision: get().revision + 1,
    });
  },

  markFinished: (command, error = null) => {
    if (!isBackgroundIntervalCommand(command)) return;
    const key = jobKey(command.pluginId, command.name);
    const now = Date.now();
    writeNumber(storageKey("last", command.pluginId, command.name), now);
    writeString(storageKey("error", command.pluginId, command.name), error);
    const runningKeys = get().runningKeys.filter((item) => item !== key);
    const prior = get().jobs[key];
    const nextRunAt =
      prior?.nextRunAt ?? readNumber(storageKey("next", command.pluginId, command.name));
    const job: PluginBackgroundJob = {
      pluginId: command.pluginId,
      commandName: command.name,
      commandTitle: command.title || command.name,
      interval: String(command.interval || prior?.interval || ""),
      intervalMs: prior?.intervalMs || parseIntervalMs(command.interval) || 0,
      lastRunAt: now,
      nextRunAt,
      state: nextRunAt != null ? "scheduled" : "idle",
      lastError: error,
    };
    set({
      runningKeys,
      jobs: { ...get().jobs, [key]: job },
      revision: get().revision + 1,
    });
  },

  getJob: (pluginId, commandName) => get().jobs[jobKey(pluginId, commandName)],

  listJobs: (pluginId) => {
    const jobs = Object.values(get().jobs);
    if (!pluginId) return jobs;
    return jobs.filter((job) => job.pluginId === pluginId);
  },

  summarizePlugin: (pluginId) => {
    const jobs = get().listJobs(pluginId);
    if (jobs.length === 0) return null;
    let lastRunAt: number | null = null;
    let nextRunAt: number | null = null;
    let isRunning = false;
    for (const job of jobs) {
      if (job.state === "running") isRunning = true;
      if (job.lastRunAt != null && (lastRunAt == null || job.lastRunAt > lastRunAt)) {
        lastRunAt = job.lastRunAt;
      }
      if (job.nextRunAt != null && (nextRunAt == null || job.nextRunAt < nextRunAt)) {
        nextRunAt = job.nextRunAt;
      }
    }
    return {
      pluginId,
      hasBackground: true,
      isRunning,
      jobs,
      lastRunAt,
      nextRunAt,
    };
  },

  hasBackground: (pluginId) => get().listJobs(pluginId).length > 0,
}));

/** Resolve plugin id from a launcher AppEntry path. */
export function pluginIdFromAppPath(path: string): string | null {
  if (path.startsWith("__qx:plugin:")) {
    return path.slice("__qx:plugin:".length) || null;
  }
  if (path.startsWith("__qx:cmd:")) {
    const rest = path.slice("__qx:cmd:".length);
    const split = rest.lastIndexOf(":");
    if (split <= 0) return null;
    return rest.slice(0, split) || null;
  }
  // Builtin modules open as __qx:<moduleId>
  if (path.startsWith("__qx:") && !path.startsWith("__qx:calc:")) {
    const id = path.slice("__qx:".length);
    if (!id || id.includes(":")) return null;
    return `builtin:${id}`;
  }
  return null;
}

/** Resolve command name for `__qx:cmd:pluginId:command` entries. */
export function commandNameFromAppPath(path: string): string | null {
  if (!path.startsWith("__qx:cmd:")) return null;
  const rest = path.slice("__qx:cmd:".length);
  const split = rest.lastIndexOf(":");
  if (split <= 0) return null;
  return rest.slice(split + 1) || null;
}

export function formatTimestamp(ms: number | null | undefined, locale?: string): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "";
  try {
    return new Date(ms).toLocaleString(locale || undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return new Date(ms).toISOString();
  }
}

export function formatRelativeTime(
  ms: number | null | undefined,
  now = Date.now(),
): { kind: "never" | "just_now" | "past" | "future"; minutes?: number; hours?: number; days?: number } {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return { kind: "never" };
  const delta = ms - now;
  const abs = Math.abs(delta);
  if (abs < 45_000) return { kind: "just_now" };
  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) {
    return { kind: delta < 0 ? "past" : "future", minutes };
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return { kind: delta < 0 ? "past" : "future", hours };
  }
  const days = Math.round(hours / 24);
  return { kind: delta < 0 ? "past" : "future", days };
}
