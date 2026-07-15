import type { RecordingOptions } from "./store";

export const DEFAULT_RECORDING_OPTIONS: RecordingOptions = {
  outputFormat: "mp4",
  fps: 24,
  quality: "balanced",
  resolution: "1080p",
};

const OPTIONS_KEY = "qx.screencap.options";
export const CAPTURE_CONTROLS_PINNED_KEY = "qx.screencap.controlsPinned";
const SCREENSHOT_AFTER_CAPTURE_KEY = "qx.screencap.screenshotAfterCapture";
const CONFIRM_MODE_KEY = "qx.screencap.confirmMode";
const DELAY_SECONDS_KEY = "qx.screencap.delaySeconds";
const LAST_SELECTION_KEY = "qx.screencap.lastSelection";

export interface LastCaptureSelection {
  x: number;
  y: number;
  w: number;
  h: number;
  monitorId?: number | null;
}

export type ScreenshotAfterCapture = "copy" | "none";
/** refine: release only builds selection; release: release captures immediately (Alt forces refine). */
export type CaptureConfirmMode = "refine" | "release";
export type CaptureDelaySeconds = 0 | 3 | 5;

export function loadRecordingOptions(): RecordingOptions {
  try {
    const stored = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? "null") as Partial<RecordingOptions> | null;
    return { ...DEFAULT_RECORDING_OPTIONS, ...(stored ?? {}) };
  } catch {
    return DEFAULT_RECORDING_OPTIONS;
  }
}

export function saveRecordingOptions(options: RecordingOptions): void {
  localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
}

export function captureControlsPinned(): boolean {
  return localStorage.getItem(CAPTURE_CONTROLS_PINNED_KEY) === "true";
}

export function saveCaptureControlsPinned(pinned: boolean): void {
  localStorage.setItem(CAPTURE_CONTROLS_PINNED_KEY, String(pinned));
}

export function loadScreenshotAfterCapture(): ScreenshotAfterCapture {
  return localStorage.getItem(SCREENSHOT_AFTER_CAPTURE_KEY) === "none" ? "none" : "copy";
}

export function saveScreenshotAfterCapture(value: ScreenshotAfterCapture): void {
  localStorage.setItem(SCREENSHOT_AFTER_CAPTURE_KEY, value);
}

export function loadCaptureConfirmMode(): CaptureConfirmMode {
  return localStorage.getItem(CONFIRM_MODE_KEY) === "release" ? "release" : "refine";
}

export function saveCaptureConfirmMode(value: CaptureConfirmMode): void {
  localStorage.setItem(CONFIRM_MODE_KEY, value);
}

export function loadCaptureDelaySeconds(): CaptureDelaySeconds {
  const raw = Number(localStorage.getItem(DELAY_SECONDS_KEY) ?? "0");
  if (raw === 3 || raw === 5) return raw;
  return 0;
}

export function saveCaptureDelaySeconds(value: CaptureDelaySeconds): void {
  localStorage.setItem(DELAY_SECONDS_KEY, String(value));
}

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
