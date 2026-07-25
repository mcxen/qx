import type { QxShellAction } from "../ShellActionButton";

/** Validate one action tree without depending on React or the rendered menu. */
export function validateQxShellActions(
  actions: QxShellAction[],
  primaryActionId?: string,
): string[] {
  const issues: string[] = [];
  const validateLevel = (level: QxShellAction[], path: string) => {
    const ids = new Set<string>();
    for (const action of level) {
      if (!action.id.trim()) issues.push(`${path}: action id must not be empty`);
      else if (ids.has(action.id)) issues.push(`${path}: duplicate action id "${action.id}"`);
      ids.add(action.id);
      const shortcut = action.kbd?.trim().toLowerCase();
      if (shortcut === "esc" || shortcut === "escape") {
        issues.push(`${path}.${action.id}: Esc belongs to escapeAction`);
      }
      if (action.children) validateLevel(action.children, `${path}.${action.id}`);
    }
  };
  validateLevel(actions, "actions");
  if (primaryActionId && !actions.some((action) => action.id === primaryActionId)) {
    issues.push(`primaryActionId "${primaryActionId}" is missing from actions`);
  }
  return issues;
}
