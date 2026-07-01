import type { TrayActionConfig } from "./store";

export const TRAY_ACTION_TYPES = [
  { value: "open_main", label: "Open Main Window" },
  { value: "keep_visible", label: "Keep Window Visible" },
  { value: "settings", label: "Settings" },
  { value: "hide_main", label: "Hide Main Window" },
] as const;

export const DEFAULT_TRAY_ACTIONS: TrayActionConfig[] = TRAY_ACTION_TYPES.map((type) => ({
  id: type.value,
  title: type.label,
  enabled: type.value !== "hide_main",
}));

const labelForId = (id: string): string =>
  TRAY_ACTION_TYPES.find((t) => t.value === id)?.label ?? id;

export function sanitizeTrayActions(actions: TrayActionConfig[] | undefined): TrayActionConfig[] {
  const source = Array.isArray(actions) && actions.length > 0 ? actions : DEFAULT_TRAY_ACTIONS;
  return source.map((action, index) => ({
    id: action.id?.trim() || `action-${index}`,
    title: action.title?.trim() || labelForId(action.id),
    enabled: action.enabled !== false,
  }));
}

export function createTrayAction(id: string): TrayActionConfig {
  return {
    id,
    title: labelForId(id),
    enabled: true,
  };
}
