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

export function measureTraySurface(
  size: TraySurfaceSize,
  rows: readonly TraySurfaceRow[],
  options: { header?: boolean; footer?: boolean } = {},
): { width: number; height: number } {
  const metrics = TRAY_SURFACE_METRICS;
  const rowHeight = (row: TraySurfaceRow): number => {
    switch (row.kind) {
      case "action": return row.description
        ? metrics.rowHeight.actionWithDescription
        : metrics.rowHeight.action;
      case "status": return metrics.rowHeight.status;
      case "control": return metrics.rowHeight.control;
      case "shortcut-grid": return Math.max(1, row.rows ?? 1) * metrics.rowHeight.shortcut;
      case "section-label": return metrics.rowHeight.sectionLabel;
    }
  };
  const chrome = (options.header === false ? 0 : metrics.headerHeight)
    + (options.footer === false ? 0 : metrics.footerHeight)
    + metrics.contentPadding * 2;
  const gaps = Math.max(0, rows.length - 1) * metrics.sectionGap;
  const content = rows.reduce((sum, row) => sum + rowHeight(row), 0) + gaps;
  return {
    width: metrics.width[size],
    height: Math.min(metrics.maxHeight, Math.max(metrics.minHeight, chrome + content)),
  };
}
