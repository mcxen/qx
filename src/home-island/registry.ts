import type { HomeIslandDefinition, HomeIslandModeId } from "./types";

const modes = new Map<HomeIslandModeId, HomeIslandDefinition>();

export const DEFAULT_HOME_ISLAND_MODE: HomeIslandModeId = "system";

/** Register a home-island mode. Later calls with the same id replace the definition. */
export function registerHomeIsland(def: HomeIslandDefinition): void {
  modes.set(def.id, def);
}

export function getHomeIsland(id: string | null | undefined): HomeIslandDefinition | undefined {
  if (!id) return undefined;
  return modes.get(id);
}

export function listHomeIslands(): HomeIslandDefinition[] {
  return [...modes.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Unknown / empty values fall back to the default registered mode. */
export function normalizeHomeIslandMode(raw: string | null | undefined): HomeIslandModeId {
  if (raw && modes.has(raw)) return raw;
  if (modes.has(DEFAULT_HOME_ISLAND_MODE)) return DEFAULT_HOME_ISLAND_MODE;
  const first = listHomeIslands()[0];
  return first?.id ?? "default";
}

/** Test helper / hot-reload hygiene. */
export function clearHomeIslandRegistry(): void {
  modes.clear();
}
