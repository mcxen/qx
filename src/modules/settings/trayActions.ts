import type { TrayActionConfig } from "./store";

/**
 * Built-in tray action catalog.
 * - Window actions: open / hide / keep visible / settings
 * - Status lines: live memory / CPU / network (refreshed ~3s while enabled)
 * Plugin items are registered separately via context.tray (permission `tray`).
 */
export const TRAY_ACTION_TYPES = [
  { value: "status_memory", labelKey: "shortcuts.trayMenu.statusMemory", label: "Status · Memory" },
  { value: "status_cpu", labelKey: "shortcuts.trayMenu.statusCpu", label: "Status · CPU" },
  { value: "status_network", labelKey: "shortcuts.trayMenu.statusNetwork", label: "Status · Network" },
  { value: "open_main", labelKey: "shortcuts.trayMenu.openMain", label: "Open Main Window" },
  { value: "keep_visible", labelKey: "shortcuts.trayMenu.keepVisible", label: "Keep Window Visible" },
  { value: "settings", labelKey: "shortcuts.trayMenu.settings", label: "Settings" },
  { value: "hide_main", labelKey: "shortcuts.trayMenu.hideMain", label: "Hide Main Window" },
] as const;

export const DEFAULT_TRAY_ACTIONS: TrayActionConfig[] = [
  { id: "status_memory", title: "Memory", enabled: true },
  { id: "status_network", title: "Network", enabled: true },
  { id: "status_cpu", title: "CPU", enabled: false },
  { id: "open_main", title: "Open Main Window", enabled: true },
  { id: "keep_visible", title: "Keep Window Visible", enabled: true },
  { id: "settings", title: "Settings", enabled: true },
  { id: "hide_main", title: "Hide Main Window", enabled: false },
];

const labelForId = (id: string): string =>
  TRAY_ACTION_TYPES.find((t) => t.value === id)?.label ?? id;

export function sanitizeTrayActions(actions: TrayActionConfig[] | undefined): TrayActionConfig[] {
  const source = Array.isArray(actions) && actions.length > 0 ? actions : DEFAULT_TRAY_ACTIONS;
  const seen = new Set<string>();
  return source.flatMap((action, index) => {
    const id = action.id?.trim() || `action-${index}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      title: action.title?.trim() || labelForId(id),
      enabled: action.enabled !== false,
    }];
  });
}

export function createTrayAction(id: string): TrayActionConfig {
  return {
    id,
    title: labelForId(id),
    enabled: true,
  };
}

export function isTrayStatusAction(id: string): boolean {
  return id === "status_memory" || id === "status_cpu" || id === "status_network";
}
