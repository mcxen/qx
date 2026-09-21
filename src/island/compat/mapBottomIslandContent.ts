import type { BottomIslandContent } from "./bottomIslandTypes";
import type { IslandPriority, IslandSlotContent, IslandTone } from "../types";

/**
 * Legacy module surfaces only supplied content, so the Shell used to publish
 * every session as a location. Infer the semantic priority from the content
 * while preserving an explicit caller override.
 */
export function inferBottomIslandPriority(
  content: BottomIslandContent | null | undefined,
): IslandPriority {
  if (content?.priority) return content.priority;
  if (content?.tone === "danger") return "error";
  if (content?.activity || typeof content?.progress === "number") return "task";
  return "location";
}

/** Map legacy BottomIslandContent → IslandSlotContent (actions bound separately). */
export function mapBottomIslandContent(
  content: BottomIslandContent,
): IslandSlotContent {
  const meter =
    typeof content.progress === "number"
      ? {
          kind: "progress" as const,
          progress: content.progress,
          presentation: content.progressStyle,
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
    actions: (content.actions ?? []).slice(0, 2).map(({ id, label, shortcut, icon, variant }) => ({
      id,
      label,
      shortcut,
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
    progressStyle:
      content.meter?.kind === "progress" ? content.meter.presentation : undefined,
    activity:
      content.meter?.kind === "activity" ? content.meter.activity : undefined,
    tone: content.tone,
    actionLabel: content.action?.label,
    effect: content.effect,
  };
}
