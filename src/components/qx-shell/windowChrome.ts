import { getCurrentWindow } from "@tauri-apps/api/window";
import { getQxDesktopPlatform } from "../../utils/keyboard";
type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

export const WINDOW_RESIZE_HANDLES: Array<{
  direction: ResizeDirection;
  className: string;
}> = [
  { direction: "North", className: "edge-top" },
  { direction: "NorthEast", className: "corner-top-right" },
  { direction: "East", className: "edge-right" },
  { direction: "SouthEast", className: "corner-bottom-right" },
  { direction: "South", className: "edge-bottom" },
  { direction: "SouthWest", className: "corner-bottom-left" },
  { direction: "West", className: "edge-left" },
  { direction: "NorthWest", className: "corner-top-left" },
];

// Tauri/tao maps this API to WM_NCLBUTTONDOWN on Windows. macOS explicitly
// reports it as unsupported, so Cocoa/NSPanel must retain its native resizable
// edge hit testing instead of having a WebView overlay consume the pointer.
export const IS_WINDOWS_HOST = getQxDesktopPlatform() === "windows";
export const USE_EXPLICIT_WINDOW_RESIZE_HANDLES = IS_WINDOWS_HOST;

export const startWindowResize = (
    event: React.PointerEvent<HTMLDivElement>,
    direction: ResizeDirection,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    void getCurrentWindow().startResizeDragging(direction).catch(() => {});
  };

export const startWindowDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    // Topbar movement has one owner: this explicit handler. Mixing the Tauri
    // data attribute, Chromium app-region CSS and startDragging can dispatch
    // two native move loops for the same pointerdown on Windows WebView2.
    if (
      target?.closest(
        "button, a, input, textarea, select, [contenteditable='true'], [data-qx-no-window-drag]",
      )
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void getCurrentWindow().startDragging().catch(() => {});
  };
