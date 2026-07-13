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
  const parts = shortcutTokens(shortcut).map((part) => part.toLowerCase());
  const key = parts.pop();
  if (!key || parts.some((part) => !PRIMARY_MODIFIERS.has(part) && !["ctrl", "control", "alt", "option", "shift"].includes(part))) {
    return false;
  }

  const preset = getQxShortcutPreset();
  const wantsPrimary = parts.some((part) => PRIMARY_MODIFIERS.has(part));
  const wantsMeta = wantsPrimary ? preset.primaryEventModifier === "metaKey" : false;
  const wantsCtrl = parts.some((part) => part === "ctrl" || part === "control");
  const wantsAlt = parts.some((part) => part === "alt" || part === "option");
  const wantsShift = parts.includes("shift");
  const expectedCtrl = wantsCtrl || (wantsPrimary && preset.primaryEventModifier === "ctrlKey");
  if (event.metaKey !== wantsMeta || event.ctrlKey !== expectedCtrl || event.altKey !== wantsAlt || event.shiftKey !== wantsShift) {
    return false;
  }

  const normalizedKey = event.key.toLowerCase();
  if (key === "esc") return normalizedKey === "escape";
  if (key === "return" || key === "enter") return normalizedKey === "enter";
  return normalizedKey === key;
}
export type QxDesktopPlatform = "macos" | "windows";

export interface QxShortcutPreset {
  platform: QxDesktopPlatform;
  primaryEventModifier: "metaKey" | "ctrlKey";
  primaryLabel: "⌘" | "Ctrl";
  actionMenu: string;
}

export const QX_SHORTCUT_PRESETS: Record<QxDesktopPlatform, QxShortcutPreset> = {
  macos: {
    platform: "macos",
    primaryEventModifier: "metaKey",
    primaryLabel: "⌘",
    actionMenu: "CmdOrCtrl+K",
  },
  windows: {
    platform: "windows",
    primaryEventModifier: "ctrlKey",
    primaryLabel: "Ctrl",
    actionMenu: "CmdOrCtrl+K",
  },
};

export function getQxDesktopPlatform(): QxDesktopPlatform {
  if (typeof navigator === "undefined") return "windows";
  const identity = `${navigator.platform || ""} ${navigator.userAgent || ""}`.toLowerCase();
  return identity.includes("mac") ? "macos" : "windows";
}

export function getQxShortcutPreset(): QxShortcutPreset {
  return QX_SHORTCUT_PRESETS[getQxDesktopPlatform()];
}

const PRIMARY_MODIFIERS = new Set([
  "cmd",
  "command",
  "meta",
  "primary",
  "mod",
  "cmdorctrl",
  "cmdorcontrol",
  "commandorctrl",
  "commandorcontrol",
]);

function shortcutTokens(shortcut: string): string[] {
  return shortcut
    .replace(/⌘\s*/g, "Cmd+")
    .replace(/⌥\s*/g, "Alt+")
    .replace(/⇧\s*/g, "Shift+")
    .replace("↵", "Enter")
    .split(/[+\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function formatQxShortcutForPlatform(
  shortcut: string | undefined,
  platform: QxDesktopPlatform,
): string | undefined {
  if (!shortcut) return shortcut;
  const tokens = shortcutTokens(shortcut);
  const modifiers: string[] = [];
  const keys: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (PRIMARY_MODIFIERS.has(lower)) modifiers.push(platform === "macos" ? "⌘" : "Ctrl");
    else if (lower === "ctrl" || lower === "control") modifiers.push(platform === "macos" ? "⌃" : "Ctrl");
    else if (lower === "alt" || lower === "option") modifiers.push(platform === "macos" ? "⌥" : "Alt");
    else if (lower === "shift") modifiers.push(platform === "macos" ? "⇧" : "Shift");
    else keys.push(token === "Return" ? "Enter" : token);
  }
  if (keys.length === 0) return platform === "macos" ? modifiers.join("") : modifiers.join("+");
  const chord = platform === "macos"
    ? `${modifiers.join("")}${keys[0]}`
    : [...modifiers, keys[0]].join("+");
  return keys.length > 1 ? `${chord} ${keys.slice(1).join(" ")}` : chord;
}

export function formatQxShortcut(shortcut: string | undefined): string | undefined {
  return formatQxShortcutForPlatform(shortcut, getQxDesktopPlatform());
}

export function toPortableGlobalShortcut(shortcut: string): string {
  return shortcutTokens(shortcut)
    .map((token) => PRIMARY_MODIFIERS.has(token.toLowerCase()) ? "CmdOrCtrl" : token)
    .join("+");
}
