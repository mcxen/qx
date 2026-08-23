/**
 * @deprecated Prefer islandHost + ShellContent / QxIslandSurface.
 * Kept as a thin adapter for modules still passing BottomIslandContent shapes.
 */
import ShellContent from "../island/surface/ShellContent";
import QxIslandSurface from "../island/surface/QxIslandSurface";
import { mapBottomIslandContent } from "../island/compat/mapBottomIslandContent";
import type { BottomIslandContent } from "../island/compat/bottomIslandTypes";
import { useIslandProgress } from "../island/surface/useIslandProgress";

export type { BottomIslandAction, BottomIslandContent } from "../island/compat/bottomIslandTypes";

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
