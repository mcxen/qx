import { Eye, EyeOff, Keyboard, Pencil, Pin, PinOff, Star, Trash2 } from "lucide-react";
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
import {
  isEntryHidden,
  isEntryPinned,
  metadataForKey,
  metadataKeyForEntry,
  nextPinOrder,
} from "../search/searchMetadata";
import type { AppEntry } from "../store";
import {
  countEnabledGlobalShortcuts,
  globalShortcutHasConflict,
} from "../utils/keyboard";
import { usePluginRegistry } from "../plugin/registry";
import {
  isQuickEntryAlreadyAdded,
  quickEntryFromAppEntry,
  sanitizeQuickEntries,
} from "./quickEntries";

function isNativeAppEntry(item: AppEntry): boolean {
  return (item.kind ?? "app") === "app" && !!item.path && !item.path.startsWith("__qx:");
}

/** Apps, plugins, and modules that support pin / hide / quick entry / aliases. */
function isManageableLauncherEntry(item: AppEntry): boolean {
  if (isNativeAppEntry(item)) return true;
  if (item.path.startsWith("__qx:plugin:")) return true;
  if (item.path.startsWith("__qx:cmd:")) return true;
  if (
    /^__qx:(clipboard|screencap|rss|v2ex|weather|qx-ai|macros|documents|qx-tty|settings)$/.test(
      item.path,
    )
  ) {
    return true;
  }
  return false;
}

function supportsGlobalAppShortcut(item: AppEntry): boolean {
  // OS app launch only — plugins use manifest shortcuts / open tab separately.
  return isNativeAppEntry(item);
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
  const { settings, patch, patchAppShortcut, patchSearchMetadata } = useSettingsStore();
  const plugins = usePluginRegistry((state) => state.plugins);
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
  const pinned = isEntryPinned(settings, metadataKey);
  const hidden = isEntryHidden(settings, metadataKey);
  const quickCandidate = quickEntryFromAppEntry(item, plugins);
  const quickAlready = quickCandidate
    ? isQuickEntryAlreadyAdded(settings.quick_entries, quickCandidate.target)
    : false;
  const canShortcut = supportsGlobalAppShortcut(item) && Boolean(metadataKey);

  if (!isManageableLauncherEntry(item) || !metadataKey) {
    return <>{children}</>;
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent alignOffset={-4} className="qx-app-context-menu">
          <ContextMenuItem
            onSelect={() => {
              if (pinned) {
                patchSearchMetadata(metadataKey, {
                  ...metadata,
                  pinned: false,
                  pin_order: undefined,
                });
              } else {
                patchSearchMetadata(metadataKey, {
                  ...metadata,
                  pinned: true,
                  pin_order: nextPinOrder(settings),
                  hidden: false,
                });
              }
            }}
          >
            {pinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}
            <span>
              {pinned
                ? t("launcher.unpinApp", "Unpin from top")
                : t("launcher.pinApp", "Pin to top")}
            </span>
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              if (hidden) {
                patchSearchMetadata(metadataKey, {
                  ...metadata,
                  hidden: false,
                });
              } else {
                patchSearchMetadata(metadataKey, {
                  ...metadata,
                  hidden: true,
                  pinned: false,
                  pin_order: undefined,
                });
              }
            }}
          >
            {hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
            <span>
              {hidden
                ? t("launcher.showOnHome", "Show on home list")
                : t("launcher.hideFromHome", "Hide from home list")}
            </span>
          </ContextMenuItem>
          {quickCandidate && (
            <ContextMenuItem
              disabled={quickAlready}
              onSelect={() => {
                if (quickAlready) return;
                const drafts = sanitizeQuickEntries(settings.quick_entries);
                patch("quick_entries", [...drafts, quickCandidate]);
              }}
            >
              <Star size={14} aria-hidden="true" />
              <span>
                {quickAlready
                  ? t("launcher.quickEntryAlready", "Already a Quick Entry")
                  : t("launcher.addToQuickEntries", "Add to Quick Entries")}
              </span>
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setAliasesOpen(true)}>
            <Pencil size={14} aria-hidden="true" />
            <span>{t("launcher.editAliases", "Edit aliases")}</span>
          </ContextMenuItem>
          {canShortcut && (
            <ContextMenuItem onSelect={() => setShortcutOpen(true)}>
              <Keyboard size={14} aria-hidden="true" />
              <span>
                {hasShortcut
                  ? t("launcher.editShortcut", "Edit shortcut")
                  : t("launcher.recordShortcut", "Record shortcut")}
              </span>
              {hasShortcut && <Kbd>{binding?.key}</Kbd>}
            </ContextMenuItem>
          )}
          {canShortcut && hasShortcut && (
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

      {canShortcut && (
        <Dialog open={shortcutOpen} onOpenChange={setShortcutOpen}>
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
      )}
    </>
  );
}
