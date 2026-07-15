/**
 * System desktop-window inventory port.
 * Window geometry for capture hover-select, layout tools, etc.
 */
import { invoke } from "@tauri-apps/api/core";

export interface DesktopWindow {
  id: number;
  title: string;
  appName: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  isMinimized: boolean;
  isFocused: boolean;
  monitorId?: number | null;
}

export interface DesktopWindowQuery {
  monitorId?: number | null;
  /** When set with monitorId, rects are logical points relative to that monitor. */
  logicalScale?: number | null;
  excludeNameSubstrings?: string[];
  minSize?: number;
  minIntersection?: number;
}

/** List visible top-level windows (`desktop_windows_list`). */
export function listDesktopWindows(query?: DesktopWindowQuery): Promise<DesktopWindow[]> {
  return invoke<DesktopWindow[]>("desktop_windows_list", { query: query ?? null });
}

/**
 * Capture-oriented convenience: logical rects on one monitor, excluding Qx chrome.
 * Implemented client-side on top of the public query so features share one IPC.
 */
export function listDesktopWindowsForCapture(
  monitorId: number,
  logicalScale: number,
): Promise<DesktopWindow[]> {
  return listDesktopWindows({
    monitorId,
    logicalScale,
    excludeNameSubstrings: ["qx", "qx region picker", "qx recording controls"],
    minSize: 48,
    minIntersection: 32,
  });
}
