export interface BottomIslandContent {
  label: string;
  detail?: string;
  progress?: number;
  activity?: "bounce" | "bounce-exit";
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
  const activity = content?.activity === "bounce" || content?.activity === "bounce-exit";
  const activityExiting = content?.activity === "bounce-exit";

  return (
    <div
      className={`qx-bottom-island${content ? "" : " is-empty"}${
        content?.tone ? ` tone-${content.tone}` : ""
      }${activity ? " is-activity" : ""}${activityExiting ? " is-activity-exiting" : ""}`}
    >
      {content ? (
        <>
          <div className="qx-bottom-island-copy">
            <span
              className="qx-bottom-island-label"
              data-pulse={activity && !activityExiting ? "true" : undefined}
            >
              {content.label}
            </span>
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
          {activity && progress === null && (
            <div
              className="qx-bottom-island-activity"
              aria-label={content.detail ?? content.label}
            >
              <span className="qx-bottom-island-activity-curve">
                <svg viewBox="0 0 84 12" aria-hidden="true" focusable="false">
                  <path d="M1 6 C 8 1, 14 1, 21 6 S 34 11, 42 6 S 56 1, 63 6 S 76 11, 83 6" />
                </svg>
              </span>
              <span className="qx-bottom-island-activity-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
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
