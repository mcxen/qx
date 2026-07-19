import { useState } from "react";
import { ExternalLink, LoaderCircle, Pause, Play, Square } from "lucide-react";
import { Button } from "../../components/ui";
import type { IslandContentAction } from "../types";

export interface IslandActionButtonProps {
  action: IslandContentAction;
  onInvoke: (action: IslandContentAction) => void | Promise<void>;
}

/**
 * The only business-action button rendered inside an island surface.
 * It owns size, iconography, danger styling, focus treatment and duplicate-click
 * protection so producers publish intent rather than custom controls.
 */
export default function IslandActionButton({
  action,
  onInvoke,
}: IslandActionButtonProps) {
  const [pending, setPending] = useState(false);

  const invoke = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onInvoke(action);
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      className="qx-island-shell-action"
      type="button"
      variant={action.variant === "danger" ? "destructive" : "ghost"}
      size="sm"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => void invoke()}
      data-variant={action.variant ?? "default"}
      aria-label={action.label}
    >
      <IslandActionGlyph icon={action.icon} pending={pending} />
      {action.label}
    </Button>
  );
}

function IslandActionGlyph({
  icon,
  pending,
}: {
  icon?: IslandContentAction["icon"];
  pending: boolean;
}) {
  if (pending) {
    return <LoaderCircle className="qx-island-shell-action-icon is-spinning" aria-hidden="true" />;
  }
  const props = { className: "qx-island-shell-action-icon", "aria-hidden": true } as const;
  if (icon === "pause") return <Pause {...props} />;
  if (icon === "play") return <Play {...props} />;
  if (icon === "stop") return <Square {...props} />;
  if (icon === "open") return <ExternalLink {...props} />;
  return null;
}
