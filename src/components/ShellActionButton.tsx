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

  return (
    <button
      className={`qx-shell-action tone-${action.tone ?? "normal"} variant-${variant}`}
      disabled={action.disabled}
      onClick={action.onClick}
      type="button"
    >
      {variant === "escape" && action.kbd ? (
        <kbd>{action.kbd}</kbd>
      ) : (
        <>
          <span>{action.label}</span>
          {action.kbd && <kbd>{action.kbd}</kbd>}
        </>
      )}
    </button>
  );
}
