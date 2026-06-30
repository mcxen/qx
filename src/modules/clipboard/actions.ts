import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ClipboardEntry } from "../../store";

const PASTE_FOCUS_DELAY_MS = 60;

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
  _options: PasteClipboardEntryOptions = {},
): Promise<void> {
  await writeClipboardEntry(item);

  if (!isTauriRuntime()) return;

  // The panel is non-activating, so the user's foreground app still has key
  // focus. We just need to hide ourselves so the panel doesn't visually
  // overlap the target, then post a synthetic Cmd+V into the OS — which
  // lands in whichever app the user was actually using.
  await invoke("floating_hide").catch(() => {});
  await wait(PASTE_FOCUS_DELAY_MS);
  await invoke("plugin_perform_paste");
}

export async function pasteClipboardEntryAtCursor(item: ClipboardEntry): Promise<void> {
  await pasteClipboardEntry(item, { focusAtCursor: true });
}

export async function loadClipboardEntryById(id: string): Promise<ClipboardEntry | undefined> {
  const history = await invoke<ClipboardEntry[]>("get_clipboard_history", { limit: 200 });
  return history.find((entry) => entry.id === id);
}
