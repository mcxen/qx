import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Copy,
  ExternalLink,
  File,
  FileSearch,
  FolderSearch,
  Gauge,
  Globe,
  Layers3,
  Loader2,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "../../components/ui";
import { useT } from "../../i18n";
import { openSystemPath, revealSystemPath } from "../../system/pathActions";
import type { AgentStep, QxAiFileAttachment } from "./agent/types";
import { ReasoningElapsedTime } from "./ReasoningElapsedTime";

const MarkdownRenderer = lazy(() => import("./MarkdownRenderer"));

const DISCLOSURE_UNMOUNT_DELAY_MS = 300;
const MAX_PERSISTED_DISCLOSURES = 600;
const disclosureOpenState = new Map<string, boolean>();

function rememberDisclosureState(key: string | undefined, open: boolean) {
  if (!key) return;
  disclosureOpenState.delete(key);
  disclosureOpenState.set(key, open);
  while (disclosureOpenState.size > MAX_PERSISTED_DISCLOSURES) {
    const oldestKey = disclosureOpenState.keys().next().value as string | undefined;
    if (!oldestKey) break;
    disclosureOpenState.delete(oldestKey);
  }
}

function useDisclosureState(
  defaultOpen: boolean,
  disclosureKey?: string,
): {
  open: boolean;
  renderContent: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
} {
  const [open, setOpenState] = useState(
    () => disclosureKey ? disclosureOpenState.get(disclosureKey) ?? defaultOpen : defaultOpen,
  );
  const [renderContent, setRenderContent] = useState(open);

  useEffect(() => {
    const nextOpen = disclosureKey
      ? disclosureOpenState.get(disclosureKey) ?? defaultOpen
      : defaultOpen;
    setOpenState(nextOpen);
    setRenderContent(nextOpen);
  }, [defaultOpen, disclosureKey]);

  useEffect(() => {
    if (open) {
      setRenderContent(true);
      return;
    }
    if (!renderContent) return;
    const timer = window.setTimeout(() => setRenderContent(false), DISCLOSURE_UNMOUNT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, renderContent]);

  const setOpen = useCallback<Dispatch<SetStateAction<boolean>>>((nextValue) => {
    // Keep children mounted before the closed -> open grid transition starts.
    // On close they remain mounted until the exit animation finishes.
    setRenderContent(true);
    setOpenState((current) => {
      const next = typeof nextValue === "function" ? nextValue(current) : nextValue;
      rememberDisclosureState(disclosureKey, next);
      return next;
    });
  }, [disclosureKey]);

  return { open, renderContent, setOpen };
}

function DisclosureContent({
  children,
  className = "",
  open,
  renderContent,
}: {
  children: ReactNode;
  className?: string;
  open: boolean;
  renderContent: boolean;
}) {
  return (
    <div
      className={`qx-ai-disclosure-content${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div className="qx-ai-disclosure-clip">
        {renderContent ? children : null}
      </div>
    </div>
  );
}

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

type ToolCategory = "command" | "search" | "file" | "web" | "system" | "module" | "generic";

function getToolCategory(name: string): ToolCategory {
  const normalized = name.toLowerCase();
  if (normalized === "bash" || normalized.includes("terminal")) return "command";
  if (/grep|search|(^|_)files?$/.test(normalized)) return "search";
  if (/path|file|docs_(read|write|inspect)|send_file/.test(normalized)) return "file";
  if (/http|rss|weather|url/.test(normalized)) return "web";
  if (/plugin|module|capabilit|schedule|skill|memory/.test(normalized)) return "module";
  if (/^qx_|ocr|screencap|clipboard|(^|_)apps?$/.test(normalized)) return "system";
  return "generic";
}

function toolSummaryKeys(category: ToolCategory): string[] {
  switch (category) {
    case "command": return ["command", "script"];
    case "search": return ["query", "pattern", "root", "path"];
    case "file": return ["path", "filePath", "name", "root"];
    case "web": return ["url", "location", "feed", "query"];
    case "module": return ["action", "command", "id", "name"];
    case "system": return ["path", "query", "name", "section"];
    default: return ["query", "path", "url", "command", "script", "name", "id"];
  }
}

function ToolCategoryIcon({ category }: { category: ToolCategory }) {
  if (category === "command") return <Terminal size={14} aria-hidden="true" />;
  if (category === "search") return <Search size={14} aria-hidden="true" />;
  if (category === "file") return <FileSearch size={14} aria-hidden="true" />;
  if (category === "web") return <Globe size={14} aria-hidden="true" />;
  return <Wrench size={14} aria-hidden="true" />;
}

function isJsonStructureOnly(line: string): boolean {
  return Boolean(line) && [...line].every((character) => "{}[],".includes(character));
}

function latestActivityLine(value?: string): string {
  if (!value) return "";
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
      ?.trim()
      .replace(/^```(?:json|text|\w+)?\s*/i, "")
      .replace(/^[-*#>]+\s*/, "")
      .replace(/\s+/g, " ");
    if (line && line !== "```" && !isJsonStructureOnly(line)) return line;
  }
  return "";
}

function compactToolPayload(value?: string, category: ToolCategory = "generic"): string {
  if (!value?.trim()) return "";
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) || parsed === null) return "";
    if (typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      for (const key of toolSummaryKeys(category)) {
        const candidate = record[key];
        if (typeof candidate === "string" && candidate.trim()) return latestActivityLine(candidate);
      }
      // Structured results without a semantic field are useful in the expanded
      // body, but their final `}` / `]` is not a meaningful collapsed summary.
      return "";
    }
    if (typeof parsed === "string") return latestActivityLine(parsed);
  } catch {
    // Plain text and incomplete streaming JSON still make useful one-line summaries.
  }
  return latestActivityLine(value);
}

function useToolLabel(name: string, category: ToolCategory): string {
  const t = useT();
  if (category === "command") return t("qxai.tool.kind.command", "Command");
  if (category === "search") return t("qxai.tool.kind.search", "Search");
  if (category === "file") return t("qxai.tool.kind.file", "File");
  if (category === "web") return t("qxai.tool.kind.web", "Web");
  if (category === "system") return t("qxai.tool.kind.system", "System");
  if (category === "module") return t("qxai.tool.kind.module", "Module");
  return humanizeToolName(name);
}

function ActivitySummary({
  activityKey,
  streaming,
  text,
}: {
  activityKey: string;
  streaming?: boolean;
  text: string;
}) {
  const [snapshot, setSnapshot] = useState(() => ({
    current: { key: activityKey, text },
    previous: null as { key: string; text: string } | null,
  }));
  const viewportRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    setSnapshot((current) => {
      if (current.current.key === activityKey) {
        return current.current.text === text
          ? current
          : { ...current, current: { key: activityKey, text } };
      }
      return {
        current: { key: activityKey, text },
        previous: current.current,
      };
    });
    const timer = window.setTimeout(() => {
      setSnapshot((current) => current.previous ? { ...current, previous: null } : current);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [activityKey, text]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !streaming) return;
    viewport.scrollLeft = viewport.scrollWidth;
  }, [snapshot.current.text, streaming]);

  return (
    <span ref={viewportRef} className="qx-ai-activity-roll" title={snapshot.current.text}>
      {snapshot.previous ? (
        <span className="qx-ai-activity-roll-line is-leaving" aria-hidden="true">
          {snapshot.previous.text}
        </span>
      ) : null}
      <span className={`qx-ai-activity-roll-line${snapshot.previous ? " is-entering" : ""}`}>
        {snapshot.current.text}
      </span>
    </span>
  );
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
  disclosureKey,
}: {
  name: string;
  state: string;
  input?: string;
  output?: string;
  defaultOpen?: boolean;
  disclosureKey?: string;
}) {
  const t = useT();
  const { open, renderContent, setOpen } = useDisclosureState(defaultOpen, disclosureKey);
  const running = state === "running" || state === "input-streaming" || state === "input-available";
  const failed = state === "error" || state === "output-error";
  const hasOutput = output !== undefined;
  const category = getToolCategory(name);
  const toolLabel = useToolLabel(name, category);
  const activitySummary = compactToolPayload(running ? input : output ?? input, category);
  const label = running
    ? t("qxai.tool.running", "Running {name}…").replace("{name}", toolLabel)
    : failed
      ? t("qxai.tool.failed", "{name} failed").replace("{name}", toolLabel)
      : t("qxai.tool.used", "Used {name}").replace("{name}", toolLabel);

  return (
    <div
      className={`qx-ai-tool qx-jan-tool${open ? " is-open" : ""}${running ? " is-running" : ""}${failed ? " is-error" : ""}`}
      data-qx-ai="tool"
    >
      <button
        type="button"
        className="qx-ai-tool-header qx-jan-tool-header"
        title={humanizeToolName(name)}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ToolCategoryIcon category={category} />
        <span className="qx-ai-tool-label qx-jan-tool-label">{label}</span>
        {activitySummary ? <span className="qx-ai-activity-separator" aria-hidden="true">·</span> : null}
        {activitySummary ? (
          <span className="qx-ai-tool-activity" title={activitySummary}>{activitySummary}</span>
        ) : null}
        {running ? <Loader2 size={13} className="qx-spin" /> : null}
        <ChevronDown size={14} className={`qx-jan-chevron${open ? " is-open" : ""}`} aria-hidden="true" />
      </button>
      <DisclosureContent
        className="qx-ai-tool-disclosure"
        open={open}
        renderContent={renderContent}
      >
        <div className="qx-ai-tool-body qx-jan-tool-body">
          {input ? (
            <div className="qx-jan-tool-section">
              <h4>{t("qxai.tool.parameters", "Parameters")}</h4>
              <pre><code>{input}</code></pre>
            </div>
          ) : null}
          {hasOutput ? (
            <div className="qx-jan-tool-section">
              <h4>{failed ? t("common.error", "Error") : t("qxai.tool.result", "Result")}</h4>
              <pre className="is-output"><code>{output || t("qxai.tool.noOutput", "No output")}</code></pre>
            </div>
          ) : null}
        </div>
      </DisclosureContent>
    </div>
  );
}

/**
 * Reasoning panel — AI Elements `Reasoning` structure, Beautiful UI Thinking look.
 * CSS: `.qx-ai-reasoning` (canonical) + `.qx-jan-cot` (compat).
 */
function ReasoningPanel({
  title,
  isStreaming,
  summary,
  summaryKey = "reasoning",
  children,
  defaultOpen = true,
  reasoningDurationMs,
  reasoningStartedAt,
  disclosureKey,
}: {
  title?: ReactNode;
  isStreaming?: boolean;
  summary?: string;
  summaryKey?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  reasoningDurationMs?: number;
  reasoningStartedAt?: number;
  disclosureKey?: string;
}) {
  const { open, renderContent, setOpen } = useDisclosureState(defaultOpen, disclosureKey);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const followTimelineRef = useRef(true);
  const activitySummary = !open ? latestActivityLine(summary) : "";

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!open || !isStreaming || !timeline || !followTimelineRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      timeline.scrollTop = timeline.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [children, isStreaming, open]);

  const headerTitle = title ?? (
    <ReasoningElapsedTime
      streaming={Boolean(isStreaming)}
      startedAt={reasoningStartedAt}
      durationMs={reasoningDurationMs}
    />
  );

  return (
    <div
      className={`qx-ai-reasoning qx-jan-cot${open ? " is-open" : ""}${isStreaming ? " is-streaming" : ""}`}
      data-qx-ai="reasoning"
    >
      <button
        type="button"
        className="qx-ai-reasoning-header qx-jan-cot-header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Sparkles size={15} strokeWidth={1.75} className="qx-jan-cot-spark" aria-hidden="true" />
        <span className="qx-ai-reasoning-title qx-jan-cot-title">
          {headerTitle}
        </span>
        {activitySummary ? <span className="qx-ai-activity-separator" aria-hidden="true">·</span> : null}
        {activitySummary ? (
          <span className="qx-ai-reasoning-summary">
            <ActivitySummary activityKey={summaryKey} streaming={isStreaming} text={activitySummary} />
          </span>
        ) : null}
        <ChevronDown size={14} className={`qx-jan-chevron${open ? " is-open" : ""}`} aria-hidden="true" />
      </button>
      <DisclosureContent
        className="qx-ai-reasoning-disclosure"
        open={open}
        renderContent={renderContent}
      >
        <div className="qx-ai-reasoning-panel qx-jan-cot-panel">
          <div className="qx-ai-reasoning-rail qx-jan-cot-rail" aria-hidden="true" />
          <div
            ref={timelineRef}
            className="qx-ai-reasoning-content qx-jan-cot-content"
            onScroll={(event) => {
              const timeline = event.currentTarget;
              followTimelineRef.current = timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop <= 4;
            }}
          >
            {children}
          </div>
        </div>
      </DisclosureContent>
    </div>
  );
}

/** @deprecated use ReasoningPanel */
const JanChainOfThought = ReasoningPanel;

function ToolCallGroupPanel({ steps }: { steps: AgentStep[] }) {
  const t = useT();
  const { open, renderContent, setOpen } = useDisclosureState(
    false,
    steps[0]?.id ? `tool-group:${steps[0].id}` : undefined,
  );
  const running = steps.some((step) => step.state === "running");
  const failed = steps.some((step) => step.state === "error");
  const latest = steps[steps.length - 1];
  const summary = compactToolPayload(
    running ? latest?.input : latest?.output ?? latest?.input,
    getToolCategory(latest?.tool ?? "tool"),
  );
  const label = (running
    ? t("qxai.tool.group.running", "Running {n} tools…")
    : failed
      ? t("qxai.tool.group.failed", "{n} tools, some failed")
      : t("qxai.tool.group.used", "Used {n} tools"))
    .replace("{n}", String(steps.length));
  return (
    <div className={`qx-ai-tool-group${open ? " is-open" : ""}${running ? " is-running" : ""}${failed ? " is-error" : ""}`}>
      <button type="button" className="qx-ai-tool-group-header" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <Layers3 size={14} aria-hidden="true" />
        <span className="qx-ai-tool-label">{label}</span>
        {summary ? <span className="qx-ai-activity-separator" aria-hidden="true">·</span> : null}
        {summary ? <span className="qx-ai-tool-activity" title={summary}>{summary}</span> : null}
        {running ? <Loader2 size={13} className="qx-spin" /> : null}
        <ChevronDown size={14} className={`qx-jan-chevron${open ? " is-open" : ""}`} aria-hidden="true" />
      </button>
      <DisclosureContent open={open} renderContent={renderContent}>
        <div className="qx-ai-tool-group-body">
          {steps.map((step) => (
            <ToolCallPanel
              key={step.id}
              disclosureKey={`tool:${step.id}`}
              name={step.tool ?? "tool"}
              state={step.state}
              input={step.input}
              output={step.output}
            />
          ))}
        </div>
      </DisclosureContent>
    </div>
  );
}

function StepRow({
  status,
  label,
  children,
  disclosureKey,
}: {
  status: "complete" | "active" | "pending" | "error";
  label: string;
  children?: ReactNode;
  disclosureKey?: string;
}) {
  const { open, renderContent, setOpen } = useDisclosureState(false, disclosureKey);
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
      {children ? (
        <DisclosureContent open={open} renderContent={renderContent}>
          <div className="qx-jan-step-body">{children}</div>
        </DisclosureContent>
      ) : null}
    </div>
  );
}

export { ReasoningPanel, ToolCallPanel };

export const AgentStepsView = memo(function AgentStepsView({
  steps,
  streaming = false,
  reasoningDurationMs,
  reasoningStartedAt,
}: {
  steps: AgentStep[];
  streaming?: boolean;
  reasoningDurationMs?: number;
  reasoningStartedAt?: number;
}) {
  const t = useT();
  const visible = steps.filter((step, index) => {
    if (step.kind === "final") return false;
    if (step.kind !== "observation") return true;
    return !steps.slice(0, index).some((candidate) =>
      candidate.kind === "action"
      && candidate.tool === step.tool
      && candidate.output === step.output
    );
  });
  if (visible.length === 0) return null;
  const latestStep = visible[visible.length - 1];
  const activitySummary = latestStep?.kind === "thought" || latestStep?.kind === "error"
    ? latestActivityLine(latestStep.text)
    : compactToolPayload(
        latestStep?.output ?? latestStep?.input,
        getToolCategory(latestStep?.tool ?? "tool"),
      );
  const renderItems: Array<{ kind: "step"; step: AgentStep } | { kind: "group"; steps: AgentStep[] }> = [];
  for (const step of visible) {
    const previous = renderItems[renderItems.length - 1];
    if (step.kind === "action" && previous?.kind === "group") {
      previous.steps.push(step);
      continue;
    }
    if (step.kind === "action" && previous?.kind === "step" && previous.step.kind === "action") {
      renderItems.splice(renderItems.length - 1, 1, { kind: "group", steps: [previous.step, step] });
      continue;
    }
    renderItems.push({ kind: "step", step });
  }

  return (
    <JanChainOfThought
      isStreaming={streaming}
      summary={activitySummary}
      summaryKey={latestStep?.id ?? "reasoning"}
      defaultOpen={false}
      reasoningDurationMs={reasoningDurationMs}
      reasoningStartedAt={reasoningStartedAt}
      disclosureKey={steps[0]?.id ? `reasoning:${steps[0].id}` : undefined}
    >
      {renderItems.map((item) => {
        if (item.kind === "group") {
          return <ToolCallGroupPanel key={`group-${item.steps[0]?.id}`} steps={item.steps} />;
        }
        const { step } = item;
        if (step.kind === "thought") {
          return (
            <StepRow
              key={step.id}
              disclosureKey={`step:${step.id}`}
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
              disclosureKey={`tool:${step.id}`}
              name={step.tool ?? "tool"}
              state={step.state}
              input={step.input}
              output={step.output}
              defaultOpen={false}
            />
          );
        }
        if (step.kind === "observation") {
          return (
            <ToolCallPanel
              key={step.id}
              disclosureKey={`tool:${step.id}`}
              name={step.tool ?? "tool"}
              state="completed"
              output={step.output}
              defaultOpen={false}
            />
          );
        }
        if (step.kind === "error") {
          return (
            <StepRow
              key={step.id}
              disclosureKey={`step:${step.id}`}
              status="error"
              label={t("common.error", "Error")}
            >
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
  reasoningStartedAt,
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
  reasoningStartedAt?: number;
}) {
  const parts = useMemo(() => parseParts(content), [content]);
  const hasChain = Boolean((steps && steps.length > 0) || reasoning);

  return (
    <>
      {steps && steps.length > 0 ? (
        <AgentStepsView
          steps={steps}
          streaming={streaming}
          reasoningDurationMs={reasoningDurationMs}
          reasoningStartedAt={reasoningStartedAt}
        />
      ) : reasoning ? (
        <JanChainOfThought
          isStreaming={streaming}
          summary={reasoning}
          defaultOpen={false}
          reasoningDurationMs={reasoningDurationMs}
          reasoningStartedAt={reasoningStartedAt}
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
