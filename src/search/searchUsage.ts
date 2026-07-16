/**
 * Search-result click usage (rolling 30-day window).
 *
 * Main search stays free of await: callers stamp/rank from an in-memory cache
 * and refresh that cache asynchronously. Frequent items that still match the
 * current query can be merged into results without blocking apps/files IPC.
 */

import { invoke } from "@tauri-apps/api/core";
import type { AppEntry } from "../store";
import { MatchTier, scoreEntryTier } from "./rankResults";

export interface SearchClickStat {
  path: string;
  name: string;
  kind?: string | null;
  icon?: string | null;
  click_count: number;
  last_clicked: string;
}

const CACHE_TTL_MS = 12_000;
const DEFAULT_LIMIT = 48;

let usageByPath = new Map<string, number>();
let usageStats: SearchClickStat[] = [];
let lastFetchedAt = 0;
let inflight: Promise<void> | null = null;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function parseKind(kind: string | null | undefined): AppEntry["kind"] {
  switch (kind) {
    case "app":
    case "command":
    case "clipboard":
    case "file":
    case "folder":
    case "calculation":
      return kind;
    default:
      return "app";
  }
}

export function getCachedClickCount(path: string): number {
  return usageByPath.get(path) ?? 0;
}

/** Attach rolling click counts from the local cache (sync). */
export function stampUsage(entries: AppEntry[]): AppEntry[] {
  if (usageByPath.size === 0) return entries;
  return entries.map((entry) => {
    const clicks = usageByPath.get(entry.path);
    if (!clicks) return entry;
    if (entry.clickCount === clicks) return entry;
    return { ...entry, clickCount: clicks };
  });
}

/** High-usage rows that still match the active query (sync, pure). */
export function frequentMatchingEntries(query: string, limit = 12): AppEntry[] {
  const q = query.trim();
  if (!q || usageStats.length === 0) return [];

  const out: AppEntry[] = [];
  for (const stat of usageStats) {
    if (out.length >= limit) break;
    const entry: AppEntry = {
      name: stat.name,
      path: stat.path,
      icon: stat.icon || "builtin:app",
      kind: parseKind(stat.kind),
      clickCount: stat.click_count,
    };
    // Reuse main search match rules (exact/prefix/word/contains); no special path.
    if (scoreEntryTier(entry, q) >= MatchTier.none) continue;
    out.push(entry);
  }
  return out;
}

/**
 * Refresh the usage cache. Safe to call frequently; coalesces concurrent loads
 * and respects a short TTL so typing does not hammer SQLite.
 */
export function refreshSearchUsageCache(options?: {
  force?: boolean;
  limit?: number;
}): Promise<void> {
  if (!isTauriRuntime()) return Promise.resolve();
  const force = options?.force === true;
  const now = Date.now();
  if (!force && now - lastFetchedAt < CACHE_TTL_MS && usageStats.length > 0) {
    return Promise.resolve();
  }
  if (inflight) return inflight;

  inflight = invoke<SearchClickStat[]>("get_search_click_stats", {
    limit: options?.limit ?? DEFAULT_LIMIT,
    days: 30,
  })
    .then((stats) => {
      usageStats = Array.isArray(stats) ? stats : [];
      const next = new Map<string, number>();
      for (const row of usageStats) {
        if (!row?.path) continue;
        next.set(row.path, Math.max(0, Number(row.click_count) || 0));
      }
      usageByPath = next;
      lastFetchedAt = Date.now();
    })
    .catch(() => {
      // Usage is advisory; never fail the search pipeline.
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Fire-and-forget: record a launcher result open for 30-day ranking. */
export function recordSearchResultClick(item: AppEntry): void {
  if (!isTauriRuntime()) return;
  const path = item.path?.trim();
  const name = (item.display_name || item.name || "").trim();
  if (!path || !name) return;

  // Optimistic local bump so the next re-rank can use it without waiting IPC.
  usageByPath.set(path, (usageByPath.get(path) ?? 0) + 1);
  const existing = usageStats.find((row) => row.path === path);
  if (existing) {
    existing.click_count += 1;
    existing.last_clicked = new Date().toISOString();
    existing.name = name;
    if (item.kind) existing.kind = item.kind;
    if (item.icon) existing.icon = item.icon;
    usageStats.sort((a, b) => b.click_count - a.click_count);
  } else {
    usageStats.unshift({
      path,
      name,
      kind: item.kind ?? null,
      icon: item.icon ?? null,
      click_count: 1,
      last_clicked: new Date().toISOString(),
    });
  }

  void invoke("record_search_click", {
    path,
    name,
    kind: item.kind ?? null,
    icon: item.icon || null,
  }).catch(() => {});
}
