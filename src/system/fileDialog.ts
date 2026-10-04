import { invoke } from "@tauri-apps/api/core";
import { open, type OpenDialogOptions } from "@tauri-apps/plugin-dialog";

/** Keep the host visible until the native picker settles, including cancellation. */
export async function openNativeFileDialog(
  options: OpenDialogOptions,
): Promise<string | string[] | null> {
  await invoke("floating_set_external_interaction_active", { active: true, fileDialog: true });
  try {
    return await open(options);
  } finally {
    await invoke("floating_set_external_interaction_active", { active: false, fileDialog: true });
  }
}
