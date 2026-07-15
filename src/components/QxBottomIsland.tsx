/**
 * @deprecated Prefer islandHost + ShellContent / QxIslandSurface.
 * Kept as a thin adapter for modules still passing BottomIslandContent shapes.
 */
import ShellContent from "../island/surface/ShellContent";
import QxIslandSurface from "../island/surface/QxIslandSurface";
import { mapBottomIslandContent } from "../island/compat/mapBottomIslandContent";

export interface BottomIslandContent {
  label: string;
  detail?: string;
  progress?: number;
  activity?: "bounce" | "bounce-exit";
  tone?: "neutral" | "success" | "warning" | "danger";
  actionLabel?: string;
  onAction?: () => void;
}

export default function QxBottomIsland({
  content,
}: {
  content?: BottomIslandContent | null;
}) {
  const slot = content ? mapBottomIslandContent(content) : null;
  return (
    <QxIslandSurface
      placement="docked"
      variant="shell"
      empty={!content}
      tone={content?.tone}
    >
      <ShellContent
        content={slot}
        onAction={content?.onAction}
      />
    </QxIslandSurface>
  );
}
