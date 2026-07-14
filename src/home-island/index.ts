/**
 * Home Island module — pluggable idle launcher bottom HUD.
 *
 * To add a mode:
 * 1. Create `modes/MyIsland.tsx` (UI) + `modes/myMode.tsx` (definition).
 * 2. `registerHomeIsland(...)` inside `catalog.ts`.
 * 3. Add zh strings in `i18n.ts` (title/hint keys on the definition).
 * 4. Prefer `useIslandStats` / `useIslandPower` / `useIslandNet` (or extend the bus)
 *    so sampling stays async and non-blocking.
 *
 * Launcher and Settings only talk to this package — not individual modes.
 */

export { ensureHomeIslandCatalog } from "./catalog";
export {
  DEFAULT_HOME_ISLAND_MODE,
  getHomeIsland,
  listHomeIslands,
  normalizeHomeIslandMode,
  registerHomeIsland,
} from "./registry";
export { resolveHomeIsland } from "./resolve";
export { default as HomeIslandSettings } from "./HomeIslandSettings";
export { useIslandData, useIslandNet, useIslandPower, useIslandStats } from "./data/hooks";
export type {
  HomeIslandAppearance,
  HomeIslandDefinition,
  HomeIslandModeId,
  HomeIslandRenderProps,
  HomeIslandSettingsProps,
  ResolvedHomeIsland,
  Translate,
} from "./types";
export type {
  IslandDataChannel,
  IslandDataState,
  NetSnapshot,
  PowerSnapshot,
  SystemStatsSnapshot,
} from "./data/types";
