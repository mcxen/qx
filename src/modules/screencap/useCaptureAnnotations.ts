import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { CaptureColor, CaptureTool } from "./CaptureToolbar";
import { captureNumberForeground, captureNumberOutline } from "./captureColor";
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

type ShapeKind = "arrow" | "rect";

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
  | { type: "mosaic"; points: Point[]; color: CaptureColor }
  | { type: "number"; x: number; y: number; value: number; color: CaptureColor }
  | { type: "pen"; points: Point[]; color: CaptureColor };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const CAPTURE_TEXT_INITIAL_WIDTH = 24;
export const CAPTURE_TEXT_INITIAL_HEIGHT = 30;
export const CAPTURE_TEXT_INITIAL_FONT_SIZE = 18;
export const CAPTURE_TEXT_MIN_FONT_SIZE = 8;
export const CAPTURE_TEXT_MAX_FONT_SIZE = 160;

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

function drawMosaicStroke(context: CanvasRenderingContext2D, points: Point[], width: number, height: number) {
  if (points.length === 0) return;
  const path = new Path2D();
  path.moveTo(points[0].x * width, points[0].y * height);
  if (points.length === 1) {
    path.lineTo(points[0].x * width + 0.01, points[0].y * height + 0.01);
  } else {
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const midpointX = ((previous.x + current.x) / 2) * width;
      const midpointY = ((previous.y + current.y) / 2) * height;
      path.quadraticCurveTo(previous.x * width, previous.y * height, midpointX, midpointY);
    }
    const finalPoint = points[points.length - 1];
    path.lineTo(finalPoint.x * width, finalPoint.y * height);
  }
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.filter = "blur(5px)";
  context.strokeStyle = "rgba(82, 82, 88, 0.82)";
  context.lineWidth = 30;
  context.stroke(path);
  context.filter = "blur(2px)";
  context.strokeStyle = "rgba(150, 150, 156, 0.46)";
  context.lineWidth = 20;
  context.stroke(path);
  context.restore();
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
  const nextTextId = useRef(1);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

    const paint = (annotation: CaptureAnnotation) => {
      context.strokeStyle = annotation.color;
      context.fillStyle = annotation.color;
      if (annotation.type === "arrow") {
        drawArrow(context, annotation.x1 * selection.w, annotation.y1 * selection.h, annotation.x2 * selection.w, annotation.y2 * selection.h);
      } else if (annotation.type === "rect") {
        const x = Math.min(annotation.x1, annotation.x2) * selection.w;
        const y = Math.min(annotation.y1, annotation.y2) * selection.h;
        const w = Math.abs(annotation.x2 - annotation.x1) * selection.w;
        const h = Math.abs(annotation.y2 - annotation.y1) * selection.h;
        context.strokeRect(x, y, w, h);
      } else if (annotation.type === "mosaic") {
        drawMosaicStroke(context, annotation.points, selection.w, selection.h);
      } else if (annotation.type === "pen") {
        if (annotation.points.length < 2) return;
        context.beginPath();
        context.moveTo(annotation.points[0].x * selection.w, annotation.points[0].y * selection.h);
        for (let index = 1; index < annotation.points.length; index += 1) {
          context.lineTo(annotation.points[index].x * selection.w, annotation.points[index].y * selection.h);
        }
        context.stroke();
      } else if (annotation.type === "number") {
        drawNumberMarker(context, annotation.x * selection.w, annotation.y * selection.h, annotation.value, annotation.color);
      }
    };

    for (const annotation of drawableAnnotations) paint(annotation);
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
    if (penDraft && penDraft.length > 0 && strokeDraftKind) {
      paint({
        type: strokeDraftKind,
        points: penDraft.map((point) => ({ x: point.x / selection.w, y: point.y / selection.h })),
        color,
      });
    }
  }, [color, drawableAnnotations, penDraft, selection, shapeDraft, strokeDraftKind]);

  const exportOverlayBase64 = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selection) return undefined;
    const ratio = window.devicePixelRatio || 1;
    const output = document.createElement("canvas");
    output.width = canvas.width;
    output.height = canvas.height;
    const context = output.getContext("2d");
    if (!context) return undefined;
    context.drawImage(canvas, 0, 0);
    context.scale(ratio, ratio);
    context.textAlign = "left";
    context.textBaseline = "top";
    const paintText = (annotation: CaptureAnnotation) => {
      if (annotation.type !== "text" || !annotation.text) return;
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
    };
    annotations.forEach(paintText);
    return output.toDataURL("image/png").split(",")[1];
  }, [annotations, selection]);

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
  const onCanvasMouseDown = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!selection || !tool || busy) return;
    event.preventDefault();
    event.stopPropagation();
    const point = canvasPoint(event);
    if (!point) return;
    if (tool === "text") return;
    if (tool === "number") {
      pushAnnotation({ type: "number", x: point.x / selection.w, y: point.y / selection.h, value: nextNumber, color });
      setNextNumber((value) => value + 1);
    } else if (tool === "pen" || tool === "mosaic") {
      setPenDraft([point]);
      setStrokeDraftKind(tool);
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
  const createTextAnnotation = useCallback((point?: Point) => {
    if (!selection || busy) return null;
    const width = Math.min(CAPTURE_TEXT_INITIAL_WIDTH, selection.w);
    const height = Math.min(CAPTURE_TEXT_INITIAL_HEIGHT, selection.h);
    const left = clamp(
      point?.x ?? (selection.w - width) / 2,
      0,
      Math.max(0, selection.w - width),
    );
    const top = clamp(
      point?.y ?? (selection.h - height) / 2,
      0,
      Math.max(0, selection.h - height),
    );
    const id = `text-${nextTextId.current++}`;
    pushAnnotation({
      type: "text",
      id,
      x: left / selection.w,
      y: top / selection.h,
      w: width / selection.w,
      h: height / selection.h,
      fontSize: Math.min(CAPTURE_TEXT_INITIAL_FONT_SIZE, height * 0.72),
      text: "",
      color,
    });
    setActiveTextId(id);
    setTool(null);
    return id;
  }, [busy, color, pushAnnotation, selection]);
  const onCanvasMouseUp = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!selection) return;
    event.preventDefault();
    event.stopPropagation();
    if (penDraft) {
      if (strokeDraftKind && penDraft.length > 0) {
        pushAnnotation({
          type: strokeDraftKind,
          points: penDraft.map((point) => ({ x: point.x / selection.w, y: point.y / selection.h })),
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

  const updateTextAnnotation = useCallback((id: string, patch: Partial<Pick<Extract<CaptureAnnotation, { type: "text" }>, "x" | "y" | "w" | "h" | "fontSize" | "text">>) => {
    setAnnotations((current) => current.map((annotation) => annotation.type === "text" && annotation.id === id ? { ...annotation, ...patch } : annotation));
  }, []);
  const deleteTextAnnotation = useCallback((id: string) => {
    setAnnotations((current) => current.filter((annotation) => !(annotation.type === "text" && annotation.id === id)));
    setActiveTextId((current) => current === id ? null : current);
  }, []);

  return {
    tool, setTool, color, setColor, annotations, setAnnotations, redoStack, setRedoStack,
    shapeDraft, setShapeDraft, nextNumber, setNextNumber, penDraft, setPenDraft,
    activeTextId, setActiveTextId, canvasRef, undo, redo, onCanvasMouseDown, onCanvasMouseMove,
    onCanvasMouseUp, createTextAnnotation, updateTextAnnotation, deleteTextAnnotation, exportOverlayBase64,
  };
}
