import type { Point, Rect } from "./useCaptureAnnotations";

// Keep the picker usable for one-line text and small UI controls. The native
// capture backends still clamp to at least one physical pixel, so this is a
// logical/CSS affordance rather than an artificial screenshot limit.
export const MIN_CAPTURE_SIZE = 4;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function selectionFromLogicalArea(
  area: { x: number; y: number; w: number; h: number } | null | undefined,
): Rect | null {
  if (!area || area.w < MIN_CAPTURE_SIZE || area.h < MIN_CAPTURE_SIZE) return null;
  return { x: area.x, y: area.y, w: area.w, h: area.h };
}

export function rectFromPoints(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

export function clampRectToViewport(rect: Rect): Rect {
  const w = clamp(rect.w, MIN_CAPTURE_SIZE, window.innerWidth);
  const h = clamp(rect.h, MIN_CAPTURE_SIZE, window.innerHeight);
  return {
    x: clamp(rect.x, 0, Math.max(0, window.innerWidth - w)),
    y: clamp(rect.y, 0, Math.max(0, window.innerHeight - h)),
    w,
    h,
  };
}
