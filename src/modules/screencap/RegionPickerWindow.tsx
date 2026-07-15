import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Camera, Circle, Maximize, Monitor, MoveUpRight, Type, X } from "lucide-react";
import { useT } from "../../i18n";
import { loadRecordingOptions, loadScreenshotAfterCapture } from "./preferences";
import type { CaptureMode, RecordingSnapshot } from "./store";

interface PickerStatus {
  mode: CaptureMode;
  monitorId: number;
  monitorName: string;
}

interface CaptureDisplay {
  id: number;
  name: string;
  width: number;
  height: number;
  isPrimary: boolean;
  isBuiltin: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface Rect extends Point {
  w: number;
  h: number;
}

type ResizeHandle = "nw" | "ne" | "sw" | "se";
type Tool = "text" | "arrow" | null;
type Annotation =
  | { type: "text"; x: number; y: number; text: string }
  | { type: "arrow"; x1: number; y1: number; x2: number; y2: number };

interface RectInteraction {
  kind: "move" | "resize";
  start: Point;
  origin: Rect;
  handle?: ResizeHandle;
}

const MIN_SIZE = 32;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rectFromPoints(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

function drawArrow(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 12;
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.moveTo(x2, y2);
  context.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  context.moveTo(x2, y2);
  context.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  context.stroke();
}

/** Full-display protected overlay: draw, refine, annotate, then capture. */
export default function RegionPickerWindow() {
  const t = useT();
  const [picker, setPicker] = useState<PickerStatus | null>(null);
  const [displays, setDisplays] = useState<CaptureDisplay[]>([]);
  const [recording, setRecording] = useState<RecordingSnapshot | null>(null);
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [drawEnd, setDrawEnd] = useState<Point | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [interaction, setInteraction] = useState<RectInteraction | null>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [arrowStart, setArrowStart] = useState<Point | null>(null);
  const [textDraft, setTextDraft] = useState<{ point: Point; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    document.body.classList.add("qx-region-picker-body");
    rootRef.current?.focus();
    void Promise.all([
      invoke<PickerStatus | null>("screencap_region_select_status"),
      invoke<CaptureDisplay[]>("screencap_list_displays"),
      invoke<RecordingSnapshot>("recording_status"),
    ]).then(([status, availableDisplays, snapshot]) => {
      setPicker(status);
      setDisplays(availableDisplays);
      setRecording(snapshot);
    }).catch(() => {});
    const pickerListener = listen<PickerStatus>("screencap:picker", (event) => {
      setPicker(event.payload);
      setSelection(null);
      setDrawStart(null);
      setDrawEnd(null);
      setAnnotations([]);
      setBusy(false);
      setError(null);
    });
    const stateListener = listen<RecordingSnapshot>("screencap:state", (event) => {
      setRecording(event.payload);
      if (event.payload.phase !== "recording" && event.payload.phase !== "processing") {
        setBusy(false);
      }
      setError(event.payload.error);
    });
    return () => {
      document.body.classList.remove("qx-region-picker-body");
      void pickerListener.then((dispose) => dispose());
      void stateListener.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selection) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(selection.w * ratio));
    canvas.height = Math.max(1, Math.round(selection.h * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 3;
    context.strokeStyle = "#ff3b30";
    context.fillStyle = "#ff3b30";
    for (const annotation of annotations) {
      if (annotation.type === "arrow") {
        drawArrow(
          context,
          annotation.x1 * selection.w,
          annotation.y1 * selection.h,
          annotation.x2 * selection.w,
          annotation.y2 * selection.h,
        );
      } else {
        const x = annotation.x * selection.w;
        const y = annotation.y * selection.h;
        context.font = "600 18px -apple-system, BlinkMacSystemFont, sans-serif";
        context.lineWidth = 4;
        context.strokeStyle = "rgba(255,255,255,.9)";
        context.strokeText(annotation.text, x, y);
        context.fillStyle = "#ff3b30";
        context.fillText(annotation.text, x, y);
        context.lineWidth = 3;
        context.strokeStyle = "#ff3b30";
      }
    }
  }, [annotations, selection]);

  const cancel = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    await invoke("screencap_cancel_region_select").catch(() => {});
  }, [busy]);

  const confirm = useCallback(async (action: CaptureMode) => {
    if (busy || !selection) return;
    setBusy(true);
    const canvas = canvasRef.current;
    const annotationOverlayBase64 = action === "screenshot" && annotations.length > 0 && canvas
      ? canvas.toDataURL("image/png").split(",")[1]
      : undefined;
    try {
      await invoke("screencap_confirm_region_select", {
        area: {
          x: Math.round(selection.x),
          y: Math.round(selection.y),
          w: Math.round(selection.w),
          h: Math.round(selection.h),
        },
        options: loadRecordingOptions(),
        action,
        annotationOverlayBase64,
        copyToClipboard: action === "screenshot" && loadScreenshotAfterCapture() === "copy",
      });
    } catch (captureError) {
      setBusy(false);
      setError(String(captureError));
    }
  }, [annotations.length, busy, selection]);

  const selectDisplay = useCallback(async (monitorId: number) => {
    if (busy || monitorId === picker?.monitorId) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("screencap_select_display", { monitorId });
    } catch (displayError) {
      setBusy(false);
      setError(String(displayError));
    }
  }, [busy, picker?.monitorId]);

  const selectFullScreen = useCallback(() => {
    if (busy) return;
    setSelection({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
    setDrawStart(null);
    setDrawEnd(null);
    setAnnotations([]);
    setError(null);
  }, [busy]);

  const beginResize = (event: React.MouseEvent, handle: ResizeHandle) => {
    if (!selection || busy) return;
    event.preventDefault();
    event.stopPropagation();
    setInteraction({
      kind: "resize",
      handle,
      start: { x: event.clientX, y: event.clientY },
      origin: selection,
    });
  };

  const onRootMouseDown = (event: React.MouseEvent) => {
    if (busy || event.button !== 0 || selection) return;
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    setDrawStart(point);
    setDrawEnd(point);
  };

  const onSelectionMouseDown = (event: React.MouseEvent) => {
    if (!selection || tool || busy || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setInteraction({
      kind: "move",
      start: { x: event.clientX, y: event.clientY },
      origin: selection,
    });
  };

  const onRootMouseMove = (event: React.MouseEvent) => {
    if (drawStart && !selection) {
      setDrawEnd({ x: event.clientX, y: event.clientY });
      return;
    }
    if (!interaction) return;
    const dx = event.clientX - interaction.start.x;
    const dy = event.clientY - interaction.start.y;
    const origin = interaction.origin;
    if (interaction.kind === "move") {
      setSelection({
        ...origin,
        x: clamp(origin.x + dx, 0, window.innerWidth - origin.w),
        y: clamp(origin.y + dy, 0, window.innerHeight - origin.h),
      });
      return;
    }
    let left = origin.x;
    let top = origin.y;
    let right = origin.x + origin.w;
    let bottom = origin.y + origin.h;
    if (interaction.handle?.includes("w")) left = clamp(origin.x + dx, 0, right - MIN_SIZE);
    if (interaction.handle?.includes("e")) right = clamp(origin.x + origin.w + dx, left + MIN_SIZE, window.innerWidth);
    if (interaction.handle?.includes("n")) top = clamp(origin.y + dy, 0, bottom - MIN_SIZE);
    if (interaction.handle?.includes("s")) bottom = clamp(origin.y + origin.h + dy, top + MIN_SIZE, window.innerHeight);
    setSelection({ x: left, y: top, w: right - left, h: bottom - top });
  };

  const onRootMouseUp = () => {
    if (drawStart && drawEnd && !selection) {
      const next = rectFromPoints(drawStart, drawEnd);
      setDrawStart(null);
      setDrawEnd(null);
      if (next.w >= MIN_SIZE && next.h >= MIN_SIZE) setSelection(next);
      return;
    }
    setInteraction(null);
  };

  const canvasPoint = (event: React.MouseEvent<HTMLCanvasElement>): Point | null => {
    if (!selection) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(event.clientX - bounds.left, 0, selection.w),
      y: clamp(event.clientY - bounds.top, 0, selection.h),
    };
  };

  const onCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selection || !tool) return;
    event.preventDefault();
    event.stopPropagation();
    const point = canvasPoint(event);
    if (!point) return;
    if (tool === "text") {
      setTextDraft({ point, text: "" });
      setTool(null);
    } else {
      setArrowStart(point);
    }
  };

  const commitTextDraft = () => {
    if (!selection || !textDraft) return;
    const text = textDraft.text.trim();
    if (text) {
      setAnnotations((current) => [...current, {
        type: "text",
        x: textDraft.point.x / selection.w,
        y: textDraft.point.y / selection.h,
        text,
      }]);
    }
    setTextDraft(null);
  };

  const onCanvasMouseUp = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selection || tool !== "arrow" || !arrowStart) return;
    event.preventDefault();
    event.stopPropagation();
    const end = canvasPoint(event);
    if (end && Math.hypot(end.x - arrowStart.x, end.y - arrowStart.y) > 8) {
      setAnnotations((current) => [...current, {
        type: "arrow",
        x1: arrowStart.x / selection.w,
        y1: arrowStart.y / selection.h,
        x2: end.x / selection.w,
        y2: end.y / selection.h,
      }]);
    }
    setArrowStart(null);
    setTool(null);
  };

  const draft = drawStart && drawEnd ? rectFromPoints(drawStart, drawEnd) : null;
  const rect = selection ?? draft;
  const display = picker?.monitorName ?? t("screencap.display", "display");
  const recordingActive = recording?.phase === "recording" || recording?.phase === "processing";
  const visibleRect = recordingActive && rect
    ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
    : rect;

  return (
    <div
      ref={rootRef}
      className="qx-region-picker"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (tool) setTool(null);
          else void cancel();
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          setAnnotations((current) => current.slice(0, -1));
        }
      }}
      onMouseDown={onRootMouseDown}
      onMouseMove={onRootMouseMove}
      onMouseUp={onRootMouseUp}
    >
      {!recordingActive && (
        <div className="qx-region-picker-displaybar" onMouseDown={(event) => event.stopPropagation()}>
          {displays.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === picker?.monitorId ? "is-active" : ""}
              disabled={busy}
              onClick={() => void selectDisplay(item.id)}
            >
              <Monitor size={13} aria-hidden="true" />
              <span>{item.isBuiltin
                ? t("screencap.display.builtin", "Built-in Display")
                : `${t("screencap.display.external", "External Display")} · ${item.name}`}</span>
              {item.isPrimary && <small>{t("screencap.display.primary", "Primary")}</small>}
            </button>
          ))}
          <span />
          <button type="button" disabled={busy} onClick={selectFullScreen}>
            <Maximize size={13} aria-hidden="true" />
            {t("screencap.fullscreen", "Full Screen")}
          </button>
        </div>
      )}

      {visibleRect && (
        <>
          {!recordingActive && <>
            <div className="qx-region-picker-shade" style={{ left: 0, top: 0, right: 0, height: visibleRect.y }} />
            <div className="qx-region-picker-shade" style={{ left: 0, top: visibleRect.y + visibleRect.h, right: 0, bottom: 0 }} />
            <div className="qx-region-picker-shade" style={{ left: 0, top: visibleRect.y, width: visibleRect.x, height: visibleRect.h }} />
            <div className="qx-region-picker-shade" style={{ left: visibleRect.x + visibleRect.w, top: visibleRect.y, right: 0, height: visibleRect.h }} />
          </>}
          <div
            className={`qx-region-picker-rect${selection ? " is-selected" : ""}${tool ? ` is-tool-${tool}` : ""}${recordingActive ? " is-recording" : ""}`}
            style={{ left: visibleRect.x, top: visibleRect.y, width: visibleRect.w, height: visibleRect.h }}
            onMouseDown={onSelectionMouseDown}
          >
            {selection && !recordingActive && (
              <>
                <canvas
                  ref={canvasRef}
                  className="qx-region-picker-annotations"
                  onMouseDown={onCanvasMouseDown}
                  onMouseUp={onCanvasMouseUp}
                />
                {textDraft && (
                  <input
                    autoFocus
                    className="qx-region-picker-text-input"
                    value={textDraft.text}
                    placeholder={t("screencap.picker.textPrompt", "Enter annotation text")}
                    style={{
                      left: clamp(textDraft.point.x, 4, Math.max(4, selection.w - 184)),
                      top: clamp(textDraft.point.y - 22, 4, Math.max(4, selection.h - 32)),
                    }}
                    onChange={(event) => setTextDraft({ ...textDraft, text: event.target.value })}
                    onMouseDown={(event) => event.stopPropagation()}
                    onBlur={() => setTextDraft(null)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") commitTextDraft();
                      if (event.key === "Escape") setTextDraft(null);
                    }}
                  />
                )}
                {(["nw", "ne", "sw", "se"] as ResizeHandle[]).map((handle) => (
                  <button
                    key={handle}
                    type="button"
                    className={`qx-region-picker-handle is-${handle}`}
                    aria-label={t("screencap.picker.resize", "Resize selection")}
                    onMouseDown={(event) => beginResize(event, handle)}
                  />
                ))}
              </>
            )}
          </div>
          {!recordingActive && <div className="qx-region-picker-size" style={{ left: visibleRect.x, top: Math.max(8, visibleRect.y - 28) }}>
            {Math.round(visibleRect.w)} × {Math.round(visibleRect.h)}
          </div>}
        </>
      )}

      {selection && !recordingActive && (
        <div
          className="qx-region-picker-toolbar"
          style={{
            left: clamp(selection.x + selection.w / 2, 190, window.innerWidth - 190),
            top: selection.y + selection.h + 48 < window.innerHeight
              ? selection.y + selection.h + 10
              : Math.max(10, selection.y - 44),
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => void confirm("screenshot")} disabled={busy}>
            <Camera size={14} /> {t("screencap.screenshot", "Screenshot")}
          </button>
          <button type="button" className="is-record" onClick={() => void confirm("recording")} disabled={busy || annotations.length > 0}>
            <Circle size={10} fill="currentColor" /> {t("screencap.record", "Record")}
          </button>
          <span />
          <button type="button" className={tool === "text" ? "is-active" : ""} onClick={() => setTool(tool === "text" ? null : "text")}>
            <Type size={14} /> {t("screencap.picker.text", "Text")}
          </button>
          <button type="button" className={tool === "arrow" ? "is-active" : ""} onClick={() => setTool(tool === "arrow" ? null : "arrow")}>
            <MoveUpRight size={14} /> {t("screencap.picker.arrow", "Arrow")}
          </button>
          <button type="button" className="is-icon" onClick={() => void cancel()} aria-label={t("common.cancel", "Cancel")}>
            <X size={14} />
          </button>
        </div>
      )}

      {!rect && !busy && !recordingActive && (
        <div className="qx-region-picker-hint">
          {t("screencap.picker.draw", "Drag on {display} to select an area")
            .replace("{display}", display)}
        </div>
      )}
      {selection && tool && (
        <div className="qx-region-picker-hint is-tool-hint">
          {tool === "text"
            ? t("screencap.picker.textHint", "Click inside the selection to place text")
            : t("screencap.picker.arrowHint", "Drag inside the selection to draw an arrow")}
        </div>
      )}
      {error && !recordingActive && (
        <div className="qx-region-picker-error">{error}</div>
      )}
    </div>
  );
}
