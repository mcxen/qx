import { Keyboard, Pencil, Trash2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import SearchAliasTagEditor from "../components/SearchAliasTagEditor";
import ShortcutRecorder from "../components/ShortcutRecorder";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Kbd,
} from "../components/ui";
import { useT } from "../i18n";
import { useSettingsStore } from "../modules/settings/store";
import { useDisplayName } from "../search/appDisplay";
import { metadataForKey, metadataKeyForEntry } from "../search/searchMetadata";
import type { AppEntry } from "../store";
import {
  countEnabledGlobalShortcuts,
  globalShortcutHasConflict,
} from "../utils/keyboard";

function isApplicationEntry(item: AppEntry): boolean {
  return (item.kind ?? "app") === "app" && item.path.endsWith(".app");
}



export default function AppResultContextMenu({
  item,
  children,
}: {
  item: AppEntry;
  children: ReactNode;
}) {
  const t = useT();
  const getDisplayName = useDisplayName();
  const { settings, patchAppShortcut, patchSearchMetadata } = useSettingsStore();
  const [aliasesOpen, setAliasesOpen] = useState(false);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const appName = getDisplayName(item);
  const metadataKey = metadataKeyForEntry(item);
  const metadata = metadataForKey(settings, metadataKey);
  const binding = metadataKey ? settings.app_shortcuts[metadataKey] : undefined;
  const counts = useMemo(
    () => countEnabledGlobalShortcuts(settings.shortcuts, settings.app_shortcuts),
    [settings.shortcuts, settings.app_shortcuts],
  );
  const hasShortcut = Boolean(binding?.key);
  const shortcutConflict = globalShortcutHasConflict(binding, counts);

  if (!isApplicationEntry(item) || !metadataKey) {
    return <>{children}</>;
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent alignOffset={-4} className="qx-app-context-menu">
          <ContextMenuItem onSelect={() => setAliasesOpen(true)}>
            <Pencil size={14} aria-hidden="true" />
            <span>{t("launcher.editAliases", "Edit aliases")}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setShortcutOpen(true)}>
            <Keyboard size={14} aria-hidden="true" />
            <span>
              {hasShortcut
                ? t("launcher.editShortcut", "Edit shortcut")
                : t("launcher.recordShortcut", "Record shortcut")}
            </span>
            {hasShortcut && <Kbd>{binding?.key}</Kbd>}
          </ContextMenuItem>
          {hasShortcut && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="is-danger"
                onSelect={() => patchAppShortcut(metadataKey, { key: "", enabled: false })}
              >
                <Trash2 size={14} aria-hidden="true" />
                <span>{t("launcher.removeShortcut", "Remove shortcut")}</span>
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={aliasesOpen} onOpenChange={setAliasesOpen}>
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
            <Button type="button" variant="secondary" onClick={() => setAliasesOpen(false)}>
              {t("launcher.done", "Done")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={shortcutOpen} onOpenChange={setShortcutOpen}>
        <DialogContent style={{ width: "min(420px, calc(100vw - 40px))" }}>
          <DialogHeader>
            <DialogTitle>{t("launcher.appShortcut", "Application shortcut")}</DialogTitle>
            <DialogDescription>{appName}</DialogDescription>
          </DialogHeader>
          <div className="qx-app-shortcut-dialog">
            <div>
              <div className="qx-modal-field-label">{t("launcher.shortcut", "Shortcut")}</div>
              <ShortcutRecorder
                initial={binding?.key ?? ""}
                conflict={shortcutConflict}
                onCommit={(next) => patchAppShortcut(metadataKey, next)}
                onCancel={() => {}}
              />
              {shortcutConflict && (
                <div className="qx-modal-error">
                  {t("launcher.shortcutConflict", "This shortcut is already used by another action.")}
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
              <Button type="button" variant="secondary" onClick={() => setShortcutOpen(false)}>
                {t("launcher.done", "Done")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
