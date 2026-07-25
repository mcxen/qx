/**
 * Detect "open this panel" commands that only duplicate a searchable panel entry.
 * Host search should hide these when a panel is registered (e.g. sysinfo's
 * open-sysinfo). Real actions and `mode: "no-view"` jobs stay visible.
 */

export function isRedundantPanelOpenCommand(
  command: { name: string; title?: string; mode?: string | null },
  hasPanel: boolean,
): boolean {
  if (!hasPanel) return false;
  if (command.mode === "no-view") return false;
  const name = String(command.name || "").trim().toLowerCase();
  if (!name) return false;
  if (name === "open" || name.startsWith("open-") || name.startsWith("open_")) {
    return true;
  }
  const title = String(command.title || "").trim().toLowerCase();
  if (/^open\s+/.test(title)) return true;
  return false;
}
