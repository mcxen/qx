import type { SelectedFile } from "../../system";

const RECENT_FILES_KEY = "qx.fileActions.recentFiles.v1";
const LEGACY_OPERATION_HISTORY_KEY = "qx.fileActions.history.v1";
const MAX_RECENT_FILES = 5;

export type RecentFileEntry = SelectedFile & { viewedAtMs: number };

function isRecentFileEntry(value: unknown): value is RecentFileEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<RecentFileEntry>;
  return typeof entry.path === "string"
    && typeof entry.name === "string"
    && typeof entry.parent === "string"
    && typeof entry.kind === "string"
    && typeof entry.viewedAtMs === "number";
}

export function loadRecentFiles(): RecentFileEntry[] {
  try {
    // The old key contained completed operations and has intentionally
    // incompatible semantics. Remove it instead of presenting stale data.
    localStorage.removeItem(LEGACY_OPERATION_HISTORY_KEY);
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecentFileEntry).slice(0, MAX_RECENT_FILES) : [];
  } catch {
    return [];
  }
}

export function recordRecentFile(item: SelectedFile, viewedAtMs = Date.now()): RecentFileEntry[] {
  const entry: RecentFileEntry = { ...item, viewedAtMs };
  const updated = [entry, ...loadRecentFiles().filter((candidate) => candidate.path !== item.path)]
    .slice(0, MAX_RECENT_FILES);
  try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(updated)); } catch { /* Keep UI usable without storage. */ }
  return updated;
}

export function clearRecentFiles(): void {
  try { localStorage.removeItem(RECENT_FILES_KEY); } catch { /* Storage may be disabled. */ }
}
