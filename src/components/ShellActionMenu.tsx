import { useEffect, useId, useRef } from "react";
import type { QxShellAction } from "./ShellActionButton";
import { Popover, PopoverAnchor, PopoverContent } from "./ui";
import { formatQxShortcut } from "../utils/keyboard";
import { useT } from "../i18n";
import { useActionExecution } from "./qx-shell/ActionExecutionContext";
import { actionHasSubmenu } from "./qx-shell/actionProtocol";
export { actionHasSubmenu } from "./qx-shell/actionProtocol";

/** Mark shell Actions buttons so outside-dismiss does not race the toggle click. */
export const QX_ACTION_MENU_TRIGGER_ATTR = "data-qx-action-menu-trigger";

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
  anchorPoint,
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
  /** Viewport coordinate for context-menu invocation; absent anchors to Bottom Bar Actions. */
  anchorPoint?: { x: number; y: number } | null;
}) {
  const t = useT();
  const execution = useActionExecution();
  const menuId = useId();
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.scrollIntoView({
      block: "nearest",
    });
    if (!searchable) itemRefs.current[activeIndex]?.focus({ preventScroll: true });
  }, [activeIndex, open, actions, searchable]);

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
        <span
          className={`qx-actions-popover-anchor${anchorPoint ? " is-contextual" : ""}`}
          style={
            anchorPoint
              ? { left: anchorPoint.x, top: anchorPoint.y, right: "auto", bottom: "auto" }
              : undefined
          }
          aria-hidden="true"
        />
      </PopoverAnchor>
      <PopoverContent
        ref={menuRef}
        tabIndex={-1}
        align={anchorPoint ? "start" : "end"}
        side={anchorPoint ? "right" : "top"}
        sideOffset={anchorPoint ? 6 : 10}
        className={`qx-actions-popover${searchable ? " is-searchable" : ""}${
          canGoBack ? " is-nested" : ""
        }`}
        role={searchable ? "dialog" : "menu"}
        aria-label={title}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          ((searchable ? searchRef.current : itemRefs.current[activeIndex]) ?? menuRef.current)?.focus({ preventScroll: true });
        }}
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
          // Radix renders the content in a portal and marks Escape handled
          // before the event can reach QxShell's root keydown responder. Close
          // here explicitly, while preserving nested-panel back behavior.
          event.preventDefault();
          if (canGoBack) onBack?.();
          else onOpenChange(false);
        }}
      >
        <div className="qx-actions-popover-title">
          {canGoBack ? (
            <button
              type="button"
              className="qx-actions-popover-back"
              onClick={() => onBack?.()}
              aria-label={t("common.back", "Back")}
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
            aria-label={t("shell.filterActions", "Filter…")}
            role="combobox"
            aria-expanded={open}
            aria-controls={menuId}
            aria-activedescendant={actions[activeIndex] ? `${menuId}-${activeIndex}` : undefined}
            autoComplete="off"
            spellCheck={false}
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

        <div id={menuId} className="qx-actions-popover-scroll" role={searchable ? "listbox" : "group"} aria-label={title}>
          {loading ? (
            <div className="qx-actions-popover-empty">…</div>
          ) : actions.length === 0 ? (
            <div className="qx-actions-popover-empty">—</div>
          ) : (
            actions.map((action, index) => {
              const nested = actionHasSubmenu(action);
              return (
                <button
                  key={action.id}
                  id={`${menuId}-${index}`}
                  ref={(element) => {
                    itemRefs.current[index] = element;
                  }}
                  className={`qx-actions-popover-item${index === activeIndex ? " is-active" : ""}${
                    action.tone === "danger" ? " danger" : ""
                  }${nested ? " has-submenu" : ""}`}
                  disabled={action.disabled || execution?.isPending(action)}
                  aria-busy={execution?.isPending(action) || undefined}
                  tabIndex={index === activeIndex && !searchable ? 0 : -1}
                  aria-selected={searchable ? index === activeIndex : undefined}
                  onMouseEnter={() => onHover(index)}
                  onClick={() => onRun(action)}
                  role={searchable ? "option" : "menuitem"}
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
                      <kbd className="qx-actions-menu-key" title={t("shell.menuShortcut", "While Actions is open")}>
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
