import { Button } from "./ui";
import { formatQxShortcut } from "../utils/keyboard";

export interface QxShellAction {
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
  onClick?: () => void;
  /**
   * Raycast nested Action Panel: static children. Enter / → drills in;
   * Esc / ← returns to parent.
   */
  children?: QxShellAction[];
  /**
   * Async children (e.g. load last 50 clipboard items when drilling in).
   * Prefer over pre-building huge static lists.
   */
  loadChildren?: () => Promise<QxShellAction[]>;
  /** When true, the nested panel shows a filter field (clipboard-style lists). */
  searchable?: boolean;
  /** Placeholder for the nested filter field when `searchable`. */
  searchPlaceholder?: string;
}

export default function ShellActionButton({
  action,
  variant = "normal",
  triggerAttrs,
}: {
  action?: QxShellAction;
  variant?: "normal" | "escape";
  /** Extra DOM attributes (e.g. action-menu trigger marker for outside-dismiss). */
  triggerAttrs?: Record<string, string | boolean | undefined>;
}) {
  if (!action || action.disabled) return null;
  const shortcutLabel = formatQxShortcut(action.kbd);

  return (
    <Button
      className={`qx-shell-action tone-${action.tone ?? "normal"} variant-${variant}`}
      disabled={action.disabled}
      onClick={action.onClick}
      type="button"
      {...triggerAttrs}
    >
      {variant === "escape" && shortcutLabel ? (
        <kbd>{shortcutLabel}</kbd>
      ) : (
        <>
          <span>{action.label}</span>
          {shortcutLabel && <kbd>{shortcutLabel}</kbd>}
        </>
      )}
    </Button>
  );
}
