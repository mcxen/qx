import { useEffect, useRef } from "react";
import type { QxShellAction } from "./ShellActionButton";
import { Popover, PopoverAnchor, PopoverContent } from "./ui";
import { formatQxShortcut } from "../utils/keyboard";

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  actions: QxShellAction[];
  activeIndex: number;
  onHover: (index: number) => void;
  onRun: (action: QxShellAction) => void;
}) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex, open]);

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
        className="qx-actions-popover"
        role="menu"
        aria-label={title}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => {
          // Actions button owns toggle; prevent close→reopen on the same click.
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
          // Esc is handled by QxShell action-menu keyboard protocol (focus restore).
          event.preventDefault();
        }}
      >
        <div className="qx-actions-popover-title">{title}</div>
        {actions.map((action, index) => (
          <button
            key={`${action.label}-${index}`}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            className={`qx-actions-popover-item${index === activeIndex ? " is-active" : ""}${
              action.tone === "danger" ? " danger" : ""
            }`}
            disabled={action.disabled}
            onMouseEnter={() => onHover(index)}
            onClick={() => onRun(action)}
            role="menuitem"
            type="button"
          >
            <span>{action.label}</span>
            <span className="qx-actions-popover-kbds">
              {action.menuKey && (
                <kbd className="qx-actions-menu-key" title="While Actions is open">
                  {action.menuKey.toUpperCase()}
                </kbd>
              )}
              {action.kbd && <kbd>{formatQxShortcut(action.kbd)}</kbd>}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
