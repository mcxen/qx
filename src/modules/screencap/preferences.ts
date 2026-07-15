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

export type ScreenshotAfterCapture = "copy" | "none";

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
