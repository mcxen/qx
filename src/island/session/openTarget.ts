import type { IslandOpenTarget, IslandSource } from "../types";

/** Convert the host-owned Island destination into the route understood by App. */
export function islandRouteForTarget(target: IslandOpenTarget | undefined): string | null {
  if (!target) return null;
  if (target.kind === "launcher") return "launcher";
  const id = target.id.trim();
  if (!id) return null;
  return target.kind === "plugin" ? `plugin:${id}` : id;
}

/**
 * QxShell route keys are namespaced by their built-in module id
 * (`rss.article-detail`, `qx-ai.chat`, ...). Keep that convention at the Shell
 * boundary so every built-in module gets the same click-to-open Island affordance.
 */
export function defaultIslandOpenTarget(
  routeKey: string,
  source: IslandSource,
): IslandOpenTarget | undefined {
  if (source !== "module") return undefined;
  const id = routeKey.split(".", 1)[0]?.trim();
  return id ? { kind: "module", id } : undefined;
}
