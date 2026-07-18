/** QxIsland shared contracts — see docs/qx-island-architecture.md */

export type IslandPlacement = "docked" | "floating";
export type IslandTone = "neutral" | "success" | "warning" | "danger";
export type IslandActionIcon = "pause" | "play" | "stop" | "open";
export type IslandActionVariant = "default" | "danger";
export type IslandChromeVariant = "shell" | "system" | "sci" | "date";

export type IslandPriority = "task" | "error" | "toast" | "location" | "home";

/** v1 only — no dual */
export type IslandPlacementMode = "docked" | "floating" | "docked-or-float";

/** v1 only — queue does not exist */
export type IslandReplacePolicy = "replace-same-id" | "reject-if-lower";

export type IslandSource =
  | "module"
  | "home"
  | "plugin"
  | "plugin-display"
  | "shell"
  | "system";

export interface IslandContentAction {
  /** Must exist in ActionRegistry for this session when clickable. */
  id: string;
  label: string;
  /** Host-owned icon set keeps docked and floating controls consistent. */
  icon?: IslandActionIcon;
  variant?: IslandActionVariant;
}

export interface IslandSlotContent {
  identity?: {
    tag?: string;
    beacon?: "live" | "steady" | "off";
    iconName?: string;
  };
  primary: string;
  secondary?: string;
  meter?: {
    kind: "progress" | "activity";
    /** 0–100; never fake */
    progress?: number;
    activity?: "bounce" | "bounce-exit";
  };
  action?: IslandContentAction;
  /** Compact trailing action pack; host renders at most the first two. */
  actions?: IslandContentAction[];
  /** Short, replayable host-owned feedback effect. */
  effect?: { kind: "orbit"; nonce: number };
  /** Host-rendered wall-clock countdown; never requires per-second session updates. */
  countdown?: {
    /** Absolute Unix milliseconds while running. */
    endsAt?: number;
    /** Frozen value while paused, or fallback when endsAt is absent. */
    remainingMs?: number;
    /** Enables host-derived progress. */
    durationMs?: number;
    paused?: boolean;
  };
  tone?: IslandTone;
  /**
   * Docked only in v1 float. Float ignores unknown componentId and falls
   * back to slots when present.
   */
  componentId?: string;
  /** JSON-serializable props for registered docked components */
  componentProps?: Record<string, unknown>;
}

export interface IslandSession {
  id: string;
  /** Host-assigned monotonic per id; producers do not invent */
  generation: number;
  priority: IslandPriority;
  /**
   * Bumped only on show / priority / placement / sticky changes — NOT on
   * progress/label-only updates. Winner comparator uses this, not updatedAt.
   */
  rankEpoch: number;
  source: IslandSource;
  createdAt: number;
  /** Content/TTL bookkeeping; may change every progress tick */
  contentUpdatedAt: number;
  ttlMs?: number;
  replacePolicy: IslandReplacePolicy;
  placement: IslandPlacementMode;
  content: IslandSlotContent;
  sticky?: boolean;
  /**
   * When true, high-frequency content updates must not change rankEpoch
   * (default true for meter.progress updates).
   */
  progressSilent?: boolean;
}

export type ActionHandler = () => void | Promise<void>;

export interface IslandShowInput {
  id: string;
  priority: IslandPriority;
  source?: IslandSource;
  content: IslandSlotContent;
  ttlMs?: number;
  replacePolicy?: IslandReplacePolicy;
  placement?: IslandPlacementMode;
  sticky?: boolean;
  progressSilent?: boolean;
  /** Out-of-band: not in snapshot, not synced to float */
  actions?: Record<string, ActionHandler>;
}

export interface IslandUpdateInput {
  expectedGeneration?: number;
  priority?: IslandPriority;
  content?: Partial<IslandSlotContent> | IslandSlotContent;
  ttlMs?: number | null;
  placement?: IslandPlacementMode;
  sticky?: boolean;
  progressSilent?: boolean;
  actions?: Record<string, ActionHandler>;
}

export type DockedRenderMode = "exception" | "store" | "empty";
