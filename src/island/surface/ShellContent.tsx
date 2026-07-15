import type { IslandSlotContent, IslandTone } from "../types";
import { actionRegistry } from "../session/actionRegistry";

function clampProgress(value?: number): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export interface ShellContentProps {
  content?: IslandSlotContent | null;
  sessionId?: string;
  /** Fallback for legacy BottomIsland onAction when no sessionId */
  onAction?: () => void;
}

/**
 * Fixed-height shell layout: single row + progress as bottom overlay.
 * Trailing pack: [activity?][action?] with action always rightmost.
 */
export default function ShellContent({
  content,
  sessionId,
  onAction,
}: ShellContentProps) {
  if (!content) {
    return <span className="qx-island-shell-placeholder" />;
  }

  const progress =
    content.meter?.kind === "progress"
      ? clampProgress(content.meter.progress)
      : null;
  const activityKind =
    content.meter?.kind === "activity" ? content.meter.activity : undefined;
  const activity =
    activityKind === "bounce" || activityKind === "bounce-exit";
  const activityExiting = activityKind === "bounce-exit";
  const tone: IslandTone = content.tone ?? "neutral";

  const handleAction = () => {
    if (sessionId && content.action?.id) {
      if (actionRegistry.dispatch(sessionId, content.action.id)) return;
    }
    onAction?.();
  };

  return (
    <div
      className={`qx-island-shell-content${activity ? " is-activity" : ""}${
        activityExiting ? " is-activity-exiting" : ""
      }`}
      data-tone={tone}
    >
      <div className="qx-island-shell-row">
        <div className="qx-island-shell-copy">
          {content.identity?.tag && (
            <span className="qx-island-shell-tag">
              {content.identity.beacon && content.identity.beacon !== "off" && (
                <i
                  className={`qx-sci-beacon is-${content.identity.beacon}`}
                  aria-hidden="true"
                />
              )}
              {content.identity.tag}
            </span>
          )}
          <span
            className="qx-island-shell-primary"
            data-pulse={activity && !activityExiting ? "true" : undefined}
          >
            {content.primary}
          </span>
          {content.secondary && (
            <span className="qx-island-shell-secondary">{content.secondary}</span>
          )}
        </div>
        <div className="qx-island-shell-trailing">
          {activity && (
            <div
              className="qx-island-meter-activity"
              aria-label={content.secondary ?? content.primary}
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
          {content.action && (
            <button
              className="qx-island-shell-action"
              type="button"
              onClick={handleAction}
            >
              {content.action.label}
            </button>
          )}
        </div>
      </div>
      {progress !== null && (
        <div
          className="qx-island-meter-progress"
          aria-label={`${progress}%`}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
