/**
 * Lightweight bus for launcher search-island progress.
 * App.tsx publishes phase updates; SearchProgressIsland subscribes.
 */

export type SearchTrackId = "apps" | "files" | "clipboard";

export type SearchTrackStatus = "skipped" | "pending" | "running" | "done";

export type SearchIslandPhase = "idle" | "searching" | "settling";

export interface SearchTrackState {
  id: SearchTrackId;
  status: SearchTrackStatus;
  /** Optional hit count once known */
  hits?: number;
}

export interface SearchProgressSnapshot {
  phase: SearchIslandPhase;
  query: string;
  seq: number;
  tracks: SearchTrackState[];
  updatedAt: number;
}

const LISTENERS = new Set<() => void>();

let snapshot: SearchProgressSnapshot = {
  phase: "idle",
  query: "",
  seq: 0,
  tracks: [],
  updatedAt: 0,
};

function emit() {
  for (const listener of LISTENERS) listener();
}

export function getSearchProgressSnapshot(): SearchProgressSnapshot {
  return snapshot;
}

export function subscribeSearchProgress(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}

export function publishSearchProgress(next: Partial<SearchProgressSnapshot> & {
  phase: SearchIslandPhase;
}): void {
  snapshot = {
    ...snapshot,
    ...next,
    tracks: next.tracks ?? snapshot.tracks,
    updatedAt: Date.now(),
  };
  emit();
}

export function resetSearchProgress(): void {
  snapshot = {
    phase: "idle",
    query: "",
    seq: 0,
    tracks: [],
    updatedAt: Date.now(),
  };
  emit();
}

/** Build initial track list for a search request. */
export function buildSearchTracks(
  scope: "all" | "apps" | "files" | "clipboard",
  query: string,
): SearchTrackState[] {
  const trimmed = query.trim();
  const shouldApps = scope === "all" || scope === "apps";
  const shouldFiles =
    (scope === "files" && trimmed.length >= 2) || (scope === "all" && trimmed.length >= 3);
  const shouldClipboard = (scope === "all" || scope === "clipboard") && trimmed.length > 0;

  const tracks: SearchTrackState[] = [];
  if (shouldApps) {
    tracks.push({ id: "apps", status: "running" });
  } else {
    tracks.push({ id: "apps", status: "skipped" });
  }
  tracks.push({
    id: "files",
    status: shouldFiles ? (shouldApps ? "pending" : "running") : "skipped",
  });
  tracks.push({
    id: "clipboard",
    status: shouldClipboard
      ? shouldApps || shouldFiles
        ? "pending"
        : "running"
      : "skipped",
  });
  return tracks;
}

export function patchSearchTracks(
  patch: Partial<Record<SearchTrackId, Partial<SearchTrackState>>>,
  extras?: Partial<Pick<SearchProgressSnapshot, "phase" | "query" | "seq">>,
): void {
  const tracks = snapshot.tracks.map((track) => {
    const update = patch[track.id];
    return update ? { ...track, ...update, id: track.id } : track;
  });
  publishSearchProgress({
    phase: extras?.phase ?? snapshot.phase,
    query: extras?.query ?? snapshot.query,
    seq: extras?.seq ?? snapshot.seq,
    tracks,
  });
}
