import type { AppEntry } from "../store";
import type { SearchMetadataEntry, Settings } from "../modules/settings/store";

export function normalizeSearchTerm(value: string): string {
  return value.trim().toLowerCase();
}

export function moduleMetadataKey(tabId: string): string {
  return `module:${tabId}`;
}

export function pluginMetadataKey(pluginId: string): string {
  return `plugin:${pluginId}`;
}

export function appMetadataKey(path: string): string {
  return `app:${path}`;
}

export function metadataKeyForEntry(item: AppEntry): string | null {
  if (item.path.startsWith("__qx:plugin:")) {
    return pluginMetadataKey(item.path.slice("__qx:plugin:".length));
  }
  if (item.path.startsWith("__qx:cmd:")) {
    const commandKey = item.path.slice("__qx:cmd:".length);
    const commandNameIndex = commandKey.lastIndexOf(":");
    if (commandNameIndex > 0) {
      return pluginMetadataKey(commandKey.slice(0, commandNameIndex));
    }
    return null;
  }
  const tabMatch = item.path.match(/^__qx:(clipboard|screencap|rss|v2ex|weather|qx-ai|macros|documents|qx-tty|settings)$/);
  if (tabMatch) return moduleMetadataKey(tabMatch[1]);
  if ((item.kind ?? "app") === "app" && item.path) return appMetadataKey(item.path);
  return null;
}

export function emptySearchMetadata(): SearchMetadataEntry {
  return { aliases: [], tags: [] };
}

export function metadataForKey(settings: Settings, key: string | null): SearchMetadataEntry {
  if (!key) return emptySearchMetadata();
  return settings.search_metadata[key] ?? emptySearchMetadata();
}

/** Lower rank = earlier in list. Unpinned apps share a high bucket (stable by caller index). */
export function pinSortRank(settings: Settings, key: string | null): number {
  if (!key) return 1_000_000;
  const entry = settings.search_metadata[key];
  if (!entry?.pinned) return 1_000_000;
  const order = typeof entry.pin_order === "number" && Number.isFinite(entry.pin_order)
    ? entry.pin_order
    : 0;
  return Math.max(0, Math.min(order, 999_999));
}

export function isEntryPinned(settings: Settings, key: string | null): boolean {
  if (!key) return false;
  return Boolean(settings.search_metadata[key]?.pinned);
}

export function isEntryHidden(settings: Settings, key: string | null): boolean {
  if (!key) return false;
  return Boolean(settings.search_metadata[key]?.hidden);
}

/**
 * Drop user-hidden apps from the empty home list.
 * Does not affect search — callers should only use this on the home path.
 */
export function filterHiddenFromHome<T extends { path: string; kind?: string }>(
  entries: T[],
  settings: Settings,
  keyFor: (item: T) => string | null,
): T[] {
  return entries.filter((entry) => !isEntryHidden(settings, keyFor(entry)));
}

/** Stable sort: pinned apps first (by pin_order), then original order. */
export function sortEntriesWithPins<T extends { path: string; kind?: string }>(
  entries: T[],
  settings: Settings,
  keyFor: (item: T) => string | null,
): T[] {
  return entries
    .map((entry, index) => ({ entry, index, rank: pinSortRank(settings, keyFor(entry)) }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map(({ entry }) => entry);
}

/**
 * Split pinned rows (by pin_order) from the rest. Used by result row builder so
 * pins form a sticky top section even after category grouping.
 */
export function splitPinnedEntries<T extends { path: string; kind?: string }>(
  entries: T[],
  settings: Settings,
  keyFor: (item: T) => string | null,
): { pinned: T[]; rest: T[] } {
  const tagged = entries.map((entry, index) => ({
    entry,
    index,
    rank: pinSortRank(settings, keyFor(entry)),
  }));
  const pinned = tagged
    .filter((row) => row.rank < 1_000_000)
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map((row) => row.entry);
  if (pinned.length === 0) return { pinned: [], rest: entries };
  const pinnedPaths = new Set(pinned.map((entry) => entry.path));
  const rest = entries.filter((entry) => !pinnedPaths.has(entry.path));
  return { pinned, rest };
}

/**
 * Sticky pins for any list (home or search):
 * - Pinned entries always lead, ordered by pin_order (not match score).
 * - Missing pinned rows are injected from `catalog` / plugin ports so typing
 *   a query cannot bury or drop pins.
 */
export function promotePinnedStickyEntries(
  results: AppEntry[],
  settings: Settings,
  options?: {
    catalog?: AppEntry[];
    plugins?: Array<{
      id: string;
      name: string;
      enabled: boolean;
      description?: string;
      manifest?: { icon?: string } | null;
    }>;
  },
): AppEntry[] {
  const byPath = new Map<string, AppEntry>();
  for (const entry of options?.catalog ?? []) {
    byPath.set(entry.path, entry);
  }
  for (const entry of results) {
    byPath.set(entry.path, entry);
  }
  if (options?.plugins) {
    for (const row of pinnedPortEntriesFromSettings(settings, options.plugins)) {
      if (byPath.has(row.path)) continue;
      byPath.set(row.path, {
        name: row.name,
        display_name: row.display_name || row.name,
        path: row.path,
        icon: row.icon,
        kind: (row.kind || "command") as AppEntry["kind"],
        subtitle: row.subtitle,
      });
    }
  }

  const pinned: Array<{ entry: AppEntry; rank: number }> = [];
  for (const [key, meta] of Object.entries(settings.search_metadata || {})) {
    if (!meta?.pinned || meta.hidden) continue;
    let path: string | null = null;
    if (key.startsWith("app:")) path = key.slice("app:".length);
    else if (key.startsWith("plugin:")) path = `__qx:plugin:${key.slice("plugin:".length)}`;
    else if (key.startsWith("module:")) path = `__qx:${key.slice("module:".length)}`;
    if (!path) continue;
    const entry = byPath.get(path);
    if (!entry) continue;
    pinned.push({ entry, rank: pinSortRank(settings, key) });
  }
  pinned.sort((a, b) => a.rank - b.rank || a.entry.path.localeCompare(b.entry.path));
  if (pinned.length === 0) return results;

  const pinnedPaths = new Set(pinned.map((row) => row.entry.path));
  const rest = results.filter((entry) => !pinnedPaths.has(entry.path));
  return [...pinned.map((row) => row.entry), ...rest];
}

/** Empty home list: hide user-hidden apps, then pin-sort. */
export function prepareHomeAppList<T extends { path: string; kind?: string }>(
  entries: T[],
  settings: Settings,
  keyFor: (item: T) => string | null,
): T[] {
  return sortEntriesWithPins(
    filterHiddenFromHome(entries, settings, keyFor),
    settings,
    keyFor,
  );
}

/**
 * Build launcher rows for pinned plugins/modules so they appear on the empty
 * home list (not only OS apps from search_apps).
 */
export function pinnedPortEntriesFromSettings(
  settings: Settings,
  plugins: Array<{ id: string; name: string; enabled: boolean; description?: string; manifest?: { icon?: string } | null }>,
): Array<{
  name: string;
  display_name?: string;
  path: string;
  icon: string;
  kind: string;
  subtitle?: string;
}> {
  const rows: Array<{
    name: string;
    display_name?: string;
    path: string;
    icon: string;
    kind: string;
    subtitle?: string;
  }> = [];
  for (const [key, meta] of Object.entries(settings.search_metadata || {})) {
    if (!meta?.pinned || meta.hidden) continue;
    if (key.startsWith("plugin:")) {
      const pluginId = key.slice("plugin:".length);
      const plugin = plugins.find((item) => item.id === pluginId);
      if (!plugin?.enabled) continue;
      rows.push({
        name: plugin.name || pluginId,
        display_name: plugin.name || pluginId,
        path: `__qx:plugin:${pluginId}`,
        icon: plugin.manifest?.icon || `builtin:${pluginId}`,
        kind: "command",
        subtitle: plugin.description || pluginId,
      });
      continue;
    }
    if (key.startsWith("module:")) {
      const moduleId = key.slice("module:".length);
      rows.push({
        name: moduleId,
        display_name: moduleId,
        path: `__qx:${moduleId}`,
        icon: `builtin:${moduleId}`,
        kind: "command",
        subtitle: "Module",
      });
    }
  }
  return rows;
}

export function nextPinOrder(settings: Settings): number {
  let max = 0;
  for (const entry of Object.values(settings.search_metadata)) {
    if (!entry?.pinned) continue;
    if (typeof entry.pin_order === "number" && entry.pin_order > max) {
      max = entry.pin_order;
    }
  }
  return max + 1;
}

export function metadataTokens(entry?: SearchMetadataEntry): string[] {
  if (!entry) return [];
  return [...entry.aliases, ...entry.tags].map((item) => item.trim()).filter(Boolean);
}

export function metadataMatchesQuery(entry: SearchMetadataEntry | undefined, query: string): boolean {
  const q = normalizeSearchTerm(query);
  if (!q) return true;
  return metadataTokens(entry).some((item) => normalizeSearchTerm(item).includes(q));
}

export function itemMatchesSearchMetadata(settings: Settings, key: string | null, query: string): boolean {
  if (!key) return false;
  return metadataMatchesQuery(settings.search_metadata[key], query);
}
