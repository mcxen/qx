import {
  appVersionMeetsMinimum,
  marketplaceEntrySupportsPlatform,
} from "../../../plugin/platform";
import type { InstalledPlugin, PluginIndexEntry } from "../../../plugin/types";
export { BUILTIN_MODULE_ICONS as BUILTIN_PLUGIN_ICONS } from "../../builtinIcons";

export const isBuiltin = (p: InstalledPlugin) => p.id.startsWith("builtin:");

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

export type InstalledPluginUpdate =
  | { kind: "ready"; entry: PluginIndexEntry }
  | { kind: "needs-qx"; entry: PluginIndexEntry };

/**
 * Pick the highest marketplace package that is newer than the installed
 * plugin. Ready offers already pass the current OS and Qx version; needs-qx
 * means a newer package exists but this Qx build cannot install it yet.
 */
export function selectInstalledPluginUpdate(
  plugin: Pick<InstalledPlugin, "id" | "version">,
  entries: readonly PluginIndexEntry[],
  hostVersion: string | null,
): InstalledPluginUpdate | null {
  if (!plugin.id || plugin.id.startsWith("builtin:") || hostVersion === null) return null;

  const newer = entries.filter((entry) => (
    entry.id === plugin.id
    && Boolean(entry.download_url?.trim())
    && marketplaceEntrySupportsPlatform(entry)
    && isPluginUpdateAvailable(plugin.version, entry.version)
  ));
  if (newer.length === 0) return null;

  const highest = (list: PluginIndexEntry[]) => list.reduce((best, entry) => (
    comparePluginVersions(entry.version, best.version) > 0 ? entry : best
  ));

  const ready = newer.filter((entry) => appVersionMeetsMinimum(hostVersion, entry.min_app_version));
  if (ready.length > 0) return { kind: "ready", entry: highest(ready) };
  return { kind: "needs-qx", entry: highest(newer) };
}
