import { memo } from "react";
import { Brain, CheckCircle2, Loader2, Search, Wrench, XCircle } from "lucide-react";
import type { AgentStep } from "./react-agent";
import MarkdownRenderer from "./MarkdownRenderer";

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
  streaming = false,
  steps,
}: {
  content: string;
  streaming?: boolean;
  steps?: AgentStep[];
}) {
  return (
    <>
      {steps && steps.length > 0 && <AgentStepsView steps={steps} />}
      {parseParts(content).map((part, index) =>
        part.type === "tool" ? (
          <ToolInvocation key={`tool-${index}-${part.name}`} part={part} />
        ) : (
          <MarkdownRenderer key={`text-${index}`} content={part.text} />
        ),
      )}
      {streaming && <span className="qx-typing-cursor">|</span>}
    </>
  );
}
