/** QxIsland public API — docs/qx-island-architecture.md */

export type {
  IslandPlacement,
  IslandTone,
  IslandActionIcon,
  IslandActionVariant,
  IslandChromeVariant,
  IslandPriority,
  IslandPlacementMode,
  IslandReplacePolicy,
  IslandSource,
  IslandSlotContent,
  IslandSession,
  IslandShowInput,
  IslandUpdateInput,
  ActionHandler,
  DockedRenderMode,
} from "./types";

export { islandHost } from "./session/hostApi";
export { actionRegistry } from "./session/actionRegistry";
export {
  resolveDockedWinner,
  resolveRotatingWinner,
  countRotatingSessions,
  resolveDockedRenderMode,
  compareSessions,
  PRIORITY_RANK,
} from "./session/priority";
export {
  showSession,
  updateSession,
  dismissSession,
  getSnapshot,
  getDockedWinner,
  subscribe as subscribeIslandSessions,
} from "./session/store";

export { default as QxIslandSurface } from "./surface/QxIslandSurface";
export { default as ShellContent } from "./surface/ShellContent";
export { default as QxIslandDockHost } from "./surface/QxIslandDockHost";
export { default as QxIslandDockSlot } from "./surface/QxIslandDockSlot";

export {
  mapBottomIslandContent,
  mapSlotToBottomIsland,
} from "./compat/mapBottomIslandContent";
export { useShellIslandShim } from "./compat/useShellIslandShim";
export {
  showPluginIslandStatus,
  clearPluginIslandStatus,
} from "./bridge/pluginIslandBridge";
export {
  registerIslandComponent,
  getIslandComponent,
} from "./components/registry";
export { ensureHomeIslandComponents } from "./home/registerHomeComponents";
export { useHomeIslandContribution } from "./home/useHomeIslandContribution";
