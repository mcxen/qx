import type { ComponentType, ReactNode } from "react";
import type { BottomIslandContent } from "../components/QxShell";

/** Stored preference — free string, validated against the registry. */
export type HomeIslandModeId = string;

export type Translate = (key: string, fallback: string) => string;

/** Appearance fields the island system cares about. */
export interface HomeIslandAppearance {
  home_island_mode: string;
  home_island_cpu: boolean;
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
  /** Content for QxShell `island` when idle. */
  shellContent: BottomIslandContent | null;
  /** Node for QxShell `customIsland` when idle. */
  customNode: ReactNode | undefined;
}
