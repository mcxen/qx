import { useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { QxShellAction } from "../components/QxShell";
import { useLocale, useT } from "../i18n";
import { islandHost } from "../island";
import type { PluginWorkbenchAction, PluginWorkbenchDetail } from "./workbenchTypes";
import {
  buildWorkbenchHtmlExport,
  isWorkbenchHtmlExportable,
  utf8TextToBase64,
} from "./workbenchHtmlExport";
import {
  inlineWorkbenchDetailImages,
  WorkbenchImageInliningError,
} from "./workbenchImageInlining";

const WORKBENCH_HTML_EXPORT_ACTION_ID = "__qx:workbench-save-html";

function exportMenuKey(actions: PluginWorkbenchAction[]): string | undefined {
  const used = new Set(actions.map((action) => action.menuKey?.toLowerCase()).filter(Boolean));
  return ["s", "e", "h", "l", ..."acfgijkmnopqrtuvwxyz"]
    .find((key) => !used.has(key) && key !== "b" && key !== "d");
}

interface UseWorkbenchHtmlExportActionInput {
  pluginId: string;
  pluginName: string;
  panelTitle?: string;
  itemTitle?: string;
  detail?: PluginWorkbenchDetail;
  visible: boolean;
  existingActions: PluginWorkbenchAction[];
}

/** Host-reserved Action that saves a trusted information-detail snapshot. */
export function useWorkbenchHtmlExportAction({
  pluginId,
  pluginName,
  panelTitle,
  itemTitle,
  detail,
  visible,
  existingActions,
}: UseWorkbenchHtmlExportActionInput): QxShellAction | undefined {
  const t = useT();
  const locale = useLocale();
  const savingRef = useRef(false);
  const save = useCallback(async () => {
    if (!detail || !isWorkbenchHtmlExportable(detail) || savingRef.current) return;
    savingRef.current = true;
    const sessionId = `plugin.workbench-export.${pluginId}`;
    islandHost.show({
      id: sessionId,
      priority: "task",
      source: "shell",
      placement: "docked",
      sticky: true,
      progressSilent: true,
      content: {
        primary: t("plugins.workbench.export.saving", "Saving HTML…"),
        secondary: itemTitle || detail.title,
        meter: { kind: "activity", activity: "wave" },
      },
    });
    try {
      const offlineDetail = await inlineWorkbenchDetailImages(pluginId, detail, ({ completed, total }) => {
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
      const exported = buildWorkbenchHtmlExport({
        detail: offlineDetail,
        itemTitle,
        panelTitle,
        pluginName,
        locale,
        labels: {
          savedFrom: t("plugins.workbench.export.savedFrom", "Saved from {source} with Qx"),
          savedAt: t("plugins.workbench.export.savedAt", "Saved at {time}"),
          replies: t("plugins.workbench.replies", "Replies"),
          replyTo: t("plugins.workbench.replies.replyTo", "Reply to {author}"),
          originalPoster: t("plugins.workbench.replies.op", "OP"),
          likes: t("plugins.workbench.export.likes", "♥ {count}"),
          loadedReplies: t(
            "plugins.workbench.export.loadedReplies",
            "This snapshot contains {loaded} of {total} replies available upstream.",
          ),
        },
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
    } finally {
      savingRef.current = false;
    }
  }, [detail, itemTitle, locale, panelTitle, pluginId, pluginName, t]);

  return useMemo(() => {
    if (!visible || !isWorkbenchHtmlExportable(detail)) return undefined;
    return {
      id: WORKBENCH_HTML_EXPORT_ACTION_ID,
      label: t("plugins.workbench.export.action", "Save Offline HTML"),
      menuKey: exportMenuKey(existingActions),
      onClick: () => { void save(); },
    };
  }, [detail, existingActions, save, t, visible]);
}
