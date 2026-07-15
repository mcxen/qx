import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
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
  { labelKey: string; labelFallback: string; verbKey: string; verbFallback: string; Icon: () => ReactElement }
> = {
  apps: {
    labelKey: "launcher.scope.apps",
    labelFallback: "Apps",
    verbKey: "launcher.scan.step.apps",
    verbFallback: "Searching apps",
    Icon: IconApps,
  },
  files: {
    labelKey: "launcher.scope.files",
    labelFallback: "Files",
    verbKey: "launcher.scan.step.files",
    verbFallback: "Searching files",
    Icon: IconFiles,
  },
  clipboard: {
    labelKey: "launcher.scope.clipboard",
    labelFallback: "Clipboard",
    verbKey: "launcher.scan.step.clipboard",
    verbFallback: "Searching clipboard",
    Icon: IconClipboard,
  },
};

export interface SearchProgressIslandProps {
  query?: string;
  scope?: SearchScope;
  isSearching?: boolean;
  isSearchSettling?: boolean;
  hits?: Partial<Record<SearchTrackId, number>>;
}

/**
 * Step-by-step search island: one track at a time, vertical flip to the next
 * stage when the pipeline advances (apps → files → clipboard).
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

  const stepIndex = resolveActiveStep(tracks, phase);
  const [displayIndex, setDisplayIndex] = useState(stepIndex);
  const [slideDir, setSlideDir] = useState<"up" | "down">("up");
  const prevIndexRef = useRef(stepIndex);

  // Vertical step change: old exits up, new enters from below (or reverse).
  useEffect(() => {
    if (stepIndex === prevIndexRef.current) return;
    setSlideDir(stepIndex > prevIndexRef.current ? "up" : "down");
    prevIndexRef.current = stepIndex;
    setDisplayIndex(stepIndex);
  }, [stepIndex]);

  // Keep displayIndex in range when track list shrinks.
  useEffect(() => {
    if (tracks.length === 0) return;
    setDisplayIndex((i) => Math.min(i, tracks.length - 1));
  }, [tracks.length]);

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
  }, [phase, snap.seq, displayIndex]);

  const active = tracks[displayIndex] ?? tracks[0];
  const total = Math.max(1, tracks.length);

  return (
    <div
      className={`qx-search-scan-island is-stepper${phase === "settling" ? " is-settling" : ""}${
        phase === "searching" ? " is-searching" : ""
      }`}
      aria-label={t("launcher.searching", "Searching")}
      role="status"
      data-step={displayIndex + 1}
      data-steps={total}
      data-slide={slideDir}
    >
      <span className="qx-search-scan-tag">
        <i className="qx-search-scan-beacon" aria-hidden="true" />
        {t("launcher.scan.tag", "SCAN")}
      </span>

      {/* Pipeline step indicators (vertical) */}
      <div className="qx-search-scan-steps" aria-hidden="true">
        {tracks.map((track, i) => (
          <i
            key={track.id}
            className={`qx-search-scan-step-dot${
              i === displayIndex ? " is-current" : ""
            }${track.status === "done" ? " is-done" : ""}${
              track.status === "running" ? " is-live" : ""
            }`}
          />
        ))}
      </div>

      <div className="qx-search-scan-viewport">
        <div
          className={`qx-search-scan-reel is-dir-${slideDir}`}
          style={{ transform: `translateY(${-displayIndex * 100}%)` }}
        >
          {tracks.map((track, trackIndex) => {
            const meta = TRACK_META[track.id];
            const fill = trackFill(track, clock, phase, track.id === active?.id);
            const label = meta
              ? track.status === "done"
                ? t(meta.labelKey, meta.labelFallback)
                : t(meta.verbKey, meta.verbFallback)
              : track.id;
            return (
              <div
                key={track.id}
                className={`qx-search-scan-step is-${track.status}${
                  track.status === "running" ? " is-live" : ""
                }`}
              >
                <span className="qx-search-scan-icon" aria-hidden="true">
                  {meta ? <meta.Icon /> : null}
                </span>
                <span className="qx-search-scan-step-body">
                  <span className="qx-search-scan-step-label">{label}</span>
                  <span className="qx-search-scan-dots" data-fill={Math.round(fill * DOTS)}>
                    {Array.from({ length: DOTS }, (_, i) => {
                      const on = i < fill * DOTS - 0.001;
                      const head =
                        track.status === "running" &&
                        track.id === active?.id &&
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
                </span>
                {typeof track.hits === "number" && track.status === "done" ? (
                  <span className="qx-search-scan-hits">
                    {track.hits > 99 ? "99+" : track.hits}
                  </span>
                ) : (
                  <span className="qx-search-scan-step-index">
                    {trackIndex + 1}/{total}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {/* Horizontal crawl only on the active step bar */}
        {active?.status === "running" && (
          <div className="qx-search-scan-bar">
            <span style={{ width: `${Math.max(12, trackFill(active, clock, phase, true) * 100)}%` }} />
          </div>
        )}
      </div>

      {query ? (
        <span className="qx-search-scan-query" title={query}>
          {query}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Show the pipeline stage we are *on*:
 * running → first pending (next up) → last done (settling) → 0.
 */
function resolveActiveStep(tracks: SearchTrackState[], phase: string): number {
  if (tracks.length === 0) return 0;
  if (phase === "settling") return tracks.length - 1;

  const running = tracks.findIndex((t) => t.status === "running");
  if (running >= 0) return running;

  const pending = tracks.findIndex((t) => t.status === "pending");
  if (pending >= 0) return pending;

  for (let i = tracks.length - 1; i >= 0; i--) {
    if (tracks[i].status === "done") return i;
  }
  return 0;
}

function trackFill(
  track: SearchTrackState,
  clock: number,
  phase: string,
  isActive: boolean,
): number {
  if (track.status === "done" || phase === "settling") return 1;
  if (track.status === "pending" || track.status === "skipped") return 0;
  if (!isActive) return 0.15;
  const crawl = Math.min(0.88, (clock % 2.2) / 2.2);
  const pulse = 0.12 + 0.08 * (0.5 + 0.5 * Math.sin(clock * 3.2));
  return Math.max(pulse, crawl);
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
