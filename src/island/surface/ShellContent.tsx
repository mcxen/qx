import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import type { IslandActionIcon, IslandSlotContent, IslandTone } from "../types";
import { actionRegistry } from "../session/actionRegistry";

function clampProgress(value?: number): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function countdownRemaining(content: IslandSlotContent, now: number): number | null {
  const countdown = content.countdown;
  if (!countdown) return null;
  if (countdown.paused || countdown.endsAt == null || !Number.isFinite(countdown.endsAt)) {
    return typeof countdown.remainingMs === "number" && Number.isFinite(countdown.remainingMs)
      ? Math.max(0, countdown.remainingMs)
      : null;
  }
  return Math.max(0, countdown.endsAt - now);
}

function formatCountdown(value: number): string {
  const totalSeconds = Math.max(0, Math.ceil(value / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function IslandActionGlyph({ icon }: { icon?: IslandActionIcon }) {
  if (!icon) return null;
  return (
    <svg className="qx-island-shell-action-icon" viewBox="0 0 12 12" aria-hidden="true">
      {icon === "pause" && <><rect x="2.25" y="2" width="2.25" height="8" rx="0.7" /><rect x="7.5" y="2" width="2.25" height="8" rx="0.7" /></>}
      {icon === "play" && <path d="M3.1 1.9 10 6 3.1 10.1Z" />}
      {icon === "stop" && <rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.4" />}
      {icon === "open" && <path d="M4 2h6v6H8.5V4.55L3.1 9.95 2.05 8.9 7.45 3.5H4V2Z" />}
    </svg>
  );
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
  const [now, setNow] = useState(() => Date.now());
  const countdownRunning = Boolean(
    content?.countdown
    && !content.countdown.paused
    && typeof content.countdown.endsAt === "number"
    && Number.isFinite(content.countdown.endsAt),
  );

  useEffect(() => {
    if (!countdownRunning) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [countdownRunning, content?.countdown?.endsAt]);

  if (!content) {
    return <span className="qx-island-shell-placeholder" />;
  }

  const countdownMs = countdownRemaining(content, now);
  const countdownProgress = countdownMs != null
    && typeof content.countdown?.durationMs === "number"
    && content.countdown.durationMs > 0
    ? clampProgress(((content.countdown.durationMs - countdownMs) / content.countdown.durationMs) * 100)
    : null;
  const progress = countdownProgress ?? (
    content.meter?.kind === "progress"
      ? clampProgress(content.meter.progress)
      : null
  );
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
          {countdownMs !== null && (
            <time
              className="qx-island-shell-countdown"
              data-paused={content.countdown?.paused ? "true" : undefined}
              dateTime={`PT${Math.ceil(countdownMs / 1000)}S`}
              aria-live="off"
            >
              {formatCountdown(countdownMs)}
            </time>
          )}
          {content.action && (
            <Button
              className="qx-island-shell-action"
              type="button"
              variant={content.action.variant === "danger" ? "destructive" : "ghost"}
              size="sm"
              onClick={handleAction}
              data-variant={content.action.variant ?? "default"}
              aria-label={content.action.label}
            >
              <IslandActionGlyph icon={content.action.icon} />
              {content.action.label}
            </Button>
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
