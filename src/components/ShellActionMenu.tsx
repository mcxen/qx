import { useEffect, useRef } from "react";
import type { QxShellAction } from "./ShellActionButton";
import { Popover, PopoverAnchor, PopoverContent } from "./ui";
import { formatQxShortcut } from "../utils/keyboard";

/** Mark shell Actions buttons so outside-dismiss does not race the toggle click. */
export const QX_ACTION_MENU_TRIGGER_ATTR = "data-qx-action-menu-trigger";

export function actionHasSubmenu(action: QxShellAction): boolean {
  return Boolean(
    (action.children && action.children.length > 0) || action.loadChildren,
  );
}

export default function ShellActionMenu({
  open,
  onOpenChange,
  title,
  actions,
  activeIndex,
  onHover,
  onRun,
  canGoBack = false,
  onBack,
  searchable = false,
  searchQuery = "",
  onSearchQueryChange,
  searchPlaceholder = "Filter…",
  loading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  actions: QxShellAction[];
  activeIndex: number;
  onHover: (index: number) => void;
  onRun: (action: QxShellAction) => void;
  /** Nested panel: show back control (Raycast). */
  canGoBack?: boolean;
  onBack?: () => void;
  searchable?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  searchPlaceholder?: string;
  loading?: boolean;
}) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex, open, actions]);

  useEffect(() => {
    if (!open || !searchable) return;
    // Focus filter when drilling into a searchable submenu (clipboard).
    const id = window.requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, searchable, title]);

  const isActionMenuTrigger = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(`[${QX_ACTION_MENU_TRIGGER_ATTR}]`));
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange} modal={false}>
      <PopoverAnchor asChild>
        <span className="qx-actions-popover-anchor" aria-hidden="true" />
      </PopoverAnchor>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={10}
        className={`qx-actions-popover${searchable ? " is-searchable" : ""}${
          canGoBack ? " is-nested" : ""
        }`}
        role="menu"
        aria-label={title}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => {
          if (isActionMenuTrigger(event.target)) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isActionMenuTrigger(event.target)) {
            event.preventDefault();
          }
        }}
        onEscapeKeyDown={(event) => {
          // Esc is handled by QxShell action-menu keyboard protocol (focus restore / pop).
          event.preventDefault();
        }}
      >
        <div className="qx-actions-popover-title">
          {canGoBack ? (
            <button
              type="button"
              className="qx-actions-popover-back"
              onClick={() => onBack?.()}
              aria-label="Back"
            >
              ←
            </button>
          ) : null}
          <span className="qx-actions-popover-title-text">{title}</span>
        </div>

        {searchable ? (
          <input
            ref={searchRef}
            className="qx-actions-popover-search"
            type="search"
            value={searchQuery}
            placeholder={searchPlaceholder}
            onChange={(event) => onSearchQueryChange?.(event.target.value)}
            onKeyDown={(event) => {
              // Keep ↑↓/Enter on the shell handler; stop only bubble for typing keys.
              if (
                event.key === "ArrowDown"
                || event.key === "ArrowUp"
                || event.key === "Enter"
                || event.key === "Escape"
                || event.key === "ArrowLeft"
                || event.key === "ArrowRight"
                || event.key === "Home"
                || event.key === "End"
              ) {
                return;
              }
              event.stopPropagation();
            }}
          />
        ) : null}

        <div className="qx-actions-popover-scroll">
          {loading ? (
            <div className="qx-actions-popover-empty">…</div>
          ) : actions.length === 0 ? (
            <div className="qx-actions-popover-empty">—</div>
          ) : (
            actions.map((action, index) => {
              const nested = actionHasSubmenu(action);
              return (
                <button
                  key={`${action.label}-${index}`}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  className={`qx-actions-popover-item${index === activeIndex ? " is-active" : ""}${
                    action.tone === "danger" ? " danger" : ""
                  }${nested ? " has-submenu" : ""}`}
                  disabled={action.disabled}
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onRun(action)}
                  role="menuitem"
                  type="button"
                >
                  <span className="qx-actions-popover-copy">
                    <span className="qx-actions-popover-label">{action.label}</span>
                    {action.detail ? (
                      <span className="qx-actions-popover-detail">{action.detail}</span>
                    ) : null}
                  </span>
                  <span className="qx-actions-popover-kbds">
                    {action.menuKey && (
                      <kbd className="qx-actions-menu-key" title="While Actions is open">
                        {action.menuKey.toUpperCase()}
                      </kbd>
                    )}
                    {action.kbd && <kbd>{formatQxShortcut(action.kbd)}</kbd>}
                    {nested ? (
                      <kbd className="qx-actions-submenu-chevron" aria-hidden="true">
                        ›
                      </kbd>
                    ) : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
