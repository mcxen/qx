import { Button } from "./ui";
import { formatQxShortcut } from "../utils/keyboard";

export interface QxShellAction {
  label: string;
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
