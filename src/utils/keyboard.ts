export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const editable = target.closest("input, textarea, select, [contenteditable='true']");
  if (!(editable instanceof HTMLElement)) return false;

  if (editable instanceof HTMLInputElement) {
    return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "reset", "submit"].includes(editable.type);
  }

  return true;
}

/**
 * IME candidate confirmation is reported inconsistently by browsers: some
 * expose `isComposing`, while others only emit the legacy keyCode 229. Treat
 * both forms as composition input so Enter can reach the IME instead of a
 * shell action (for example, opening the selected search result).
 */
export function isImeCompositionEvent(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode">,
): boolean {
  return event.isComposing || event.keyCode === 229;
}

export function shouldIgnoreBareShortcut(
  event: Pick<KeyboardEvent, "isComposing" | "keyCode" | "target">,
): boolean {
  return isImeCompositionEvent(event) || isEditableTarget(event.target);
}

/**
 * True when the browser/OS should keep the editing chord (select-all, paste,
 * cut, undo, or copy of an actual text selection). Empty-selection Cmd/Ctrl+C
 * is left for app actions (e.g. copy the highlighted clipboard row).
 */
export function isNativeEditingShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "target"> | Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "target">,
): boolean {
  if (!isEditableTarget(event.target) || (!event.metaKey && !event.ctrlKey)) return false;
  const key = normalizeEventKey(event as Pick<KeyboardEvent, "key" | "code">);
  if (!["a", "c", "v", "x", "z"].includes(key)) return false;
  if (key !== "c") return true;

  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    return end > start;
  }
  if (typeof window === "undefined") return true;
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
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

const MODIFIER_TOKENS = new Set([
  ...PRIMARY_MODIFIERS,
  "ctrl",
  "control",
  "alt",
  "option",
  "shift",
]);

/**
 * Global host chords that must never be bound as in-app action shortcuts.
 * macOS uses Option+Space and Windows uses Ctrl+Alt+Space; Cmd/Ctrl+Space
 * remains reserved for Spotlight / OS input switching.
 */
const RESERVED_GLOBAL_SHORTCUTS = new Set([
  "alt+space",
  "option+space",
  "cmd+space",
  "command+space",
  "meta+space",
  "cmdorctrl+space",
  "cmdorcontrol+space",
  "commandorctrl+space",
  "commandorcontrol+space",
  "ctrl+space",
  "control+space",
  "primary+space",
  "mod+space",
]);

/** OS search chords that cannot be registered reliably as Qx globals. */
const OS_RESERVED_GLOBAL_SHORTCUTS = new Set([
  "cmd+space",
  "command+space",
  "meta+space",
  "cmdorctrl+space",
  "cmdorcontrol+space",
  "commandorctrl+space",
  "commandorcontrol+space",
  "ctrl+space",
  "control+space",
  "primary+space",
  "mod+space",
]);

function shortcutTokens(shortcut: string): string[] {
  return shortcut
    .replace(/⌘\s*/g, "Cmd+")
    .replace(/⌥\s*/g, "Alt+")
    .replace(/⇧\s*/g, "Shift+")
    .replace(/⌫/g, "Backspace")
    .replace(/⌦/g, "Delete")
    .replace(/↵/g, "Enter")
    .replace(/␣/g, "Space")
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Normalize a key token from a shortcut string. */
export function normalizeShortcutKeyToken(token: string): string {
  const lower = token.trim().toLowerCase();
  if (lower === " " || lower === "space" || lower === "spacebar") return "space";
  if (lower === "esc") return "escape";
  if (lower === "return" || lower === "↵") return "enter";
  if (lower === "⌫" || lower === "backspace") return "backspace";
  if (lower === "⌦" || lower === "del" || lower === "delete") return "delete";
  return lower;
}

/**
 * Normalize KeyboardEvent key/code so Space / Backspace / Delete match reliably
 * across browsers (Space is often `event.key === " "`).
 */
export function normalizeEventKey(
  event: Pick<KeyboardEvent, "key"> & { code?: string },
): string {
  const code = (event.code || "").toLowerCase();
  if (code === "space") return "space";
  if (code === "backspace") return "backspace";
  if (code === "delete") return "delete";
  if (code === "enter" || code === "numpadenter") return "enter";
  if (code === "escape") return "escape";

  const key = event.key;
  if (key === " " || key === "Spacebar") return "space";
  if (key === "Backspace") return "backspace";
  if (key === "Delete") return "delete";
  if (key === "Enter") return "enter";
  if (key === "Escape") return "escape";
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase();
}

function keysMatch(shortcutKey: string, eventKey: string): boolean {
  if (shortcutKey === eventKey) return true;
  // ⌘⌫ and ⌘⌦ both mean “delete selected item” in list UIs.
  if (
    (shortcutKey === "backspace" && eventKey === "delete")
    || (shortcutKey === "delete" && eventKey === "backspace")
  ) {
    return true;
  }
  return false;
}

/** Canonical portable form for reserved / conflict checks (lowercase, + joined). */
export function canonicalizeShortcut(shortcut: string | undefined): string | null {
  if (!shortcut) return null;
  const parts = shortcutTokens(shortcut).map((part) => part.toLowerCase());
  if (parts.length === 0) return null;
  const key = normalizeShortcutKeyToken(parts[parts.length - 1] ?? "");
  const mods = parts
    .slice(0, -1)
    .map((part) => {
      if (PRIMARY_MODIFIERS.has(part)) return "cmdorctrl";
      if (part === "control") return "ctrl";
      if (part === "option") return "alt";
      return part;
    })
    .sort();
  return [...mods, key].join("+");
}

/**
 * Host-level chords that actions must never steal (launcher summon, Spotlight, …).
 * In-app list actions should use Cmd/Ctrl+letter or Cmd/Ctrl+Backspace instead.
 */
export function isReservedGlobalShortcut(shortcut: string | undefined): boolean {
  const canonical = canonicalizeShortcut(shortcut);
  if (!canonical) return false;
  if (RESERVED_GLOBAL_SHORTCUTS.has(canonical)) return true;
  // Any *+space with Alt/Option or primary mod is reserved for OS / launcher.
  const parts = canonical.split("+");
  const key = parts[parts.length - 1];
  if (key !== "space") return false;
  return parts.some((part) =>
    part === "alt"
    || part === "cmdorctrl"
    || part === "ctrl"
    || part === "meta"
    || part === "cmd"
  );
}

function isOsReservedGlobalShortcut(shortcut: string | undefined): boolean {
  const canonical = canonicalizeShortcut(shortcut);
  return canonical ? OS_RESERVED_GLOBAL_SHORTCUTS.has(canonical) : false;
}

/**
 * True when this event is a reserved host chord (do not handle as an action).
 * Prevents in-app handlers from interfering with launcher summon / Spotlight.
 */
export function isReservedGlobalShortcutEvent(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
): boolean {
  const key = normalizeEventKey(event);
  if (key !== "space") return false;
  // Any host/OS modifier around Space belongs to the global responder chain.
  // In particular Windows' Qx default uses Ctrl+Alt+Space.
  return event.altKey || event.metaKey || event.ctrlKey;
}

export function matchesQxShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  shortcut: string | undefined,
): boolean {
  if (!shortcut || isReservedGlobalShortcut(shortcut)) return false;

  const parts = shortcutTokens(shortcut).map((part) => part.toLowerCase());
  if (parts.length === 0) return false;
  const keyToken = normalizeShortcutKeyToken(parts[parts.length - 1] ?? "");
  const modParts = parts.slice(0, -1);
  if (!keyToken || modParts.some((part) => !MODIFIER_TOKENS.has(part))) {
    return false;
  }

  const preset = getQxShortcutPreset();
  const wantsPrimary = modParts.some((part) => PRIMARY_MODIFIERS.has(part));
  const wantsMeta = wantsPrimary ? preset.primaryEventModifier === "metaKey" : false;
  const wantsCtrl = modParts.some((part) => part === "ctrl" || part === "control");
  const wantsAlt = modParts.some((part) => part === "alt" || part === "option");
  const wantsShift = modParts.includes("shift");
  const expectedCtrl = wantsCtrl || (wantsPrimary && preset.primaryEventModifier === "ctrlKey");

  if (
    event.metaKey !== wantsMeta
    || event.ctrlKey !== expectedCtrl
    || event.altKey !== wantsAlt
    || event.shiftKey !== wantsShift
  ) {
    return false;
  }

  return keysMatch(keyToken, normalizeEventKey(event));
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

export function defaultQxHostShortcutsForPlatform(platform: QxDesktopPlatform): {
  toggleLauncher: string;
  toggleWindow: string;
} {
  return platform === "windows"
    ? { toggleLauncher: "Ctrl+Alt+Shift+Space", toggleWindow: "Ctrl+Alt+Space" }
    : { toggleLauncher: "Alt+Shift+Space", toggleWindow: "Alt+Space" };
}

export function getDefaultQxHostShortcuts() {
  return defaultQxHostShortcutsForPlatform(getQxDesktopPlatform());
}

export function getQxShortcutPreset(): QxShortcutPreset {
  return QX_SHORTCUT_PRESETS[getQxDesktopPlatform()];
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
    else {
      const key = normalizeShortcutKeyToken(token);
      if (key === "enter") keys.push("↵");
      else if (key === "backspace") keys.push("⌫");
      else if (key === "delete") keys.push("⌦");
      else if (key === "space") keys.push("Space");
      else if (key === "escape") keys.push("Esc");
      else keys.push(token === "Return" ? "Enter" : token);
    }
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
    .map((token) => {
      const lower = token.toLowerCase();
      if (PRIMARY_MODIFIERS.has(lower)) return "CmdOrCtrl";
      if (lower === "option") return "Alt";
      return token;
    })
    .join("+");
}

export type ShortcutBindingLike = { key: string; enabled: boolean };

/**
 * Count enabled global bindings by canonical key (Cmd/CmdOrCtrl/Meta collapse).
 * Used for conflict detection across module shortcuts and per-app shortcuts.
 */
export function countEnabledGlobalShortcuts(
  ...groups: Array<Record<string, ShortcutBindingLike> | undefined>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const group of groups) {
    if (!group) continue;
    for (const binding of Object.values(group)) {
      if (!binding?.enabled || !binding.key?.trim()) continue;
      const canonical = canonicalizeShortcut(binding.key);
      if (!canonical) continue;
      counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    }
  }
  return counts;
}

/** True when this binding collides with another enabled global, or is OS/host reserved. */
export function globalShortcutHasConflict(
  binding: ShortcutBindingLike | undefined,
  counts: Map<string, number>,
): boolean {
  if (!binding?.enabled || !binding.key?.trim()) return false;
  if (isOsReservedGlobalShortcut(binding.key)) return true;
  const canonical = canonicalizeShortcut(binding.key);
  if (!canonical) return false;
  return (counts.get(canonical) ?? 0) > 1;
}

export type GlobalShortcutIssue = "reserved" | "invalid" | "conflict";

/** Stable issue code when a global binding is invalid / conflicting. */
export function globalShortcutIssue(
  binding: ShortcutBindingLike | undefined,
  counts: Map<string, number>,
): GlobalShortcutIssue | null {
  if (!binding?.enabled || !binding.key?.trim()) return null;
  if (isOsReservedGlobalShortcut(binding.key)) {
    return "reserved";
  }
  const canonical = canonicalizeShortcut(binding.key);
  if (!canonical) return "invalid";
  if ((counts.get(canonical) ?? 0) > 1) {
    return "conflict";
  }
  return null;
}
