import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/** Coalesce bursty key-window requests during Option+Space show (activate + focus thrash). */
let lastKeyWindowRequestAt = 0;
let pendingKeyWindowTimer: ReturnType<typeof setTimeout> | null = null;
const KEY_WINDOW_MIN_INTERVAL_MS = 80;

/**
 * Request key-window status for the floating panel so keyboard input lands in
 * the webview instead of the user's previous foreground app.
 *
 * The main window is a non-activating NSPanel on macOS, so it never grabs
 * key-window status automatically. Components that own a focusable input
 * should call this helper from their `onFocus` (or once on mount when the
 * input is auto-focused). Calls are debounced — show/focus used to fire this
 * 4–6 times per summon and each invoke blocked the UI path for tens of ms.
 */
export function requestPanelKeyWindow(): void {
  if (!isTauriRuntime()) return;
  const now = Date.now();
  const elapsed = now - lastKeyWindowRequestAt;
  if (elapsed >= KEY_WINDOW_MIN_INTERVAL_MS) {
    lastKeyWindowRequestAt = now;
    void invoke("floating_request_key").catch(() => {});
    return;
  }
  if (pendingKeyWindowTimer != null) return;
  pendingKeyWindowTimer = setTimeout(() => {
    pendingKeyWindowTimer = null;
    lastKeyWindowRequestAt = Date.now();
    void invoke("floating_request_key").catch(() => {});
  }, KEY_WINDOW_MIN_INTERVAL_MS - elapsed);
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
