import type { AgentSettings } from "../../settings/store";
import type { G4fMessage } from "../store";

export interface AgentStep {
  id: string;
  kind: "thought" | "action" | "observation" | "final" | "error";
  tool?: string;
  input?: string;
  output?: string;
  text?: string;
  state: "running" | "completed" | "error";
}

export interface QxAiFileAttachment {
  path: string;
  name: string;
  kind: string;
  size: number;
  mimeType?: string;
}

export interface ToolExecutionResult {
  observation: string;
  attachments?: QxAiFileAttachment[];
}

export interface ToolSpec {
  name: string;
  description: string;
  inputHint: string;
  parameters: Record<string, unknown>;
  isEnabled: (s: AgentSettings) => boolean;
  /**
   * Builtin module ids that must be user-enabled for this tool to appear.
   * If a required module is disabled (or treated as unavailable), the tool is
   * omitted from schemas/prompts so the model never "discovers" it.
   */
  requiresModules?: string[];
  /**
   * Extra app-settings gate (e.g. OCR master switch). When false, the tool is
   * omitted the same way as a disabled module.
   */
  isAvailable?: (settings: import("../../settings/store").Settings) => boolean;
  run: (input: unknown) => Promise<string | ToolExecutionResult>;
}

export interface AgentRunOptions {
  messages: G4fMessage[];
  provider: string;
  model: string;
  basePrompt: string;
  agentSettings: AgentSettings;
  onStep: (step: AgentStep) => void;
  onStepUpdate: (id: string, patch: Partial<AgentStep>) => void;
  onAssistantStream: (text: string) => void;
  onReasoningStream: (text: string) => void;
  reasoning: boolean;
  maxIterations?: number;
  /** Frozen Hermes-style memory block for this session (prefix-cache friendly). */
  memorySnapshot?: string;
  /** Optional conversation id for hooks / telemetry (never required for tools). */
  conversationId?: string;
  /** Latest user text for before_turn hooks (skill matching, guards). */
  userMessage?: string;
}

export interface AgentRunResult {
  finalAnswer: string;
  reasoning?: string;
  steps: AgentStep[];
  attachments: QxAiFileAttachment[];
}

export const MAX_OBSERVATION_CHARS = 4000;
/** Keep long chats fast: only ship recent turns + system to the model. */
export const MAX_CONTEXT_MESSAGES = 24;

export function truncate(text: string, limit = MAX_OBSERVATION_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} chars]`;
}

export function asRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // fall through
      }
    }
  }
  return {};
}

export function stringField(rec: Record<string, unknown>, key: string, fallback = ""): string {
  const value = rec[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

export function numberField(rec: Record<string, unknown>, key: string, fallback: number): number {
  const value = rec[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function normalizeToolResult(result: string | ToolExecutionResult): ToolExecutionResult {
  return typeof result === "string" ? { observation: result } : result;
}

export function nextStepId(): string {
  return `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function appendAttachments(
  target: QxAiFileAttachment[],
  incoming: QxAiFileAttachment[] | undefined,
) {
  for (const attachment of incoming ?? []) {
    if (!target.some((item) => item.path === attachment.path)) target.push(attachment);
  }
}

/** Compact context for speed: keep system + last N non-system messages. */
export function compactMessages<T extends { role: string }>(messages: T[], max = MAX_CONTEXT_MESSAGES): T[] {
  if (messages.length <= max) return messages;
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  const keep = rest.slice(-(max - Math.min(system.length, 2)));
  return [...system.slice(0, 2), ...keep];
}
