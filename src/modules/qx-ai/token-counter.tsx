import { useMemo } from "react";
import {
  ArrowDown,
  ArrowUp,
  Brain,
  Sigma,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui";
import { useT } from "../../i18n";
import { estimateTokens } from "./message-rendering";

const WARN_PCT = 85;
const OVER_PCT = 100;
const RING_R = 6;
const RING_C = 2 * Math.PI * RING_R;

export type TokenCounterMessage = {
  role: string;
  content: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimated?: boolean;
  };
  tokenCount?: number;
};

function formatCompact(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(Math.round(num));
}

function formatExact(num: number): string {
  return Math.round(num).toLocaleString();
}

function Row({
  icon,
  label,
  value,
  strong,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="qx-jan-token-row">
      <span className="qx-jan-token-row-label">
        {icon}
        {label}
      </span>
      <span className={`qx-jan-token-row-value${strong ? " is-strong" : ""}`}>{value}</span>
    </div>
  );
}

/**
 * Jan-style Token Usage control for the composer toolbar.
 * Shows a compact badge (count or % of context) with a popover breakdown.
 */
export function QxAiTokenCounter({
  messages,
  draft = "",
  maxTokens,
  modelName,
  className,
}: {
  messages: TokenCounterMessage[];
  draft?: string;
  maxTokens?: number;
  modelName?: string;
  className?: string;
}) {
  const t = useT();

  const { total, inputTokens, outputTokens, estimated } = useMemo(() => {
    let estimatedContext = 0;
    let fallbackOutput = 0;
    let latestUsage: TokenCounterMessage["usage"] | undefined;

    for (const message of messages) {
      if (message.role === "system") continue;
      const usage = message.usage;
      if (usage?.totalTokens && usage.totalTokens > 0) {
        latestUsage = usage;
      }
      if (message.role === "assistant") {
        if (usage?.outputTokens && usage.outputTokens > 0) {
          fallbackOutput = usage.outputTokens;
        } else if (message.tokenCount && message.tokenCount > 0) {
          fallbackOutput = message.tokenCount;
        } else {
          fallbackOutput = estimateTokens(message.content);
        }
      }
      estimatedContext += estimateTokens(message.content);
    }

    const draftTokens = estimateTokens(draft);
    const estimatedTotal = Math.max(0, estimatedContext + draftTokens);
    // Jan shows the last provider-reported turn when the composer is empty,
    // then falls back to a live context estimate as soon as a new draft exists.
    const total = latestUsage && draftTokens === 0
      ? Math.max(0, latestUsage.totalTokens ?? estimatedTotal)
      : estimatedTotal;

    const inputTokens = latestUsage?.inputTokens && latestUsage.inputTokens > 0
      ? latestUsage.inputTokens + draftTokens
      : Math.max(0, estimatedTotal - fallbackOutput);
    const outputTokens = latestUsage?.outputTokens && latestUsage.outputTokens > 0
      ? latestUsage.outputTokens
      : fallbackOutput;
    const estimated = latestUsage === undefined || draftTokens > 0;

    return { total, inputTokens, outputTokens, estimated };
  }, [draft, messages]);

  if (total <= 0 && !maxTokens) return null;

  const pct =
    maxTokens && maxTokens > 0 ? Math.min(999, (total / maxTokens) * 100) : undefined;
  const tier: "ok" | "warn" | "over" =
    pct === undefined
      ? "ok"
      : pct >= OVER_PCT
        ? "over"
        : pct >= WARN_PCT
          ? "warn"
          : "ok";
  const remaining =
    maxTokens && maxTokens > 0 ? Math.max(0, maxTokens - total) : undefined;
  const prefix = estimated ? "~" : "";

  const badge = maxTokens && maxTokens > 0 && pct !== undefined ? (
    <div className={`qx-jan-token-badge is-${tier}`}>
      <svg className="qx-jan-token-ring" viewBox="0 0 16 16" aria-hidden="true">
        <circle
          className="qx-jan-token-ring-track"
          cx="8"
          cy="8"
          r={RING_R}
          fill="none"
          strokeWidth="1.5"
        />
        <circle
          className="qx-jan-token-ring-progress"
          cx="8"
          cy="8"
          r={RING_R}
          fill="none"
          strokeWidth="1.5"
          strokeDasharray={String(RING_C)}
          strokeDashoffset={String(RING_C * (1 - Math.min(pct, 100) / 100))}
        />
      </svg>
      <span className="qx-jan-token-badge-pct">{pct.toFixed(1)}%</span>
    </div>
  ) : (
    <div className="qx-jan-token-badge is-count">
      <Sigma size={13} aria-hidden="true" />
      <span className="qx-jan-token-badge-count">
        {prefix}
        {formatCompact(total)}
      </span>
    </div>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`qx-jan-token-counter${className ? ` ${className}` : ""}`}
          title={t("qxai.tokens.usage", "Token Usage")}
          aria-label={t("qxai.tokens.usage", "Token Usage")}
        >
          {badge}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="qx-jan-token-popover"
      >
        <div className="qx-jan-token-popover-head">
          <Brain size={15} aria-hidden="true" />
          <div className="qx-jan-token-popover-titles">
            <strong>
              {maxTokens && maxTokens > 0
                ? t("qxai.tokens.contextWindow", "Context window")
                : t("qxai.tokens.usage", "Token Usage")}
            </strong>
            {modelName ? <small>{modelName}</small> : null}
          </div>
        </div>

        {maxTokens && maxTokens > 0 && pct !== undefined ? (
          <div className="qx-jan-token-popover-progress">
            <div className="qx-jan-token-popover-progress-meta">
              <span className={`qx-jan-token-popover-pct is-${tier}`}>
                {pct.toFixed(1)}%
              </span>
              <span className="qx-jan-token-popover-fraction">
                {prefix}
                {formatCompact(total)} / {formatCompact(maxTokens)}
              </span>
            </div>
            <div className="qx-jan-token-bar">
              <div
                className={`qx-jan-token-bar-fill is-${tier}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="qx-jan-token-popover-rows">
          {inputTokens > 0 ? (
            <Row
              icon={<ArrowUp size={13} aria-hidden="true" />}
              label={t("qxai.tokens.prompt", "Prompt")}
              value={`${prefix}${formatExact(inputTokens)}`}
            />
          ) : null}
          {outputTokens > 0 ? (
            <Row
              icon={<ArrowDown size={13} aria-hidden="true" />}
              label={t("qxai.tokens.completion", "Completion")}
              value={`${prefix}${formatExact(outputTokens)}`}
            />
          ) : null}
          <Row
            icon={<Sigma size={13} aria-hidden="true" />}
            label={t("qxai.tokens.used", "Used")}
            value={`${prefix}${formatExact(total)}`}
            strong
          />
          {remaining !== undefined ? (
            <Row
              icon={<Brain size={13} aria-hidden="true" />}
              label={t("qxai.tokens.remaining", "Remaining")}
              value={formatExact(remaining)}
            />
          ) : null}
        </div>
        {estimated ? (
          <p className="qx-jan-token-popover-note">
            {t(
              "qxai.tokens.estimatedNote",
              "Counts are estimated (chars ÷ 4) until the provider reports usage.",
            )}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
