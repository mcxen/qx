import { useEffect, useRef } from "react";
import type { QxShellAction } from "./ShellActionButton";
import { Popover, PopoverAnchor, PopoverContent } from "./ui";
import { formatQxShortcut } from "../utils/keyboard";

export default function ShellActionMenu({
  title,
  actions,
  activeIndex,
  onHover,
  onRun,
}: {
  title: string;
  actions: QxShellAction[];
  activeIndex: number;
  onHover: (index: number) => void;
  onRun: (action: QxShellAction) => void;
}) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [activeIndex]);

  return (
    <Popover open modal={false}>
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
          {action.kbd && <kbd>{formatQxShortcut(action.kbd)}</kbd>}
        </button>
      ))}
      </PopoverContent>
    </Popover>
  );
}
