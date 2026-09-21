export interface SplitBounds { min: number; max: number; collapseAt?: number }

export function constrainSplitWidth(value: number, bounds: SplitBounds): number {
  if (bounds.collapseAt != null && value < bounds.collapseAt) return 0;
  return Math.round(Math.max(bounds.min, Math.min(bounds.max, value)));
}

export function splitBounds(total: number, min: number, otherMin: number, max = Infinity, collapseAt?: number): SplitBounds {
  return { min, max: Math.max(min, Math.min(max, total - otherMin - 8)), collapseAt };
}

export function splitKeyWidth(key: string, current: number, step: number, side: "left" | "right", bounds: SplitBounds): number | null {
  if (key === "Home") return side === "right" ? bounds.max : bounds.min;
  if (key === "End") return side === "right" && bounds.collapseAt != null ? 0 : bounds.max;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return null;
  const delta = (key === "ArrowLeft" ? -step : step) * (side === "right" ? -1 : 1);
  if (current === 0 && delta > 0 && bounds.collapseAt != null) return bounds.min;
  if (delta < 0 && bounds.collapseAt != null && current + delta < bounds.min) return 0;
  return constrainSplitWidth(current + delta, bounds);
}
