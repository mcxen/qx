import { useMemo } from "react";
import SearchAliasTagEditor from "../components/SearchAliasTagEditor";
import ShortcutRecorder from "../components/ShortcutRecorder";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui";
import { useT } from "../i18n";
import { useSettingsStore } from "../modules/settings/store";
import { useDisplayName } from "../search/appDisplay";
import {
  countEnabledGlobalShortcuts,
  globalShortcutHasConflict,
} from "../utils/keyboard";
import type { AppEntry } from "../store";
import { launcherEntryManageState } from "./entryManage";

export type LauncherManageDialogKind = "aliases" | "shortcut";

export interface LauncherManageDialogRequest {
  kind: LauncherManageDialogKind;
  item: AppEntry;
}

/**
 * Alias + global-shortcut dialogs for a launcher entry.
 * Shared by right-click context menu and Cmd+K Actions.
 */
export default function LauncherEntryManageDialogs({
  request,
  onClose,
}: {
  request: LauncherManageDialogRequest | null;
  onClose: () => void;
}) {
  const t = useT();
  const getDisplayName = useDisplayName();
  const { settings, patchAppShortcut, patchSearchMetadata } = useSettingsStore();
  const item = request?.item ?? null;
  const kind = request?.kind ?? null;
  const appName = item ? getDisplayName(item) : "";
  const manage = item
    ? launcherEntryManageState(settings, item)
    : null;
  const counts = useMemo(
    () => countEnabledGlobalShortcuts(settings.shortcuts, settings.app_shortcuts),
    [settings.shortcuts, settings.app_shortcuts],
  );
  const shortcutConflict =
    manage?.binding != null
      ? globalShortcutHasConflict(manage.binding, counts)
      : false;

  if (!item || !manage?.metadataKey || !kind) return null;

  const { metadataKey, metadata, binding, hasShortcut, canShortcut } = manage;

  return (
    <>
      <Dialog
        open={kind === "aliases"}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent style={{ width: "min(420px, calc(100vw - 40px))" }}>
          <DialogHeader>
            <DialogTitle>{t("launcher.editAliases", "Edit aliases")}</DialogTitle>
            <DialogDescription>{appName}</DialogDescription>
          </DialogHeader>
          <SearchAliasTagEditor
            entry={metadata}
            onChange={(next) => patchSearchMetadata(metadataKey, next)}
          />
          <div className="qx-modal-actions">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t("launcher.done", "Done")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {canShortcut && (
        <Dialog
          open={kind === "shortcut"}
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
        >
          <DialogContent style={{ width: "min(420px, calc(100vw - 40px))" }}>
            <DialogHeader>
              <DialogTitle>{t("launcher.appShortcut", "Application shortcut")}</DialogTitle>
              <DialogDescription>
                {t(
                  "launcher.appShortcut.desc",
                  "Launch this app from anywhere with a global shortcut.",
                )}
                {" · "}
                {appName}
              </DialogDescription>
            </DialogHeader>
            <div className="qx-app-shortcut-dialog">
              <div>
                <div className="qx-modal-field-label">{t("launcher.shortcut", "Shortcut")}</div>
                <ShortcutRecorder
                  initial={binding?.key ?? ""}
                  conflict={shortcutConflict}
                  onCommit={(next) =>
                    patchAppShortcut(metadataKey, {
                      ...next,
                      enabled: next.key.trim() ? (next.enabled ?? true) : false,
                    })
                  }
                  onCancel={() => {}}
                />
                {shortcutConflict && (
                  <div className="qx-modal-error">
                    {t(
                      "launcher.shortcutConflict",
                      "This shortcut is already used by another action.",
                    )}
                  </div>
                )}
              </div>
              <div className="qx-modal-actions">
                {hasShortcut && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => patchAppShortcut(metadataKey, { key: "", enabled: false })}
                  >
                    {t("launcher.remove", "Remove")}
                  </Button>
                )}
                <Button type="button" variant="secondary" onClick={onClose}>
                  {t("launcher.done", "Done")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
