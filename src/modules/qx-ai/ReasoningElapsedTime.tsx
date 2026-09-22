import { memo, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";

export interface ReasoningElapsedTimeProps {
  streaming: boolean;
  /** First real reasoning/tool event timestamp from the run state. */
  startedAt?: number;
  /** Frozen runtime duration for a completed message. */
  durationMs?: number;
}

export function reasoningElapsedMs({
  streaming,
  startedAt,
  durationMs,
  now,
}: ReasoningElapsedTimeProps & { now: number }): number | undefined {
  if (!streaming) return durationMs;
  if (startedAt == null) return durationMs;
  return Math.max(durationMs ?? 0, now - startedAt);
}

export function formatReasoningClock(durationMs: number, roundUp = false): string {
  const totalSeconds = Math.max(
    roundUp ? 1 : 0,
    roundUp ? Math.ceil(durationMs / 1000) : Math.floor(durationMs / 1000),
  );
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${String(totalMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function useReasoningElapsedTime({
  streaming,
  startedAt,
  durationMs,
}: ReasoningElapsedTimeProps): number | undefined {
  const observedStartRef = useRef<number | undefined>(startedAt);
  if (startedAt != null) observedStartRef.current = startedAt;
  if (streaming && observedStartRef.current == null) observedStartRef.current = Date.now();

  const resolve = () => reasoningElapsedMs({
    streaming,
    startedAt: startedAt ?? observedStartRef.current,
    durationMs,
    now: Date.now(),
  });
  const [elapsedMs, setElapsedMs] = useState<number | undefined>(resolve);

  useEffect(() => {
    if (!streaming) {
      setElapsedMs((current) => durationMs ?? current);
      observedStartRef.current = startedAt;
      return;
    }

    let timer = 0;
    const tick = () => {
      const next = resolve();
      setElapsedMs(next);
      const untilBoundary = next == null ? 1000 : 1000 - (next % 1000);
      timer = window.setTimeout(tick, Math.max(50, untilBoundary));
    };
    tick();
    return () => window.clearTimeout(timer);
  }, [durationMs, startedAt, streaming]);

  return elapsedMs;
}

function SplitFlapClock({ value }: { value: string }) {
  const previousRef = useRef(value);
  const previous = previousRef.current.padStart(value.length, "0");

  useEffect(() => {
    previousRef.current = value;
  }, [value]);

  return (
    <span className="qx-ai-flip-clock" aria-hidden="true">
      {[...value].map((character, index) => {
        if (character === ":") {
          return <span key={`separator-${index}`} className="qx-ai-flip-separator">:</span>;
        }
        const oldCharacter = previous[index] ?? character;
        const changed = oldCharacter !== character;
        return (
          <span
            key={`${index}-${character}`}
            className={`qx-ai-flip-digit${changed ? " is-changing" : ""}`}
          >
            {changed ? <span className="qx-ai-flip-digit-old">{oldCharacter}</span> : null}
            <span className="qx-ai-flip-digit-current">{character}</span>
            <span className="qx-ai-flip-digit-split" aria-hidden="true" />
          </span>
        );
      })}
    </span>
  );
}

export const ReasoningElapsedTime = memo(function ReasoningElapsedTime(
  props: ReasoningElapsedTimeProps,
) {
  const t = useT();
  const elapsedMs = useReasoningElapsedTime(props);
  if (elapsedMs == null) {
    return (
      <span className={props.streaming ? "qx-ai-reasoning-status is-shimmer" : "qx-ai-reasoning-status"}>
        {props.streaming
          ? t("qxai.cot.thinking", "Thinking…")
          : t("qxai.cot.thoughtBrief", "Thought for a few seconds")}
      </span>
    );
  }

  const seconds = props.streaming
    ? Math.max(0, Math.floor(elapsedMs / 1000))
    : Math.max(1, Math.ceil(elapsedMs / 1000));
  const accessible = (props.streaming
    ? t("qxai.cot.thinkingFor", "Thinking for {n} seconds")
    : t("qxai.cot.thoughtFor", "{verb} for {n} seconds")
        .replace("{verb}", t("qxai.cot.thoughtVerb", "Thought")))
    .replace("{n}", String(seconds));

  return (
    <span className="qx-ai-reasoning-time" aria-label={accessible}>
      <span className={`qx-ai-reasoning-status${props.streaming ? " is-shimmer" : ""}`} aria-hidden="true">
        {props.streaming
          ? t("qxai.cot.thinkingNow", "Thinking")
          : t("qxai.cot.thoughtForPrefix", "Thought for")}
      </span>
      <SplitFlapClock value={formatReasoningClock(elapsedMs, !props.streaming)} />
      <span className="qx-ai-reasoning-time-unit" aria-hidden="true">
        {t("qxai.cot.secondsShort", "s")}
      </span>
    </span>
  );
});
