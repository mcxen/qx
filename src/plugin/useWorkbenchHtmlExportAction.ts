import { useCallback, useMemo, useRef } from "react";
import type { QxShellAction } from "../components/QxShell";
import { useLocale, useT } from "../i18n";
import type { PluginWorkbenchAction, PluginWorkbenchDetail } from "./workbenchTypes";
import { buildWorkbenchHtmlExport, isWorkbenchHtmlExportable } from "./workbenchHtmlExport";
import { inlineWorkbenchDetailImages } from "./workbenchImageInlining";
import { runHostOfflineHtmlExport } from "./offlineHtmlExport";

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
    try {
      await runHostOfflineHtmlExport({
        sessionId: `plugin.workbench-export.${pluginId}`,
        title: itemTitle || detail.title,
        t,
        embed: async (onProgress) => {
          const offlineDetail = await inlineWorkbenchDetailImages(pluginId, detail, onProgress);
          return buildWorkbenchHtmlExport({
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
