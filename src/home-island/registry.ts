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

/**
 * Resolve multi-select mode list for rotation.
 * Falls back to single `home_island_mode` when the array is empty/missing.
 */
export function normalizeHomeIslandModes(appearance: {
  home_island_mode?: string | null;
  home_island_modes?: string[] | null;
}): HomeIslandModeId[] {
  const fromList = (appearance.home_island_modes ?? [])
    .map((id) => String(id || "").trim())
    .filter((id) => id && modes.has(id));
  if (fromList.length > 0) {
    // de-dupe, preserve order
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of fromList) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }
  return [normalizeHomeIslandMode(appearance.home_island_mode)];
}

/** Test helper / hot-reload hygiene. */
export function clearHomeIslandRegistry(): void {
  modes.clear();
}
