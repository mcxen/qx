import type { CaptureMode } from "./store";
import type { Point, Rect } from "./useCaptureAnnotations";

interface LogicalArea {
  x: number;
  y: number;
  w: number;
  h: number;
  monitorId?: number | null;
}

export interface PickerStatus {
  mode: CaptureMode;
  monitorId: number;
  monitorName: string;
  coordinateScale: number;
  snapshotPath?: string;
  logicalArea?: LogicalArea | null;
  restoreSelection?: boolean;
  /** When false (single display), skip cross-display pointer-follow IPC. */
  multiDisplay?: boolean;
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type PickMode = "region" | "fullscreen";

export interface RectInteraction {
  kind: "move" | "resize";
  start: Point;
  origin: Rect;
  handle?: ResizeHandle;
}

export const CAPTURE_RESIZE_HANDLES: ResizeHandle[] = [
  "nw", "n", "ne", "e", "se", "s", "sw", "w",
];

export function waitForPickerFrame(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
