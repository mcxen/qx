import type {
  IslandSession,
  IslandShowInput,
  IslandUpdateInput,
  IslandSlotContent,
  IslandPriority,
  IslandSource,
} from "../types";
import { actionRegistry } from "./actionRegistry";
import { resolveDockedWinner, resolveRotatingWinner } from "./priority";
import { createQxLogger } from "../../lib/logger";

const log = createQxLogger("island.store");

export type IslandClock = () => number;

const MODULE_TASK_SAFETY_MS = 120_000;
const PLUGIN_TTL_HARD_MAX_MS = 8_000;
const TOAST_DEFAULT_MS = 2_600;
const ERROR_DEFAULT_MS = 8_000;

let nowFn: IslandClock = () => Date.now();
let sessions = new Map<string, IslandSession>();
let snapshotCache: IslandSession[] = [];
let generationCounters = new Map<string, number>();
let rankEpochCounter = 0;
const listeners = new Set<() => void>();
const ttlTimers = new Map<string, ReturnType<typeof setTimeout>>();

function nextGeneration(id: string): number {
  const next = (generationCounters.get(id) ?? 0) + 1;
  generationCounters.set(id, next);
  return next;
}

function bumpRankEpoch(): number {
  rankEpochCounter += 1;
  return rankEpochCounter;
}

function notify(): void {
  snapshotCache = Array.from(sessions.values());
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* ignore subscriber errors */
    }
  }
}

function clearTtl(id: string): void {
  const timer = ttlTimers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    ttlTimers.delete(id);
  }
}

function scheduleTtl(session: IslandSession): void {
  clearTtl(session.id);
  if (session.ttlMs == null || session.ttlMs <= 0) return;
  const expiresAt = session.contentUpdatedAt + session.ttlMs;
  const delay = Math.max(0, expiresAt - nowFn());
  const timer = setTimeout(() => {
    ttlTimers.delete(session.id);
    // Re-check still the same generation before dismiss
    const current = sessions.get(session.id);
    if (!current || current.generation !== session.generation) return;
    dismissInternal(session.id, "ttl");
  }, delay);
  ttlTimers.set(session.id, timer);
}

function applyPluginCaps(input: IslandShowInput): IslandShowInput | null {
  if (input.source === "plugin-display") {
    const content: IslandSlotContent = {
      ...input.content,
      componentId: undefined,
      componentProps: undefined,
    };
    content.primary = content.primary.slice(0, 80);
    if (content.secondary) content.secondary = content.secondary.slice(0, 120);
    if (content.meter?.kind === "progress") {
      content.meter = {
        kind: "progress",
        progress: Math.max(0, Math.min(100, Number(content.meter.progress ?? 0))),
      };
    }
    return {
      ...input,
      priority: "location",
      placement: "docked-or-float",
      sticky: true,
      ttlMs: input.ttlMs == null ? undefined : Math.max(500, input.ttlMs),
      content,
    };
  }

  if (input.source !== "plugin") return input;

  // §5.2: plugin may only show toast priority, non-sticky, docked, slots-only.
  if (input.priority !== "toast") {
    log.debug("island plugin rejected non-toast priority", {
      id: input.id,
      priority: input.priority,
    });
    return null;
  }

  const content: IslandSlotContent = {
    ...input.content,
    componentId: undefined,
    componentProps: undefined,
  };
  if (content.primary.length > 80) {
    content.primary = content.primary.slice(0, 80);
  }
  if (content.secondary && content.secondary.length > 120) {
    content.secondary = content.secondary.slice(0, 120);
  }

  let ttlMs = input.ttlMs;
  if (ttlMs == null) {
    const tone = content.tone;
    const isActivity = content.meter?.kind === "activity";
    ttlMs =
      tone === "danger" || isActivity ? PLUGIN_TTL_HARD_MAX_MS : TOAST_DEFAULT_MS;
  }
  ttlMs = Math.min(ttlMs, PLUGIN_TTL_HARD_MAX_MS);

  return {
    ...input,
    content,
    sticky: false,
    placement: "docked",
    ttlMs,
    priority: "toast",
  };
}

function defaultTtl(
  source: IslandSource,
  priority: IslandPriority,
  explicit?: number,
): number | undefined {
  if (explicit != null) return explicit;
  if (source === "plugin") return TOAST_DEFAULT_MS;
  if (priority === "toast") return TOAST_DEFAULT_MS;
  if (priority === "error") return ERROR_DEFAULT_MS;
  if (
    priority === "task" &&
    (source === "module" || source === "shell")
  ) {
    return MODULE_TASK_SAFETY_MS;
  }
  return undefined;
}

function mergeContent(
  base: IslandSlotContent,
  patch: Partial<IslandSlotContent> | IslandSlotContent,
): IslandSlotContent {
  if ("primary" in patch && typeof (patch as IslandSlotContent).primary === "string") {
    // Full-ish replace when primary is present
    return {
      ...base,
      ...patch,
      identity: patch.identity !== undefined ? patch.identity : base.identity,
      meter: patch.meter !== undefined ? patch.meter : base.meter,
      action: patch.action !== undefined ? patch.action : base.action,
      actions: patch.actions !== undefined ? patch.actions : base.actions,
      effect: patch.effect !== undefined ? patch.effect : base.effect,
    };
  }
  return {
    ...base,
    ...patch,
    identity:
      patch.identity !== undefined
        ? { ...base.identity, ...patch.identity }
        : base.identity,
    meter: patch.meter !== undefined ? { ...base.meter, ...patch.meter } : base.meter,
    action: patch.action !== undefined ? patch.action : base.action,
    actions: patch.actions !== undefined ? patch.actions : base.actions,
    effect: patch.effect !== undefined ? patch.effect : base.effect,
  };
}

function dismissInternal(id: string, reason: string): void {
  if (!sessions.has(id)) return;
  clearTtl(id);
  sessions.delete(id);
  actionRegistry.unbind(id);
  log.debug("island dismiss", { id, reason });
  notify();
}

export function showSession(input: IslandShowInput): { id: string; generation: number } | null {
  const capped = applyPluginCaps(input);
  if (!capped) return null;

  const existing = sessions.get(capped.id);
  const replacePolicy = capped.replacePolicy ?? "replace-same-id";
  if (
    existing &&
    replacePolicy === "reject-if-lower" &&
    PRIORITY_WORSE(capped.priority, existing.priority)
  ) {
    return { id: existing.id, generation: existing.generation };
  }

  const now = nowFn();
  const generation = nextGeneration(capped.id);
  const source = capped.source ?? "module";
  const ttlMs = defaultTtl(source, capped.priority, capped.ttlMs);

  const session: IslandSession = {
    id: capped.id,
    generation,
    priority: capped.priority,
    rankEpoch: bumpRankEpoch(),
    source,
    createdAt: existing?.createdAt ?? now,
    contentUpdatedAt: now,
    ttlMs,
    replacePolicy,
    placement: capped.placement ?? "docked",
    content: capped.content,
    sticky: capped.sticky,
    progressSilent: capped.progressSilent ?? true,
  };

  sessions.set(session.id, session);
  if (capped.actions !== undefined) {
    actionRegistry.unbind(session.id);
    if (Object.keys(capped.actions).length > 0) {
      actionRegistry.bind(session.id, capped.actions);
    }
  }
  scheduleTtl(session);
  log.debug("island show", {
    id: session.id,
    priority: session.priority,
    generation: session.generation,
  });
  notify();
  return { id: session.id, generation: session.generation };
}

function PRIORITY_WORSE(next: IslandPriority, current: IslandPriority): boolean {
  const order: IslandPriority[] = ["task", "error", "toast", "location", "home"];
  return order.indexOf(next) > order.indexOf(current);
}

export function updateSession(
  id: string,
  patch: IslandUpdateInput,
): { ok: boolean; generation?: number } {
  const current = sessions.get(id);
  if (!current) return { ok: false };

  if (
    patch.expectedGeneration != null &&
    patch.expectedGeneration !== current.generation
  ) {
    log.debug("island update stale", {
      id,
      expected: patch.expectedGeneration,
      actual: current.generation,
    });
    return { ok: false };
  }

  // Plugin caps on updates
  if (current.source === "plugin") {
    if (patch.priority != null && patch.priority !== "toast") {
      return { ok: false };
    }
    if (patch.sticky) return { ok: false };
    if (patch.placement && patch.placement !== "docked") return { ok: false };
  }
  if (current.source === "plugin-display") {
    if (patch.priority != null && patch.priority !== "location") return { ok: false };
    if (patch.sticky === false) return { ok: false };
    if (patch.placement && patch.placement !== "docked-or-float") return { ok: false };
  }

  const now = nowFn();
  let rankEpoch = current.rankEpoch;
  const rankChanging =
    (patch.priority != null && patch.priority !== current.priority) ||
    (patch.sticky != null && patch.sticky !== current.sticky) ||
    (patch.placement != null && patch.placement !== current.placement);

  if (rankChanging) {
    rankEpoch = bumpRankEpoch();
  }

  let content = current.content;
  if (patch.content) {
    content = mergeContent(current.content, patch.content);
    if (current.source === "plugin" || current.source === "plugin-display") {
      content = {
        ...content,
        componentId: undefined,
        componentProps: undefined,
      };
      if (content.primary.length > 80) content.primary = content.primary.slice(0, 80);
      if (content.secondary && content.secondary.length > 120) {
        content.secondary = content.secondary.slice(0, 120);
      }
      if (current.source === "plugin-display" && content.meter?.kind === "progress") {
        content.meter = {
          kind: "progress",
          progress: Math.max(0, Math.min(100, Number(content.meter.progress ?? 0))),
        };
      }
    }
  }

  let ttlMs = current.ttlMs;
  if (patch.ttlMs === null) {
    ttlMs = undefined;
  } else if (patch.ttlMs !== undefined) {
    ttlMs =
      current.source === "plugin"
        ? Math.min(patch.ttlMs, PLUGIN_TTL_HARD_MAX_MS)
        : patch.ttlMs;
  }

  const generation = nextGeneration(id);
  const next: IslandSession = {
    ...current,
    generation,
    rankEpoch,
    contentUpdatedAt: now,
    content,
    priority: patch.priority ?? current.priority,
    placement: patch.placement ?? current.placement,
    sticky: patch.sticky ?? current.sticky,
    progressSilent: patch.progressSilent ?? current.progressSilent,
    ttlMs,
  };

  sessions.set(id, next);
  if (patch.actions !== undefined) {
    actionRegistry.unbind(id);
    if (Object.keys(patch.actions).length > 0) {
      actionRegistry.bind(id, patch.actions);
    }
  }
  scheduleTtl(next);
  notify();
  return { ok: true, generation };
}

export function dismissSession(id: string): void {
  dismissInternal(id, "host");
}

export function getSnapshot(): IslandSession[] {
  return snapshotCache;
}

export function getSession(id: string): IslandSession | undefined {
  return sessions.get(id);
}

export function getDockedWinner(rotationIndex = 0): IslandSession | null {
  const snapshot = getSnapshot();
  const id = rotationIndex === 0
    ? resolveDockedWinner(snapshot)
    : resolveRotatingWinner(snapshot, rotationIndex);
  return id ? sessions.get(id) ?? null : null;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test / injectable clock. */
export function __setIslandClock(clock: IslandClock): void {
  nowFn = clock;
}

export function __resetIslandStoreForTests(): void {
  for (const id of Array.from(sessions.keys())) {
    clearTtl(id);
    actionRegistry.unbind(id);
  }
  for (const id of Array.from(ttlTimers.keys())) clearTtl(id);
  sessions = new Map();
  snapshotCache = [];
  generationCounters = new Map();
  rankEpochCounter = 0;
  listeners.clear();
  nowFn = () => Date.now();
}
