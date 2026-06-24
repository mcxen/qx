import type { AppEntry } from "../store";
import { getLauncherActionTitle } from "./launcherActions";
import type { LauncherAction } from "./types";

export default function LauncherActionPopover({
  actions,
  activeIndex,
  selectedItem,
  onHover,
  onRun,
}: {
  actions: LauncherAction[];
  activeIndex: number;
  selectedItem: AppEntry;
  onHover: (index: number) => void;
  onRun: (action: LauncherAction) => void;
}) {
  const title = getLauncherActionTitle(selectedItem);

  return (
    <div className="qx-actions-popover" role="menu" aria-label={title}>
      <div className="qx-actions-popover-title">{title}</div>
      {actions.map((action, index) => (
        <button
          key={action.id}
          className={`qx-actions-popover-item${index === activeIndex ? " is-active" : ""}${
            action.danger ? " danger" : ""
          }`}
          disabled={action.disabled}
          onMouseEnter={() => onHover(index)}
          onClick={() => onRun(action)}
          role="menuitem"
          type="button"
        >
          <span>{action.label}</span>
          {action.kbd && <kbd>{action.kbd}</kbd>}
        </button>
      ))}
    </div>
  );
}
