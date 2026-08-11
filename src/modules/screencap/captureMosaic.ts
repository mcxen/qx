/**
 * Live mosaic helpers — sample real selection pixels into N×N blocks.
 * Final export re-applies the same ops in Rust against the post-hide capture.
 */

import type { Point } from "./useCaptureAnnotations";

/** CSS-pixel block edge for region/brush mosaic (scaled by selection size). */
export const MOSAIC_BLOCK_CSS = 14;
/** Brush half-width in CSS pixels. */
export const MOSAIC_BRUSH_RADIUS_CSS = 18;

export type MosaicOp =
  | {
      mode: "region";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      blockSize: number;
    }
  | {
      mode: "brush";
      points: Point[];
      radius: number;
      blockSize: number;
    };

export function mosaicBlockSizeRel(selectionMinSide: number): number {
  return MOSAIC_BLOCK_CSS / Math.max(1, selectionMinSide);
}

export function mosaicBrushRadiusRel(selectionMinSide: number): number {
  return MOSAIC_BRUSH_RADIUS_CSS / Math.max(1, selectionMinSide);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function blockPixels(imageWidth: number, imageHeight: number, blockSizeRel: number): number {
  const minSide = Math.max(1, Math.min(imageWidth, imageHeight));
  return Math.max(4, Math.min(96, Math.round(clamp(blockSizeRel, 0.004, 0.25) * minSide)));
}

function radiusPixels(imageWidth: number, imageHeight: number, radiusRel: number): number {
  const minSide = Math.max(1, Math.min(imageWidth, imageHeight));
  return Math.max(2, clamp(radiusRel, 0.004, 0.35) * minSide);
}

function averageCell(
  data: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): [number, number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let count = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const i = (y * width + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      a += data[i + 3];
      count += 1;
    }
  }
  if (count === 0) return [0, 0, 0, 0];
  return [
    Math.round(r / count),
    Math.round(g / count),
    Math.round(b / count),
    Math.round(a / count),
  ];
}

function fillCell(
  data: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: [number, number, number, number],
): void {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = color[3];
    }
  }
}

function pointSegmentDistanceSq(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-9) {
    const ex = px - x1;
    const ey = py - y1;
    return ex * ex + ey * ey;
  }
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const ex = px - projX;
  const ey = py - projY;
  return ex * ex + ey * ey;
}

function strokeHits(points: Array<{ x: number; y: number }>, x: number, y: number, radiusSq: number): boolean {
  if (points.length === 1) {
    const dx = x - points[0].x;
    const dy = y - points[0].y;
    return dx * dx + dy * dy <= radiusSq;
  }
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (pointSegmentDistanceSq(x, y, a.x, a.y, b.x, b.y) <= radiusSq) return true;
  }
  return false;
}

/**
 * Draw pixelated mosaics onto `context` by sampling `source`.
 * Only mosaic cells are written (transparent elsewhere) so the live desktop
 * remains visible outside the redacted areas.
 */
export function paintMosaicOps(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  destWidth: number,
  destHeight: number,
  ops: MosaicOp[],
): void {
  if (ops.length === 0 || sourceWidth < 1 || sourceHeight < 1 || destWidth < 1 || destHeight < 1) {
    return;
  }

  const width = Math.max(1, Math.round(destWidth));
  const height = Math.max(1, Math.round(destHeight));

  // Sample freeze into destination resolution for stable block math.
  const sample = document.createElement("canvas");
  sample.width = width;
  sample.height = height;
  const sampleCtx = sample.getContext("2d", { willReadFrequently: true });
  if (!sampleCtx) return;
  sampleCtx.drawImage(source, 0, 0, width, height);
  const sourceData = sampleCtx.getImageData(0, 0, width, height).data;

  // Transparent layer: only filled mosaic cells are opaque.
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const outCtx = out.getContext("2d");
  if (!outCtx) return;
  const outImage = outCtx.createImageData(width, height);
  const outData = outImage.data;

  const writeCell = (
    left: number,
    top: number,
    right: number,
    bottom: number,
  ) => {
    const color = averageCell(sourceData, width, left, top, right, bottom);
    fillCell(outData, width, left, top, right, bottom, color);
  };

  for (const op of ops) {
    if (op.mode === "region") {
      const left = Math.floor(clamp(Math.min(op.x1, op.x2), 0, 1) * width);
      const top = Math.floor(clamp(Math.min(op.y1, op.y2), 0, 1) * height);
      const right = Math.ceil(clamp(Math.max(op.x1, op.x2), 0, 1) * width);
      const bottom = Math.ceil(clamp(Math.max(op.y1, op.y2), 0, 1) * height);
      const block = blockPixels(width, height, op.blockSize);
      for (let y = top; y < bottom; y += block) {
        const cellBottom = Math.min(y + block, bottom);
        for (let x = left; x < right; x += block) {
          writeCell(x, y, Math.min(x + block, right), cellBottom);
        }
      }
      continue;
    }

    if (op.points.length === 0) continue;
    const pts = op.points.map((p) => ({
      x: clamp(p.x, 0, 1) * width,
      y: clamp(p.y, 0, 1) * height,
    }));
    const radius = radiusPixels(width, height, op.radius);
    const radiusSq = radius * radius;
    const block = blockPixels(width, height, op.blockSize);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x - radius);
      minY = Math.min(minY, p.y - radius);
      maxX = Math.max(maxX, p.x + radius);
      maxY = Math.max(maxY, p.y + radius);
    }
    const left = Math.max(0, Math.floor(minX));
    const top = Math.max(0, Math.floor(minY));
    const right = Math.min(width, Math.ceil(maxX));
    const bottom = Math.min(height, Math.ceil(maxY));
    for (let y = top; y < bottom; y += block) {
      const cellBottom = Math.min(y + block, bottom);
      for (let x = left; x < right; x += block) {
        const cellRight = Math.min(x + block, right);
        const cx = (x + cellRight - 1) * 0.5;
        const cy = (y + cellBottom - 1) * 0.5;
        if (!strokeHits(pts, cx, cy, radiusSq)) continue;
        writeCell(x, y, cellRight, cellBottom);
      }
    }
  }

  outCtx.putImageData(outImage, 0, 0);
  context.drawImage(out, 0, 0, destWidth, destHeight);
}

/**
 * Always-visible mosaic region guide (draft + committed).
 * Used when live pixelate preview is unavailable so the user still sees the mask.
 */
export function paintMosaicRegionOutline(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  if (w < 1 || h < 1) return;
  context.save();
  // Soft hatch so the zone is obvious even without pixelate preview.
  context.fillStyle = "rgba(90, 96, 112, 0.28)";
  context.fillRect(x, y, w, h);
  context.strokeStyle = "rgba(0, 0, 0, 0.55)";
  context.lineWidth = 3;
  context.setLineDash([]);
  context.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  context.strokeStyle = "rgba(255, 255, 255, 0.95)";
  context.lineWidth = 1.75;
  context.setLineDash([6, 4]);
  context.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  // Corner ticks — read clearly on busy screenshots.
  const tick = Math.min(10, Math.min(w, h) * 0.2);
  context.setLineDash([]);
  context.lineWidth = 2;
  context.strokeStyle = "rgba(255, 220, 80, 0.95)";
  context.beginPath();
  context.moveTo(x, y + tick);
  context.lineTo(x, y);
  context.lineTo(x + tick, y);
  context.moveTo(x + w - tick, y);
  context.lineTo(x + w, y);
  context.lineTo(x + w, y + tick);
  context.moveTo(x + w, y + h - tick);
  context.lineTo(x + w, y + h);
  context.lineTo(x + w - tick, y + h);
  context.moveTo(x + tick, y + h);
  context.lineTo(x, y + h);
  context.lineTo(x, y + h - tick);
  context.stroke();
  context.restore();
}

/** Fallback feedback for a mosaic brush while source pixels are unavailable. */
export function paintMosaicBrushOutline(
  context: CanvasRenderingContext2D,
  points: Point[],
  radius: number,
): void {
  if (points.length === 0) return;
  context.save();
  context.strokeStyle = "rgba(255, 220, 80, 0.9)";
  context.fillStyle = "rgba(90, 96, 112, 0.22)";
  context.lineWidth = Math.max(4, radius * 2);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash([6, 4]);
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  if (points.length === 1) {
    context.lineTo(points[0].x + 0.01, points[0].y);
  }
  context.stroke();
  // Solid core so the path stays legible over the dash stroke.
  context.setLineDash([]);
  context.strokeStyle = "rgba(255, 255, 255, 0.55)";
  context.lineWidth = Math.max(2, radius * 0.9);
  context.stroke();
  context.restore();
}
