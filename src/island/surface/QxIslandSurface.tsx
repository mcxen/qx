import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  IslandChromeVariant,
  IslandPlacement,
  IslandProgressStyle,
  IslandTone,
} from "../types";

export interface QxIslandSurfaceProps {
  placement: IslandPlacement;
  tone?: IslandTone;
  variant?: IslandChromeVariant;
  progress?: number | null;
  progressStyle?: IslandProgressStyle;
  empty?: boolean;
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}

const PROGRESS_PARTICLES = Array.from({ length: 18 }, (_, index) => ({
  left: 7 + ((index * 47 + 13) % 88),
  top: 18 + ((index * 29 + 11) % 64),
  size: 1 + (index % 3),
  delay: -((index * 173) % 2600),
  duration: 2200 + ((index * 251) % 1700),
}));

function ProgressParticles({ className = "" }: { className?: string }) {
  return (
    <span className={`qx-island-progress-particles ${className}`.trim()} aria-hidden="true">
      {PROGRESS_PARTICLES.map((particle, index) => (
        <i
          key={index}
          className="qx-island-progress-particle"
          style={{
            left: `${particle.left}%`,
            top: `${particle.top}%`,
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            animationDelay: `${particle.delay}ms`,
            animationDuration: `${particle.duration}ms`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * Owns outer chrome: size, radius, glass/border (by variant), docked centering.
 * Content must not set absolute positioning or outer width/height.
 */
export default function QxIslandSurface({
  placement,
  tone = "neutral",
  variant = "shell",
  progress = null,
  progressStyle = "surface-fill",
  empty = false,
  children,
  className = "",
  "aria-label": ariaLabel,
}: QxIslandSurfaceProps) {
  const classes = [
    "qx-island-surface",
    empty ? "is-empty" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedProgress =
    typeof progress === "number" && Number.isFinite(progress)
      ? Math.max(0, Math.min(100, progress))
      : null;
  const previousProgressRef = useRef<number | null>(normalizedProgress);
  const trailProgressRef = useRef(0);
  const trailKeyRef = useRef(0);
  const [progressTrail, setProgressTrail] = useState<{
    width: number;
    key: number;
  } | null>(null);

  useEffect(() => {
    const previousProgress = previousProgressRef.current;
    previousProgressRef.current = normalizedProgress;

    if (normalizedProgress == null) {
      trailProgressRef.current = 0;
      setProgressTrail(null);
      return undefined;
    }

    if (previousProgress != null && normalizedProgress < previousProgress) {
      const trailWidth = Math.max(previousProgress, trailProgressRef.current);
      trailProgressRef.current = trailWidth;
      const key = trailKeyRef.current + 1;
      trailKeyRef.current = key;
      setProgressTrail({ width: trailWidth, key });
      const timer = window.setTimeout(() => {
        trailProgressRef.current = 0;
        setProgressTrail(null);
      }, 620);
      return () => window.clearTimeout(timer);
    }

    trailProgressRef.current = 0;
    setProgressTrail(null);
    return undefined;
  }, [normalizedProgress]);

  return (
    <div
      className={classes}
      data-placement={placement}
      data-variant={variant}
      data-tone={tone}
      data-progress-style={normalizedProgress == null ? undefined : progressStyle}
      aria-hidden={empty || undefined}
      aria-label={ariaLabel}
    >
      {normalizedProgress != null && (
        <span
          className="sr-only"
          role="progressbar"
          aria-label={`${normalizedProgress}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={normalizedProgress}
        />
      )}
      {normalizedProgress != null && progressStyle === "surface-fill" && (
        <span
          className="qx-island-progress-surface-trail"
          key={`trail-${progressTrail?.key ?? "none"}`}
          style={{ width: `${progressTrail?.width ?? 0}%` }}
          aria-hidden="true"
        >
          <ProgressParticles className="is-trail" />
        </span>
      )}
      {normalizedProgress != null && progressStyle === "surface-fill" && (
        <span
          className="qx-island-progress-surface-fill"
          style={{ width: `${normalizedProgress}%` }}
          aria-hidden="true"
        >
          <ProgressParticles />
        </span>
      )}
      {normalizedProgress != null && progressStyle === "island-ring" && (
        <svg
          className="qx-island-progress-island-ring"
          viewBox="0 0 400 34"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <rect className="is-track" x="1" y="1" width="398" height="32" rx="7" pathLength="100" />
          <rect
            className="is-value"
            x="1"
            y="1"
            width="398"
            height="32"
            rx="7"
            pathLength="100"
            style={{ strokeDasharray: `${normalizedProgress} 100` }}
          />
        </svg>
      )}
      {children}
    </div>
  );
}
