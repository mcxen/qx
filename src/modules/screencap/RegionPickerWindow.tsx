import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AppWindow,
  Camera,
  Circle,
  Grid3x3,
  Hash,
  Maximize,
  MoveUpRight,
  Pencil,
  Square,
  Type,
  X,
} from "lucide-react";
import { useT } from "../../i18n";
import {
  listDesktopWindowsForCapture,
  type DesktopWindow,
} from "../../system";
import { loadLastCaptureSelection, saveLastCaptureSelection } from "./preferences";
import { DEFAULT_SETTINGS, type ScreencapSettings } from "../settings/store";
import type { CaptureMode, RecordingSnapshot, RecordingOptions } from "./store";

interface LogicalArea {
  x: number;
  y: number;
  w: number;
  h: number;
  monitorId?: number | null;
}

interface PickerStatus {
  mode: CaptureMode;
  monitorId: number;
  monitorName: string;
  coordinateScale: number;
  logicalArea?: LogicalArea | null;
  restoreSelection?: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface Rect extends Point {
  w: number;
  h: number;
}

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type PickMode = "region" | "window" | "fullscreen";
type Tool = "text" | "arrow" | "rect" | "pen" | "number" | "mosaic" | null;
type AnnotationColor = "#ff3b30" | "#ffcc00" | "#5b8cff" | "#34c759" | "#ffffff";
type ShapeKind = "arrow" | "rect" | "mosaic";

type Annotation =
  | { type: "text"; x: number; y: number; text: string; color: AnnotationColor }
  | { type: "arrow"; x1: number; y1: number; x2: number; y2: number; color: AnnotationColor }
  | { type: "rect"; x1: number; y1: number; x2: number; y2: number; color: AnnotationColor }
  | { type: "mosaic"; x1: number; y1: number; x2: number; y2: number; color: AnnotationColor }
  | { type: "number"; x: number; y: number; value: number; color: AnnotationColor }
  | { type: "pen"; points: Point[]; color: AnnotationColor };

interface RectInteraction {
  kind: "move" | "resize";
  start: Point;
  origin: Rect;
  handle?: ResizeHandle;
}

const MIN_SIZE = 32;
const ANNOTATION_COLORS: AnnotationColor[] = ["#ff3b30", "#ffcc00", "#5b8cff", "#34c759", "#ffffff"];

function selectionFromLogicalArea(area: LogicalArea | null | undefined): Rect | null {
  if (!area || area.w < MIN_SIZE || area.h < MIN_SIZE) return null;
  return {
    x: area.x,
    y: area.y,
    w: area.w,
    h: area.h,
  };
}

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

function clampRectToViewport(rect: Rect): Rect {
  const w = clamp(rect.w, MIN_SIZE, window.innerWidth);
  const h = clamp(rect.h, MIN_SIZE, window.innerHeight);
  return {
    x: clamp(rect.x, 0, Math.max(0, window.innerWidth - w)),
    y: clamp(rect.y, 0, Math.max(0, window.innerHeight - h)),
    w,
    h,
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

/** Opaque redaction mosaic — covers underlying pixels when the overlay is composited. */
function drawMosaic(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const cell = 8;
  for (let row = 0; row < h; row += cell) {
    for (let col = 0; col < w; col += cell) {
      const seed = ((Math.floor(x + col) * 73856093) ^ (Math.floor(y + row) * 19349663)) >>> 0;
      const tone = 40 + (seed % 160);
      context.fillStyle = `rgb(${tone},${tone},${tone})`;
      context.fillRect(x + col, y + row, Math.min(cell, w - col), Math.min(cell, h - row));
    }
  }
}

function drawNumberMarker(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  value: number,
  color: string,
) {
  const radius = 12;
  context.beginPath();
  context.fillStyle = color;
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = "rgba(255,255,255,.92)";
  context.stroke();
  context.fillStyle = "#fff";
  context.font = "700 13px -apple-system, BlinkMacSystemFont, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(value), x, y + 0.5);
  context.textAlign = "start";
  context.textBaseline = "alphabetic";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Full-display protected overlay: draw, refine, annotate, then capture. */
export default function RegionPickerWindow() {
  const t = useT();
  const [picker, setPicker] = useState<PickerStatus | null>(null);
  const [windows, setWindows] = useState<DesktopWindow[]>([]);
  const [recording, setRecording] = useState<RecordingSnapshot | null>(null);
  const [captureSettings, setCaptureSettings] = useState<ScreencapSettings>(DEFAULT_SETTINGS.screencap);
  const [intent, setIntent] = useState<CaptureMode>("screenshot");
  const [pickMode, setPickMode] = useState<PickMode>("region");
  const [drawStart, setDrawStart] = useState<Point | null>(null);
  const [drawEnd, setDrawEnd] = useState<Point | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [interaction, setInteraction] = useState<RectInteraction | null>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [color, setColor] = useState<AnnotationColor>("#ff3b30");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [, setRedoStack] = useState<Annotation[]>([]);
  const [shapeDraft, setShapeDraft] = useState<{ kind: ShapeKind; start: Point; end: Point } | null>(null);
  const [nextNumber, setNextNumber] = useState(1);
  const lastClickRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const [penDraft, setPenDraft] = useState<Point[] | null>(null);
  const [textDraft, setTextDraft] = useState<{ point: Point; text: string } | null>(null);
  const [hoverWindow, setHoverWindow] = useState<DesktopWindow | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cancelCountdownRef = useRef(false);

  const setPointerFollow = useCallback((enabled: boolean) => {
    void invoke("screencap_set_pointer_follow", { enabled }).catch(() => {});
  }, []);

  const loadWindows = useCallback(async () => {
    if (picker?.monitorId == null || picker.coordinateScale == null || picker.coordinateScale <= 0) {
      setWindows([]);
      return;
    }
    try {
      // System desktop-window inventory — not a screencap-private command.
      const list = await listDesktopWindowsForCapture(picker.monitorId, picker.coordinateScale);
      setWindows(list);
    } catch {
      setWindows([]);
    }
  }, [picker?.coordinateScale, picker?.monitorId]);

  useEffect(() => {
    document.body.classList.add("qx-region-picker-body");
    rootRef.current?.focus();
    void Promise.all([
      invoke<PickerStatus | null>("screencap_region_select_status"),
      invoke<RecordingSnapshot>("recording_status"),
      invoke<{ screencap: ScreencapSettings }>("get_settings"),
    ]).then(([status, snapshot, settings]) => {
      setPicker(status);
      setCaptureSettings(settings.screencap);
      if (status?.mode === "recording" || status?.mode === "screenshot") {
        setIntent(status.mode);
      }
      const restored = selectionFromLogicalArea(status?.logicalArea);
      if (restored) {
        setSelection(restored);
      } else {
        // Remember last region on this monitor for fast re-capture.
        const remembered = loadLastCaptureSelection();
        if (
          remembered
          && (remembered.monitorId == null || remembered.monitorId === status?.monitorId)
        ) {
          const next = clampRectToViewport({
            x: remembered.x,
            y: remembered.y,
            w: remembered.w,
            h: remembered.h,
          });
          setSelection(next);
        }
      }
      setRecording(snapshot);
    }).catch((loadError) => {
      setError(String(loadError));
    });
    const pickerListener = listen<PickerStatus>("screencap:picker", (event) => {
      const payload = event.payload;
      setPicker(payload);
      if (payload.mode === "recording" || payload.mode === "screenshot") {
        setIntent(payload.mode);
      }
      setDrawStart(null);
      setDrawEnd(null);
      setTool(null);
      setHoverWindow(null);
      setBusy(false);
      setCountdown(null);
      setError(null);
      cancelCountdownRef.current = true;
      if (payload.restoreSelection) {
        const restored = selectionFromLogicalArea(payload.logicalArea);
        if (restored) setSelection(restored);
        setAnnotations([]);
        setRedoStack([]);
        setNextNumber(1);
      } else {
        setSelection(null);
        setAnnotations([]);
        setRedoStack([]);
        setNextNumber(1);
      }
    });
    const stateListener = listen<RecordingSnapshot>("screencap:state", (event) => {
      setRecording(event.payload);
      if (event.payload.phase !== "recording" && event.payload.phase !== "processing") {
        setBusy(false);
      }
      setError(event.payload.error);
    });
    void pickerListener.catch((listenError) => setError(String(listenError)));
    void stateListener.catch((listenError) => setError(String(listenError)));
    return () => {
      document.body.classList.remove("qx-region-picker-body");
      void pickerListener.then((dispose) => dispose()).catch(() => {});
      void stateListener.then((dispose) => dispose()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (pickMode !== "window") return;
    void loadWindows();
    const timer = window.setInterval(() => void loadWindows(), 1200);
    return () => window.clearInterval(timer);
  }, [loadWindows, pickMode]);

  // After display switch / session attach, refresh window list once picker is known.
  useEffect(() => {
    if (picker?.monitorId == null) return;
    void loadWindows();
  }, [loadWindows, picker?.monitorId, picker?.coordinateScale]);

  // Rust owns cross-display pointer tracking. Stop it as soon as the user has
  // started an interaction so an in-progress selection can never move screens.
  useEffect(() => {
    if (selection || drawStart || interaction || busy || countdown !== null) {
      setPointerFollow(false);
    }
  }, [busy, countdown, drawStart, interaction, selection, setPointerFollow]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selection) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(selection.w * ratio));
    canvas.height = Math.max(1, Math.round(selection.h * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.scale(ratio, ratio);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 3;

    const paint = (annotation: Annotation) => {
      context.strokeStyle = annotation.color;
      context.fillStyle = annotation.color;
      if (annotation.type === "arrow") {
        drawArrow(
          context,
          annotation.x1 * selection.w,
          annotation.y1 * selection.h,
          annotation.x2 * selection.w,
          annotation.y2 * selection.h,
        );
      } else if (annotation.type === "rect") {
        const x = Math.min(annotation.x1, annotation.x2) * selection.w;
        const y = Math.min(annotation.y1, annotation.y2) * selection.h;
        const w = Math.abs(annotation.x2 - annotation.x1) * selection.w;
        const h = Math.abs(annotation.y2 - annotation.y1) * selection.h;
        context.strokeRect(x, y, w, h);
      } else if (annotation.type === "mosaic") {
        const x = Math.min(annotation.x1, annotation.x2) * selection.w;
        const y = Math.min(annotation.y1, annotation.y2) * selection.h;
        const w = Math.abs(annotation.x2 - annotation.x1) * selection.w;
        const h = Math.abs(annotation.y2 - annotation.y1) * selection.h;
        drawMosaic(context, x, y, w, h);
      } else if (annotation.type === "pen") {
        if (annotation.points.length < 2) return;
        context.beginPath();
        context.moveTo(annotation.points[0].x * selection.w, annotation.points[0].y * selection.h);
        for (let i = 1; i < annotation.points.length; i += 1) {
          context.lineTo(annotation.points[i].x * selection.w, annotation.points[i].y * selection.h);
        }
        context.stroke();
      } else if (annotation.type === "number") {
        drawNumberMarker(
          context,
          annotation.x * selection.w,
          annotation.y * selection.h,
          annotation.value,
          annotation.color,
        );
      } else {
        const x = annotation.x * selection.w;
        const y = annotation.y * selection.h;
        context.font = "600 18px -apple-system, BlinkMacSystemFont, sans-serif";
        context.lineWidth = 4;
        context.strokeStyle = "rgba(255,255,255,.9)";
        context.strokeText(annotation.text, x, y);
        context.fillStyle = annotation.color;
        context.fillText(annotation.text, x, y);
        context.lineWidth = 3;
        context.strokeStyle = annotation.color;
      }
    };

    for (const annotation of annotations) paint(annotation);
    if (shapeDraft) {
      paint({
        type: shapeDraft.kind,
        x1: shapeDraft.start.x / selection.w,
        y1: shapeDraft.start.y / selection.h,
        x2: shapeDraft.end.x / selection.w,
        y2: shapeDraft.end.y / selection.h,
        color,
      });
    }
    if (penDraft && penDraft.length > 1) {
      paint({
        type: "pen",
        points: penDraft.map((point) => ({ x: point.x / selection.w, y: point.y / selection.h })),
        color,
      });
    }
  }, [annotations, color, penDraft, selection, shapeDraft]);

  const cancel = useCallback(async () => {
    if (busy && countdown === null) return;
    cancelCountdownRef.current = true;
    setCountdown(null);
    setBusy(true);
    await invoke("screencap_set_picker_passthrough", { enabled: false }).catch(() => {});
    await invoke("screencap_cancel_region_select").catch(() => {});
  }, [busy, countdown]);

  const pushAnnotation = useCallback((annotation: Annotation) => {
    setAnnotations((current) => [...current, annotation]);
    setRedoStack([]);
  }, []);

  const undo = useCallback(() => {
    setAnnotations((current) => {
      if (current.length === 0) return current;
      const removed = current[current.length - 1];
      if (removed.type === "number") {
        setNextNumber((value) => Math.max(1, Math.min(value, removed.value)));
      }
      const next = current.slice(0, -1);
      setRedoStack((stack) => [...stack, removed]);
      return next;
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const item = stack[stack.length - 1];
      setAnnotations((current) => [...current, item]);
      return stack.slice(0, -1);
    });
  }, []);

  const confirm = useCallback(async (action: CaptureMode, areaOverride?: Rect) => {
    const target = areaOverride ?? selection;
    if (busy || !target || countdown !== null) return;
    if (action === "recording" && annotations.length > 0) {
      setError(t("screencap.picker.annotationsBlockRecord", "Clear annotations before recording."));
      return;
    }
    setBusy(true);
    setError(null);
    cancelCountdownRef.current = false;

    const canvas = canvasRef.current;
    const annotationOverlayBase64 = action === "screenshot" && annotations.length > 0 && canvas
      ? canvas.toDataURL("image/png").split(",")[1]
      : undefined;

    const delay = captureSettings.capture_delay_seconds;
    if (delay > 0) {
      try {
        await invoke("screencap_set_picker_passthrough", { enabled: true });
      } catch {
        // Best effort — countdown still proceeds.
      }
      for (let remaining = delay; remaining > 0; remaining -= 1) {
        if (cancelCountdownRef.current) {
          setCountdown(null);
          setBusy(false);
          await invoke("screencap_set_picker_passthrough", { enabled: false }).catch(() => {});
          return;
        }
        setCountdown(remaining);
        await sleep(1000);
      }
      setCountdown(null);
      await invoke("screencap_set_picker_passthrough", { enabled: false }).catch(() => {});
      if (cancelCountdownRef.current) {
        setBusy(false);
        return;
      }
    }

    try {
      saveLastCaptureSelection({
        x: Math.round(target.x),
        y: Math.round(target.y),
        w: Math.round(target.w),
        h: Math.round(target.h),
        monitorId: picker?.monitorId ?? null,
      });
      await invoke("screencap_confirm_region_select", {
        area: {
          x: Math.round(target.x),
          y: Math.round(target.y),
          w: Math.round(target.w),
          h: Math.round(target.h),
        },
        options: {
          outputFormat: captureSettings.output_format,
          fps: captureSettings.fps,
          quality: captureSettings.quality,
          resolution: captureSettings.resolution,
        } satisfies RecordingOptions,
        action,
        annotationOverlayBase64,
        copyToClipboard: action === "screenshot" && captureSettings.auto_copy_to_clipboard,
      });
    } catch (captureError) {
      setBusy(false);
      setError(String(captureError));
    }
  }, [annotations.length, busy, captureSettings, countdown, picker?.monitorId, selection, t]);

  const selectFullScreen = useCallback(() => {
    if (busy) return;
    setPointerFollow(false);
    setPickMode("fullscreen");
    setSelection({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
    setDrawStart(null);
    setDrawEnd(null);
    setHoverWindow(null);
    setAnnotations([]);
    setRedoStack([]);
    setError(null);
  }, [busy, setPointerFollow]);

  const switchPickMode = useCallback((mode: PickMode) => {
    if (busy) return;
    setPickMode(mode);
    setHoverWindow(null);
    setDrawStart(null);
    setDrawEnd(null);
    setTool(null);
    if (mode === "fullscreen") {
      selectFullScreen();
      return;
    }
    if (mode === "window") {
      setSelection(null);
      void loadWindows();
      return;
    }
    // region: keep current selection if any
  }, [busy, loadWindows, selectFullScreen]);

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

  const hitWindow = useCallback((point: Point): DesktopWindow | null => {
    for (const item of windows) {
      if (
        point.x >= item.x
        && point.y >= item.y
        && point.x <= item.x + item.w
        && point.y <= item.y + item.h
      ) {
        return item;
      }
    }
    return null;
  }, [windows]);

  const onRootMouseDown = (event: React.MouseEvent) => {
    if (busy || event.button !== 0 || countdown !== null) return;
    setPointerFollow(false);
    if (pickMode === "window") {
      const hit = hitWindow({ x: event.clientX, y: event.clientY });
      if (hit) {
        event.preventDefault();
        const next = clampRectToViewport({ x: hit.x, y: hit.y, w: hit.w, h: hit.h });
        setSelection(next);
        setHoverWindow(null);
        setAnnotations([]);
        setRedoStack([]);
        setPickMode("region");
      }
      return;
    }
    if (pickMode === "fullscreen") return;
    // Region mode: allow redraw by dragging on dimmed area (or always start new drag when no tool).
    if (tool) return;
    if (selection) {
      // Click outside selection → clear and start new drag.
      const inside = event.clientX >= selection.x
        && event.clientY >= selection.y
        && event.clientX <= selection.x + selection.w
        && event.clientY <= selection.y + selection.h;
      if (inside) return;
      setSelection(null);
      setAnnotations([]);
      setRedoStack([]);
    }
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    setDrawStart(point);
    setDrawEnd(point);
  };

  const onSelectionMouseDown = (event: React.MouseEvent) => {
    if (!selection || tool || busy || event.button !== 0 || countdown !== null) return;
    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    const prev = lastClickRef.current;
    if (
      prev
      && now - prev.at < 320
      && Math.hypot(event.clientX - prev.x, event.clientY - prev.y) < 8
    ) {
      lastClickRef.current = null;
      void confirm(intent);
      return;
    }
    lastClickRef.current = { at: now, x: event.clientX, y: event.clientY };
    setInteraction({
      kind: "move",
      start: { x: event.clientX, y: event.clientY },
      origin: selection,
    });
  };

  const onRootMouseMove = (event: React.MouseEvent) => {
    if (pickMode === "window" && !selection && !busy) {
      setHoverWindow(hitWindow({ x: event.clientX, y: event.clientY }));
    }
    if (drawStart && !selection) {
      let end = { x: event.clientX, y: event.clientY };
      if (event.shiftKey) {
        const size = Math.max(Math.abs(end.x - drawStart.x), Math.abs(end.y - drawStart.y));
        end = {
          x: drawStart.x + Math.sign(end.x - drawStart.x || 1) * size,
          y: drawStart.y + Math.sign(end.y - drawStart.y || 1) * size,
        };
      }
      setDrawEnd(end);
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
    const handle = interaction.handle ?? "se";
    if (handle.includes("w")) left = clamp(origin.x + dx, 0, right - MIN_SIZE);
    if (handle.includes("e")) right = clamp(origin.x + origin.w + dx, left + MIN_SIZE, window.innerWidth);
    if (handle.includes("n")) top = clamp(origin.y + dy, 0, bottom - MIN_SIZE);
    if (handle.includes("s")) bottom = clamp(origin.y + origin.h + dy, top + MIN_SIZE, window.innerHeight);
    setSelection({ x: left, y: top, w: right - left, h: bottom - top });
  };

  const finishDrawSelection = useCallback((forceRefine: boolean) => {
    if (!drawStart || !drawEnd || selection) return false;
    const next = rectFromPoints(drawStart, drawEnd);
    setDrawStart(null);
    setDrawEnd(null);
    if (next.w < MIN_SIZE || next.h < MIN_SIZE) {
      setPointerFollow(true);
      return false;
    }
    setSelection(next);
    const confirmMode = captureSettings.capture_confirm_mode;
    if (confirmMode === "release" && !forceRefine) {
      void confirm(intent, next);
    }
    return true;
  }, [captureSettings.capture_confirm_mode, confirm, drawEnd, drawStart, intent, selection, setPointerFollow]);

  const onRootMouseUp = (event: React.MouseEvent) => {
    if (drawStart && drawEnd && !selection) {
      finishDrawSelection(event.altKey);
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
    if (!selection || !tool || busy) return;
    event.preventDefault();
    event.stopPropagation();
    const point = canvasPoint(event);
    if (!point) return;
    if (tool === "text") {
      setTextDraft({ point, text: "" });
      setTool(null);
      return;
    }
    if (tool === "number") {
      pushAnnotation({
        type: "number",
        x: point.x / selection.w,
        y: point.y / selection.h,
        value: nextNumber,
        color,
      });
      setNextNumber((value) => value + 1);
      return;
    }
    if (tool === "pen") {
      setPenDraft([point]);
      return;
    }
    if (tool === "arrow" || tool === "rect" || tool === "mosaic") {
      setShapeDraft({ kind: tool, start: point, end: point });
    }
  };

  const onCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event);
    if (!point) return;
    if (penDraft) {
      setPenDraft((current) => (current ? [...current, point] : current));
      return;
    }
    if (shapeDraft) {
      setShapeDraft({ ...shapeDraft, end: point });
    }
  };

  const commitTextDraft = useCallback(() => {
    if (!selection || !textDraft) return;
    const text = textDraft.text.trim();
    if (text) {
      pushAnnotation({
        type: "text",
        x: textDraft.point.x / selection.w,
        y: textDraft.point.y / selection.h,
        text,
        color,
      });
    }
    setTextDraft(null);
  }, [color, pushAnnotation, selection, textDraft]);

  const onCanvasMouseUp = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selection) return;
    event.preventDefault();
    event.stopPropagation();
    if (penDraft) {
      if (penDraft.length > 1) {
        pushAnnotation({
          type: "pen",
          points: penDraft.map((point) => ({
            x: point.x / selection.w,
            y: point.y / selection.h,
          })),
          color,
        });
      }
      setPenDraft(null);
      return;
    }
    if (!shapeDraft) return;
    const end = canvasPoint(event) ?? shapeDraft.end;
    const distance = Math.hypot(end.x - shapeDraft.start.x, end.y - shapeDraft.start.y);
    if (distance > 8) {
      pushAnnotation({
        type: shapeDraft.kind,
        x1: shapeDraft.start.x / selection.w,
        y1: shapeDraft.start.y / selection.h,
        x2: end.x / selection.w,
        y2: end.y / selection.h,
        color,
      });
    }
    setShapeDraft(null);
  };

  const draft = drawStart && drawEnd ? rectFromPoints(drawStart, drawEnd) : null;
  const rect = selection ?? draft ?? (hoverWindow
    ? { x: hoverWindow.x, y: hoverWindow.y, w: hoverWindow.w, h: hoverWindow.h }
    : null);
  const display = picker?.monitorName ?? t("screencap.display", "display");
  const recordingActive = recording?.phase === "recording" || recording?.phase === "processing";
  const visibleRect = recordingActive && rect
    ? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
    : rect;
  const showAnnotationTools = intent === "screenshot";
  const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

  return (
    <div
      ref={rootRef}
      className={`qx-region-picker${pickMode === "window" ? " is-window-mode" : ""}${countdown !== null ? " is-countdown" : ""}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          if (countdown !== null) {
            cancelCountdownRef.current = true;
            setCountdown(null);
            setBusy(false);
            void invoke("screencap_set_picker_passthrough", { enabled: false }).catch(() => {});
            return;
          }
          if (textDraft) {
            setTextDraft(null);
            return;
          }
          if (tool) {
            setTool(null);
            return;
          }
          if (shapeDraft || penDraft) {
            setShapeDraft(null);
            setPenDraft(null);
            return;
          }
          if (drawStart) {
            setDrawStart(null);
            setDrawEnd(null);
            setPointerFollow(true);
            return;
          }
          if (selection) {
            setSelection(null);
            setAnnotations([]);
            setRedoStack([]);
            setNextNumber(1);
            setTool(null);
            setPointerFollow(true);
            return;
          }
          void cancel();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          return;
        }
        if (event.key === "Enter" && selection && !busy && countdown === null) {
          event.preventDefault();
          void confirm(intent);
          return;
        }
        if (event.key === " " && !busy) {
          event.preventDefault();
          selectFullScreen();
          return;
        }
        if (!event.metaKey && !event.ctrlKey && !event.altKey) {
          const key = event.key.toLowerCase();
          if (key === "s") {
            event.preventDefault();
            setIntent("screenshot");
          } else if (key === "r") {
            event.preventDefault();
            setIntent("recording");
            setTool(null);
          } else if (key === "tab") {
            event.preventDefault();
            switchPickMode(pickMode === "region" ? "window" : "region");
          } else if (key === "1") setTool("rect");
          else if (key === "2") setTool("arrow");
          else if (key === "3") setTool("text");
          else if (key === "4") setTool("pen");
          else if (key === "5") setTool("number");
          else if (key === "6") setTool("mosaic");
        }
      }}
      onMouseDown={onRootMouseDown}
      onMouseMove={onRootMouseMove}
      onMouseUp={onRootMouseUp}
    >
      {!recordingActive && countdown === null && (
        <div className="qx-region-picker-modebar" onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" className={pickMode === "region" ? "is-active" : ""} disabled={busy} onClick={() => switchPickMode("region")}>
            {t("screencap.pick.region", "Region")}
          </button>
          <button type="button" className={pickMode === "window" ? "is-active" : ""} disabled={busy} onClick={() => switchPickMode("window")}>
            <AppWindow size={13} aria-hidden="true" />
            {t("screencap.pick.window", "Window")}
          </button>
          <button type="button" className={pickMode === "fullscreen" ? "is-active" : ""} disabled={busy} onClick={() => switchPickMode("fullscreen")}>
            <Maximize size={13} aria-hidden="true" />
            {t("screencap.fullscreen", "Full Screen")}
          </button>
        </div>
      )}

      {visibleRect && (
        <>
          {!recordingActive && countdown === null && <>
            <div className="qx-region-picker-shade" style={{ left: 0, top: 0, right: 0, height: visibleRect.y }} />
            <div className="qx-region-picker-shade" style={{ left: 0, top: visibleRect.y + visibleRect.h, right: 0, bottom: 0 }} />
            <div className="qx-region-picker-shade" style={{ left: 0, top: visibleRect.y, width: visibleRect.x, height: visibleRect.h }} />
            <div className="qx-region-picker-shade" style={{ left: visibleRect.x + visibleRect.w, top: visibleRect.y, right: 0, height: visibleRect.h }} />
          </>}
          <div
            className={`qx-region-picker-rect${selection ? " is-selected" : ""}${tool ? ` is-tool-${tool}` : ""}${recordingActive ? " is-recording" : ""}${!selection && hoverWindow ? " is-hover-window" : ""}`}
            style={{ left: visibleRect.x, top: visibleRect.y, width: visibleRect.w, height: visibleRect.h }}
            onMouseDown={onSelectionMouseDown}
          >
            {selection && !recordingActive && countdown === null && (
              <>
                <canvas
                  ref={canvasRef}
                  className="qx-region-picker-annotations"
                  onMouseDown={onCanvasMouseDown}
                  onMouseMove={onCanvasMouseMove}
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
                    onBlur={() => commitTextDraft()}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitTextDraft();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setTextDraft(null);
                      }
                    }}
                  />
                )}
                {handles.map((handle) => (
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
          {!recordingActive && countdown === null && (
            <div className="qx-region-picker-size" style={{ left: visibleRect.x, top: Math.max(8, visibleRect.y - 28) }}>
              {Math.round(visibleRect.w)} × {Math.round(visibleRect.h)}
              {hoverWindow && !selection ? ` · ${hoverWindow.appName || hoverWindow.title}` : ""}
            </div>
          )}
        </>
      )}

      {selection && !recordingActive && countdown === null && (
        <div
          className="qx-region-picker-toolbar"
          style={{
            left: clamp(selection.x + selection.w / 2, 220, window.innerWidth - 220),
            top: selection.y + selection.h + 48 < window.innerHeight
              ? selection.y + selection.h + 10
              : Math.max(10, selection.y - 44),
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={intent === "screenshot" ? "is-primary" : ""}
            onClick={() => void confirm("screenshot")}
            disabled={busy}
          >
            <Camera size={14} /> {t("screencap.screenshot", "Screenshot")}
          </button>
          <button
            type="button"
            className={`is-record${intent === "recording" ? " is-primary" : ""}`}
            onClick={() => void confirm("recording")}
            disabled={busy || annotations.length > 0}
            title={annotations.length > 0
              ? t("screencap.picker.annotationsBlockRecord", "Clear annotations before recording.")
              : undefined}
          >
            <Circle size={10} fill="currentColor" /> {t("screencap.record", "Record")}
          </button>
          {showAnnotationTools && (
            <>
              <span />
              <button type="button" className={tool === "rect" ? "is-active" : ""} onClick={() => setTool(tool === "rect" ? null : "rect")} title="1">
                <Square size={14} />
              </button>
              <button type="button" className={tool === "arrow" ? "is-active" : ""} onClick={() => setTool(tool === "arrow" ? null : "arrow")} title="2">
                <MoveUpRight size={14} />
              </button>
              <button type="button" className={tool === "text" ? "is-active" : ""} onClick={() => setTool(tool === "text" ? null : "text")} title="3">
                <Type size={14} />
              </button>
              <button type="button" className={tool === "pen" ? "is-active" : ""} onClick={() => setTool(tool === "pen" ? null : "pen")} title="4">
                <Pencil size={14} />
              </button>
              <button type="button" className={tool === "number" ? "is-active" : ""} onClick={() => setTool(tool === "number" ? null : "number")} title="5">
                <Hash size={14} />
              </button>
              <button type="button" className={tool === "mosaic" ? "is-active" : ""} onClick={() => setTool(tool === "mosaic" ? null : "mosaic")} title="6">
                <Grid3x3 size={14} />
              </button>
              <span />
              {ANNOTATION_COLORS.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  className={`qx-region-picker-swatch${color === swatch ? " is-active" : ""}`}
                  style={{ background: swatch }}
                  aria-label={swatch}
                  onClick={() => setColor(swatch)}
                />
              ))}
            </>
          )}
          <button type="button" className="is-icon" onClick={() => void cancel()} aria-label={t("common.cancel", "Cancel")}>
            <X size={14} />
          </button>
        </div>
      )}

      {!rect && !busy && !recordingActive && countdown === null && (
        <div className="qx-region-picker-hint">
          {pickMode === "window"
            ? t("screencap.picker.windowHint", "Hover a window and click to select · Esc to cancel")
            : t("screencap.picker.draw", "Drag on {display} to select an area")
                .replace("{display}", display)}
        </div>
      )}
      {selection && tool && countdown === null && (
        <div className="qx-region-picker-hint is-tool-hint">
          {tool === "text"
            ? t("screencap.picker.textHint", "Click inside the selection to place text")
            : tool === "arrow"
              ? t("screencap.picker.arrowHint", "Drag inside the selection to draw an arrow")
              : tool === "rect"
                ? t("screencap.picker.rectHint", "Drag inside the selection to draw a rectangle")
                : tool === "number"
                  ? t("screencap.picker.numberHint", "Click to place numbered step markers")
                  : tool === "mosaic"
                    ? t("screencap.picker.mosaicHint", "Drag to redact an area with mosaic")
                    : t("screencap.picker.penHint", "Drag inside the selection to draw freehand")}
        </div>
      )}
      {countdown !== null && (
        <div className="qx-region-picker-countdown" aria-live="assertive">
          <strong>{countdown}</strong>
          <span>{t("screencap.picker.countdown", "Capturing… Esc to cancel")}</span>
        </div>
      )}
      {error && !recordingActive && countdown === null && (
        <div className="qx-region-picker-error">{error}</div>
      )}
    </div>
  );
}
