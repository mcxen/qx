import { Wrench } from "lucide-react";
import type { ReactNode } from "react";

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
  const blockPattern = /```(?:tool|tool_call|tool-call|json)\s*\n([\s\S]*?)```/gi;
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

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    if (match[1]) {
      nodes.push(<code key={`code-${match.index}`}>{match[1]}</code>);
    } else if (match[2]) {
      nodes.push(<strong key={`strong-${match.index}`}>{match[2]}</strong>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownText({ content }: { content: string }) {
  const blocks = content.split(/(```[\s\S]*?```)/g).filter(Boolean);
  return (
    <div className="qx-ai-response">
      {blocks.map((block, blockIndex) => {
        const codeMatch = block.match(/^```(\w+)?\s*\n?([\s\S]*?)```$/);
        if (codeMatch) {
          return (
            <pre className="qx-ai-code" key={`code-${blockIndex}`}>
              <code>{codeMatch[2]}</code>
            </pre>
          );
        }

        return block
          .split(/\n{2,}/)
          .filter((paragraph) => paragraph.trim())
          .map((paragraph, paragraphIndex) => {
            const listItems = paragraph
              .split("\n")
              .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1])
              .filter((line): line is string => Boolean(line));
            if (listItems.length > 0 && listItems.length === paragraph.split("\n").length) {
              return (
                <ul key={`list-${blockIndex}-${paragraphIndex}`}>
                  {listItems.map((item, itemIndex) => (
                    <li key={`${itemIndex}-${item.slice(0, 18)}`}>{renderInline(item)}</li>
                  ))}
                </ul>
              );
            }
            return (
              <p key={`p-${blockIndex}-${paragraphIndex}`}>
                {renderInline(paragraph)}
              </p>
            );
          });
      })}
    </div>
  );
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

export function AiMessageContent({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <>
      {parseParts(content).map((part, index) =>
        part.type === "tool" ? (
          <ToolInvocation key={`tool-${index}-${part.name}`} part={part} />
        ) : (
          <MarkdownText key={`text-${index}`} content={part.text} />
        ),
      )}
      {streaming && <span className="qx-typing-cursor">|</span>}
    </>
  );
}
