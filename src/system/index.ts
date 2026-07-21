/**
 * Qx system capability ports (frontend).
 *
 * These modules are thin, stable IPC façades over root-level Rust services.
 * Feature modules (screencap, OCR, plugins, …) depend on this layer only —
 * never invent parallel display/window/clipboard discovery.
 *
 * SOLID:
 * - S: one port file per capability
 * - O: new system capabilities add a new port; features consume without forking
 * - D: features depend on these abstractions, not xcap/AppKit/Win32
 */

export * from "./display";
export * from "./desktopWindows";
export * from "./clipboard";
export * from "./ocr";
export * from "./pathActions";
