import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir, openPath } from "@tauri-apps/plugin-opener";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { AppEntry } from "../store";
import type { LauncherAction } from "./types";

type LauncherItemKind = NonNullable<AppEntry["kind"]>;

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

export function getLauncherActionTitle(item: AppEntry): string {
  const kind = resolveLauncherItemKind(item);
  if (kind === "file" || kind === "folder") return "File Actions";
  if (kind === "clipboard") return "Clipboard Actions";
  if (kind === "command" || kind === "calculation") return "Command Actions";
  return "Application Actions";
}

export function createLauncherActions({
  item,
  onItemClick,
  onNavigate,
}: {
  item: AppEntry | null;
  onItemClick: (item: AppEntry) => void;
  onNavigate: (tab: string) => void;
}): LauncherAction[] {
  if (!item) return [];

  const kind = resolveLauncherItemKind(item);

  if (kind === "clipboard") {
    return [
      {
        id: "copy-text",
        label: "Copy Text",
        kbd: "↵",
        run: async () => writeText(await readClipboardText(item)),
      },
      {
        id: "open-clipboard",
        label: "Open Clipboard History",
        kbd: "⌘ ↵",
        run: () => onNavigate("clipboard"),
      },
    ];
  }

  if (kind === "command") {
    return [
      {
        id: "run-command",
        label: item.path === "__qx:settings" ? "Open Settings" : "Run Command",
        kbd: "↵",
        run: () => onItemClick(item),
      },
    ];
  }

  if (kind === "calculation") {
    return [
      {
        id: "copy-result",
        label: "Copy Result",
        kbd: "↵",
        run: () => onItemClick(item),
      },
    ];
  }

  return [
    {
      id: "open",
      label: kind === "file" ? "Open File" : "Open Application",
      kbd: "↵",
      run: () => onItemClick(item),
    },
    {
      id: "reveal",
      label: "Show in Finder",
      kbd: "⌘ ↵",
      run: () => revealItemInDir(item.path),
    },
    {
      id: "copy-path",
      label: "Copy Path",
      kbd: "⌘ C",
      run: () => writeText(item.path),
    },
    ...(kind === "app"
      ? [
          {
            id: "show-package",
            label: "Show Package Contents",
            kbd: "⌥ ⌘ ↵",
            run: () => openPath(`${item.path}/Contents`),
          },
        ]
      : []),
  ];
}
