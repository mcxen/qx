import { Suspense, lazy, memo, useMemo } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Brain, CheckCircle2, Copy, ExternalLink, File, FolderSearch, Image, Loader2, Search, Wrench, XCircle } from "lucide-react";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { openSystemPath, revealSystemPath } from "../../system/pathActions";
import type { AgentStep, QxAiFileAttachment } from "./react-agent";
const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function FileAttachments({ attachments }: { attachments: QxAiFileAttachment[] }) {
  const t = useT();
  return (
    <div className="qx-ai-attachments">
      {attachments.map((attachment) => (
        <div className="qx-ai-attachment" key={attachment.path}>
          {attachment.kind === "image" ? (
            <img className="qx-ai-attachment-preview" src={convertFileSrc(attachment.path)} alt="" />
          ) : attachment.mimeType?.startsWith("image/") ? (
            <Image size={18} aria-hidden="true" />
          ) : (
            <File size={18} aria-hidden="true" />
          )}
          <div className="qx-ai-attachment-copy">
            <strong title={attachment.name}>{attachment.name}</strong>
            <span title={attachment.path}>{formatFileSize(attachment.size)} · {attachment.path}</span>
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
      ))}
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

function ToolInvocation({ part }: { part: Extract<MessagePart, { type: "tool" }> }) {
  return (
    <div className="qx-ai-tool-call">
      <div className="qx-ai-tool-call-header">
        <Wrench size={14} />
        <span>{part.name}</span>
        <em>{part.state}</em>
      </div>
      {part.input && (
        <pre className="qx-ai-tool-call-body">
          <code>{part.input}</code>
        </pre>
      )}
      {part.output && (
        <pre className="qx-ai-tool-call-body is-output">
          <code>{part.output}</code>
        </pre>
      )}
    </div>
  );
}

function StepStateIcon({ state }: { state: AgentStep["state"] }) {
  if (state === "running") return <Loader2 size={12} className="qx-spin" />;
  if (state === "error") return <XCircle size={12} />;
  return <CheckCircle2 size={12} />;
}

export const AgentStepView = memo(function AgentStepView({ step }: { step: AgentStep }) {
  if (step.kind === "thought") {
    return (
      <div className="qx-agent-step is-thought">
        <div className="qx-agent-step-head">
          <Brain size={12} />
          <span>Thought</span>
        </div>
        <div className="qx-agent-step-body">{step.text}</div>
      </div>
    );
  }
  if (step.kind === "action") {
    return (
      <div className={`qx-agent-step is-action is-${step.state}`}>
        <div className="qx-agent-step-head">
          <Wrench size={12} />
          <span>Action · {step.tool}</span>
          <StepStateIcon state={step.state} />
        </div>
        {step.input && (
          <pre className="qx-agent-step-pre">
            <code>{step.input}</code>
          </pre>
        )}
      </div>
    );
  }
  if (step.kind === "observation") {
    return (
      <div className="qx-agent-step is-observation">
        <div className="qx-agent-step-head">
          <Search size={12} />
          <span>Observation{step.tool ? ` · ${step.tool}` : ""}</span>
        </div>
        {step.output && (
          <pre className="qx-agent-step-pre is-output">
            <code>{step.output}</code>
          </pre>
        )}
      </div>
    );
  }
  if (step.kind === "error") {
    return (
      <div className="qx-agent-step is-error">
        <div className="qx-agent-step-head">
          <XCircle size={12} />
          <span>Error</span>
        </div>
        <div className="qx-agent-step-body">{step.text}</div>
      </div>
    );
  }
  return null;
});

export const AgentStepsView = memo(function AgentStepsView({ steps }: { steps: AgentStep[] }) {
  const visible = steps.filter((s) => s.kind !== "final");
  if (visible.length === 0) return null;
  return (
    <div className="qx-agent-steps">
      {visible.map((step) => (
        <AgentStepView key={step.id} step={step} />
      ))}
    </div>
  );
});

export function AiMessageContent({
  content,
  reasoning,
  streaming = false,
  steps,
  attachments,
}: {
  content: string;
  reasoning?: string;
  streaming?: boolean;
  steps?: AgentStep[];
  attachments?: QxAiFileAttachment[];
}) {
  const t = useT();
  const parts = useMemo(() => parseParts(content), [content]);

  return (
    <>
      {steps && steps.length > 0 && <AgentStepsView steps={steps} />}
      {reasoning ? (
        <details className="qx-ai-reasoning" open={streaming}>
          <summary>
            <Brain size={13} />
            <span>
              {streaming
                ? t("qxai.reasoning.streaming", "Reasoning…")
                : t("qxai.reasoning", "Reasoning")}
            </span>
          </summary>
          <div className="qx-ai-reasoning-body">{reasoning}</div>
        </details>
      ) : null}
      <Suspense fallback={<div className="qx-md-body">{content}</div>}>
        {parts.map((part, index) =>
          part.type === "tool" ? (
            <ToolInvocation key={`tool-${index}-${part.name}`} part={part} />
          ) : (
            <MarkdownRenderer key={`text-${index}`} content={part.text} />
          ),
        )}
      </Suspense>
      {attachments && attachments.length > 0 ? (
        <FileAttachments attachments={attachments} />
      ) : null}
      {streaming && <span className="qx-typing-cursor">|</span>}
    </>
  );
}
