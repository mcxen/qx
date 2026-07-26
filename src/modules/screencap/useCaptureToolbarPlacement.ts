import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  clampCaptureToolbarPosition,
  resolveCaptureToolbarPosition,
} from "./captureToolbarPosition";
import type { CaptureMode } from "./store";
import type { Rect } from "./useCaptureAnnotations";

const FULLSCREEN_BOTTOM_INSET = 56;

interface ToolbarPoint {
  left: number;
  top: number;
}

interface ToolbarDrag {
  pointerId: number;
  startX: number;
  startY: number;
  origin: ToolbarPoint;
}

function clampToolbarPoint(
  point: ToolbarPoint,
  toolbar: { width: number; height: number },
): ToolbarPoint {
  return clampCaptureToolbarPosition(
    point,
    toolbar,
    { width: window.innerWidth, height: window.innerHeight },
  );
}

/** Measures, places, and bounds the protected capture toolbar inside one display. */
export function useCaptureToolbarPlacement({
  selection,
  fullscreen,
  intent,
}: {
  selection: Rect | null;
  fullscreen: boolean;
  intent: CaptureMode;
}): {
  toolbarRef: RefObject<HTMLDivElement | null>;
  toolbarStyle: CSSProperties;
  onToolbarPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToolbarPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToolbarPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
} {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarSize, setToolbarSize] = useState({ width: 760, height: 46 });
  const [fullscreenPosition, setFullscreenPosition] = useState<ToolbarPoint | null>(null);
  const dragRef = useRef<ToolbarDrag | null>(null);

  useEffect(() => {
    if (!fullscreen) {
      dragRef.current = null;
      setFullscreenPosition(null);
    }
  }, [fullscreen]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || !selection) return;
    const measure = () => {
      const bounds = toolbar.getBoundingClientRect();
      const next = { width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) };
      setToolbarSize((current) => current.width === next.width && current.height === next.height
        ? current
        : next);
      setFullscreenPosition((current) => current ? clampToolbarPoint(current, next) : current);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [intent, selection]);

  const defaultFullscreenPosition = clampToolbarPoint({
    left: window.innerWidth / 2,
    top: window.innerHeight - toolbarSize.height - FULLSCREEN_BOTTOM_INSET,
  }, toolbarSize);
  const regionPosition = selection
    ? resolveCaptureToolbarPosition(
      selection,
      toolbarSize,
      { width: window.innerWidth, height: window.innerHeight },
    )
    : null;
  const position = fullscreen
    ? (fullscreenPosition ?? defaultFullscreenPosition)
    : regionPosition;

  const onToolbarPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!fullscreen || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, [contenteditable='true'], [role='dialog']")) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { left: bounds.left + bounds.width / 2, top: bounds.top },
    };
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [fullscreen]);

  const onToolbarPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setFullscreenPosition(clampToolbarPoint({
      left: drag.origin.left + event.clientX - drag.startX,
      top: drag.origin.top + event.clientY - drag.startY,
    }, toolbarSize));
  }, [toolbarSize]);

  const onToolbarPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  return {
    toolbarRef,
    toolbarStyle: { left: position?.left, top: position?.top },
    onToolbarPointerDown,
    onToolbarPointerMove,
    onToolbarPointerUp,
  };
}
