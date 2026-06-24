export interface BottomIslandContent {
  label: string;
  detail?: string;
  progress?: number;
  tone?: "neutral" | "success" | "warning" | "danger";
  actionLabel?: string;
  onAction?: () => void;
}

function clampProgress(value?: number): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export default function QxBottomIsland({
  content,
}: {
  content?: BottomIslandContent | null;
}) {
  const progress = clampProgress(content?.progress);

  return (
    <div
      className={`qx-bottom-island${content ? "" : " is-empty"}${
        content?.tone ? ` tone-${content.tone}` : ""
      }`}
    >
      {content ? (
        <>
          <div className="qx-bottom-island-copy">
            <span className="qx-bottom-island-label">{content.label}</span>
            {content.detail && (
              <span className="qx-bottom-island-detail">{content.detail}</span>
            )}
          </div>
          {progress !== null && (
            <div
              className="qx-bottom-island-progress"
              aria-label={`${progress}%`}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
          )}
          {content.actionLabel && (
            <button
              className="qx-bottom-island-action"
              onClick={content.onAction}
              type="button"
            >
              {content.actionLabel}
            </button>
          )}
        </>
      ) : (
        <span className="qx-bottom-island-placeholder" />
      )}
    </div>
  );
}
