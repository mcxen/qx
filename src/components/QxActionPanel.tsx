import type { HTMLAttributes, ReactNode } from "react";
import { formatQxShortcut } from "../utils/keyboard";
import type { QxShellAction } from "./ShellActionButton";
import { Button } from "./ui";

export function QxActionList({
  actions,
  empty,
}: {
  actions: readonly QxShellAction[];
  empty?: ReactNode;
}) {
  if (!actions.length) return empty ? <>{empty}</> : null;
  return actions.map((action, index) => {
    const shortcut = formatQxShortcut(action.kbd);
    return (
      <Button
        key={`${action.label}-${index}`}
        className={`qx-action-item${action.tone === "danger" ? " danger" : ""}`}
        variant="ghost"
        type="button"
        disabled={action.disabled}
        onClick={action.onClick}
      >
        <span className="qx-action-item-copy">
          <span>{action.label}</span>
          {action.detail ? <small className="qx-action-item-detail">{action.detail}</small> : null}
        </span>
        {shortcut ? <kbd>{shortcut}</kbd> : null}
      </Button>
    );
  });
}

export function QxActionPanel({
  title,
  actions,
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & {
  title: ReactNode;
  actions: readonly QxShellAction[];
}) {
  return (
    <aside className={`qx-action-panel${className ? ` ${className}` : ""}`} {...props}>
      <div className="qx-action-title">{title}</div>
      <QxActionList actions={actions} />
      {children}
    </aside>
  );
}
