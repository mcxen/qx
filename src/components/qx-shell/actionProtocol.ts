interface QxShellActionPresentation {
  /** Stable, non-localized identity shared by Bottom Bar, Enter, Context and Actions. */
  id: string;
  label: string;
  /** Optional secondary line under the label (e.g. char count). */
  detail?: string;
  /** In-window chord (e.g. CmdOrCtrl+Backspace). Never Alt+Space / Cmd+Space. */
  kbd?: string;
  /**
   * Optional single-key alias while the Actions menu is open (Raycast-style).
   * Letters only — never Space (avoids fighting launcher / Spotlight).
   */
  menuKey?: string;
  disabled?: boolean;
  tone?: "normal" | "primary" | "danger";
  /** When true, the nested panel shows a filter field (clipboard-style lists). */
  searchable?: boolean;
  /** Placeholder for the nested filter field when `searchable`. */
  searchPlaceholder?: string;
}
/** Execution kinds are mutually exclusive; disabled placeholders stay compatible. */
export type QxShellAction = QxShellActionPresentation & (
  | { onClick: () => void | Promise<void>; children?: never; loadChildren?: never }
  | { children: QxShellAction[]; onClick?: never; loadChildren?: never }
  | { loadChildren: () => Promise<QxShellAction[]>; onClick?: never; children?: never }
  | { disabled: true; onClick?: never; children?: never; loadChildren?: never }
);

export interface QxShellActionMenuRequest { id: number; x: number; y: number }
export function actionHasSubmenu(action: QxShellAction): boolean { return action.children !== undefined || Boolean(action.loadChildren); }

/** Validate one action tree without depending on React or the rendered menu. */
export function validateQxShellActions(
  actions: QxShellAction[],
  primaryActionId?: string,
): string[] {
  const issues: string[] = [];
  const validateLevel = (level: QxShellAction[], path: string) => {
    const ids = new Set<string>();
    const menuKeys = new Set<string>();
    for (const action of level) {
      if (!action.id.trim()) issues.push(`${path}: action id must not be empty`);
      else if (ids.has(action.id)) issues.push(`${path}: duplicate action id "${action.id}"`);
      ids.add(action.id);
      const implementations = Number(Boolean(action.onClick)) + Number(action.children !== undefined) + Number(Boolean(action.loadChildren));
      if (implementations > 1 || (implementations === 0 && !action.disabled)) issues.push(`${path}.${action.id}: action needs exactly one execution kind`);
      const shortcut = action.kbd?.trim().toLowerCase();
      if (shortcut === "esc" || shortcut === "escape") {
        issues.push(`${path}.${action.id}: Esc belongs to escapeAction`);
      }
      const menuKey = action.menuKey?.trim().toLowerCase();
      if (menuKey && !/^[a-z]$/.test(menuKey)) {
        issues.push(`${path}.${action.id}: menuKey must be one ASCII letter`);
      } else if (menuKey && menuKeys.has(menuKey)) {
        issues.push(`${path}.${action.id}: duplicate menuKey "${menuKey}"`);
      }
      if (menuKey) menuKeys.add(menuKey);
      if (action.children) validateLevel(action.children, `${path}.${action.id}`);
    }
  };
  validateLevel(actions, "actions");
  if (primaryActionId && !actions.some((action) => action.id === primaryActionId)) {
    issues.push(`primaryActionId "${primaryActionId}" is missing from actions`);
  }
  return issues;
}
