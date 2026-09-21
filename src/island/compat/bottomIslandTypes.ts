import type {
  IslandActionIcon,
  IslandActionVariant,
  IslandActivity,
  IslandProgressStyle,
  IslandPriority,
} from "../types";

export interface BottomIslandAction {
  id: string;
  label: string;
  shortcut?: string;
  onAction: () => void;
  icon?: IslandActionIcon;
  variant?: IslandActionVariant;
}

export interface BottomIslandContent {
  /** Semantic state, independent of danger styling (e.g. unsaved drafts). */
  priority?: IslandPriority;
  label: string;
  detail?: string;
  progress?: number;
  progressStyle?: IslandProgressStyle;
  activity?: IslandActivity;
  tone?: "neutral" | "success" | "warning" | "danger";
  actionLabel?: string;
  onAction?: () => void;
  actions?: BottomIslandAction[];
  effect?: { kind: "orbit"; nonce: number };
}
