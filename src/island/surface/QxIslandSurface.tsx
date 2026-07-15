import type { ReactNode } from "react";
import type {
  IslandChromeVariant,
  IslandPlacement,
  IslandTone,
} from "../types";

export interface QxIslandSurfaceProps {
  placement: IslandPlacement;
  tone?: IslandTone;
  variant?: IslandChromeVariant;
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

  return (
    <div
      className={classes}
      data-placement={placement}
      data-variant={variant}
      data-tone={tone}
      aria-hidden={empty || undefined}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}
