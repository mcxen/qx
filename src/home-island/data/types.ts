export interface SystemStatsSnapshot {
  cpu: number;
  memory: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  gpu: number | null;
}

export interface PowerSnapshot {
  batteryLevel: number | null;
  isCharging: boolean;
  fullyCharged: boolean;
  source: string;
}

export interface NetSnapshot {
  downRate: number;
  upRate: number;
  downLevels: number[];
  upLevels: number[];
}

export type IslandDataChannel = "stats" | "power" | "net";

export interface IslandDataState {
  stats: SystemStatsSnapshot | null;
  power: PowerSnapshot | null;
  net: NetSnapshot | null;
  /** Channel has completed at least one successful sample. */
  ready: Record<IslandDataChannel, boolean>;
  /** Last error message per channel (null when healthy). */
  error: Record<IslandDataChannel, string | null>;
}

export type IslandDataListener = (state: IslandDataState) => void;
