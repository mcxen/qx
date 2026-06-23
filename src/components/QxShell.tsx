import { forwardRef } from "react";
import type { ReactNode } from "react";

export interface BottomIslandContent {
  label: string;
  detail?: string;
  progress?: number;
  tone?: "neutral" | "success" | "warning" | "danger";
  actionLabel?: string;
  onAction?: () => void;
}

interface QxShellAction {
  label: string;
  kbd?: string;
  disabled?: boolean;
  tone?: "normal" | "primary" | "danger";
  onClick?: () => void;
}

interface QxShellProps {
  title: string;
  search?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  context?: ReactNode;
  island?: BottomIslandContent | null;
  customIsland?: ReactNode;
  escapeAction?: QxShellAction;
  primaryAction?: QxShellAction;
  secondaryAction?: QxShellAction;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
  onKeyDown?: (event: React.KeyboardEvent) => void;
}

function clampProgress(value?: number): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export function QxBottomIsland({ content }: { content?: BottomIslandContent | null }) {
  const progress = clampProgress(content?.progress);

  return (
    <div
      className={`qx-bottom-island${content ? "" : " is-empty"}${
        content?.tone ? ` tone-${content.tone}` : ""
      }`}
    >
      {content ? (
        <>
          <div className="qx-bottom-island-copy">
            <span className="qx-bottom-island-label">{content.label}</span>
            {content.detail && (
              <span className="qx-bottom-island-detail">{content.detail}</span>
            )}
          </div>
          {progress !== null && (
            <div
              className="qx-bottom-island-progress"
              aria-label={`${progress}%`}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          )}
          {content.actionLabel && (
            <button
              className="qx-bottom-island-action"
              onClick={content.onAction}
              type="button"
            >
              {content.actionLabel}
            </button>
          )}
        </>
      ) : (
        <span className="qx-bottom-island-placeholder" />
      )}
    </div>
  );
}

function ShellActionButton({
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

const QxShell = forwardRef<HTMLDivElement, QxShellProps>(function QxShell({
  title,
  search,
  leading,
  trailing,
  children,
  context,
  island,
  customIsland,
  escapeAction,
  primaryAction,
  secondaryAction,
  onBack,
  backLabel = "Back",
  className = "",
  onKeyDown,
}, ref) {
  const fallbackEscapeAction: QxShellAction = onBack
    ? { label: backLabel, kbd: "Esc", onClick: onBack }
    : { label: "Esc", kbd: "Esc" };
  const leftAction = escapeAction ?? fallbackEscapeAction;
  const visiblePrimaryAction = primaryAction?.disabled ? undefined : primaryAction;
  const visibleSecondaryAction = secondaryAction?.disabled ? undefined : secondaryAction;
  const hasRightActions = Boolean(visiblePrimaryAction || visibleSecondaryAction);

  return (
    <div
      ref={ref}
      className={`qx-shell ${context ? "has-context" : ""} ${className}`}
      aria-label={title}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <div className="qx-shell-topbar" data-tauri-drag-region>
        {onBack ? (
          <button
            className="qx-shell-back"
            onClick={onBack}
            title={backLabel}
            type="button"
          >
            <span aria-hidden="true" />
          </button>
        ) : (
          leading
        )}
        <div className="qx-shell-search-slot">{search}</div>
        {trailing && <div className="qx-shell-trailing">{trailing}</div>}
      </div>

      <div className="qx-shell-main">
        <main className="qx-shell-content">{children}</main>
        {context && <aside className="qx-shell-context">{context}</aside>}
      </div>

      <div className="qx-shell-bottombar">
        <div className="qx-shell-left">
          <ShellActionButton action={leftAction} variant="escape" />
        </div>
        {customIsland ?? <QxBottomIsland content={island} />}
        {hasRightActions ? (
          <div className="qx-shell-actions">
            <ShellActionButton action={visiblePrimaryAction} />
            <ShellActionButton action={visibleSecondaryAction} />
          </div>
        ) : (
          <div className="qx-shell-actions is-empty" aria-hidden="true" />
        )}
      </div>
    </div>
  );
});

export default QxShell;
