export type TraySurfaceSize = "compact" | "standard" | "wide";

export type TraySurfaceRow =
  | { kind: "action"; description?: boolean }
  | { kind: "status" }
  | { kind: "control" }
  | { kind: "shortcut-grid"; rows?: number }
  | { kind: "section-label" };

export const TRAY_SURFACE_METRICS = {
  width: { compact: 288, standard: 360, wide: 440 },
  minHeight: 150,
  maxHeight: 520,
  headerHeight: 40,
  footerHeight: 38,
  contentPadding: 8,
  sectionGap: 6,
  rowHeight: {
    action: 34,
    actionWithDescription: 46,
    status: 32,
    control: 68,
    shortcut: 64,
    sectionLabel: 22,
  },
  shortcutMinWidth: 88,
  leadingWidth: 28,
  trailingMinWidth: 56,
  trailingMaxWidth: 112,
} as const;

function shortcutColumns(size: TraySurfaceSize): number {
  if (size === "wide") return 4;
  if (size === "standard") return 3;
  return 2;
}

export function trayShortcutRows(count: number, size: TraySurfaceSize): number {
  return Math.max(1, Math.ceil(Math.max(0, count) / shortcutColumns(size)));
}

export function measureTraySurface(
  size: TraySurfaceSize,
  rows: readonly TraySurfaceRow[],
  options: { header?: boolean; footer?: boolean } = {},
): { width: number; height: number } {
  const metrics = TRAY_SURFACE_METRICS;
  const groups: TraySurfaceRow[][] = [];
  let current: TraySurfaceRow[] = [];
  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
  };
  for (const row of rows) {
    if (row.kind === "section-label") flush();
    current.push(row);
  }
  flush();

  const groupHeight = (group: TraySurfaceRow[]): number => {
    let height = 0;
    let actions = 0;
    let statuses = 0;
    let controls = 0;
    for (const row of group) {
      switch (row.kind) {
        case "section-label":
          height += metrics.rowHeight.sectionLabel;
          break;
        case "action":
          actions += 1;
          break;
        case "status":
          statuses += 1;
          break;
        case "control":
          controls += 1;
          break;
        case "shortcut-grid": {
          const gridRows = Math.max(1, row.rows ?? 1);
          height += gridRows * metrics.rowHeight.shortcut + Math.max(0, gridRows - 1) * 8;
          break;
        }
      }
    }
    if (actions > 0) {
      height += actions * metrics.rowHeight.action + Math.max(0, actions - 1);
    }
    if (statuses > 0) {
      height += statuses * metrics.rowHeight.status + Math.max(0, statuses - 1);
    }
    if (controls > 0) {
      height += controls * metrics.rowHeight.control + Math.max(0, controls - 1) * 8;
    }
    return height;
  };

  const chrome = (options.header === false ? 0 : metrics.headerHeight)
    + (options.footer === false ? 0 : metrics.footerHeight)
    + metrics.contentPadding * 2;
  const content = groups.reduce((sum, group) => sum + groupHeight(group), 0)
    + Math.max(0, groups.length - 1) * metrics.sectionGap;
  return {
    width: metrics.width[size],
    height: Math.min(metrics.maxHeight, Math.max(metrics.minHeight, chrome + content)),
  };
}
