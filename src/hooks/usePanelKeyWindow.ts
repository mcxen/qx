import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * Request key-window status for the floating panel so keyboard input lands in
 * the webview instead of the user's previous foreground app.
 *
 * The main window is a non-activating NSPanel on macOS, so it never grabs
 * key-window status automatically. Components that own a focusable input
 * should call this helper from their `onFocus` (or once on mount when the
 * input is auto-focused) and the panel will promote to key window without
 * activating the application as a whole — the dock stays hidden, no app
 * switch happens, but typing reaches the input.
 */
export function requestPanelKeyWindow(): void {
  if (!isTauriRuntime()) return;
  void invoke("floating_request_key").catch(() => {});
}

/**
 * Hook variant: requests key-window status once when the component mounts.
 * Useful for components that auto-focus a search input on render (Launcher,
 * Settings search, AI chat input).
 */
export function usePanelKeyWindowOnMount(): void {
  useEffect(() => {
    requestPanelKeyWindow();
  }, []);
}
