import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AppEntry } from "../store";
import type { Settings } from "../modules/settings/store";
import { useSettingsStore } from "../modules/settings/store";
import { openSystemPath, revealSystemPath } from "../system";
import { metadataForKey } from "../search/searchMetadata";
import {
  launcherEntryManageState,
  toggleLauncherEntryHidden,
  toggleLauncherEntryPin,
} from "./entryManage";
import type { LauncherAction } from "./types";

type LauncherItemKind = NonNullable<AppEntry["kind"]>;
type Translate = (key: string, fallback: string) => string;

async function readClipboardText(item: AppEntry): Promise<string> {
  const id = item.path.slice("__qx:clipboard:".length);
  const history = await invoke<{ id: string; text: string }[]>(
    "get_clipboard_history",
    { limit: 200 },
  );
  return history.find((entry) => entry.id === id)?.text ?? item.name;
}

function resolveLauncherItemKind(item: AppEntry): LauncherItemKind {
  return item.kind ?? (item.path.startsWith("__qx:") ? "command" : "app");
}

export function getLauncherActionTitle(item: AppEntry, t: Translate): string {
  const kind = resolveLauncherItemKind(item);
  if (kind === "file" || kind === "folder") return t("launcher.action.fileActions", "File Actions");
  if (kind === "clipboard") return t("launcher.action.clipboardActions", "Clipboard Actions");
  if (kind === "command" || kind === "calculation") return t("launcher.action.commandActions", "Command Actions");
  return t("launcher.action.appActions", "Application Actions");
}

function manageEntryActions({
  item,
  settings,
  t,
  onEditAliases,
  onRecordShortcut,
}: {
  item: AppEntry;
  settings: Settings;
  t: Translate;
  onEditAliases?: (item: AppEntry) => void;
  onRecordShortcut?: (item: AppEntry) => void;
}): LauncherAction[] {
  const manage = launcherEntryManageState(settings, item);
  if (!manage.canManage || !manage.metadataKey) return [];

  const { metadataKey, hasShortcut, pinned, hidden, canShortcut } = manage;
  const actions: LauncherAction[] = [
    {
      id: "pin",
      label: pinned
        ? t("launcher.unpinApp", "Unpin from top")
        : t("launcher.pinApp", "Pin to top"),
      menuKey: "p",
      run: () => {
        const store = useSettingsStore.getState();
        toggleLauncherEntryPin(
          store.settings,
          metadataKey,
          metadataForKey(store.settings, metadataKey),
          store.patchSearchMetadata,
        );
      },
    },
    {
      id: "hide-home",
      label: hidden
        ? t("launcher.showOnHome", "Show on home list")
        : t("launcher.hideFromHome", "Hide from home list"),
      menuKey: "h",
      run: () => {
        const store = useSettingsStore.getState();
        toggleLauncherEntryHidden(
          store.settings,
          metadataKey,
          metadataForKey(store.settings, metadataKey),
          store.patchSearchMetadata,
        );
      },
    },
    {
      id: "edit-aliases",
      label: t("launcher.editAliases", "Edit aliases"),
      menuKey: "a",
      run: () => onEditAliases?.(item),
    },
  ];

  if (canShortcut) {
    actions.push({
      id: "record-shortcut",
      label: hasShortcut
        ? t("launcher.editShortcut", "Edit shortcut")
        : t("launcher.recordShortcut", "Record shortcut"),
      menuKey: "s",
      kbd: hasShortcut ? manage.binding?.key : undefined,
      run: () => onRecordShortcut?.(item),
    });
    if (hasShortcut) {
      actions.push({
        id: "remove-shortcut",
        label: t("launcher.removeShortcut", "Remove shortcut"),
        menuKey: "r",
        danger: true,
        run: () => {
          useSettingsStore.getState().patchAppShortcut(metadataKey, {
            key: "",
            enabled: false,
          });
        },
      });
    }
  }

  return actions;
}

export function createLauncherActions({
  item,
  onItemClick,
  onNavigate,
  t,
  settings,
  onEditAliases,
  onRecordShortcut,
}: {
  item: AppEntry | null;
  onItemClick: (item: AppEntry) => void;
  onNavigate: (tab: string) => void;
  t: Translate;
  settings: Settings;
  onEditAliases?: (item: AppEntry) => void;
  onRecordShortcut?: (item: AppEntry) => void;
}): LauncherAction[] {
  if (!item) return [];

  const kind = resolveLauncherItemKind(item);
  const manage = manageEntryActions({
    item,
    settings,
    t,
    onEditAliases,
    onRecordShortcut,
  });

  if (kind === "clipboard") {
    return [
      {
        id: "copy-text",
        label: t("launcher.action.copyText", "Copy Text"),
        kbd: "Enter",
        run: async () => writeText(await readClipboardText(item)),
      },
      {
        id: "open-clipboard",
        label: t("launcher.action.openClipboard", "Open Clipboard History"),
        kbd: "CmdOrCtrl+Enter",
        run: () => onNavigate("clipboard"),
      },
    ];
  }

  if (kind === "command") {
    return [
      {
        id: "run-command",
        label: item.path === "__qx:settings"
          ? t("launcher.action.openSettings", "Open Settings")
          : t("launcher.action.runCommand", "Run Command"),
        kbd: "Enter",
        run: () => onItemClick(item),
      },
      ...manage,
    ];
  }

  if (kind === "calculation") {
    return [
      {
        id: "copy-result",
        label: t("launcher.action.copyResult", "Copy Result"),
        kbd: "Enter",
        run: () => onItemClick(item),
      },
    ];
  }

  return [
    {
      id: "open",
      label: kind === "file"
        ? t("launcher.action.openFile", "Open File")
        : t("launcher.action.openApp", "Open Application"),
      kbd: "Enter",
      run: () => onItemClick(item),
    },
    // Pin / aliases / shortcut sit near the top of Actions (Raycast-style manage).
    ...manage,
    {
      id: "reveal",
      label: t("launcher.action.showInFinder", "Show in Finder"),
      kbd: "CmdOrCtrl+Enter",
      run: () => revealSystemPath(item.path),
    },
    {
      id: "copy-path",
      label: t("launcher.action.copyPath", "Copy Path"),
      kbd: "CmdOrCtrl+C",
      run: () => writeText(item.path),
    },
    ...(kind === "app"
      ? [
          {
            id: "show-package",
            label: t("launcher.action.showPackage", "Show Package Contents"),
            kbd: "Alt+CmdOrCtrl+Enter",
            run: () => openSystemPath(`${item.path}/Contents`),
          },
        ]
      : []),
  ];
}
