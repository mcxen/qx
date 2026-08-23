export type PluginIslandTone = "neutral" | "success" | "warning" | "danger";
export type PluginIslandActionIcon = "pause" | "play" | "stop" | "open";
export type PluginIslandActivity = "wave" | "dots" | "spinner" | "pulse";
export type PluginIslandProgressStyle =
  | "surface-fill"
  | "icon-ring"
  | "island-ring"
  | "compact-line";

/** Structured, host-rendered content for the optional external QxIsland surface. */
export interface PluginIslandDisplayInput {
  primary: string;
  secondary?: string;
  tone?: PluginIslandTone;
  progress?: number;
  progressStyle?: PluginIslandProgressStyle;
  activity?: PluginIslandActivity;
  countdown?: {
    endsAt?: number;
    remainingMs?: number;
    durationMs?: number;
    paused?: boolean;
  };
  action?: {
    label: string;
    command: string;
    icon?: PluginIslandActionIcon;
    variant?: "default" | "danger";
  };
  actions?: Array<{
    label: string;
    command: string;
    icon?: PluginIslandActionIcon;
    variant?: "default" | "danger";
  }>;
  ttlMs?: number;
}
