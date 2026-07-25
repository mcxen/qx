import type { ReactNode } from "react";
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
          className="qx-island-progress-surface-fill"
          style={{ width: `${normalizedProgress}%` }}
          aria-hidden="true"
        />
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
