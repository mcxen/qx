/** Pure grid-navigation rules shared by Workbench galleries and built-in grids. */

export function shouldHandleQxGridKey(input: {
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

export function resolveQxGridIndex(input: {
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
