import { forwardRef, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import QxBottomIsland, { type BottomIslandContent } from "./QxBottomIsland";
import ShellActionButton, { type QxShellAction } from "./ShellActionButton";
import ShellActionMenu from "./ShellActionMenu";

export type { BottomIslandContent } from "./QxBottomIsland";
export type { QxShellAction } from "./ShellActionButton";

interface QxShellProps {
  title: string;
  visual?: "solid" | "elevated" | "glass";
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
  actions?: QxShellAction[];
  actionTitle?: string;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  overlayBottom?: boolean;
}

const QxShell = forwardRef<HTMLDivElement, QxShellProps>(function QxShell({
  title,
  visual = "solid",
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
  actions,
  actionTitle,
  onBack,
  backLabel = "Back",
  className = "",
  onKeyDown,
  overlayBottom,
}, ref) {
  const fallbackEscapeAction: QxShellAction = onBack
    ? { label: backLabel, kbd: "Esc", onClick: onBack }
    : { label: "Esc", kbd: "Esc" };
  const leftAction = escapeAction ?? fallbackEscapeAction;
  const visiblePrimaryAction = primaryAction?.disabled ? undefined : primaryAction;
  const visibleSecondaryAction = secondaryAction?.disabled ? undefined : secondaryAction;
  const hasRightActions = Boolean(visiblePrimaryAction || visibleSecondaryAction);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [actionIndex, setActionIndex] = useState(0);
  const menuActions = useMemo(() => actions ?? [], [actions]);
  const menuTitle = actionTitle ?? `${title} Actions`;

  useEffect(() => {
    if (menuActions.length === 0) {
      setActionMenuOpen(false);
      setActionIndex(0);
      return;
    }
    setActionIndex((index) => Math.max(0, Math.min(index, menuActions.length - 1)));
  }, [menuActions.length]);

  const runMenuAction = (action: QxShellAction) => {
    if (action.disabled) return;
    setActionMenuOpen(false);
    action.onClick?.();
  };

  const findNextActionIndex = (startIndex: number, direction: 1 | -1): number => {
    if (menuActions.length === 0) return 0;
    for (let step = 1; step <= menuActions.length; step += 1) {
      const index = (startIndex + step * direction + menuActions.length) % menuActions.length;
      if (!menuActions[index]?.disabled) return index;
    }
    return Math.max(0, Math.min(startIndex, menuActions.length - 1));
  };

  const openActionMenu = () => {
    const firstEnabled = menuActions.findIndex((action) => !action.disabled);
    setActionIndex(firstEnabled >= 0 ? firstEnabled : 0);
    setActionMenuOpen((open) => !open);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (actionMenuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setActionMenuOpen(false);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setActionIndex((index) => findNextActionIndex(index, 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActionIndex((index) => findNextActionIndex(index, -1));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        const action = menuActions[actionIndex];
        if (action) runMenuAction(action);
        return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const action = menuActions.find(
          (item) => item.kbd?.length === 1 && item.kbd.toLowerCase() === event.key.toLowerCase(),
        );
        if (action) {
          event.preventDefault();
          event.stopPropagation();
          runMenuAction(action);
        }
        return;
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && menuActions.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      openActionMenu();
      return;
    }

    onKeyDown?.(event);
  };

  return (
    <div
      ref={ref}
      className={`qx-shell visual-${visual} ${context ? "has-context" : ""} ${overlayBottom ? "qx-shell-overlay-bottom" : ""} ${className}`}
      aria-label={title}
      onKeyDownCapture={handleKeyDown}
      tabIndex={0}
    >
      <div className="qx-shell-drag-edge edge-top" data-tauri-drag-region aria-hidden="true" />
      <div className="qx-shell-drag-edge edge-right" data-tauri-drag-region aria-hidden="true" />
      <div className="qx-shell-drag-edge edge-bottom" data-tauri-drag-region aria-hidden="true" />
      <div className="qx-shell-drag-edge edge-left" data-tauri-drag-region aria-hidden="true" />

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
            <ShellActionButton
              action={
                visibleSecondaryAction && menuActions.length > 0 && !visibleSecondaryAction.onClick
                  ? {
                      ...visibleSecondaryAction,
                      onClick: () => {
                        openActionMenu();
                      },
                    }
                  : visibleSecondaryAction
              }
            />
          </div>
        ) : (
          <div className="qx-shell-actions is-empty" aria-hidden="true" />
        )}
      </div>
      {actionMenuOpen && menuActions.length > 0 && (
        <ShellActionMenu
          title={menuTitle}
          actions={menuActions}
          activeIndex={actionIndex}
          onHover={setActionIndex}
          onRun={runMenuAction}
        />
      )}
    </div>
  );
});

export default QxShell;
