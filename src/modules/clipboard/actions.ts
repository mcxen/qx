import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ClipboardEntry } from "../../store";

const PASTE_FOCUS_DELAY_MS = 140;

interface PasteClipboardEntryOptions {
  focusAtCursor?: boolean;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function writeClipboardEntry(item: ClipboardEntry): Promise<void> {
  if (item.image_path) {
    await invoke("write_clipboard_image_entry", { id: item.id });
  } else {
    await writeText(item.text);
  }
  await invoke("record_clipboard_copy", { id: item.id });
}

export async function pasteClipboardEntry(
  item: ClipboardEntry,
  options: PasteClipboardEntryOptions = {},
): Promise<void> {
  await writeClipboardEntry(item);

  if (!isTauriRuntime()) return;

  await getCurrentWindow().hide().catch(() => {});
  await wait(PASTE_FOCUS_DELAY_MS);
  await invoke(options.focusAtCursor ? "plugin_perform_paste_at_cursor" : "plugin_perform_paste");
}

export async function pasteClipboardEntryAtCursor(item: ClipboardEntry): Promise<void> {
  await pasteClipboardEntry(item, { focusAtCursor: true });
}

export async function loadClipboardEntryById(id: string): Promise<ClipboardEntry | undefined> {
  const history = await invoke<ClipboardEntry[]>("get_clipboard_history", { limit: 200 });
  return history.find((entry) => entry.id === id);
}
