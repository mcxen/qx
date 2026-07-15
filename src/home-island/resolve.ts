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
    return { modeId: id, shellContent: null, customNode: undefined };
  }

  if (def.kind === "shell") {
    return {
      modeId: def.id,
      shellContent: def.resolveShellContent?.({ appearance, t }) ?? null,
      customNode: undefined,
      chromeVariant: "shell",
    };
  }

  if (def.Component) {
    const chromeVariant =
      def.id === "system" ? "system" : def.id === "date" ? "date" : "sci";
    return {
      modeId: def.id,
      shellContent: null,
      customNode: createElement(def.Component, { appearance }),
      chromeVariant,
    };
  }

  return { modeId: def.id, shellContent: null, customNode: undefined };
}
