/**
 * System clipboard port for image file publish.
 * Features (capture toast, export actions) share this capability.
 */
import { invoke } from "@tauri-apps/api/core";

/** Copy an image file on disk onto the system clipboard. */
export function writeImageFileToClipboard(path: string): Promise<void> {
  return invoke<void>("clipboard_write_image_file", { path });
}
