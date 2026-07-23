import { Eye, EyeOff, Keyboard, Pencil, Pin, PinOff, Star, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Kbd,
} from "../components/ui";
import { useT } from "../i18n";
import { useSettingsStore } from "../modules/settings/store";
import type { AppEntry } from "../store";
import {
  isQuickEntryAlreadyAdded,
  quickEntryFromAppEntry,
  sanitizeQuickEntries,
} from "./quickEntries";
import {
  launcherEntryManageState,
  toggleLauncherEntryHidden,
  toggleLauncherEntryPin,
} from "./entryManage";
import LauncherEntryManageDialogs, {
  type LauncherManageDialogRequest,
} from "./LauncherEntryManageDialogs";
import { usePluginRegistry } from "../plugin/registry";
import { metadataForKey } from "../search/searchMetadata";

export default function AppResultContextMenu({
  item,
  children,
}: {
  item: AppEntry;
  children: ReactNode;
}) {
  const t = useT();
  const { settings, patch, patchAppShortcut, patchSearchMetadata } = useSettingsStore();
  const plugins = usePluginRegistry((state) => state.plugins);
  const [dialog, setDialog] = useState<LauncherManageDialogRequest | null>(null);
  const manage = launcherEntryManageState(settings, item);
  const {
    metadataKey,
    binding,
    hasShortcut,
    pinned,
    hidden,
    canManage,
    canShortcut,
  } = manage;
  const quickCandidate = quickEntryFromAppEntry(item, plugins);
  const quickAlready = quickCandidate
    ? isQuickEntryAlreadyAdded(settings.quick_entries, quickCandidate.target)
    : false;

  if (!canManage || !metadataKey) {
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
              toggleLauncherEntryPin(
                settings,
                metadataKey,
                metadataForKey(settings, metadataKey),
                patchSearchMetadata,
              );
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
              toggleLauncherEntryHidden(
                settings,
                metadataKey,
                metadataForKey(settings, metadataKey),
                patchSearchMetadata,
              );
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
          <ContextMenuItem onSelect={() => setDialog({ kind: "aliases", item })}>
            <Pencil size={14} aria-hidden="true" />
            <span>{t("launcher.editAliases", "Edit aliases")}</span>
          </ContextMenuItem>
          {canShortcut && (
            <ContextMenuItem onSelect={() => setDialog({ kind: "shortcut", item })}>
              <Keyboard size={14} aria-hidden="true" />
              <span>
                {hasShortcut
                  ? t("launcher.editShortcut", "Edit shortcut")
                  : t("launcher.recordShortcut", "Record shortcut")}
              </span>
              {hasShortcut && binding?.key ? <Kbd>{binding.key}</Kbd> : null}
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

      <LauncherEntryManageDialogs request={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
