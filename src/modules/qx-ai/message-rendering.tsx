import { Suspense, lazy, memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Copy,
  ExternalLink,
  File,
  FolderSearch,
  Gauge,
  Loader2,
  Search,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { openSystemPath, revealSystemPath } from "../../system/pathActions";
import type { AgentStep, QxAiFileAttachment } from "./agent/types";

const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function humanizeToolName(name: string): string {
  const spaced = name.replace(/[_-]+/g, " ").trim();
  if (!spaced) return "tool";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isImageAttachment(attachment: QxAiFileAttachment): boolean {
  return attachment.kind === "image" || Boolean(attachment.mimeType?.startsWith("image/"));
}

function FileAttachments({ attachments }: { attachments: QxAiFileAttachment[] }) {
  const t = useT();
  return (
    <div className="qx-ai-attachments">
      {attachments.map((attachment) => {
        const isImage = isImageAttachment(attachment);
        const previewSrc = isImage ? convertFileSrc(attachment.path) : "";
        return (
          <div
            className={`qx-ai-attachment${isImage ? " is-image" : ""}`}
            key={attachment.path}
          >
            {isImage ? (
              <button
                type="button"
                className="qx-ai-attachment-preview-btn"
                title={t("common.open", "Open")}
                onClick={() => void openSystemPath(attachment.path)}
              >
                <img
                  className="qx-ai-attachment-preview"
                  src={previewSrc}
                  alt={attachment.name}
                  loading="lazy"
                />
              </button>
            ) : (
              <File size={18} aria-hidden="true" />
            )}
            <div className="qx-ai-attachment-copy">
              <strong title={attachment.name}>{attachment.name}</strong>
              <span title={attachment.path}>
                {formatFileSize(attachment.size)}
                {attachment.mimeType ? ` · ${attachment.mimeType}` : ""}
              </span>
            </div>
            <div className="qx-ai-attachment-actions">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={t("common.open", "Open")}
                aria-label={t("common.open", "Open")}
                onClick={() => void openSystemPath(attachment.path)}
              >
                <ExternalLink size={14} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={t("qxai.attachment.reveal", "Show in file manager")}
                aria-label={t("qxai.attachment.reveal", "Show in file manager")}
                onClick={() => void revealSystemPath(attachment.path)}
              >
                <FolderSearch size={14} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={t("qxai.attachment.copy", "Copy file")}
                aria-label={t("qxai.attachment.copy", "Copy file")}
                onClick={() => void invoke("clipboard_write_file_paths", { paths: [attachment.path] })}
              >
                <Copy size={14} />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

type MessagePart =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; state: string; input?: string; output?: string };

function parseToolBlock(raw: string): MessagePart | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed) as Record<string, unknown>;
    const name = value.name ?? value.tool ?? value.toolName ?? value.function;
    if (typeof name !== "string" || !name.trim()) return null;
    const input = value.input ?? value.args ?? value.arguments;
    const output = value.output ?? value.result;
    return {
      type: "tool",
      name,
      state: String(value.state ?? value.status ?? "completed"),
      input: typeof input === "string" ? input : input ? JSON.stringify(input, null, 2) : undefined,
      output: typeof output === "string" ? output : output ? JSON.stringify(output, null, 2) : undefined,
    };
  } catch {
    return null;
  }
}

function parseParts(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const blockPattern = /```(?:tool|tool_call|tool-call)\s*\n([\s\S]*?)```/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(content))) {
    const before = content.slice(lastIndex, match.index);
    if (before) parts.push({ type: "text", text: before });
    const tool = parseToolBlock(match[1] ?? "");
    if (tool) parts.push(tool);
    else parts.push({ type: "text", text: match[0] });
    lastIndex = match.index + match[0].length;
  }
  const rest = content.slice(lastIndex);
  if (rest) parts.push({ type: "text", text: rest });
  return parts.length ? parts : [{ type: "text", text: content }];
}

/**
 * Tool call chip — AI Elements `Tool` structure, Beautiful UI compact chip look.
 * CSS: `.qx-ai-tool` (canonical) + `.qx-jan-tool` (compat).
 */
function ToolCallPanel({
  name,
  state,
  input,
  output,
  defaultOpen = false,
}: {
  name: string;
  state: string;
  input?: string;
  output?: string;
  defaultOpen?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const running = state === "running" || state === "input-streaming" || state === "input-available";
  const failed = state === "error" || state === "output-error";
  const label = running
    ? t("qxai.tool.running", "Running {name}…").replace("{name}", humanizeToolName(name))
    : failed
      ? t("qxai.tool.failed", "{name} failed").replace("{name}", humanizeToolName(name))
      : t("qxai.tool.used", "Used {name}").replace("{name}", humanizeToolName(name));

  return (
    <div
      className={`qx-ai-tool qx-jan-tool${open ? " is-open" : ""}${running ? " is-running" : ""}${failed ? " is-error" : ""}`}
      data-qx-ai="tool"
    >
      <button type="button" className="qx-ai-tool-header qx-jan-tool-header" onClick={() => setOpen((value) => !value)}>
        <Wrench size={14} aria-hidden="true" />
        <span className="qx-ai-tool-label qx-jan-tool-label">{label}</span>
        {running ? <Loader2 size={13} className="qx-spin" /> : null}
        <ChevronDown size={14} className={`qx-jan-chevron${open ? " is-open" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="qx-ai-tool-body qx-jan-tool-body">
          {input ? (
            <div className="qx-jan-tool-section">
              <h4>{t("qxai.tool.parameters", "Parameters")}</h4>
              <pre><code>{input}</code></pre>
            </div>
          ) : null}
          {output ? (
            <div className="qx-jan-tool-section">
              <h4>{failed ? t("common.error", "Error") : t("qxai.tool.result", "Result")}</h4>
              <pre className="is-output"><code>{output}</code></pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Reasoning panel — AI Elements `Reasoning` structure, Beautiful UI Thinking look.
 * CSS: `.qx-ai-reasoning` (canonical) + `.qx-jan-cot` (compat).
 */
function ReasoningPanel({
  title,
  streamingLabel,
  completedVerb,
  isStreaming,
  children,
  defaultOpen = true,
  reasoningDurationMs,
}: {
  title?: ReactNode;
  streamingLabel?: string;
  completedVerb?: string;
  isStreaming?: boolean;
  children: ReactNode;
  defaultOpen?: boolean;
  reasoningDurationMs?: number;
}) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [durationSec, setDurationSec] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (isStreaming) setOpen(true);
  }, [isStreaming]);

  useEffect(() => {
    if (isStreaming) {
      if (startedAt === null) setStartedAt(Date.now());
      return;
    }
    if (startedAt !== null) {
      setDurationSec(Math.max(1, Math.ceil((Date.now() - startedAt) / 1000)));
      setStartedAt(null);
    }
  }, [isStreaming, startedAt]);

  const completedDurationSec = reasoningDurationMs != null
    ? Math.max(1, Math.ceil(reasoningDurationMs / 1000))
    : durationSec;

  const headerTitle = (() => {
    if (title) return title;
    if (isStreaming || durationSec === 0) {
      return (
        <span className="qx-jan-shimmer">
          {streamingLabel ?? t("qxai.cot.thinking", "Thinking…")}
        </span>
      );
    }
    if (completedDurationSec === undefined) {
      return t("qxai.cot.thoughtBrief", "Thought for a few seconds");
    }
    return t("qxai.cot.thoughtFor", "{verb} for {n} seconds")
      .replace("{verb}", completedVerb ?? t("qxai.cot.thoughtVerb", "Thought"))
      .replace("{n}", String(completedDurationSec));
  })();

  return (
    <div
      className={`qx-ai-reasoning qx-jan-cot${open ? " is-open" : ""}${isStreaming ? " is-streaming" : ""}`}
      data-qx-ai="reasoning"
    >
      <button
        type="button"
        className="qx-ai-reasoning-header qx-jan-cot-header"
        onClick={() => setOpen((value) => !value)}
      >
        <Sparkles size={15} strokeWidth={1.75} className="qx-jan-cot-spark" aria-hidden="true" />
        <span className={`qx-ai-reasoning-title qx-jan-cot-title${isStreaming ? " is-shimmer" : ""}`}>
          {headerTitle}
        </span>
        <ChevronDown size={14} className={`qx-jan-chevron${open ? " is-open" : ""}`} aria-hidden="true" />
      </button>
      {open ? (
        <div className="qx-ai-reasoning-panel qx-jan-cot-panel">
          <div className="qx-ai-reasoning-rail qx-jan-cot-rail" aria-hidden="true" />
          <div className="qx-ai-reasoning-content qx-jan-cot-content">{children}</div>
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated use ReasoningPanel */
const JanChainOfThought = ReasoningPanel;

function StepRow({
  status,
  label,
  children,
}: {
  status: "complete" | "active" | "pending" | "error";
  label: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`qx-jan-step is-${status}`}>
      <button
        type="button"
        className="qx-jan-step-header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="qx-jan-step-rail" aria-hidden="true">
          {status === "complete" ? (
            <CheckCircle2 size={14} />
          ) : status === "error" ? (
            <XCircle size={14} />
          ) : status === "active" ? (
            <CircleDot size={14} />
          ) : (
            <Loader2 size={14} className="qx-spin" />
          )}
        </span>
        <span className="qx-jan-step-label">{label}</span>
        <ChevronDown
          size={14}
          className={`qx-jan-chevron${open ? " is-open" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && children ? <div className="qx-jan-step-body">{children}</div> : null}
    </div>
  );
}

export { ReasoningPanel, ToolCallPanel };

export const AgentStepsView = memo(function AgentStepsView({
  steps,
  streaming = false,
  reasoningDurationMs,
}: {
  steps: AgentStep[];
  streaming?: boolean;
  reasoningDurationMs?: number;
}) {
  const t = useT();
  const visible = steps.filter((s) => s.kind !== "final");
  if (visible.length === 0) return null;

  return (
    <JanChainOfThought
      streamingLabel={t("qxai.cot.thinking", "Thinking…")}
      completedVerb={t("qxai.cot.thoughtVerb", "Thought")}
      isStreaming={streaming}
      reasoningDurationMs={reasoningDurationMs}
    >
      {visible.map((step) => {
        if (step.kind === "thought") {
          return (
            <StepRow
              key={step.id}
              status={step.state === "running" ? "active" : "complete"}
              label={t("qxai.cot.thoughtStep", "Thought")}
            >
              <div className="qx-jan-thought-text">{step.text}</div>
            </StepRow>
          );
        }
        // Tool rows sit directly in the Reasoning list (Elements Tool + BUI chip).
        if (step.kind === "action") {
          return (
            <ToolCallPanel
              key={step.id}
              name={step.tool ?? "tool"}
              state={step.state}
              input={step.input}
              defaultOpen={false}
            />
          );
        }
        if (step.kind === "observation") {
          return (
            <ToolCallPanel
              key={step.id}
              name={step.tool ?? "tool"}
              state="completed"
              output={step.output}
              defaultOpen={false}
            />
          );
        }
        if (step.kind === "error") {
          return (
            <StepRow key={step.id} status="error" label={t("common.error", "Error")}>
              <div className="qx-jan-thought-text is-error">{step.text}</div>
            </StepRow>
          );
        }
        return null;
      })}
    </JanChainOfThought>
  );
});

/**
 * Jan TokenSpeedIndicator semantics:
 * - Hide while streaming (live TPS is optional elsewhere, e.g. composer).
 * - Show rounded tokens/sec + (output token count) under completed assistant messages.
 */
export function TokenSpeedBadge({
  tokenSpeed,
  tokenCount,
  streaming,
}: {
  tokenSpeed?: number;
  tokenCount?: number;
  streaming?: boolean;
}) {
  const t = useT();
  // Match Jan: completed messages only (streaming returns null).
  if (streaming) return null;
  const displaySpeed = tokenSpeed && tokenSpeed > 0 ? Math.round(tokenSpeed) : 0;
  const displayCount = tokenCount && tokenCount > 0 ? Math.round(tokenCount) : 0;
  if (displaySpeed === 0 && displayCount === 0) return null;
  return (
    <div className="qx-jan-token-speed" title={t("qxai.tokens.speed", "Generation speed")}>
      <Gauge size={16} aria-hidden="true" />
      {displaySpeed > 0 ? (
        <span>
          {displaySpeed} {t("qxai.tokens.perSec", "tokens/sec")}
        </span>
      ) : null}
      {displayCount > 0 ? (
        <span className="qx-jan-token-count">
          ({displayCount} {t("qxai.tokens.unit", "tokens")})
        </span>
      ) : null}
    </div>
  );
}

export function TokenUsageBadge({
  usage,
}: {
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimated?: boolean;
  };
}) {
  const t = useT();
  if (!usage) return null;
  const input = usage.inputTokens && usage.inputTokens > 0 ? Math.round(usage.inputTokens) : 0;
  const output = usage.outputTokens && usage.outputTokens > 0 ? Math.round(usage.outputTokens) : 0;
  const total = usage.totalTokens && usage.totalTokens > 0 ? Math.round(usage.totalTokens) : input + output;
  if (input === 0 && output === 0 && total === 0) return null;
  const prefix = usage.estimated ? "~" : "";
  return (
    <span
      className="qx-jan-token-usage"
      title={t("qxai.tokens.usageDetails", "Token Usage")}
    >
      {t("qxai.tokens.usage", "Token Usage")}: {prefix}{total}
      <span className="qx-jan-token-usage-detail">
        ({prefix}{input} {t("qxai.tokens.input", "input")} · {prefix}{output} {t("qxai.tokens.output", "output")})
      </span>
    </span>
  );
}

export function AiMessageContent({
  content,
  reasoning,
  streaming = false,
  steps,
  attachments,
  tokenSpeed,
  tokenCount,
  usage,
  reasoningDurationMs,
}: {
  content: string;
  reasoning?: string;
  streaming?: boolean;
  steps?: AgentStep[];
  attachments?: QxAiFileAttachment[];
  tokenSpeed?: number;
  tokenCount?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimated?: boolean;
  };
  reasoningDurationMs?: number;
}) {
  const t = useT();
  const parts = useMemo(() => parseParts(content), [content]);
  const hasChain = Boolean((steps && steps.length > 0) || reasoning);

  return (
    <>
      {steps && steps.length > 0 ? (
        <AgentStepsView
          steps={steps}
          streaming={streaming}
          reasoningDurationMs={reasoningDurationMs}
        />
      ) : reasoning ? (
        <JanChainOfThought
          streamingLabel={t("qxai.reasoning.streaming", "Reasoning…")}
          completedVerb={t("qxai.cot.thoughtVerb", "Thought")}
          isStreaming={streaming}
          reasoningDurationMs={reasoningDurationMs}
        >
          <div className="qx-jan-thought-text">{reasoning}</div>
        </JanChainOfThought>
      ) : null}

      <Suspense fallback={<div className="qx-md-body">{content}</div>}>
        {parts.map((part, index) =>
          part.type === "tool" ? (
            <ToolCallPanel
              key={`tool-${index}-${part.name}`}
              name={part.name}
              state={part.state}
              input={part.input}
              output={part.output}
            />
          ) : (
            <MarkdownRenderer key={`text-${index}`} content={part.text} />
          ),
        )}
      </Suspense>

      {attachments && attachments.length > 0 ? (
        <FileAttachments attachments={attachments} />
      ) : null}

      {!streaming && (tokenSpeed || tokenCount || usage) ? (
        <div className="qx-jan-message-foot">
          <TokenSpeedBadge tokenSpeed={tokenSpeed} tokenCount={tokenCount} />
          <TokenUsageBadge usage={usage} />
        </div>
      ) : null}

      {streaming ? (
        <div className="qx-jan-message-foot is-streaming">
          {hasChain ? null : <Search size={12} className="qx-jan-streaming-dot" aria-hidden="true" />}
          <span className="qx-stream-caret is-streaming" aria-hidden="true" />
        </div>
      ) : null}
    </>
  );
}

/** Rough token estimate (chars / 4) for speed display without a tokenizer. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function computeTokenSpeed(tokenCount: number, durationMs: number): number {
  if (tokenCount <= 0 || durationMs <= 0) return 0;
  return (tokenCount / durationMs) * 1000;
}
