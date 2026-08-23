import type {
  IslandActionIcon,
  IslandActionVariant,
  IslandActivity,
  IslandProgressStyle,
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
