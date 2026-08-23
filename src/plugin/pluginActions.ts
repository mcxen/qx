import type { QxShellAction } from "../components/QxShell";

const MENU_KEY_PATTERN = /^[a-z]$/i;

function actionKeyCandidates(action: QxShellAction): string[] {
  const stableId = action.id.replace(/^__qx:/, "");
  const source = `${stableId} ${action.label}`.toLowerCase();
  const candidates: string[] = [];
  for (const char of source) {
    if (MENU_KEY_PATTERN.test(char) && !candidates.includes(char)) candidates.push(char);
  }
  return candidates;
}

/**
 * Keep plugin Actions keyboard-complete even when an older package omitted
 * menuKey. Explicit unique letters win; missing/duplicate letters fall back to
 * the stable action id before the localized label.
 */
export function assignPluginActionMenuKeys(actions: QxShellAction[]): QxShellAction[] {
  const used = new Set<string>();
  return actions.map((action) => {
    const explicit = action.menuKey?.toLowerCase();
    if (explicit && MENU_KEY_PATTERN.test(explicit) && !used.has(explicit)) {
      used.add(explicit);
      return explicit === action.menuKey ? action : { ...action, menuKey: explicit };
    }

    const fallback = actionKeyCandidates(action).find((candidate) => !used.has(candidate));
    if (!fallback) return { ...action, menuKey: undefined };
    used.add(fallback);
    return { ...action, menuKey: fallback };
  });
}

export function isBareEnterShortcut(kbd: string | undefined): boolean {
  const normalized = kbd?.trim().toLowerCase();
  return normalized === "enter" || normalized === "return" || normalized === "↵";
}
