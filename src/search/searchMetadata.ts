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

export function metadataForKey(settings: Settings, key: string | null): SearchMetadataEntry {
  if (!key) return { aliases: [], tags: [] };
  return settings.search_metadata[key] ?? { aliases: [], tags: [] };
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
