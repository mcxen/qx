import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ClipboardEntry } from "../../store";

interface PasteClipboardEntryOptions {
  focusAtCursor?: boolean;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

/**
 * Selection in Clipboard History must not write the system pasteboard while
 * the main window is still open: `record_clipboard_copy` bumps timestamp /
 * copy_count and a live history reload reorders the list under the user.
 *
 * Instead, queue the chosen entry and flush after the shell hides (blur /
 * hotkey / close-to-background). Explicit Copy / Paste still write immediately.
 */
let pendingRestore: ClipboardEntry | null = null;
let hideListenerInstalled = false;
let flushInFlight: Promise<void> | null = null;

export function queueClipboardRestore(item: ClipboardEntry | null | undefined): void {
  pendingRestore = item ?? null;
}

export function clearClipboardRestore(): void {
  pendingRestore = null;
}

export function peekClipboardRestoreId(): string | null {
  return pendingRestore?.id ?? null;
}

export async function flushClipboardRestore(): Promise<void> {
  if (flushInFlight) {
    await flushInFlight;
    // A concurrent queue may have landed while the first write ran.
    if (pendingRestore) await flushClipboardRestore();
    return;
  }
  const item = pendingRestore;
  pendingRestore = null;
  if (!item) return;
  flushInFlight = writeClipboardEntry(item)
    .catch(() => {
      // Best-effort restore; leave the previous pasteboard content if write fails.
    })
    .finally(() => {
      flushInFlight = null;
    });
  await flushInFlight;
  if (pendingRestore) await flushClipboardRestore();
}

/** Install once: when the main window loses focus / hides, restore pending selection. */
export function ensureClipboardRestoreOnHide(): void {
  if (hideListenerInstalled || !isTauriRuntime()) return;
  hideListenerInstalled = true;
  void getCurrentWindow()
    .onFocusChanged(({ payload: focused }) => {
      if (!focused) void flushClipboardRestore();
    })
    .catch(() => {
      hideListenerInstalled = false;
    });
}

export async function writeClipboardEntry(item: ClipboardEntry): Promise<void> {
  if (item.file_path) {
    await invoke("write_clipboard_file_entry", { id: item.id });
  } else if (item.image_path) {
    await invoke("write_clipboard_image_entry", { id: item.id });
  } else {
    await writeText(item.text);
  }
  await invoke("record_clipboard_copy", { id: item.id });
}

export async function pasteClipboardEntry(
  item: ClipboardEntry,
  _options: PasteClipboardEntryOptions = {},
): Promise<void> {
  // Paste already writes; do not flush the same (or another) entry again on hide.
  clearClipboardRestore();
  await writeClipboardEntry(item);

  if (!isTauriRuntime()) return;

  // The backend hides Qx, restores the app that was frontmost before the
  // floating shell appeared, waits for it to become frontmost, then posts Cmd+V.
  await invoke("plugin_perform_paste");
}

export async function pasteClipboardEntryAtCursor(item: ClipboardEntry): Promise<void> {
  await pasteClipboardEntry(item, { focusAtCursor: true });
}

export async function loadClipboardEntryById(id: string): Promise<ClipboardEntry | undefined> {
  const history = await invoke<ClipboardEntry[]>("get_clipboard_history", { limit: 200 });
  return history.find((entry) => entry.id === id);
}
