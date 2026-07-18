import type { RecordingOptions } from "./store";

export const DEFAULT_RECORDING_OPTIONS: RecordingOptions = {
  outputFormat: "mp4",
  fps: 24,
  quality: "balanced",
  resolution: "1080p",
};

const LAST_SELECTION_KEY = "qx.screencap.lastSelection";

export interface LastCaptureSelection {
  x: number;
  y: number;
  w: number;
  h: number;
  monitorId?: number | null;
}

export type CaptureHistoryLayout = "list" | "gallery";

export function loadLastCaptureSelection(): LastCaptureSelection | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_SELECTION_KEY) ?? "null") as LastCaptureSelection | null;
    if (!raw || typeof raw.x !== "number" || typeof raw.y !== "number") return null;
    if (raw.w < 32 || raw.h < 32) return null;
    return raw;
  } catch {
    return null;
  }
}

export function saveLastCaptureSelection(area: LastCaptureSelection): void {
  localStorage.setItem(LAST_SELECTION_KEY, JSON.stringify(area));
}
