/**
 * Launcher search ranking — shared match quality + global result order.
 *
 * Invariants:
 * - Relevance first (exact > prefix > word-prefix > contains).
 * - Short queries (length ≤ SHORT_QUERY_MAX) never match via mid-string contains
 *   (fixes `ip` ⊂ `clipboard` ranking above `iPhone…`).
 * - Same tier: kind → clickCount → file type (office docs before source/logs)
 *   → shorter display name → localeCompare (zh-aware).
 * - Empty query: caller must not use this (home list uses pin sort).
 */

import type { AppEntry } from "../store";

/** Queries this short reject mid-string `includes` matches. */
export const SHORT_QUERY_MAX = 2;

/** Lower = better. */
export const MatchTier = {
  exact: 0,
  prefix: 1,
  wordPrefix: 2,
  contains: 3,
  /** Multi-token every-token contains (query has spaces). */
  multiToken: 4,
  none: 99,
} as const;

export type MatchTierValue = (typeof MatchTier)[keyof typeof MatchTier];

export function normalizeSearchQuery(query: string): string {
  return query.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function compactSearchSeparators(value: string): string {
  return normalizeSearchQuery(value).replace(/[\s\-_.\/]+/g, "");
}

/**
 * True when `haystack` has a token (split on non-alphanumeric / CJK run) that
 * starts with `query`, or a camelCase hump that starts with `query`.
 */
export function hasWordPrefix(haystack: string, query: string): boolean {
  const q = normalizeSearchQuery(query);
  if (!q) return false;
  const lower = haystack.toLowerCase();
  if (lower.startsWith(q)) return true;

  // Tokenize: non-letter/digit separators; keep CJK as their own runs via split.
  const tokens = lower.split(/[^a-z0-9\u3400-\u9fff\uF900-\uFAFF]+/).filter(Boolean);
  if (tokens.some((token) => token.startsWith(q))) return true;

  // camelCase / PascalCase on original string: "iPhoneMirror" → iphone, mirror
  const camelChunks = haystack
    .replace(/([a-z\d])([A-Z])/g, "$1\0$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1\0$2")
    .split("\0")
    .map((part) => part.toLowerCase())
    .filter(Boolean);
  return camelChunks.some((chunk) => chunk.startsWith(q));
}

/**
 * Classify how strongly `haystack` matches `query`.
 * Mid-string contains is rejected when query length ≤ SHORT_QUERY_MAX.
 */
export function classifyMatch(haystack: string, query: string): MatchTierValue {
  const q = normalizeSearchQuery(query);
  if (!q) return MatchTier.none;
  const value = haystack.trim().toLowerCase();
  if (!value) return MatchTier.none;

  if (value === q) return MatchTier.exact;
  if (value.startsWith(q)) return MatchTier.prefix;
  if (hasWordPrefix(haystack, q)) return MatchTier.wordPrefix;

  if (value.includes(q)) {
    if (q.length <= SHORT_QUERY_MAX) return MatchTier.none;
    return MatchTier.contains;
  }

  // Treat spaces and common name separators as optional. This makes `qx ai`,
  // `qx-ai`, and `QxAI` equivalent while retaining the normal tier ordering.
  const compactQuery = compactSearchSeparators(q);
  const compactValue = compactSearchSeparators(value);
  if (compactQuery.length >= 3 && compactValue && (compactQuery !== q || compactValue !== value)) {
    if (compactValue === compactQuery) return MatchTier.exact;
    if (compactValue.startsWith(compactQuery)) return MatchTier.prefix;
    if (compactValue.includes(compactQuery)) return MatchTier.contains;
  }

  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => value.includes(token))) {
    if (tokens.some((token) => token.length <= SHORT_QUERY_MAX) && tokens.every((t) => t.length <= SHORT_QUERY_MAX)) {
      // All short tokens mid-string — still weak; only accept if every token
      // is a word prefix rather than pure mid-string. Fall through as multi when longer.
    }
    if (q.length <= SHORT_QUERY_MAX) return MatchTier.none;
    return MatchTier.multiToken;
  }

  return MatchTier.none;
}

/** Best (lowest) tier across fields. */
export function bestMatchTier(
  query: string,
  ...fields: Array<string | null | undefined>
): MatchTierValue {
  let best: MatchTierValue = MatchTier.none;
  for (const field of fields) {
    if (field == null || field === "") continue;
    const tier = classifyMatch(field, query);
    if (tier < best) best = tier;
  }
  return best;
}

/** Whether any field is a usable match (for filtering candidates). */
export function textMatchesQuery(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  return bestMatchTier(query, ...fields) < MatchTier.none;
}

/**
 * Higher = better score for call sites that sort descending (plugin commands).
 * 0 = no match.
 */
export function scoreMatchDescending(
  query: string,
  ...fields: Array<string | null | undefined>
): number {
  const tier = bestMatchTier(query, ...fields);
  if (tier >= MatchTier.none) return 0;
  // exact 100, prefix 90, wordPrefix 80, contains 60, multiToken 50
  const map: Record<number, number> = {
    [MatchTier.exact]: 100,
    [MatchTier.prefix]: 90,
    [MatchTier.wordPrefix]: 80,
    [MatchTier.contains]: 60,
    [MatchTier.multiToken]: 50,
  };
  return map[tier] ?? 0;
}

function kindBias(kind: AppEntry["kind"] | undefined): number {
  switch (kind) {
    case "calculation":
      return -1;
    case "command":
      return 0;
    case "app":
      return 1;
    case "folder":
      return 2;
    case "file":
      return 3;
    case "clipboard":
      return 4;
    default:
      return 1;
  }
}

/**
 * Within the same match tier / kind, prefer office docs over source/logs.
 * Lower = better. Non-files return a neutral mid bucket so they don't shift.
 * Mirrors `document_type_rank` in `src-tauri/src/file_search.rs`.
 */
export function fileTypeBias(entry: AppEntry): number {
  if (entry.kind !== "file") return 20;
  const base = pathBasename(entry.path || entry.name || "");
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return 28;
  const ext = base.slice(dot + 1).toLowerCase();
  switch (ext) {
    case "pdf":
      return 0;
    case "doc":
    case "docx":
    case "dot":
    case "dotx":
    case "rtf":
    case "odt":
    case "pages":
      return 1;
    case "xls":
    case "xlsx":
    case "xlsm":
    case "xlsb":
    case "csv":
    case "tsv":
    case "ods":
    case "numbers":
      return 2;
    case "ppt":
    case "pptx":
    case "pps":
    case "ppsx":
    case "key":
    case "odp":
      return 3;
    case "txt":
    case "md":
    case "markdown":
    case "text":
      return 10;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "heic":
    case "heif":
    case "tif":
    case "tiff":
    case "bmp":
    case "svg":
      return 12;
    case "mp4":
    case "mov":
    case "m4v":
    case "mkv":
    case "avi":
    case "webm":
    case "mp3":
    case "m4a":
    case "wav":
    case "aac":
    case "flac":
      return 14;
    case "zip":
    case "rar":
    case "7z":
    case "tar":
    case "gz":
    case "tgz":
    case "dmg":
    case "pkg":
      return 18;
    case "rs":
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "py":
    case "go":
    case "java":
    case "kt":
    case "swift":
    case "c":
    case "cc":
    case "cpp":
    case "cxx":
    case "h":
    case "hpp":
    case "m":
    case "mm":
    case "cs":
    case "rb":
    case "php":
    case "vue":
    case "svelte":
    case "astro":
    case "json":
    case "jsonc":
    case "yml":
    case "yaml":
    case "toml":
    case "lock":
    case "map":
    case "wasm":
    case "o":
    case "a":
    case "so":
    case "dylib":
    case "class":
    case "pyc":
    case "pyo":
    case "log":
      return 40;
    default:
      return 25;
  }
}

function entryDisplayName(entry: AppEntry): string {
  return (entry.display_name || entry.name || "").trim();
}

function pathBasename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const base = normalized.split("/").pop() || normalized;
  return base.replace(/\.app$/i, "");
}

/** Compute match tier for a launcher row from visible fields. */
export function scoreEntryTier(entry: AppEntry, query: string): MatchTierValue {
  if (entry.kind === "calculation") return MatchTier.exact;

  const name = entryDisplayName(entry);
  const fields: Array<string | null | undefined> = [name, entry.name, entry.display_name, entry.subtitle];

  if (entry.kind === "file" || entry.kind === "folder" || entry.kind === "app") {
    fields.push(pathBasename(entry.path));
  }

  // Optional precomputed tier from the producer (keyword-aware matches).
  const pre = entry.matchScore;
  const computed = bestMatchTier(query, ...fields);
  if (typeof pre === "number" && Number.isFinite(pre)) {
    return Math.min(pre, computed) as MatchTierValue;
  }
  return computed;
}

/**
 * Global sort for non-empty search. Stable, pure, no pin/hide logic.
 *
 * Order: match tier → kind bias → **usage (clickCount desc)** → file type
 * (office before source) → name length → locale name.
 * Usage never outranks a stronger text match; type bias never outranks usage.
 */
export function rankSearchResults(entries: AppEntry[], query: string): AppEntry[] {
  const q = query.trim();
  if (!q || entries.length <= 1) return entries;

  return entries
    .map((entry, index) => {
      const name = entryDisplayName(entry);
      const clicks = typeof entry.clickCount === "number" && Number.isFinite(entry.clickCount)
        ? entry.clickCount
        : 0;
      return {
        entry,
        index,
        tier: scoreEntryTier(entry, q),
        kind: kindBias(entry.kind),
        clicks,
        fileType: fileTypeBias(entry),
        len: name.length || 999,
        nameKey: name.toLowerCase(),
      };
    })
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.kind !== b.kind) return a.kind - b.kind;
      if (a.clicks !== b.clicks) return b.clicks - a.clicks;
      if (a.fileType !== b.fileType) return a.fileType - b.fileType;
      if (a.len !== b.len) return a.len - b.len;
      const byName = a.nameKey.localeCompare(b.nameKey, "zh-Hans", { sensitivity: "base" });
      if (byName !== 0) return byName;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}
