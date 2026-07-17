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

/**
 * Gallery navigation normally wins over Shell's linear list navigation. Search
 * fields keep horizontal caret movement only while they contain a query;
 * vertical arrows always continue browsing the filtered grid.
 */
export function shouldHandlePluginWorkbenchGalleryKey(input: {
  key: string;
  query: string;
  editable: boolean;
  fromSearch: boolean;
  modified: boolean;
}): boolean {
  if (input.modified || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(input.key)) {
    return false;
  }
  if (!input.editable) return true;
  if (!input.fromSearch) return false;
  if (input.key === "ArrowUp" || input.key === "ArrowDown") return true;
  return input.query.length === 0;
}

export function resolvePluginWorkbenchGalleryIndex(input: {
  key: string;
  index: number;
  count: number;
  columns: number;
}): number | null {
  if (input.count <= 0) return null;
  const last = input.count - 1;
  const columns = Math.max(1, Math.trunc(input.columns) || 1);
  const index = Math.max(0, Math.min(last, Math.trunc(input.index)));
  const column = index % columns;

  if (input.key === "ArrowLeft") return column > 0 ? index - 1 : index;
  if (input.key === "ArrowRight") {
    return column < columns - 1 && index < last ? index + 1 : index;
  }
  if (input.key === "ArrowUp") return Math.max(0, index - columns);
  if (input.key === "ArrowDown") return Math.min(last, index + columns);
  return null;
}
