import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Calculator,
  Clipboard,
  CloudSun,
  FileText,
  Keyboard,
  MessageCircle,
  MonitorPlay,
  Rss,
  Settings,
  SquareTerminal,
} from "lucide-react";

/** Shared icon catalog for built-in modules across launcher and settings surfaces. */
export const BUILTIN_MODULE_ICONS: Record<string, LucideIcon> = {
  "builtin:clipboard": Clipboard,
  "builtin:qx-ai": Bot,
  "builtin:screencap": MonitorPlay,
  "builtin:rss": Rss,
  "builtin:v2ex": MessageCircle,
  "builtin:macros": Keyboard,
  "builtin:documents": FileText,
  "builtin:weather": CloudSun,
  "builtin:qx-tty": SquareTerminal,
  "builtin:settings": Settings,
  "builtin:calculator": Calculator,
};

export function normalizeBuiltinIconId(value: string): string {
  let id = value.trim().toLowerCase();
  while (id.startsWith("builtin:")) id = id.slice("builtin:".length);
  return id ? `builtin:${id}` : "";
}

export function builtinModuleIcon(value: string): LucideIcon | null {
  return BUILTIN_MODULE_ICONS[normalizeBuiltinIconId(value)] ?? null;
}

export function builtinModuleIconKind(value: string): string {
  switch (normalizeBuiltinIconId(value)) {
    case "builtin:clipboard":
      return "clipboard";
    case "builtin:qx-ai":
      return "qx-ai";
    case "builtin:screencap":
      return "record";
    case "builtin:rss":
      return "rss";
    case "builtin:v2ex":
      return "v2ex";
    case "builtin:macros":
      return "macro";
    case "builtin:documents":
      return "document";
    case "builtin:weather":
      return "weather";
    case "builtin:qx-tty":
      return "terminal";
    case "builtin:settings":
      return "settings";
    case "builtin:calculator":
      return "calculator";
    default:
      return "command";
  }
}
