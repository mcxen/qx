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
  reasoning?: string;
  steps?: AgentStep[];
  attachments?: QxAiFileAttachment[];
  skill?: Pick<QxAiSkillDocument, "id" | "name">;
  tokenCount?: number;
  tokenSpeed?: number;
  durationMs?: number;
  reasoningDurationMs?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimated?: boolean;
  };
}
