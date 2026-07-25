export interface CaptureToolbarRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CaptureToolbarSize {
  width: number;
  height: number;
}

export interface CaptureToolbarViewport {
  width: number;
  height: number;
}

export interface CaptureToolbarPosition {
  left: number;
  top: number;
}

const VIEWPORT_MARGIN = 10;
const SELECTION_GAP = 10;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Keep the measured capture toolbar inside its picker-display viewport. */
export function resolveCaptureToolbarPosition(
  selection: CaptureToolbarRect,
  toolbar: CaptureToolbarSize,
  viewport: CaptureToolbarViewport,
): CaptureToolbarPosition {
  const availableWidth = Math.max(0, viewport.width - VIEWPORT_MARGIN * 2);
  const width = Math.min(Math.max(0, toolbar.width), availableWidth);
  const height = Math.min(
    Math.max(34, toolbar.height),
    Math.max(34, viewport.height - VIEWPORT_MARGIN * 2),
  );
  const halfWidth = width / 2;
  const minCenter = VIEWPORT_MARGIN + halfWidth;
  const maxCenter = Math.max(minCenter, viewport.width - VIEWPORT_MARGIN - halfWidth);
  const left = clamp(selection.x + selection.w / 2, minCenter, maxCenter);

  const below = selection.y + selection.h + SELECTION_GAP;
  const above = selection.y - height - SELECTION_GAP;
  const top = below + height <= viewport.height - VIEWPORT_MARGIN
    ? below
    : above >= VIEWPORT_MARGIN
      ? above
      : clamp(
        below,
        VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, viewport.height - VIEWPORT_MARGIN - height),
      );

  return { left, top };
}
