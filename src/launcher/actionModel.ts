import type { AppEntry } from "../store";
import type { QxDesktopPlatform } from "../utils/keyboard";

export type LauncherItemKind = NonNullable<AppEntry["kind"]>;

export interface LauncherActionModel {
  kind: LauncherItemKind;
  titleKey: string;
  titleFallback: string;
  primaryKey: string;
  primaryFallback: string;
  hasPathActions: boolean;
  showsPackageContents: boolean;
}

export function resolveLauncherItemKind(item: AppEntry): LauncherItemKind {
  return item.kind ?? (item.path.startsWith("__qx:") ? "command" : "app");
}

/**
 * One semantic classifier for the Bottom Bar and Actions menu.
 *
 * File extensions deliberately do not select product actions: every ordinary
 * file is opened by the platform shell, which delegates PDF/image/archive/etc.
 * to its registered default application. Directories open in Finder/Explorer;
 * only native application entries use application wording and app-only tools.
 */
export function launcherActionModel(
  item: AppEntry,
  platform: QxDesktopPlatform,
): LauncherActionModel {
  const kind = resolveLauncherItemKind(item);
  switch (kind) {
    case "file":
      return {
        kind,
        titleKey: "launcher.action.fileActions",
        titleFallback: "File Actions",
        primaryKey: "launcher.action.openFile",
        primaryFallback: "Open File",
        hasPathActions: true,
        showsPackageContents: false,
      };
    case "folder":
      return {
        kind,
        titleKey: "launcher.action.fileActions",
        titleFallback: "File Actions",
        primaryKey: "launcher.action.openFolder",
        primaryFallback: "Open Folder",
        hasPathActions: true,
        showsPackageContents: false,
      };
    case "clipboard":
      return {
        kind,
        titleKey: "launcher.action.clipboardActions",
        titleFallback: "Clipboard Actions",
        primaryKey: "launcher.action.copyText",
        primaryFallback: "Copy Text",
        hasPathActions: false,
        showsPackageContents: false,
      };
    case "command":
      return {
        kind,
        titleKey: "launcher.action.commandActions",
        titleFallback: "Command Actions",
        primaryKey: item.path === "__qx:settings"
          ? "launcher.action.openSettings"
          : "launcher.action.runCommand",
        primaryFallback: item.path === "__qx:settings" ? "Open Settings" : "Run Command",
        hasPathActions: false,
        showsPackageContents: false,
      };
    case "calculation":
      return {
        kind,
        titleKey: "launcher.action.commandActions",
        titleFallback: "Command Actions",
        primaryKey: "launcher.action.copyResult",
        primaryFallback: "Copy Result",
        hasPathActions: false,
        showsPackageContents: false,
      };
    case "app":
      return {
        kind,
        titleKey: "launcher.action.appActions",
        titleFallback: "Application Actions",
        primaryKey: "launcher.action.openApp",
        primaryFallback: "Open Application",
        hasPathActions: true,
        showsPackageContents:
          platform === "macos" && item.path.toLowerCase().endsWith(".app"),
      };
  }
}
