/** Last visited Qx routes for the docked Island recents switcher. */

export const RECENT_VIEW_LIMIT = 5;
export const RECENT_VIEWS_STORAGE_KEY = "qx.island.recentViews.v1";

export interface RecentViewEntry {
  route: string;
  viewedAtMs: number;
}

type Listener = () => void;

let views: RecentViewEntry[] = readStoredViews();
let switcherOpen = false;
const viewListeners = new Set<Listener>();
const switcherListeners = new Set<Listener>();

function emit(listeners: Set<Listener>): void {
  for (const listener of listeners) listener();
}

function isRecentViewEntry(value: unknown): value is RecentViewEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RecentViewEntry>;
  return typeof entry.route === "string" && typeof entry.viewedAtMs === "number";
}

export function normalizeRecentRoute(route: string): string | null {
  const trimmed = route.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("plugin:")) {
    return trimmed.slice("plugin:".length).trim() ? trimmed : null;
  }
  return trimmed;
}

export function pushRecentView(
  list: RecentViewEntry[],
  route: string,
  viewedAtMs = Date.now(),
): RecentViewEntry[] {
  const normalized = normalizeRecentRoute(route);
  if (!normalized) return list;
  return [
    { route: normalized, viewedAtMs },
    ...list.filter((entry) => entry.route !== normalized),
  ].slice(0, RECENT_VIEW_LIMIT);
}

/** Recents shown beside the current Island icon; current route is the origin, not a new tile. */
export function recentsForSwitcher(
  list: RecentViewEntry[],
  currentRoute: string,
): RecentViewEntry[] {
  const current = normalizeRecentRoute(currentRoute);
  return list.filter((entry) => entry.route !== current).slice(0, RECENT_VIEW_LIMIT);
}

function browserStorage(): Storage | null {
  const host = globalThis.window as Window | undefined;
  if (!host || !("localStorage" in host)) return null;
  try {
    return host.localStorage;
  } catch {
    return null;
  }
}

function readStoredViews(): RecentViewEntry[] {
  try {
    const raw = browserStorage()?.getItem(RECENT_VIEWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const next: RecentViewEntry[] = [];
    for (const item of parsed) {
      if (!isRecentViewEntry(item)) continue;
      const route = normalizeRecentRoute(item.route);
      if (!route || seen.has(route)) continue;
      seen.add(route);
      next.push({ route, viewedAtMs: item.viewedAtMs });
      if (next.length >= RECENT_VIEW_LIMIT) break;
    }
    return next;
  } catch {
    return [];
  }
}

function persistViews(next: RecentViewEntry[]): void {
  try {
    browserStorage()?.setItem(RECENT_VIEWS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Keep the in-memory recents usable without storage. */
  }
}

export function loadRecentViews(): RecentViewEntry[] {
  return views;
}

export function subscribeRecentViews(listener: Listener): () => void {
  viewListeners.add(listener);
  return () => {
    viewListeners.delete(listener);
  };
}

export function recordRecentView(route: string, viewedAtMs = Date.now()): RecentViewEntry[] {
  const next = pushRecentView(views, route, viewedAtMs);
  if (next === views || (
    next.length === views.length
    && next.every((entry, index) => entry.route === views[index]?.route && entry.viewedAtMs === views[index]?.viewedAtMs)
  )) {
    return views;
  }
  views = next;
  persistViews(views);
  emit(viewListeners);
  return views;
}

export function isRecentSwitcherOpen(): boolean {
  return switcherOpen;
}

export function subscribeRecentSwitcher(listener: Listener): () => void {
  switcherListeners.add(listener);
  return () => {
    switcherListeners.delete(listener);
  };
}

export function setRecentSwitcherOpen(open: boolean): void {
  if (switcherOpen === open) return;
  switcherOpen = open;
  emit(switcherListeners);
}

export function toggleRecentSwitcher(): boolean {
  setRecentSwitcherOpen(!switcherOpen);
  return switcherOpen;
}

/** Host Esc / click-outside: close one layer and report whether it handled the step. */
export function tryCloseRecentSwitcher(): boolean {
  if (!switcherOpen) return false;
  setRecentSwitcherOpen(false);
  return true;
}

export function __resetRecentViewsForTests(): void {
  views = [];
  switcherOpen = false;
  viewListeners.clear();
  switcherListeners.clear();
}
