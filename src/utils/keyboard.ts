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
