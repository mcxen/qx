import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Clipboard,
  CloudSun,
  FileText,
  Keyboard,
  MessageCircle,
  MonitorPlay,
  Rss,
  SquareTerminal,
} from "lucide-react";
import type { InstalledPlugin } from "../../../plugin/types";

export const isBuiltin = (p: InstalledPlugin) => p.id.startsWith("builtin:");

export const BUILTIN_PLUGIN_ICONS: Record<string, LucideIcon> = {
  "builtin:clipboard": Clipboard,
  "builtin:qx-ai": Bot,
  "builtin:screencap": MonitorPlay,
  "builtin:rss": Rss,
  "builtin:v2ex": MessageCircle,
  "builtin:macros": Keyboard,
  "builtin:documents": FileText,
  "builtin:weather": CloudSun,
  "builtin:qx-tty": SquareTerminal,
};

export function fallbackLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "P";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length > 1) return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}
