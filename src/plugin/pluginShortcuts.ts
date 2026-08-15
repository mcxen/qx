import type { Settings, ShortcutBinding } from "../modules/settings/store";
import type { PluginShortcut } from "./types";

/**
 * Stable settings namespace for user-owned plugin command shortcuts.
 *
 * Plugin command bindings are deliberately kept in `settings.shortcuts` so
 * they use the same persistence, conflict checks, and global registration
 * lifecycle as other Qx shortcuts. They must not be mixed with per-app
 * bindings (`app_shortcuts`) or inferred from a command's launcher entry.
 */
export function pluginShortcutSettingsKey(pluginId: string, commandName: string): string {
  return `plugin:${pluginId}:${commandName}`;
}

/** Stable host-owned shortcut id for opening any built-in or plugin panel. */
export function pluginLaunchShortcutSettingsKey(route: string): string {
  return `open:${route}`;
}

/** Resolve a manifest declaration to the binding shape used by Qx settings. */
export function defaultPluginShortcutBinding(shortcut: PluginShortcut): ShortcutBinding {
  return {
    key: typeof shortcut.key === "string" ? shortcut.key : "",
    enabled: shortcut.enabled === true,
  };
}

/**
 * Apply a persisted user override, falling back to the manifest declaration.
 * Returning a fresh object prevents callers from mutating Zustand state while
 * rendering shortcut controls or registering native bindings.
 */
export function resolvePluginShortcutBinding(
  settings: Pick<Settings, "shortcuts">,
  pluginId: string,
  shortcut: PluginShortcut,
): ShortcutBinding {
  const override = settings.shortcuts[pluginShortcutSettingsKey(pluginId, shortcut.command)];
  if (!override) return defaultPluginShortcutBinding(shortcut);
  return {
    key: typeof override.key === "string" ? override.key : "",
    enabled: override.enabled === true,
  };
}
