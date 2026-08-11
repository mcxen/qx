import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CaptureColor, CaptureTool } from "./CaptureToolbar";
import { captureNumberForeground, captureNumberOutline } from "./captureColor";
import {
  mosaicBlockSizeRel,
  mosaicBrushRadiusRel,
  paintMosaicBrushOutline,
  paintMosaicOps,
  paintMosaicRegionOutline,
  type MosaicOp,
} from "./captureMosaic";
import {
  CAPTURE_TEXT_LINE_HEIGHT,
  CAPTURE_TEXT_VERTICAL_PADDING,
  captureTextPadding,
  wrapCaptureTextLines,
} from "./captureTextLayout";

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  w: number;
  h: number;
}

type ShapeKind = "arrow" | "rect" | "mosaic";

export type CaptureAnnotation =
  | {
      type: "text";
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      fontSize: number;
      text: string;
      color: CaptureColor;
    }
  | { type: "arrow"; x1: number; y1: number; x2: number; y2: number; color: CaptureColor }
  | { type: "rect"; x1: number; y1: number; x2: number; y2: number; color: CaptureColor }
  | {
      type: "mosaic";
      mode: "region";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      blockSize: number;
      color: CaptureColor;
    }
  | {
      type: "mosaic";
      mode: "brush";
      points: Point[];
      radius: number;
      blockSize: number;
      color: CaptureColor;
    }
  | { type: "number"; x: number; y: number; value: number; color: CaptureColor }
  | { type: "pen"; points: Point[]; color: CaptureColor };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Text placement follows Flameshot-style in-place editing:
 * start ~6 glyph-widths × 2.5 lines, then auto-grow with content.
 * While editing small fonts, the UI magnifies to a readable size
 * (see CaptureTextAnnotations) without changing the stored fontSize.
 */
export const CAPTURE_TEXT_INITIAL_FONT_SIZE = 24;
export const CAPTURE_TEXT_MIN_FONT_SIZE = 8;
export const CAPTURE_TEXT_MAX_FONT_SIZE = 160;
/** Approximate glyph width factor for Latin/CJK mixed text at bold 600 weight. */
export const CAPTURE_TEXT_GLYPH_EM = 0.62;
/** Flameshot TextWidget uses ~6 line-spacings of initial width. */
export const CAPTURE_TEXT_INITIAL_WIDTH_CHARS = 6;
/** Flameshot TextWidget uses ~2.5 line-spacings of initial height. */
export const CAPTURE_TEXT_INITIAL_HEIGHT_LINES = 2.5;
/**
 * Minimum visual font size while typing. Stored fontSize below this opens a
 * floating loupe (auto-zoom editor); final paint still uses the stored size.
 */
export const CAPTURE_TEXT_EDIT_READABLE_PX = 22;
export const CAPTURE_TEXT_EDIT_MAX_SCALE = 2.75;

/** Empty / newly placed text box size for the given font, clamped to selection. */
export function captureTextInitialBox(
  fontSize: number,
  selection: Rect,
): { width: number; height: number; fontSize: number } {
  const size = clamp(fontSize, CAPTURE_TEXT_MIN_FONT_SIZE, CAPTURE_TEXT_MAX_FONT_SIZE);
  const paddingX = Math.max(2, size * 0.22) * 2;
  const width = Math.min(
    selection.w,
    Math.max(56, size * CAPTURE_TEXT_GLYPH_EM * CAPTURE_TEXT_INITIAL_WIDTH_CHARS + paddingX),
  );
  const height = Math.min(
    selection.h,
    Math.max(
      28,
      size * CAPTURE_TEXT_LINE_HEIGHT * CAPTURE_TEXT_INITIAL_HEIGHT_LINES
        + CAPTURE_TEXT_VERTICAL_PADDING * 2,
    ),
  );
  return {
    width,
    height,
    fontSize: Math.min(size, Math.max(CAPTURE_TEXT_MIN_FONT_SIZE, height * 0.72)),
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

function drawNumberMarker(context: CanvasRenderingContext2D, x: number, y: number, value: number, color: string) {
  context.beginPath();
  context.fillStyle = color;
  context.arc(x, y, 12, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = captureNumberOutline(color);
  context.stroke();
  context.fillStyle = captureNumberForeground(color);
  context.font = "700 13px -apple-system, BlinkMacSystemFont, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(value), x, y + 0.5);
  context.textAlign = "start";
  context.textBaseline = "alphabetic";
}

function annotationToMosaicOp(annotation: CaptureAnnotation): MosaicOp | null {
  if (annotation.type !== "mosaic") return null;
  if (annotation.mode === "region") {
    return {
      mode: "region",
      x1: annotation.x1,
      y1: annotation.y1,
      x2: annotation.x2,
      y2: annotation.y2,
      blockSize: annotation.blockSize,
    };
  }
  return {
    mode: "brush",
    points: annotation.points,
    radius: annotation.radius,
    blockSize: annotation.blockSize,
  };
}

export function useCaptureAnnotations(selection: Rect | null, busy: boolean) {
  const [tool, setTool] = useState<CaptureTool>(null);
  const [color, setColor] = useState<CaptureColor>("#ff3b30");
  const [annotations, setAnnotations] = useState<CaptureAnnotation[]>([]);
  const [redoStack, setRedoStack] = useState<CaptureAnnotation[]>([]);
  const [shapeDraft, setShapeDraft] = useState<{ kind: ShapeKind; start: Point; end: Point } | null>(null);
  const [nextNumber, setNextNumber] = useState(1);
  const [penDraft, setPenDraft] = useState<Point[] | null>(null);
  const [strokeDraftKind, setStrokeDraftKind] = useState<"pen" | "mosaic" | null>(null);
  const [activeTextId, setActiveTextId] = useState<string | null>(null);
  const [freezeVersion, setFreezeVersion] = useState(0);
  const nextTextId = useRef(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const freezeImageRef = useRef<HTMLImageElement | null>(null);
  const freezeKeyRef = useRef<string>("");
  const freezeInflightRef = useRef(0);
  const drawableAnnotationsRef = useRef<CaptureAnnotation[]>([]);
  const nextDrawableAnnotations = annotations.filter((annotation) => annotation.type !== "text");
  if (
    nextDrawableAnnotations.length !== drawableAnnotationsRef.current.length
    || nextDrawableAnnotations.some(
      (annotation, index) => annotation !== drawableAnnotationsRef.current[index],
    )
  ) {
    drawableAnnotationsRef.current = nextDrawableAnnotations;
  }
  const drawableAnnotations = drawableAnnotationsRef.current;

  // Freeze only when mosaic will paint. On Windows the picker is
  // WDA_EXCLUDEFROMCAPTURE; GDI previews can be black and are rejected in Rust.
  // Final export always re-samples after the picker is hidden.
  const needsMosaicFreeze = tool === "mosaic"
    || annotations.some((annotation) => annotation.type === "mosaic")
    || shapeDraft?.kind === "mosaic"
    || strokeDraftKind === "mosaic";

  useEffect(() => {
    if (!needsMosaicFreeze || !selection || selection.w < 8 || selection.h < 8) {
      return;
    }
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;

    const key = `${Math.round(selection.x)}:${Math.round(selection.y)}:${Math.round(selection.w)}:${Math.round(selection.h)}`;
    if (key === freezeKeyRef.current && freezeImageRef.current) return;

    const token = ++freezeInflightRef.current;
    // Slightly longer debounce on every platform; Windows WGC first-frame can be
    // slow right after the picker appears.
    const timer = window.setTimeout(() => {
      void invoke<string>("screencap_selection_preview", {
        area: {
          x: Math.round(selection.x),
          y: Math.round(selection.y),
          w: Math.round(selection.w),
          h: Math.round(selection.h),
        },
      })
        .then((base64) => {
          if (token !== freezeInflightRef.current) return;
          const image = new Image();
          image.decoding = "async";
          image.onload = () => {
            if (token !== freezeInflightRef.current) return;
            // Guard against tiny/blank decode failures.
            if ((image.naturalWidth || image.width) < 2 || (image.naturalHeight || image.height) < 2) {
              freezeImageRef.current = null;
              return;
            }
            freezeImageRef.current = image;
            freezeKeyRef.current = key;
            setFreezeVersion((value) => value + 1);
          };
          image.onerror = () => {
            if (token !== freezeInflightRef.current) return;
            freezeImageRef.current = null;
          };
          image.src = `data:image/png;base64,${base64}`;
        })
        .catch(() => {
          // Windows GDI may return black under content-protected picker; keep
          // outline/dashed draft feedback until export samples the real frame.
          if (token !== freezeInflightRef.current) return;
          freezeImageRef.current = null;
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [needsMosaicFreeze, selection]);

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

    const mosaicOps: MosaicOp[] = [];
    for (const annotation of drawableAnnotations) {
      const op = annotationToMosaicOp(annotation);
      if (op) mosaicOps.push(op);
    }
    if (shapeDraft?.kind === "mosaic") {
      mosaicOps.push({
        mode: "region",
        x1: shapeDraft.start.x / selection.w,
        y1: shapeDraft.start.y / selection.h,
        x2: shapeDraft.end.x / selection.w,
        y2: shapeDraft.end.y / selection.h,
        blockSize: mosaicBlockSizeRel(Math.min(selection.w, selection.h)),
      });
    }
    if (penDraft && penDraft.length > 0 && strokeDraftKind === "mosaic") {
      mosaicOps.push({
        mode: "brush",
        points: penDraft.map((point) => ({
          x: point.x / selection.w,
          y: point.y / selection.h,
        })),
        radius: mosaicBrushRadiusRel(Math.min(selection.w, selection.h)),
        blockSize: mosaicBlockSizeRel(Math.min(selection.w, selection.h)),
      });
    }

    const freeze = freezeImageRef.current;
    if (mosaicOps.length > 0 && freeze) {
      paintMosaicOps(
        context,
        freeze,
        freeze.naturalWidth || freeze.width,
        freeze.naturalHeight || freeze.height,
        selection.w,
        selection.h,
        mosaicOps,
      );
    }

    // Always paint dashed guides so the mosaic zone is visible even when the
    // live pixelate preview cannot sample the protected desktop (Windows).
    // Guides are picker-only — not exported in the final capture.
    for (const op of mosaicOps) {
      if (op.mode === "region") {
        paintMosaicRegionOutline(
          context,
          op.x1 * selection.w,
          op.y1 * selection.h,
          op.x2 * selection.w,
          op.y2 * selection.h,
        );
      } else {
        paintMosaicBrushOutline(
          context,
          op.points.map((point) => ({
            x: point.x * selection.w,
            y: point.y * selection.h,
          })),
          op.radius * Math.min(selection.w, selection.h),
        );
      }
    }

    const paint = (annotation: CaptureAnnotation) => {
      if (annotation.type === "mosaic") return;
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
      } else if (annotation.type === "pen") {
        if (annotation.points.length < 2) return;
        context.beginPath();
        context.moveTo(annotation.points[0].x * selection.w, annotation.points[0].y * selection.h);
        for (let index = 1; index < annotation.points.length; index += 1) {
          context.lineTo(annotation.points[index].x * selection.w, annotation.points[index].y * selection.h);
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
      }
    };

    for (const annotation of drawableAnnotations) paint(annotation);
    if (shapeDraft && shapeDraft.kind !== "mosaic") {
      paint({
        type: shapeDraft.kind,
        x1: shapeDraft.start.x / selection.w,
        y1: shapeDraft.start.y / selection.h,
        x2: shapeDraft.end.x / selection.w,
        y2: shapeDraft.end.y / selection.h,
        color,
      });
    }
    if (penDraft && penDraft.length > 0 && strokeDraftKind === "pen") {
      paint({
        type: "pen",
        points: penDraft.map((point) => ({ x: point.x / selection.w, y: point.y / selection.h })),
        color,
      });
    }
  }, [color, drawableAnnotations, freezeVersion, penDraft, selection, shapeDraft, strokeDraftKind]);

  /** Vector + text overlay only — mosaics are applied in Rust on the real frame. */
  const exportOverlayBase64 = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selection) return undefined;
    const ratio = window.devicePixelRatio || 1;
    const output = document.createElement("canvas");
    output.width = canvas.width;
    output.height = canvas.height;
    const context = output.getContext("2d");
    if (!context) return undefined;
    context.scale(ratio, ratio);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 3;

    for (const annotation of annotations) {
      if (annotation.type === "mosaic" || annotation.type === "text") continue;
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
      } else if (annotation.type === "pen") {
        if (annotation.points.length < 2) continue;
        context.beginPath();
        context.moveTo(annotation.points[0].x * selection.w, annotation.points[0].y * selection.h);
        for (let index = 1; index < annotation.points.length; index += 1) {
          context.lineTo(annotation.points[index].x * selection.w, annotation.points[index].y * selection.h);
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
      }
    }

    context.textAlign = "left";
    context.textBaseline = "top";
    for (const annotation of annotations) {
      if (annotation.type !== "text" || !annotation.text) continue;
      const x = annotation.x * selection.w + Math.max(2, annotation.fontSize * 0.22);
      const lineHeight = annotation.fontSize * CAPTURE_TEXT_LINE_HEIGHT;
      const y = annotation.y * selection.h + CAPTURE_TEXT_VERTICAL_PADDING;
      const contentWidth = Math.max(
        1,
        annotation.w * selection.w - captureTextPadding(annotation.fontSize) * 2,
      );
      const lines = wrapCaptureTextLines(annotation.text, annotation.fontSize, contentWidth);
      context.font = `600 ${annotation.fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      context.fillStyle = annotation.color;
      lines.forEach((line, index) => {
        context.fillText(line, x, y + index * lineHeight);
      });
    }
    return output.toDataURL("image/png").split(",")[1];
  }, [annotations, selection]);

  const exportMosaicOps = useCallback((): MosaicOp[] => {
    const ops: MosaicOp[] = [];
    for (const annotation of annotations) {
      const op = annotationToMosaicOp(annotation);
      if (op) ops.push(op);
    }
    return ops;
  }, [annotations]);

  const pushAnnotation = useCallback((annotation: CaptureAnnotation) => {
    setAnnotations((current) => [...current, annotation]);
    setRedoStack([]);
  }, []);
  const undo = useCallback(() => {
    setAnnotations((current) => {
      if (current.length === 0) return current;
      const removed = current[current.length - 1];
      if (removed.type === "number") setNextNumber((value) => Math.max(1, Math.min(value, removed.value)));
      setRedoStack((stack) => [...stack, removed]);
      return current.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      setAnnotations((current) => [...current, stack[stack.length - 1]]);
      return stack.slice(0, -1);
    });
  }, []);
  const canvasPoint = (event: MouseEvent<HTMLCanvasElement>): Point | null => {
    if (!selection) return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(event.clientX - bounds.left, 0, selection.w),
      y: clamp(event.clientY - bounds.top, 0, selection.h),
    };
  };
  /**
   * Create an empty text box at the clicked image point and open it for editing.
   * Callers must pass a canvas-local point — the text tool no longer auto-places
   * at the selection center when the toolbar button is pressed.
   */
  const createTextAnnotation = useCallback((point: Point) => {
    if (!selection || busy) return null;
    const box = captureTextInitialBox(CAPTURE_TEXT_INITIAL_FONT_SIZE, selection);
    const left = clamp(point.x, 0, Math.max(0, selection.w - box.width));
    const top = clamp(point.y, 0, Math.max(0, selection.h - box.height));
    const id = `text-${nextTextId.current++}`;
    pushAnnotation({
      type: "text",
      id,
      x: left / selection.w,
      y: top / selection.h,
      w: box.width / selection.w,
      h: box.height / selection.h,
      fontSize: box.fontSize,
      text: "",
      color,
    });
    setActiveTextId(id);
    return id;
  }, [busy, color, pushAnnotation, selection]);
  const onCanvasMouseDown = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!selection || !tool || busy) return;
    event.preventDefault();
    event.stopPropagation();
    const point = canvasPoint(event);
    if (!point) return;
    if (tool === "text") {
      createTextAnnotation(point);
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
    } else if (tool === "pen") {
      setPenDraft([point]);
      setStrokeDraftKind("pen");
    } else if (tool === "mosaic") {
      // Primary: region rectangle. Shift+drag: freehand brush.
      if (event.shiftKey) {
        setPenDraft([point]);
        setStrokeDraftKind("mosaic");
      } else {
        setShapeDraft({ kind: "mosaic", start: point, end: point });
      }
    } else {
      setShapeDraft({ kind: tool, start: point, end: point });
    }
  };
  const onCanvasMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event);
    if (!point) return;
    if (penDraft) setPenDraft((current) => (current ? [...current, point] : current));
    else if (shapeDraft) setShapeDraft({ ...shapeDraft, end: point });
  };
  const onCanvasMouseUp = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!selection) return;
    event.preventDefault();
    event.stopPropagation();
    const minSide = Math.min(selection.w, selection.h);
    if (penDraft) {
      if (strokeDraftKind === "pen" && penDraft.length > 0) {
        pushAnnotation({
          type: "pen",
          points: penDraft.map((point) => ({ x: point.x / selection.w, y: point.y / selection.h })),
          color,
        });
      } else if (strokeDraftKind === "mosaic" && penDraft.length > 0) {
        pushAnnotation({
          type: "mosaic",
          mode: "brush",
          points: penDraft.map((point) => ({ x: point.x / selection.w, y: point.y / selection.h })),
          radius: mosaicBrushRadiusRel(minSide),
          blockSize: mosaicBlockSizeRel(minSide),
          color,
        });
      }
      setPenDraft(null);
      setStrokeDraftKind(null);
      return;
    }
    if (!shapeDraft) return;
    const end = canvasPoint(event) ?? shapeDraft.end;
    if (Math.hypot(end.x - shapeDraft.start.x, end.y - shapeDraft.start.y) > 8) {
      if (shapeDraft.kind === "mosaic") {
        pushAnnotation({
          type: "mosaic",
          mode: "region",
          x1: shapeDraft.start.x / selection.w,
          y1: shapeDraft.start.y / selection.h,
          x2: end.x / selection.w,
          y2: end.y / selection.h,
          blockSize: mosaicBlockSizeRel(minSide),
          color,
        });
      } else {
        pushAnnotation({
          type: shapeDraft.kind,
          x1: shapeDraft.start.x / selection.w,
          y1: shapeDraft.start.y / selection.h,
          x2: end.x / selection.w,
          y2: end.y / selection.h,
          color,
        });
      }
    }
    setShapeDraft(null);
  };

  const updateTextAnnotation = useCallback((
    id: string,
    patch: Partial<Pick<Extract<CaptureAnnotation, { type: "text" }>, "x" | "y" | "w" | "h" | "fontSize" | "text">>,
  ) => {
    setAnnotations((current) => current.map((annotation) => (
      annotation.type === "text" && annotation.id === id ? { ...annotation, ...patch } : annotation
    )));
  }, []);
  const deleteTextAnnotation = useCallback((id: string) => {
    setAnnotations((current) => current.filter((annotation) => !(annotation.type === "text" && annotation.id === id)));
    setActiveTextId((current) => (current === id ? null : current));
  }, []);

  return {
    tool,
    setTool,
    color,
    setColor,
    annotations,
    setAnnotations,
    redoStack,
    setRedoStack,
    shapeDraft,
    setShapeDraft,
    nextNumber,
    setNextNumber,
    penDraft,
    setPenDraft,
    activeTextId,
    setActiveTextId,
    canvasRef,
    undo,
    redo,
    onCanvasMouseDown,
    onCanvasMouseMove,
    onCanvasMouseUp,
    createTextAnnotation,
    updateTextAnnotation,
    deleteTextAnnotation,
    exportOverlayBase64,
    exportMosaicOps,
  };
}
