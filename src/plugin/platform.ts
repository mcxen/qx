import type { InstalledPlugin, PluginPlatform } from "./types";

export function currentPluginPlatform(): PluginPlatform {
  if (typeof navigator === "undefined") return "windows";
  const identity = `${navigator.platform || ""} ${navigator.userAgent || ""}`.toLowerCase();
  if (identity.includes("mac")) return "macos";
  if (identity.includes("win")) return "windows";
  return "linux";
}

export function parsePluginPlatform(value: unknown): PluginPlatform | null {
  return value === "macos" || value === "windows" || value === "linux" ? value : null;
}

export function pluginSupportsPlatform(
  plugin: InstalledPlugin,
  platform: PluginPlatform | null = currentPluginPlatform(),
): boolean {
  const declared = plugin.manifest?.platforms;
  return !declared?.length || (platform !== null && declared.includes(platform));
}

interface ParsedVersion {
  core: number[];
  prerelease: string[];
}

function parsedVersion(version: string): ParsedVersion | null {
  const withoutPrefix = version.trim().replace(/^v/i, "");
  const withoutBuild = withoutPrefix.split("+", 1)[0];
  const separator = withoutBuild.indexOf("-");
  const core = separator >= 0 ? withoutBuild.slice(0, separator) : withoutBuild;
  const prerelease = separator >= 0 ? withoutBuild.slice(separator + 1).split(".") : [];
  if (
    !core
    || !/^\d+(?:\.\d+)*$/.test(core)
    || prerelease.some((part) => !part || !/^[0-9A-Za-z-]+$/.test(part))
  ) {
    return null;
  }
  return { core: core.split(".").map(Number), prerelease };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (!left.length || !right.length) {
    if (left.length === right.length) return 0;
    return left.length ? -1 : 1;
  }
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

export function pluginSupportsAppVersion(
  plugin: InstalledPlugin,
  currentVersion: string,
): boolean {
  const minimum = plugin.manifest?.min_app_version?.trim();
  if (!minimum) return true;
  const current = parsedVersion(currentVersion);
  const required = parsedVersion(minimum);
  if (!current || !required) return false;
  const width = Math.max(current.core.length, required.core.length);
  for (let index = 0; index < width; index += 1) {
    const left = current.core[index] ?? 0;
    const right = required.core[index] ?? 0;
    if (left !== right) return left > right;
  }
  return comparePrerelease(current.prerelease, required.prerelease) >= 0;
}
