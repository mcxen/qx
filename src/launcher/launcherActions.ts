import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AppEntry } from "../store";
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

export function createLauncherActions({
  item,
  onItemClick,
  onNavigate,
  t,
}: {
  item: AppEntry | null;
  onItemClick: (item: AppEntry) => void;
  onNavigate: (tab: string) => void;
  t: Translate;
}): LauncherAction[] {
  if (!item) return [];

  const kind = resolveLauncherItemKind(item);

  if (kind === "clipboard") {
    return [
      {
        id: "copy-text",
        label: t("launcher.action.copyText", "Copy Text"),
        kbd: "↵",
        run: async () => writeText(await readClipboardText(item)),
      },
      {
        id: "open-clipboard",
        label: t("launcher.action.openClipboard", "Open Clipboard History"),
        kbd: "⌘ ↵",
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
        kbd: "↵",
        run: () => onItemClick(item),
      },
    ];
  }

  if (kind === "calculation") {
    return [
      {
        id: "copy-result",
        label: t("launcher.action.copyResult", "Copy Result"),
        kbd: "↵",
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
      kbd: "↵",
      run: () => onItemClick(item),
    },
    {
      id: "reveal",
      label: t("launcher.action.showInFinder", "Show in Finder"),
      kbd: "⌘ ↵",
      run: () => revealItemInDir(item.path),
    },
    {
      id: "copy-path",
      label: t("launcher.action.copyPath", "Copy Path"),
      kbd: "⌘ C",
      run: () => writeText(item.path),
    },
    ...(kind === "app"
      ? [
          {
            id: "show-package",
            label: t("launcher.action.showPackage", "Show Package Contents"),
            kbd: "⌥ ⌘ ↵",
            run: () => openPath(`${item.path}/Contents`),
          },
        ]
      : []),
  ];
}
