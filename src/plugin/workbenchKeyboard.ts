import { resolveQxGridIndex } from "../hooks/qxGridNavigation.ts";

/** Full-collection neighbors are published by the host renderer, never by a plugin. */
export function resolveRenderedWorkbenchIndex(input: {
  element: HTMLElement | null | undefined;
  kind: "cards" | "gallery";
  key: string;
  index: number;
  count: number;
  columns?: number;
}): number | null {
  const { element, key, index, count } = input;
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return null;
  if (input.kind === "cards") {
    const neighbor = element?.querySelector<HTMLElement>(`[data-qx-list-index="${index}"]`)
      ?.getAttribute(`data-qx-masonry-${key.slice(5).toLowerCase()}`);
    // A newly mounting card may not have geometry yet. Keep selection until
    // measured instead of falling back to a row-grid jump into another column.
    return neighbor != null && /^\d+$/.test(neighbor) && Number(neighbor) < count
      ? Number(neighbor) : count > 0 ? Math.max(0, Math.min(index, count - 1)) : null;
  }
  const columns = element
    ? Number(element.dataset.qxGridColumns) || window.getComputedStyle(element)
      .gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length : 0;
  return resolveQxGridIndex({ key, index, count, columns: columns || input.columns || 4 });
}

export const PLUGIN_WORKBENCH_HOST_KEYS = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Enter",
] as const;

/** Hidden plugin runtimes must yield visible Workbench navigation to QxShell. */
export function shouldForwardPluginWorkbenchHostKey(input: {
  mounted: boolean;
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): boolean {
  return input.mounted
    && !input.metaKey
    && !input.ctrlKey
    && !input.altKey
    && !input.shiftKey
    && (PLUGIN_WORKBENCH_HOST_KEYS as readonly string[]).includes(input.key);
}
