import { useEffect, useState } from "react";
import { Blocks, LayoutGrid, Search } from "lucide-react";
import type {
  IslandContentAction,
  IslandOpenTarget,
  IslandSlotContent,
  IslandTone,
} from "../types";
import { actionRegistry } from "../session/actionRegistry";
import IslandActionButton from "./IslandActionButton";
import { visibleIslandActivity } from "./contentPolicy";
import { builtinModuleIcon } from "../../modules/builtinIcons";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";

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

export interface ShellContentProps {
  content?: IslandSlotContent | null;
  sessionId?: string;
  /** Floating island contraction keeps only essential status and countdown. */
  compact?: boolean;
  /** Host-owned module/plugin destination represented by the leading icon. */
  openTarget?: IslandOpenTarget;
  onOpenTarget?: () => void;
  /** Fallback for legacy BottomIsland onAction when no sessionId */
  onAction?: (actionId: string) => void | Promise<void>;
}

/**
 * Fixed-height shell layout: single row + progress as bottom overlay.
 * Trailing pack: [activity?][actions?] with actions always rightmost.
 */
export default function ShellContent({
  content,
  sessionId,
  compact = false,
  openTarget,
  onOpenTarget,
  onAction,
}: ShellContentProps) {
  const t = useT();
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
  const activityKind = visibleIslandActivity(content);
  const activity = Boolean(activityKind);
  const canOpenTarget = Boolean(openTarget && onOpenTarget);
  const TargetIcon = openTarget?.kind === "module"
    ? builtinModuleIcon(openTarget.id) ?? LayoutGrid
    : openTarget?.kind === "plugin"
      ? Blocks
      : Search;
  const identityIconUrl = content.identity?.iconName?.trim();
  const openTargetLabel = t("island.openModule", "Open {name}").replace(
    "{name}",
    content.primary,
  );
  const tone: IslandTone = content.tone ?? "neutral";

  const handleAction = async (action: IslandContentAction) => {
    if (sessionId) {
      if (await actionRegistry.run(sessionId, action.id)) return;
    }
    await onAction?.(action.id);
  };
  const trailingActions = (content.actions?.length
    ? content.actions
    : content.action
      ? [content.action]
      : []).slice(0, 2);

  return (
    <div
      className={`qx-island-shell-content${activity ? " is-activity" : ""}`}
      data-tone={tone}
    >
      {content.effect?.kind === "orbit" && (
        <span
          key={content.effect.nonce}
          className="qx-island-shell-orbit"
          aria-hidden="true"
        />
      )}
      <div className={`qx-island-shell-row${canOpenTarget ? " has-module-icon" : ""}`}>
        {canOpenTarget && (
          <Button
            className="qx-island-module-button"
            type="button"
            variant="ghost"
            size="sm"
            data-qx-no-drag
            onClick={onOpenTarget}
            aria-label={openTargetLabel}
            title={openTargetLabel}
          >
            {identityIconUrl ? (
              <img src={identityIconUrl} alt="" aria-hidden="true" />
            ) : (
              <TargetIcon size={14} strokeWidth={2.1} aria-hidden="true" />
            )}
          </Button>
        )}
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
          <span className="qx-island-shell-primary">
            {content.primary}
          </span>
          {!compact && content.secondary && (
            <span className="qx-island-shell-secondary">{content.secondary}</span>
          )}
        </div>
        <div className="qx-island-shell-trailing">
          {activity && (
            <div
              className="qx-island-meter-activity"
              data-activity={activityKind}
              aria-label={content.secondary ?? content.primary}
            >
              <span className="qx-island-activity-wave" aria-hidden="true">
                <svg viewBox="0 0 84 12" aria-hidden="true" focusable="false">
                  <path d="M1 6 C 8 1, 14 1, 21 6 S 34 11, 42 6 S 56 1, 63 6 S 76 11, 83 6" />
                </svg>
              </span>
              <span className="qx-island-activity-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="qx-island-activity-spinner" aria-hidden="true" />
              <span className="qx-island-activity-pulse" aria-hidden="true">
                <i /><i /><i /><i />
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
          {!compact && trailingActions.length > 0 && (
            <span className="qx-island-shell-actions">
              {trailingActions.map((action) => (
                <IslandActionButton
                  key={action.id}
                  action={action}
                  onInvoke={handleAction}
                />
              ))}
            </span>
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
