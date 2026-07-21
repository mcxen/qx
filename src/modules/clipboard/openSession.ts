/**
 * Clipboard open session port (core module — highest open priority).
 *
 * The panel is eagerly bundled with the host. This port only warms history so
 * shortcut / navigate can paint rows with data already in the store (SWR),
 * instead of: show shell → mount empty panel → then IPC.
 */
import { invoke } from "@tauri-apps/api/core";
import { useStore, type ClipboardEntry } from "../../store";

export const CLIPBOARD_HISTORY_LIMIT = 200;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let historyInFlight: Promise<ClipboardEntry[]> | null = null;
let openInFlight: Promise<ClipboardEntry[]> | null = null;

/** Fetch history into the app store. Concurrent callers join one IPC. */
export function refreshClipboardHistory(): Promise<ClipboardEntry[]> {
  if (historyInFlight) return historyInFlight;
  if (!isTauriRuntime()) {
    return Promise.resolve(useStore.getState().clipboardHistory);
  }
  historyInFlight = (async () => {
    try {
      const res = await invoke<ClipboardEntry[]>("get_clipboard_history", {
        limit: CLIPBOARD_HISTORY_LIMIT,
      });
      useStore.getState().setClipboardHistory(res);
      return res;
    } catch {
      return useStore.getState().clipboardHistory;
    } finally {
      historyInFlight = null;
    }
  })();
  return historyInFlight;
}

export interface PrefetchClipboardOpenOptions {
  /**
   * When true (default on panel open), also probe the live system clipboard for
   * an image and re-fetch history if a new entry was saved.
   * Idle warm-up should pass false so background prefetch has no side effects.
   */
  captureLiveImage?: boolean;
}

/**
 * Warm history as soon as clipboard is requested. Safe from navigate, idle
 * warm, and ClipboardPanel mount — callers share in-flight work.
 */
export function prefetchClipboardOpen(
  options: PrefetchClipboardOpenOptions = {},
): Promise<ClipboardEntry[]> {
  const captureLiveImage = options.captureLiveImage !== false;

  if (!captureLiveImage) {
    return refreshClipboardHistory();
  }

  if (openInFlight) return openInFlight;
  if (!isTauriRuntime()) {
    return Promise.resolve(useStore.getState().clipboardHistory);
  }

  openInFlight = (async () => {
    try {
      // History and live-image capture run concurrently. If capture inserts a
      // row, refresh once more so the new image is in the store before settle.
      const historyPromise = refreshClipboardHistory();
      const imagePromise = invoke<unknown>("read_clipboard_image_now")
        .then((saved) => Boolean(saved))
        .catch(() => false);
      const [, saved] = await Promise.all([historyPromise, imagePromise]);
      if (saved) return refreshClipboardHistory();
      return useStore.getState().clipboardHistory;
    } finally {
      openInFlight = null;
    }
  })();
  return openInFlight;
}
