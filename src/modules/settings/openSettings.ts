/**
 * Host port: open / leave the Settings panel with a one-level return target.
 *
 * Modules and plugins must not call `setTab("settings")` + ad-hoc sessionStorage.
 * Use `openSettings({ section, focusPluginId, returnTo })` so Esc / Close restore
 * the caller (module or plugin panel) instead of always jumping to the launcher.
 *
 * Invariants:
 * - One return slot only (not a full nav stack).
 * - Re-opening Settings while already on Settings keeps the previous return target.
 * - Invalid / disabled return targets fall back to `launcher`.
 * - Settings internal Esc (clear filter, close dialogs) is unchanged; only the
 *   final `leave` uses `closeSettings()`.
 */

import { useStore, type Tab } from "../../store";
import { isBuiltinModuleEnabled } from "../moduleAvailability";
import { useSettingsStore, type SettingsTab } from "./store";

const PENDING_TAB_KEY = "qx.settings.pendingTab";
const FOCUS_PLUGIN_KEY = "qx.settings.focusPluginId";

export interface OpenSettingsOptions {
  /** Settings sidebar section (general, weather, agent, plugins, …). */
  section?: SettingsTab;
  /**
   * Focus an installed plugin / builtin module card under Extensions.
   * Implies `section: "plugins"` when set.
   */
  focusPluginId?: string;
  /**
   * Where Esc / Close returns after leaving Settings.
   * - omit: current app tab if it is a module/plugin, else `launcher`
   * - `"launcher"`: force home
   * - `null`: keep the previously recorded return target (re-open refinement)
   */
  returnTo?: Tab | "launcher" | null;
}

/** Process-lifetime return slot for Settings leave. */
let settingsReturnTab: string = "launcher";

export function getSettingsReturnTab(): string {
  return settingsReturnTab;
}

export function clearSettingsReturnTab(): void {
  settingsReturnTab = "launcher";
}

function readCurrentTab(): string {
  return useStore.getState().tab;
}

function resolveReturnTarget(explicit?: Tab | "launcher" | null): string {
  if (explicit === null) return settingsReturnTab;
  if (explicit !== undefined) {
    const value = String(explicit || "").trim();
    return value || "launcher";
  }
  const current = readCurrentTab();
  // Already in Settings: keep whatever brought the user here.
  if (current === "settings") return settingsReturnTab;
  if (current === "launcher" || !current) return "launcher";
  return current;
}

function isSafeReturnTab(tab: string): boolean {
  if (!tab || tab === "settings") return false;
  if (tab === "launcher") return true;
  if (tab.startsWith("plugin:")) return true;
  return isBuiltinModuleEnabled(tab);
}

function sanitizeReturnTab(tab: string): string {
  return isSafeReturnTab(tab) ? tab : "launcher";
}

function writePendingFocus(focusPluginId: string | undefined): void {
  try {
    sessionStorage.removeItem(PENDING_TAB_KEY);
    sessionStorage.removeItem(FOCUS_PLUGIN_KEY);
    if (focusPluginId) {
      sessionStorage.setItem(PENDING_TAB_KEY, "plugins");
      sessionStorage.setItem(FOCUS_PLUGIN_KEY, focusPluginId);
    }
  } catch {
    // sessionStorage may be unavailable; setActiveTab still lands on the section.
  }
}

/**
 * Open the Settings panel. Records a one-level return target for `closeSettings`.
 */
export function openSettings(options: OpenSettingsOptions = {}): void {
  const focusPluginId = options.focusPluginId?.trim() || undefined;
  const section: SettingsTab | undefined = focusPluginId
    ? "plugins"
    : options.section;

  settingsReturnTab = sanitizeReturnTab(resolveReturnTarget(options.returnTo));
  writePendingFocus(focusPluginId);

  if (section) {
    useSettingsStore.getState().setActiveTab(section);
  }

  useStore.getState().setTab("settings");
}

/**
 * Leave Settings (Esc final step / Close). Restores `returnTo` then clears it.
 */
export function closeSettings(): void {
  const target = sanitizeReturnTab(settingsReturnTab);
  settingsReturnTab = "launcher";
  try {
    sessionStorage.removeItem(PENDING_TAB_KEY);
    sessionStorage.removeItem(FOCUS_PLUGIN_KEY);
  } catch {
    /* ignore */
  }
  useStore.getState().setTab(target as Tab);
}
