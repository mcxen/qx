import type { BottomIslandContent } from "../../components/QxBottomIsland";
import type { IslandSlotContent, IslandTone } from "../types";

/** Map legacy BottomIslandContent → IslandSlotContent (actions bound separately). */
export function mapBottomIslandContent(
  content: BottomIslandContent,
): IslandSlotContent {
  const meter =
    typeof content.progress === "number"
      ? {
          kind: "progress" as const,
          progress: content.progress,
        }
      : content.activity
        ? {
            kind: "activity" as const,
            activity: content.activity,
          }
        : undefined;

  return {
    primary: content.label,
    secondary: content.detail,
    meter,
    tone: content.tone as IslandTone | undefined,
    action:
      content.actionLabel != null
        ? { id: "default", label: content.actionLabel }
        : undefined,
    actions: (content.actions ?? []).slice(0, 2).map(({ id, label, icon, variant }) => ({
      id,
      label,
      icon,
      variant,
    })),
    effect: content.effect,
  };
}

/** Reverse map for transitional call sites that still read BottomIslandContent. */
export function mapSlotToBottomIsland(
  content: IslandSlotContent,
): BottomIslandContent {
  return {
    label: content.primary,
    detail: content.secondary,
    progress:
      content.meter?.kind === "progress" ? content.meter.progress : undefined,
    activity:
      content.meter?.kind === "activity" ? content.meter.activity : undefined,
    tone: content.tone,
    actionLabel: content.action?.label,
    effect: content.effect,
  };
}
