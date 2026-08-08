import type { AppEntry, SearchHistoryEntry } from "../store";
import type { RssDashboardSnapshot } from "../plugin/surfaceProviders";

const HOME_APP_CACHE_KEY = "qx.home-dashboard.apps.v1";
const SEARCH_HISTORY_CACHE_KEY = "qx.home-dashboard.searches.v1";
const RSS_CACHE_KEY = "qx.home-dashboard.rss.v1";
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readJson(key: string): unknown {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: unknown; value?: unknown };
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) {
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // A restricted WebView may deny storage; the in-memory state remains usable.
  }
}

function isEntryKind(value: unknown): value is AppEntry["kind"] {
  return value === undefined
    || value === "app"
    || value === "command"
    || value === "clipboard"
    || value === "file"
    || value === "folder"
    || value === "calculation";
}

function normalizeAppEntry(value: unknown): AppEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<AppEntry>;
  if (typeof raw.name !== "string" || typeof raw.path !== "string" || typeof raw.icon !== "string") {
    return null;
  }
  if (!isEntryKind(raw.kind)) return null;
  return {
    name: raw.name.slice(0, 512),
    display_name: typeof raw.display_name === "string" ? raw.display_name.slice(0, 512) : undefined,
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle.slice(0, 512) : undefined,
    path: raw.path.slice(0, 4096),
    icon: raw.icon.slice(0, 4096),
    kind: raw.kind,
    moduleId: typeof raw.moduleId === "string" ? raw.moduleId.slice(0, 128) : undefined,
    modified_at: typeof raw.modified_at === "number" ? raw.modified_at : undefined,
  };
}

function normalizeSearchEntry(value: unknown): SearchHistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<SearchHistoryEntry>;
  if (typeof raw.id !== "number" || typeof raw.query !== "string" || typeof raw.timestamp !== "string") {
    return null;
  }
  return {
    id: raw.id,
    query: raw.query.slice(0, 512),
    timestamp: raw.timestamp.slice(0, 128),
  };
}

export function readCachedHomeAppResults(): AppEntry[] {
  const value = readJson(HOME_APP_CACHE_KEY);
  return Array.isArray(value)
    ? value.map(normalizeAppEntry).filter((entry): entry is AppEntry => Boolean(entry)).slice(0, 128)
    : [];
}

export function writeCachedHomeAppResults(entries: readonly AppEntry[]): void {
  if (entries.length === 0) return;
  writeJson(HOME_APP_CACHE_KEY, entries.slice(0, 128));
}

export function readCachedSearchHistory(): SearchHistoryEntry[] {
  const value = readJson(SEARCH_HISTORY_CACHE_KEY);
  return Array.isArray(value)
    ? value.map(normalizeSearchEntry).filter((entry): entry is SearchHistoryEntry => Boolean(entry)).slice(0, 5)
    : [];
}

export function writeCachedSearchHistory(entries: readonly SearchHistoryEntry[]): void {
  writeJson(SEARCH_HISTORY_CACHE_KEY, entries.slice(0, 5));
}

function normalizeRssSnapshot(value: unknown): RssDashboardSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<RssDashboardSnapshot>;
  if (!Array.isArray(raw.articles)) return null;
  const articles = raw.articles.flatMap((article) => {
    if (!article || typeof article !== "object") return [];
    const item = article as RssDashboardSnapshot["articles"][number];
    if (
      typeof item.id !== "number"
      || typeof item.feedId !== "number"
      || typeof item.feedTitle !== "string"
      || typeof item.title !== "string"
      || typeof item.link !== "string"
      || typeof item.publishedAt !== "number"
    ) {
      return [];
    }
    return [{
      id: item.id,
      feedId: item.feedId,
      feedTitle: item.feedTitle.slice(0, 256),
      title: item.title.slice(0, 1024),
      link: item.link.slice(0, 4096),
      publishedAt: item.publishedAt,
    }];
  }).slice(0, 8);
  return {
    unreadCount: typeof raw.unreadCount === "number" ? Math.max(0, Math.floor(raw.unreadCount)) : articles.length,
    articles,
    generatedAt: typeof raw.generatedAt === "number" ? raw.generatedAt : 0,
  };
}

export function readCachedRssDashboardSnapshot(): RssDashboardSnapshot | null {
  return normalizeRssSnapshot(readJson(RSS_CACHE_KEY));
}

export function writeCachedRssDashboardSnapshot(snapshot: RssDashboardSnapshot): void {
  const normalized = normalizeRssSnapshot(snapshot);
  if (normalized) writeJson(RSS_CACHE_KEY, normalized);
}
