import { useLayoutEffect, useRef, useState } from "react";
import { Blocks, LayoutGrid, Search } from "lucide-react";
import type {
  IslandContentAction,
  IslandOpenTarget,
  IslandProgressStyle,
  IslandSlotContent,
  IslandTone,
} from "../types";
import { actionRegistry } from "../session/actionRegistry";
import IslandActionButton from "./IslandActionButton";
import { visibleIslandActivity } from "./contentPolicy";
import { builtinModuleIcon } from "../../modules/builtinIcons";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import type { IslandProgressSnapshot } from "./useIslandProgress";

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

function ShellMessageMarquee({
  primary,
  secondary,
  compact,
}: {
  primary: string;
  secondary?: string;
  compact: boolean;
}) {
  const marqueeRef = useRef<HTMLSpanElement>(null);
  const groupRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const marquee = marqueeRef.current;
    const group = groupRef.current;
    if (!marquee || !group) return undefined;

    const measure = () => {
      setOverflowing(group.scrollWidth > marquee.clientWidth + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(marquee);
    observer.observe(group);
    return () => observer.disconnect();
  }, [primary, secondary, compact]);

  const renderGroup = (ariaHidden = false) => (
    <span
      className="qx-island-marquee-group qx-island-shell-marquee-group"
      ref={ariaHidden ? undefined : groupRef}
      aria-hidden={ariaHidden || undefined}
    >
      <span className="qx-island-shell-primary">{primary}</span>
      {!compact && secondary && (
        <span className="qx-island-shell-secondary">{secondary}</span>
      )}
    </span>
  );

  const accessibleText = !compact && secondary ? `${primary} · ${secondary}` : primary;
  return (
    <span
      ref={marqueeRef}
      className={`qx-island-marquee qx-island-shell-marquee${overflowing ? " is-overflowing" : ""}`}
      aria-label={accessibleText}
    >
      {overflowing ? (
        <>
          {renderGroup()}
          {renderGroup(true)}
        </>
      ) : (
        renderGroup()
      )}
    </span>
  );
}

export interface ShellContentProps {
  content?: IslandSlotContent | null;
  sessionId?: string;
  /** Floating island contraction keeps only essential status and countdown. */
  compact?: boolean;
  /** Host-owned module/plugin destination represented by the leading icon. */
  openTarget?: IslandOpenTarget;
  onOpenTarget?: () => void;
  /** Shared with QxIslandSurface so countdowns use one timer. */
  progressState?: IslandProgressSnapshot;
  /** Fallback for legacy BottomIsland onAction when no sessionId */
  onAction?: (actionId: string) => void | Promise<void>;
}

/**
 * Fixed-height shell layout: one chrome row with an optional compact progress
 * slot inside the copy column. The meter never runs below identity/actions.
 * Trailing pack: [activity?][actions?] with actions always rightmost.
 */
export default function ShellContent({
  content,
  sessionId,
  compact = false,
  openTarget,
  onOpenTarget,
  progressState = { progress: null, countdownMs: null },
  onAction,
}: ShellContentProps) {
  const t = useT();

  if (!content) {
    return <span className="qx-island-shell-placeholder" />;
  }

  const { progress, countdownMs } = progressState;
  const activityKind = visibleIslandActivity(content);
  const activity = Boolean(activityKind);
  const canOpenTarget = Boolean(openTarget && onOpenTarget);
  const progressStyle: IslandProgressStyle =
    content.meter?.presentation ?? "surface-fill";
  const showIconRing =
    progress !== null && progressStyle === "icon-ring" && canOpenTarget;
  const showCompactProgress =
    progress !== null
    && (progressStyle === "compact-line" || (progressStyle === "icon-ring" && !canOpenTarget));
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
      <div
        className={[
          "qx-island-shell-row",
          canOpenTarget ? "has-module-icon" : "",
          showCompactProgress ? "has-progress" : "",
        ].filter(Boolean).join(" ")}
      >
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
            {showIconRing && (
              <svg
                className="qx-island-module-progress-ring"
                viewBox="0 0 28 28"
                aria-hidden="true"
              >
                <rect className="is-track" x="1.5" y="1.5" width="25" height="25" rx="8" pathLength="100" />
                <rect
                  className="is-value"
                  x="1.5"
                  y="1.5"
                  width="25"
                  height="25"
                  rx="8"
                  pathLength="100"
                  style={{ strokeDasharray: `${progress} 100` }}
                />
              </svg>
            )}
          </Button>
        )}
        <div className={`qx-island-shell-copy${showCompactProgress ? " has-progress" : ""}`}>
          <div className="qx-island-shell-copy-line">
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
            <ShellMessageMarquee
              primary={content.primary}
              secondary={content.secondary}
              compact={compact}
            />
          </div>
          {showCompactProgress && (
            <div
              className="qx-island-meter-progress"
              aria-hidden="true"
            >
              <span style={{ width: `${progress}%` }} />
            </div>
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
    </div>
  );
}
