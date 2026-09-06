/**
 * Pure geometry for the host-owned Workbench Cards surface.
 *
 * Cards are assigned in source order to the currently shortest column.  The
 * helper deliberately knows nothing about React or CSS so the placement and
 * visibility rules can be covered independently from DOM rendering.
 */

export interface WorkbenchMasonryItem {
  id: string;
  /** A measured border-box height. Unknown items use the estimate. */
  height?: number;
}

export interface WorkbenchMasonryPosition {
  id: string;
  index: number;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkbenchMasonryNeighbors {
  /** Source indexes; -1 means that direction has no candidate. */
  up: number;
  down: number;
  left: number;
  right: number;
}

export interface WorkbenchMasonryLayout {
  width: number;
  columns: number;
  gap: number;
  columnWidth: number;
  contentHeight: number;
  positions: WorkbenchMasonryPosition[];
  neighbors: WorkbenchMasonryNeighbors[];
}

export interface WorkbenchMasonryScrollAnchor {
  id: string;
  index: number;
  offset: number;
}

export interface WorkbenchMasonryOptions {
  width: number;
  columns: number;
  gap: number;
  /** Height used until the card's natural DOM height is observed. */
  estimatedHeight?: number;
  /** Cards are never allowed to become narrower than this at a breakpoint. */
  minColumnWidth?: number;
}

const MAX_COLUMNS = 3;
const DEFAULT_MIN_COLUMN_WIDTH = 280;
const DEFAULT_ESTIMATED_HEIGHT = 220;

function finitePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value as number) > 0 ? value as number : fallback;
}

/**
 * Resolve the responsive column count for Cards.  The host contract caps
 * Cards at three columns; `requested` remains a hint and never forces a
 * column that cannot fit the minimum readable width.
 */
export function resolveWorkbenchMasonryColumns(
  width: number,
  requested: number | undefined,
  gap: number,
  minColumnWidth = DEFAULT_MIN_COLUMN_WIDTH,
): number {
  const requestedColumns = Number.isFinite(requested)
    ? Math.max(1, Math.min(MAX_COLUMNS, Math.round(requested as number)))
    : MAX_COLUMNS;
  if (!Number.isFinite(width) || width <= 0) return requestedColumns;
  const safeGap = Math.max(0, finitePositive(gap, 0));
  const safeMinWidth = Math.max(1, finitePositive(minColumnWidth, DEFAULT_MIN_COLUMN_WIDTH));
  const fittingColumns = Math.max(1, Math.floor((width + safeGap) / (safeMinWidth + safeGap)));
  return Math.max(1, Math.min(requestedColumns, MAX_COLUMNS, fittingColumns));
}

function shortestColumn(columnHeights: number[]): number {
  let shortest = 0;
  for (let index = 1; index < columnHeights.length; index += 1) {
    // Strictly less preserves the lower column index on ties, making layout
    // deterministic when cards have equal heights.
    if (columnHeights[index] < columnHeights[shortest]) shortest = index;
  }
  return shortest;
}

/** Lay out every item once, in source order, without sorting by height. */
export function layoutWorkbenchMasonry(
  items: readonly WorkbenchMasonryItem[],
  options: WorkbenchMasonryOptions,
): WorkbenchMasonryLayout {
  const width = Math.max(0, Number.isFinite(options.width) ? options.width : 0);
  const columns = Math.max(1, Math.min(MAX_COLUMNS, Math.round(options.columns || 1)));
  const gap = Math.max(0, finitePositive(options.gap, 0));
  const estimatedHeight = finitePositive(options.estimatedHeight, DEFAULT_ESTIMATED_HEIGHT);
  const columnWidth = columns > 0
    ? Math.max(0, (width - gap * (columns - 1)) / columns)
    : 0;
  const columnHeights = Array.from({ length: columns }, () => 0);
  const positions: WorkbenchMasonryPosition[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const column = shortestColumn(columnHeights);
    const height = finitePositive(item.height, estimatedHeight);
    const y = columnHeights[column];
    positions.push({
      id: item.id,
      index,
      column,
      x: column * (columnWidth + gap),
      y,
      width: columnWidth,
      height,
    });
    columnHeights[column] = y + height + gap;
  }

  const byColumn = Array.from({ length: columns }, () => [] as WorkbenchMasonryPosition[]);
  const columnIndexes = new Map<number, number>();
  for (const position of positions) {
    columnIndexes.set(position.index, byColumn[position.column].length);
    byColumn[position.column].push(position);
  }
  const nearestAtY = (candidates: WorkbenchMasonryPosition[], y: number): number => {
    if (!candidates.length) return -1;
    let low = 0;
    let high = candidates.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (candidates[middle].y < y) low = middle + 1;
      else high = middle;
    }
    const before = candidates[Math.max(0, low - 1)];
    const after = candidates[Math.min(candidates.length - 1, low)];
    const beforeDistance = Math.abs(before.y - y);
    const afterDistance = Math.abs(after.y - y);
    return (afterDistance < beforeDistance
      || (afterDistance === beforeDistance && after.index < before.index)
      ? after
      : before).index;
  };
  const neighbors = positions.map((position) => {
    const sameColumn = byColumn[position.column];
    const columnIndex = columnIndexes.get(position.index) ?? -1;
    const nearestInColumn = (direction: -1 | 1): number => {
      const candidate = sameColumn[columnIndex + direction];
      return candidate?.index ?? -1;
    };
    const nearestAdjacent = (direction: -1 | 1): number => (
      nearestAtY(byColumn[position.column + direction] || [], position.y)
    );
    return {
      up: nearestInColumn(-1),
      down: nearestInColumn(1),
      left: nearestAdjacent(-1),
      right: nearestAdjacent(1),
    };
  });

  const tallestColumn = columnHeights.length ? Math.max(...columnHeights) : 0;
  return {
    width,
    columns,
    gap,
    columnWidth,
    contentHeight: positions.length ? Math.max(0, tallestColumn - gap) : 0,
    positions,
    neighbors,
  };
}

/**
 * Return source indexes intersecting the vertical viewport.  Geometry is
 * still calculated for the complete collection, but only this bounded subset
 * is mounted by the React surface.
 */
export function visibleWorkbenchMasonryIndexes(
  layout: WorkbenchMasonryLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): number[] {
  const start = Math.max(0, (Number.isFinite(scrollTop) ? scrollTop : 0) - Math.max(0, overscan));
  const end = Math.max(start, (Number.isFinite(scrollTop) ? scrollTop : 0)
    + Math.max(0, viewportHeight) + Math.max(0, overscan));
  return layout.positions
    .filter((position) => position.y < end && position.y + position.height > start)
    .map((position) => position.index);
}

/** Identify a stable item and its offset from the viewport top. */
export function workbenchMasonryScrollAnchor(
  layout: WorkbenchMasonryLayout,
  scrollTop: number,
): WorkbenchMasonryScrollAnchor | undefined {
  if (!layout.positions.length) return undefined;
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const containing = layout.positions.filter(
    (position) => position.y <= top && position.y + position.height > top,
  );
  // Multiple columns can intersect the same viewport top.  The earliest
  // source item gives insert/remove operations a deterministic anchor.
  const candidate = containing.length
    ? containing.reduce((best, position) => position.index < best.index ? position : best)
    : layout.positions
      .filter((position) => position.y > top)
      .reduce<WorkbenchMasonryPosition | undefined>(
        (best, position) => !best || position.y < best.y
          || (position.y === best.y && position.index < best.index) ? position : best,
        undefined,
      )
      || layout.positions[layout.positions.length - 1];
  return { id: candidate.id, index: candidate.index, offset: top - candidate.y };
}

/** Restore an anchor after a reflow; fall back to its old source index if it was removed. */
export function restoreWorkbenchMasonryScrollTop(
  layout: WorkbenchMasonryLayout,
  anchor: WorkbenchMasonryScrollAnchor | undefined,
): number | undefined {
  if (!anchor || !layout.positions.length) return undefined;
  const byId = layout.positions.find((position) => position.id === anchor.id);
  const position = byId || layout.positions[Math.min(anchor.index, layout.positions.length - 1)];
  if (!position) return undefined;
  return Math.max(0, position.y + anchor.offset);
}
