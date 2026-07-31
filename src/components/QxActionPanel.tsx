import { Fragment, type HTMLAttributes, type ReactNode } from "react";
import { formatQxShortcut } from "../utils/keyboard";
import type { QxShellAction } from "./ShellActionButton";
import { Button } from "./ui";

export function QxActionList({
  actions,
  empty,
  showShortcuts = true,
}: {
  actions: readonly QxShellAction[];
  empty?: ReactNode;
  showShortcuts?: boolean;
}) {
  if (!actions.length) return empty ? <>{empty}</> : null;
  return actions.map((action) => {
    const shortcut = formatQxShortcut(action.kbd);
    return (
      <Button
        key={action.id}
        className={`qx-action-item${action.tone === "danger" ? " danger" : ""}`}
        variant="ghost"
        type="button"
        data-qx-search-focus="preserve"
        disabled={action.disabled}
        onClick={action.onClick}
      >
        <span className="qx-action-item-copy">
          <span>{action.label}</span>
          {action.detail ? <small className="qx-action-item-detail">{action.detail}</small> : null}
        </span>
        {showShortcuts && shortcut ? <kbd>{shortcut}</kbd> : null}
      </Button>
    );
  });
}

export interface QxActionSection {
  /** Stable, non-localized identity used as the React key. */
  id: string;
  title: ReactNode;
  /** Optional summary/metadata rendered between the heading and actions. */
  summary?: ReactNode;
  actions: readonly QxShellAction[];
  showShortcuts?: boolean;
}

/**
 * Shared Workbench/feature projection for grouped Context actions.
 *
 * Callers keep one QxShellAction collection and partition it into semantic
 * sections; this component only renders non-empty groups. The primary action
 * should already be removed by stable id before projection so Context never
 * duplicates the Bottom Bar action.
 */
export function QxActionSections({ sections }: { sections: readonly QxActionSection[] }) {
  return sections
    .filter((section) => section.actions.length > 0)
    .map((section) => (
      <Fragment key={section.id}>
        <div className="qx-action-title">{section.title}</div>
        {section.summary}
        <QxActionList
          actions={section.actions}
          showShortcuts={section.showShortcuts}
        />
      </Fragment>
    ));
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
