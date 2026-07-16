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

/** Parse `1.2.3`, `v0.5.26`, or dotted numeric-ish labels into comparable parts. */
export function versionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.+_-]/)
    .map((part) => {
      const digits = part.match(/^\d+/);
      return digits ? Number.parseInt(digits[0], 10) : 0;
    })
    .filter((n) => Number.isFinite(n));
}

/** Negative when left < right, 0 when equal, positive when left > right. */
export function comparePluginVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function isPluginUpdateAvailable(installedVersion: string | undefined, marketVersion: string): boolean {
  if (!installedVersion) return false;
  return comparePluginVersions(marketVersion, installedVersion) > 0;
}
