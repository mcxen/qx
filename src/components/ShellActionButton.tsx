import { Button } from "./ui";
import { formatQxShortcut } from "../utils/keyboard";

export interface QxShellAction {
  label: string;
  kbd?: string;
  disabled?: boolean;
  tone?: "normal" | "primary" | "danger";
  onClick?: () => void;
}

export default function ShellActionButton({
  action,
  variant = "normal",
}: {
  action?: QxShellAction;
  variant?: "normal" | "escape";
}) {
  if (!action || action.disabled) return null;
  const shortcutLabel = formatQxShortcut(action.kbd);

  return (
    <Button
      className={`qx-shell-action tone-${action.tone ?? "normal"} variant-${variant}`}
      disabled={action.disabled}
      onClick={action.onClick}
      type="button"
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
