import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ClipboardEntry } from "../../store";

interface PasteClipboardEntryOptions {
  focusAtCursor?: boolean;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
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
