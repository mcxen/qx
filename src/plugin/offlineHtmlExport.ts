import { invoke } from "@tauri-apps/api/core";
import { islandHost } from "../island";
import { utf8TextToBase64 } from "./workbenchHtmlExport";
import {
  WorkbenchImageInliningError,
  type WorkbenchImageInliningProgress,
} from "./workbenchImageInlining";

export interface OfflineHtmlDocument {
  filename: string;
  html: string;
}

/** Host-owned Downloads + Island feedback used by Workbench and first-party HTML save. */
export async function runHostOfflineHtmlExport(input: {
  sessionId: string;
  title?: string;
  t: (key: string, fallback: string) => string;
  embed: (onProgress: (progress: WorkbenchImageInliningProgress) => void) => Promise<OfflineHtmlDocument>;
}): Promise<void> {
  const { sessionId, t } = input;
  islandHost.show({
    id: sessionId,
    priority: "task",
    source: "shell",
    placement: "docked",
    sticky: true,
    progressSilent: true,
    content: {
      primary: t("plugins.workbench.export.saving", "Saving HTML…"),
      secondary: input.title,
      meter: { kind: "activity", activity: "wave" },
    },
  });
  try {
    const exported = await input.embed(({ completed, total }) => {
      islandHost.update(sessionId, {
        content: {
          secondary: t(
            "plugins.workbench.export.embeddingImages",
            "Embedding images {completed}/{total}",
          )
            .replace("{completed}", String(completed))
            .replace("{total}", String(total)),
          meter: {
            kind: "progress",
            progress: total > 0 ? (completed / total) * 100 : 100,
          },
        },
      });
    });
    const path = await invoke<string>("plugin_system_save_download", {
      filename: exported.filename,
      mimeType: "text/html;charset=utf-8",
      dataBase64: utf8TextToBase64(exported.html),
    });
    islandHost.show({
      id: sessionId,
      priority: "toast",
      source: "shell",
      placement: "docked",
      sticky: false,
      ttlMs: 5_000,
      content: {
        primary: t("plugins.workbench.export.saved", "Offline HTML saved"),
        secondary: path,
        tone: "success",
      },
    });
  } catch (error) {
    const detailText = error instanceof WorkbenchImageInliningError
      ? t(
        "plugins.workbench.export.imageFailed",
        "Could not embed {failed} of {total} images. No file was saved.",
      )
        .replace("{failed}", String(error.failed))
        .replace("{total}", String(error.total))
      : String(error);
    islandHost.show({
      id: sessionId,
      priority: "error",
      source: "shell",
      placement: "docked",
      sticky: false,
      ttlMs: 8_000,
      content: {
        primary: t("plugins.workbench.export.failed", "Could not save HTML"),
        secondary: detailText,
        tone: "danger",
      },
    });
  }
}
