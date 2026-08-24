import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "../../i18n";
import type { CaptureTool } from "./CaptureToolbar";
import type { Rect } from "./useCaptureAnnotations";
import { resolveCaptureHintPosition } from "./captureHintPosition";

interface CapturePickerFeedbackProps {
  rect: Rect | null;
  selection: Rect | null;
  display: string;
  tool: CaptureTool;
  busy: boolean;
  recordingActive: boolean;
  countdown: number | null;
  error: string | null;
}

function AdaptiveCaptureHint({ selection, children }: {
  selection: Rect | null;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => ({
    width: Math.min(560, Math.max(0, window.innerWidth - 32)),
    height: 36,
  }));
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const bounds = element.getBoundingClientRect();
      setSize({ width: bounds.width, height: bounds.height });
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [children]);

  const position = resolveCaptureHintPosition(selection, size, viewport);
  return (
    <div
      ref={ref}
      className="qx-region-picker-hint"
      style={{
        left: position?.left ?? 16,
        top: position?.top ?? 16,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {children}
    </div>
  );
}

/** Selection size, adaptive instruction hint, countdown, and local errors. */
export function CapturePickerFeedback({
  rect,
  selection,
  display,
  tool,
  busy,
  recordingActive,
  countdown,
  error,
}: CapturePickerFeedbackProps) {
  const t = useT();
  let hint: ReactNode = null;
  if (!rect && !busy && !recordingActive && countdown === null) {
    hint = t(
      "screencap.picker.draw",
      "Drag on {display} · Ctrl/⌘+C copies · R last region · Esc cancel",
    ).replace("{display}", display);
  } else if (selection && !tool && !recordingActive && countdown === null) {
    hint = t(
      "screencap.picker.selectionHint",
      "⌘/Ctrl+C copy & dismiss · Enter confirm · Esc clear",
    );
  } else if (selection && tool && countdown === null) {
    hint = tool === "text"
      ? t(
        "screencap.picker.textHint",
        "Click to place text · Enter finish · drag to move · corners resize · small fonts auto-zoom while typing",
      )
      : tool === "arrow"
        ? t("screencap.picker.arrowHint", "Drag inside the selection to draw an arrow")
        : tool === "rect"
          ? t("screencap.picker.rectHint", "Drag inside the selection to draw a rectangle")
          : tool === "number"
            ? t("screencap.picker.numberHint", "Click to place numbered step markers")
            : tool === "mosaic"
              ? t(
                "screencap.picker.mosaicHint",
                "Drag a rectangle to pixelate · hold Shift and drag for a brush stroke",
              )
              : t("screencap.picker.penHint", "Drag inside the selection to draw freehand");
  }

  return (
    <>
      {rect && !recordingActive && countdown === null && (
        <div className="qx-region-picker-size" style={{ left: rect.x, top: Math.max(8, rect.y - 28) }}>
          {Math.round(rect.w)} × {Math.round(rect.h)}
        </div>
      )}
      {hint && <AdaptiveCaptureHint selection={selection}>{hint}</AdaptiveCaptureHint>}
      {countdown !== null && (
        <div className="qx-region-picker-countdown" aria-live="assertive">
          <strong>{countdown}</strong>
          <span>{t("screencap.picker.countdown", "Capturing… Esc to cancel")}</span>
        </div>
      )}
      {error && !recordingActive && countdown === null && (
        <div className="qx-region-picker-error">{error}</div>
      )}
    </>
  );
}
