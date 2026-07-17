import type { ComponentType, ReactNode } from "react";
import type { BottomIslandContent } from "../components/QxShell";

/** Stored preference — free string, validated against the registry. */
export type HomeIslandModeId = string;

export type Translate = (key: string, fallback: string) => string;

/** Appearance fields the island system cares about. */
export interface HomeIslandAppearance {
  /**
   * Primary / last-focused mode id (compat + settings highlight).
   * Prefer `home_island_modes` for multi-select rotation.
   */
  home_island_mode: string;
  /**
   * Modes shown on the idle home island. When length > 1, they auto-rotate
   * every `home_island_rotate_secs` seconds.
   */
  home_island_modes?: string[];
  /** Auto-rotate interval in seconds. 0 = pin first selected mode only. Default 8. */
  home_island_rotate_secs?: number;
  home_island_cpu: boolean;
  /** @deprecated Retained for imported settings compatibility; System island no longer renders GPU. */
  home_island_gpu: boolean;
  home_island_memory: boolean;
}

export interface HomeIslandRenderProps {
  appearance: HomeIslandAppearance;
}

export interface HomeIslandSettingsProps {
  appearance: HomeIslandAppearance;
  /** Patch only appearance island-related fields. */
  patchAppearance: (partial: Partial<HomeIslandAppearance>) => void;
}

export interface HomeIslandDefinition {
  id: HomeIslandModeId;
  /** Sort order in settings grid (lower first). */
  order: number;
  titleKey: string;
  titleFallback: string;
  hintKey: string;
  hintFallback: string;
  /** Short glyph / code for the settings card. */
  preview: string;
  /**
   * `shell` — contribute BottomIslandContent to QxShell (default text island).
   * `custom` — render a dedicated absolute-positioned component.
   */
  kind: "shell" | "custom";
  /** Required when kind === "shell". */
  resolveShellContent?: (ctx: {
    appearance: HomeIslandAppearance;
    t: Translate;
  }) => BottomIslandContent | null;
  /** Required when kind === "custom". */
  Component?: ComponentType<HomeIslandRenderProps>;
  /** Optional mode-specific settings row(s). */
  Settings?: ComponentType<HomeIslandSettingsProps>;
  /** Override the settings row title/description when Settings is present. */
  settingsTitleKey?: string;
  settingsTitleFallback?: string;
  settingsDescKey?: string;
  settingsDescFallback?: string;
}

export interface ResolvedHomeIsland {
  /** Active mode id (after multi-select rotation / preview). */
  modeId: string;
  /** Content for QxShell `island` when idle. */
  shellContent: BottomIslandContent | null;
  /**
   * Node for local preview (Settings). Docked runtime uses componentId via
   * islandHost instead of customIsland.
   */
  customNode: ReactNode | undefined;
  /** Chrome variant for wrapping content-only modes. */
  chromeVariant?: "shell" | "system" | "sci" | "date";
}
