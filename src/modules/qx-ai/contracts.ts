import type { QxAiSkillDocument } from "./skills";

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

export interface G4fMessage {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt?: number;
  /** Provider/model snapshot that produced this assistant message. */
  provider?: string;
  model?: string;
  reasoning?: string;
  steps?: AgentStep[];
  attachments?: QxAiFileAttachment[];
  skill?: Pick<QxAiSkillDocument, "id" | "name">;
  tokenCount?: number;
  tokenSpeed?: number;
  durationMs?: number;
  reasoningDurationMs?: number;
  /** Durable assistant alternatives created by regenerate; main fields mirror the active variant. */
  variants?: QxAiAssistantVariant[];
  activeVariant?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimated?: boolean;
  };
}

export interface QxAiAssistantVariant {
  content: string;
  createdAt?: number;
  /** Provider/model snapshot that produced this regenerated candidate. */
  provider?: string;
  model?: string;
  reasoning?: string;
  steps?: AgentStep[];
  attachments?: QxAiFileAttachment[];
  tokenCount?: number;
  tokenSpeed?: number;
  durationMs?: number;
  reasoningDurationMs?: number;
  usage?: G4fMessage["usage"];
}

export interface QxAiRegenerationBackup {
  assistantIndex: number;
  messages: G4fMessage[];
}
