import { useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from "react";
import {
  getSearchProgressSnapshot,
  subscribeSearchProgress,
  type SearchTrackId,
  type SearchTrackState,
} from "./searchProgress";
import { useT } from "../i18n";
import type { SearchScope } from "../store";

const DOTS = 8;

const TRACK_META: Record<
  SearchTrackId,
  { labelKey: string; labelFallback: string; Icon: () => ReactElement }
> = {
  apps: {
    labelKey: "launcher.scope.apps",
    labelFallback: "Apps",
    Icon: IconApps,
  },
  files: {
    labelKey: "launcher.scope.files",
    labelFallback: "Files",
    Icon: IconFiles,
  },
  clipboard: {
    labelKey: "launcher.scope.clipboard",
    labelFallback: "Clipboard",
    Icon: IconClipboard,
  },
};

export interface SearchProgressIslandProps {
  /** Fallback when bus not yet published (prop-driven path). */
  query?: string;
  scope?: SearchScope;
  isSearching?: boolean;
  isSearchSettling?: boolean;
  /** Hit counts from current results (optional enrichment). */
  hits?: Partial<Record<SearchTrackId, number>>;
}

/**
 * Launcher Dynamic Island while searching:
 * multi-source scan rail with icons, 8-dot matrix progress, and L↔R sweep.
 */
export default function SearchProgressIsland({
  query: queryProp = "",
  isSearching = false,
  isSearchSettling = false,
  hits,
}: SearchProgressIslandProps) {
  const t = useT();
  const snap = useSyncExternalStore(
    subscribeSearchProgress,
    getSearchProgressSnapshot,
    getSearchProgressSnapshot,
  );

  const phase =
    snap.phase !== "idle"
      ? snap.phase
      : isSearchSettling
        ? "settling"
        : isSearching
          ? "searching"
          : "idle";

  const query = (snap.query || queryProp).trim();
  const tracks = useMemo(() => {
    const base =
      snap.tracks.length > 0
        ? snap.tracks
        : ([
            { id: "apps" as const, status: "running" as const },
            { id: "files" as const, status: "pending" as const },
            { id: "clipboard" as const, status: "pending" as const },
          ] satisfies SearchTrackState[]);
    return base
      .filter((track) => track.status !== "skipped")
      .map((track) => ({
        ...track,
        hits: hits?.[track.id] ?? track.hits,
      }));
  }, [snap.tracks, hits]);

  // Continuous 0–1 phase for sweep + per-track fill while running.
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (phase === "idle") return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setClock((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, snap.seq]);

  // Triangle wave 0→1→0 for left-right sweep.
  const sweep = triangleWave(clock * 0.55);

  return (
    <div
      className={`qx-search-scan-island${phase === "settling" ? " is-settling" : ""}${
        phase === "searching" ? " is-searching" : ""
      }`}
      aria-label={t("launcher.searching", "Searching")}
      role="status"
    >
      <span className="qx-search-scan-tag">
        <i className="qx-search-scan-beacon" aria-hidden="true" />
        {t("launcher.scan.tag", "SCAN")}
      </span>

      <div className="qx-search-scan-rail" aria-hidden={tracks.length === 0}>
        <div
          className="qx-search-scan-sweep"
          style={{ ["--qx-scan-x" as string]: `${sweep * 100}%` }}
        />
        {tracks.map((track) => {
          const meta = TRACK_META[track.id];
          const fill = trackFill(track, clock, phase);
          return (
            <div
              key={track.id}
              className={`qx-search-scan-track is-${track.status}${
                track.status === "running" ? " is-live" : ""
              }`}
              title={meta ? t(meta.labelKey, meta.labelFallback) : track.id}
            >
              <span className="qx-search-scan-icon" aria-hidden="true">
                {meta ? <meta.Icon /> : null}
              </span>
              <span className="qx-search-scan-dots" data-fill={Math.round(fill * DOTS)}>
                {Array.from({ length: DOTS }, (_, i) => {
                  const on = i < fill * DOTS - 0.001;
                  const head =
                    track.status === "running" &&
                    Math.abs(i + 0.5 - fill * DOTS) < 0.85;
                  return (
                    <i
                      key={i}
                      className={`qx-search-scan-dot${on ? " is-on" : ""}${
                        head ? " is-head" : ""
                      }`}
                    />
                  );
                })}
              </span>
              {typeof track.hits === "number" && track.status === "done" && track.hits > 0 && (
                <span className="qx-search-scan-hits">{track.hits > 99 ? "99+" : track.hits}</span>
              )}
            </div>
          );
        })}
      </div>

      {query ? (
        <span className="qx-search-scan-query" title={query}>
          {query}
        </span>
      ) : null}
    </div>
  );
}

function triangleWave(t: number): number {
  const x = t % 2;
  return x < 1 ? x : 2 - x;
}

/** 0–1 fill for the dot matrix. */
function trackFill(
  track: SearchTrackState,
  clock: number,
  phase: string,
): number {
  if (track.status === "done" || phase === "settling") return 1;
  if (track.status === "pending" || track.status === "skipped") return 0;
  // Running: ease toward ~0.72 then pulse so it never looks “stuck finished”.
  const base = 0.18 + 0.55 * (0.5 + 0.5 * Math.sin(clock * 2.1));
  const crawl = Math.min(0.85, (clock % 2.4) / 2.4);
  return Math.max(base * 0.35, crawl);
}

function IconApps() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconFiles() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
      <path
        d="M4 2.5h5.2L12.5 6v7.5A1 1 0 0 1 11.5 14.5h-7A1 1 0 0 1 3.5 13.5v-10A1 1 0 0 1 4 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M9 2.5V6h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}

function IconClipboard() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="9" height="11" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M6 3.5V2.8A1.3 1.3 0 0 1 7.3 1.5h1.4A1.3 1.3 0 0 1 10 2.8v.7"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M6 7.5h4M6 10h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
