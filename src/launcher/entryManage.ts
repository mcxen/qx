/**
 * Shared launcher entry management (pin / hide / aliases / app shortcut).
 * Used by right-click context menu and Cmd+K Actions.
 */
import type { AppEntry } from "../store";
import type { SearchMetadataEntry, Settings } from "../modules/settings/store";
import {
  isEntryHidden,
  isEntryPinned,
  metadataForKey,
  metadataKeyForEntry,
  nextPinOrder,
} from "../search/searchMetadata";

export function isNativeAppEntry(item: AppEntry): boolean {
  return (item.kind ?? "app") === "app" && !!item.path && !item.path.startsWith("__qx:");
}

/** Apps, plugins, and modules that support pin / hide / aliases. */
export function isManageableLauncherEntry(item: AppEntry): boolean {
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

/** Global launch shortcut — OS apps only (plugins use their own bindings). */
export function supportsGlobalAppShortcut(item: AppEntry): boolean {
  return isNativeAppEntry(item);
}

export function launcherEntryManageState(settings: Settings, item: AppEntry) {
  const metadataKey = metadataKeyForEntry(item);
  const metadata = metadataForKey(settings, metadataKey);
  const binding = metadataKey ? settings.app_shortcuts[metadataKey] : undefined;
  return {
    metadataKey,
    metadata,
    binding,
    hasShortcut: Boolean(binding?.key?.trim()),
    pinned: isEntryPinned(settings, metadataKey),
    hidden: isEntryHidden(settings, metadataKey),
    canManage: Boolean(metadataKey) && isManageableLauncherEntry(item),
    canShortcut: Boolean(metadataKey) && supportsGlobalAppShortcut(item),
  };
}

export function toggleLauncherEntryPin(
  settings: Settings,
  metadataKey: string,
  metadata: SearchMetadataEntry,
  patchSearchMetadata: (id: string, value: SearchMetadataEntry) => void,
): void {
  if (isEntryPinned(settings, metadataKey)) {
    patchSearchMetadata(metadataKey, {
      ...metadata,
      pinned: false,
      pin_order: undefined,
    });
    return;
  }
  patchSearchMetadata(metadataKey, {
    ...metadata,
    pinned: true,
    pin_order: nextPinOrder(settings),
    hidden: false,
  });
}

export function toggleLauncherEntryHidden(
  settings: Settings,
  metadataKey: string,
  metadata: SearchMetadataEntry,
  patchSearchMetadata: (id: string, value: SearchMetadataEntry) => void,
): void {
  if (isEntryHidden(settings, metadataKey)) {
    patchSearchMetadata(metadataKey, {
      ...metadata,
      hidden: false,
    });
    return;
  }
  patchSearchMetadata(metadataKey, {
    ...metadata,
    hidden: true,
    pinned: false,
    pin_order: undefined,
  });
}
