export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const editable = target.closest("input, textarea, select, [contenteditable='true']");
  if (!(editable instanceof HTMLElement)) return false;

  if (editable instanceof HTMLInputElement) {
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "reset", "submit"].includes(editable.type);
  }

  return true;
}

export function shouldIgnoreBareShortcut(event: Pick<KeyboardEvent, "isComposing" | "target">): boolean {
  return event.isComposing || isEditableTarget(event.target);
}

export function isNativeEditingShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "target">,
): boolean {
  if (!isEditableTarget(event.target) || (!event.metaKey && !event.ctrlKey)) return false;
  return ["a", "c", "v", "x", "z"].includes(event.key.toLowerCase());
}

export function matchesQxShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  shortcut: string | undefined,
): boolean {
  if (!shortcut) return false;
  const parts = shortcut.replace("↵", "Enter").split(/[+\s]+/).map((part) => part.trim().toLowerCase());
  const key = parts.pop();
  if (!key) return false;

  const wantsMeta = parts.some((part) => part === "cmd" || part === "command" || part === "meta");
  const wantsCtrl = parts.some((part) => part === "ctrl" || part === "control");
  const wantsAlt = parts.some((part) => part === "alt" || part === "option");
  const wantsShift = parts.includes("shift");
  if (event.metaKey !== wantsMeta || event.ctrlKey !== wantsCtrl || event.altKey !== wantsAlt || event.shiftKey !== wantsShift) {
    return false;
  }

  const normalizedKey = event.key.toLowerCase();
  if (key === "esc") return normalizedKey === "escape";
  if (key === "return" || key === "enter") return normalizedKey === "enter";
  return normalizedKey === key;
}
