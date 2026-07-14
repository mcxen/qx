import { createElement } from "react";
import { ensureHomeIslandCatalog } from "./catalog";
import { getHomeIsland, normalizeHomeIslandMode } from "./registry";
import type {
  HomeIslandAppearance,
  ResolvedHomeIsland,
  Translate,
} from "./types";

/**
 * Resolve the idle home-island view for the current appearance preference.
 * Call only when the launcher is idle (no query activity / results / plugin island).
 */
export function resolveHomeIsland(
  appearance: HomeIslandAppearance,
  t: Translate,
): ResolvedHomeIsland {
  ensureHomeIslandCatalog();
  const id = normalizeHomeIslandMode(appearance.home_island_mode);
  const def = getHomeIsland(id) ?? getHomeIsland("default");

  if (!def) {
    return { shellContent: null, customNode: undefined };
  }

  if (def.kind === "shell") {
    return {
      shellContent: def.resolveShellContent?.({ appearance, t }) ?? null,
      customNode: undefined,
    };
  }

  if (def.Component) {
    return {
      shellContent: null,
      customNode: createElement(def.Component, { appearance }),
    };
  }

  return { shellContent: null, customNode: undefined };
}
