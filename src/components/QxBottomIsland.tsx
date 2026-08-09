/**
 * @deprecated Prefer islandHost + ShellContent / QxIslandSurface.
 * Kept as a thin adapter for modules still passing BottomIslandContent shapes.
 */
import ShellContent from "../island/surface/ShellContent";
import QxIslandSurface from "../island/surface/QxIslandSurface";
import { mapBottomIslandContent } from "../island/compat/mapBottomIslandContent";
import type {
  IslandActionIcon,
  IslandActionVariant,
  IslandActivity,
  IslandProgressStyle,
} from "../island/types";
import { useIslandProgress } from "../island/surface/useIslandProgress";

export interface BottomIslandAction {
  id: string;
  label: string;
  shortcut?: string;
  onAction: () => void;
  icon?: IslandActionIcon;
  variant?: IslandActionVariant;
}

export interface BottomIslandContent {
  label: string;
  detail?: string;
  progress?: number;
  progressStyle?: IslandProgressStyle;
  activity?: IslandActivity;
  tone?: "neutral" | "success" | "warning" | "danger";
  actionLabel?: string;
  onAction?: () => void;
  actions?: BottomIslandAction[];
  effect?: { kind: "orbit"; nonce: number };
}

export default function QxBottomIsland({
  content,
}: {
  content?: BottomIslandContent | null;
}) {
  const slot = content ? mapBottomIslandContent(content) : null;
  const progressState = useIslandProgress(slot);
  return (
    <QxIslandSurface
      placement="docked"
      variant="shell"
      empty={!content}
      tone={content?.tone}
      progress={progressState.progress}
      progressStyle={slot?.meter?.presentation}
    >
      <ShellContent
        content={slot}
        progressState={progressState}
        onAction={(actionId) => {
          const action = content?.actions?.find((item) => item.id === actionId);
          if (action) action.onAction();
          else content?.onAction?.();
        }}
      />
    </QxIslandSurface>
  );
}
