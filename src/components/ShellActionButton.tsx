import { Button } from "./ui";
import { formatQxShortcut } from "../utils/keyboard";
import { useActionExecution } from "./qx-shell/ActionExecutionContext";

import type { QxShellAction } from "./qx-shell/actionProtocol";
export type { QxShellAction } from "./qx-shell/actionProtocol";

export default function ShellActionButton({
  action,
  variant = "normal",
  triggerAttrs,
  onRun,
}: {
  action?: QxShellAction;
  variant?: "normal" | "primary" | "escape";
  /** Extra DOM attributes (e.g. action-menu trigger marker for outside-dismiss). */
  triggerAttrs?: Record<string, string | boolean | undefined>;
  onRun?: (action: QxShellAction) => void;
}) {
  const execution = useActionExecution();
  if (!action) return null;
  const shortcutLabel = formatQxShortcut(action.kbd);
  const resolvedTone = variant === "primary" && (action.tone == null || action.tone === "normal")
    ? "primary"
    : action.tone ?? "normal";

  return (
    <Button
      className={`qx-shell-action tone-${resolvedTone} variant-${variant}`}
      disabled={action.disabled || execution?.isPending(action)}
      aria-busy={execution?.isPending(action) || undefined}
      onClick={() => (onRun ?? execution?.run)?.(action)}
      type="button"
      title={action.label}
      aria-label={action.label}
      {...triggerAttrs}
    >
      {/* Escape shows label + Esc kbd (Back/Hide). Other variants keep label + optional kbd. */}
      {action.label ? <span>{action.label}</span> : null}
      {shortcutLabel ? <kbd>{shortcutLabel}</kbd> : null}
    </Button>
  );
}
