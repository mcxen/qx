export interface CaptureHintRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CaptureHintSize {
  width: number;
  height: number;
}

export interface CaptureHintViewport {
  width: number;
  height: number;
}

export interface CaptureHintPosition {
  left: number;
  top: number;
}

const HINT_MARGIN = 16;
const SELECTION_GAP = 10;

function intersectsSelection(
  position: CaptureHintPosition,
  size: CaptureHintSize,
  selection: CaptureHintRect,
): boolean {
  return position.left < selection.x + selection.w + SELECTION_GAP
    && position.left + size.width > selection.x - SELECTION_GAP
    && position.top < selection.y + selection.h + SELECTION_GAP
    && position.top + size.height > selection.y - SELECTION_GAP;
}

/** Pick a screen edge position that never obscures the active capture area. */
export function resolveCaptureHintPosition(
  selection: CaptureHintRect | null,
  size: CaptureHintSize,
  viewport: CaptureHintViewport,
): CaptureHintPosition | null {
  const maxLeft = viewport.width - size.width - HINT_MARGIN;
  const maxTop = viewport.height - size.height - HINT_MARGIN;
  if (maxLeft < HINT_MARGIN || maxTop < HINT_MARGIN) return null;

  const centerLeft = Math.round((viewport.width - size.width) / 2);
  const centerTop = Math.round((viewport.height - size.height) / 2);
  const candidates: CaptureHintPosition[] = [
    { left: HINT_MARGIN, top: maxTop },
    { left: maxLeft, top: maxTop },
    { left: HINT_MARGIN, top: HINT_MARGIN },
    { left: maxLeft, top: HINT_MARGIN },
    { left: HINT_MARGIN, top: centerTop },
    { left: maxLeft, top: centerTop },
    { left: centerLeft, top: maxTop },
    { left: centerLeft, top: HINT_MARGIN },
  ];
  if (!selection) return candidates[0];
  return candidates.find((candidate) => (
    !intersectsSelection(candidate, size, selection)
  )) ?? null;
}
