import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "../settings/store";
// Types only — agent harness is dynamically imported when a turn actually runs
// so opening QxAI sessions/providers does not parse the full tool graph.
import type { AgentStep, AgentStreamMetrics, QxAiFileAttachment } from "./agent/types";
import { computeTokenSpeed, estimateTokens } from "./message-rendering";
import {
  messageHasImages,
  resolveModelVision,
} from "./model-capabilities";
import {
  buildAutoSkillPromptBlock,
  withSkillCapabilityBinding,
  type QxAiSkillDocument,
} from "./skills";
import {
  deleteQxAiSessionFiles,
  isTauriRuntime,
  loadQxAiSessions,
  saveQxAiSession,
} from "./sessions";
import {
  completeQxAiRun,
  dismissQxAiRun,
  failQxAiRun,
  showQxAiRun,
} from "./run-island";
import {
  finishReasoningTiming,
  finishStreamTiming,
  recordReasoningOutput,
  recordStreamOutput,
  resolveReasoningDuration,
  resolveStreamDuration,
  type StreamTiming,
} from "./stream-metrics";

export type { AgentStep, QxAiFileAttachment } from "./agent/types";

export interface G4fMessage {
  role: "user" | "assistant" | "system";
  content: string;
  /** Stable display timestamp; legacy sessions fall back to conversation time. */
  createdAt?: number;
  reasoning?: string;
  steps?: AgentStep[];
  attachments?: QxAiFileAttachment[];
  skill?: Pick<QxAiSkillDocument, "id" | "name">;
  /** Estimated completion tokens (chars/4) for Jan-style speed display. */
  tokenCount?: number;
  /** Tokens per second for the completion stream. */
  tokenSpeed?: number;
  durationMs?: number;
  /** Observed visible reasoning/thought phase duration, in milliseconds. */
  reasoningDurationMs?: number;
  /** Provider usage; estimated is true when derived from chars/4. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimated?: boolean;
  };
}

export interface QueuedAiMessage {
  id: string;
  conversationId: string;
  content: string;
  skill?: QxAiSkillDocument;
  attachments?: QxAiFileAttachment[];
}

export interface QxAiConversationRun {
  streaming: boolean;
  streamedContent: string;
  streamedReasoning: string;
  streamingSteps: AgentStep[];
  error: string | null;
  /** Request start (tools + model). Not used for generation speed. */
  startedAt: number;
  /**
   * Jan-style generation clock: first assistant text/reasoning delta.
   * Used with generationMs for decode-speed (excludes long tool idle gaps).
   */
  firstTokenAt?: number;
  /** Last text/reasoning delta timestamp for active-generation windows. */
  lastDeltaAt?: number;
  /** Accumulated ms while tokens were actively streaming (gaps >1.5s ignored). */
  generationMs?: number;
  /** Live completion tokens/sec estimate while streaming. */
  liveTokenSpeed?: number;
  liveTokenCount?: number;
  reasoningStartedAt?: number;
  reasoningLastDeltaAt?: number;
  reasoningMs?: number;
  /** Last provider usage metadata; preferred over frontend estimates. */
  providerPromptTokenCount?: number;
  providerTokenSpeed?: number;
  providerTokenCount?: number;
  providerTotalTokenCount?: number;
  providerDurationMs?: number;
}

function speedFromDuration(tokenCount: number, durationMs?: number): number {
  if (tokenCount <= 0 || !durationMs || durationMs <= 0) return 0;
  return Math.round(computeTokenSpeed(tokenCount, durationMs) * 100) / 100;
}

function speedFromTiming(tokenCount: number, timing?: StreamTiming, now = Date.now()): number {
  if (tokenCount <= 0 || !timing) return 0;
  const durationMs = resolveStreamDuration(timing, now);
  return speedFromDuration(tokenCount, durationMs);
}

function estimateInputTokens(messages: G4fMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message.content), 0);
}

function buildTokenUsage(
  metrics: AgentStreamMetrics | undefined,
  inputEstimate: number,
  outputTokens: number,
): G4fMessage["usage"] {
  const inputTokens = metrics?.promptTokenCount && metrics.promptTokenCount > 0
    ? metrics.promptTokenCount
    : inputEstimate;
  const totalTokens = metrics?.totalTokenCount && metrics.totalTokenCount > 0
    ? metrics.totalTokenCount
    : inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimated: !(metrics?.promptTokenCount && metrics?.tokenCount),
  };
}

function updateReasoningTiming(
  run: QxAiConversationRun,
  now: number,
  hasOutput: boolean,
): QxAiConversationRun {
  const timing = recordReasoningOutput(
    {
      startedAt: run.reasoningStartedAt,
      lastDeltaAt: run.reasoningLastDeltaAt,
      durationMs: run.reasoningMs,
    },
    now,
    hasOutput,
  );
  return {
    ...run,
    reasoningStartedAt: timing.startedAt,
    reasoningLastDeltaAt: timing.lastDeltaAt,
    reasoningMs: timing.durationMs,
  };
}

function reasoningDurationFromRun(run: QxAiConversationRun | undefined, now: number): number | undefined {
  if (!run?.reasoningStartedAt) return undefined;
  return resolveReasoningDuration(
    finishReasoningTiming(
      {
        startedAt: run.reasoningStartedAt,
        lastDeltaAt: run.reasoningLastDeltaAt,
        durationMs: run.reasoningMs,
      },
      now,
    ),
    now,
  );
}

function updateStreamRun(
  run: QxAiConversationRun | undefined,
  content: string,
  reasoning: string,
  now = Date.now(),
): QxAiConversationRun | undefined {
  if (!run?.streaming) return undefined;
  const timing = recordStreamOutput(run, now, Boolean(content.trim() || reasoning.trim()));
  const hasNewReasoning = Boolean(reasoning.trim()) && reasoning !== run.streamedReasoning;
  const reasoningRun = updateReasoningTiming(run, now, hasNewReasoning);
  const liveTokenCount = estimateTokens(content);
  return {
    ...reasoningRun,
    streamedContent: content,
    streamedReasoning: reasoning,
    ...timing,
    liveTokenCount,
    liveTokenSpeed: speedFromTiming(liveTokenCount, timing, now),
    providerTokenSpeed: undefined,
    providerTokenCount: undefined,
    providerDurationMs: undefined,
  };
}

function updateStreamMetrics(
  run: QxAiConversationRun | undefined,
  metrics: AgentStreamMetrics,
): QxAiConversationRun | undefined {
  if (!run?.streaming) return undefined;
  const providerTokenCount = metrics.tokenCount && metrics.tokenCount > 0
    ? metrics.tokenCount
    : run.providerTokenCount;
  const providerTokenSpeed = metrics.tokenSpeed && metrics.tokenSpeed > 0
    ? Math.round(metrics.tokenSpeed * 100) / 100
    : providerTokenCount && metrics.durationMs
      ? speedFromDuration(providerTokenCount, metrics.durationMs)
      : run.providerTokenSpeed;
  return {
    ...run,
    ...(providerTokenCount ? { providerTokenCount, liveTokenCount: providerTokenCount } : {}),
    ...(metrics.promptTokenCount && metrics.promptTokenCount > 0
      ? { providerPromptTokenCount: metrics.promptTokenCount }
      : {}),
    ...(metrics.totalTokenCount && metrics.totalTokenCount > 0
      ? { providerTotalTokenCount: metrics.totalTokenCount }
      : {}),
    ...(metrics.durationMs && metrics.durationMs > 0
      ? { providerDurationMs: metrics.durationMs }
      : {}),
    ...(providerTokenSpeed ? { providerTokenSpeed, liveTokenSpeed: providerTokenSpeed } : {}),
  };
}

export interface G4fConversation {
  id: string;
  name: string;
  createdAt: number;
  messages: G4fMessage[];
  provider: string;
  model: string;
  reasoningEnabled?: boolean;
  /**
   * Title ownership:
   * - auto: may replace with fallback / AI titles
   * - manual: user renamed — never overwrite
   */
  titleMode?: "auto" | "manual";
}

/** Catalog model entry (built-in or custom). Mirrors Rust `ProviderModel`. */
export interface QxAiModelInfo {
  id: string;
  name: string;
  reasoning?: boolean;
  vision?: boolean;
  /** Token context window when known. */
  context_length?: number;
  /** camelCase alias from some JSON paths. */
  contextLength?: number;
}

export interface G4fProvider {
  id: string;
  name: string;
  models: QxAiModelInfo[];
  baseUrl?: string;
  requiresApiKey?: boolean;
}

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: QxAiModelInfo[];
}

export interface BuiltInProviderCredential {
  id: string;
  apiKey: string;
}

interface StreamEvent {
  requestId: string;
  kind: "text" | "reasoning" | "done";
  chunk: string;
  done: boolean;
  message?: unknown;
  error?: string;
  tokenCount?: number;
  promptTokenCount?: number;
  totalTokenCount?: number;
  durationMs?: number;
  tokenSpeed?: number;
}

/** `chat` is the master–detail workbench; `list` is retained as an alias for chat. */
export type G4fView = "list" | "chat" | "settings";

const LAST_CONVERSATION_KEY = "qx-ai.lastConversationId";

function readLastConversationId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const id = window.localStorage.getItem(LAST_CONVERSATION_KEY);
    return id?.trim() || null;
  } catch {
    return null;
  }
}

function writeLastConversationId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(LAST_CONVERSATION_KEY, id);
    else window.localStorage.removeItem(LAST_CONVERSATION_KEY);
  } catch {
    // Private WebView may block persistence; selection still works in-session.
  }
}

function pickConversationId(
  conversations: G4fConversation[],
  preferredId: string | null | undefined,
): string | null {
  if (preferredId && conversations.some((item) => item.id === preferredId)) {
    return preferredId;
  }
  const sorted = [...conversations].sort((a, b) => b.createdAt - a.createdAt);
  return sorted[0]?.id ?? null;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function isPlaceholderConversationName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  return (
    /^Chat\s+\d+$/i.test(trimmed)
    || /^对话\s*\d+$/i.test(trimmed)
    || /^New chat$/i.test(trimmed)
    || /^新对话$/i.test(trimmed)
    || /^Scheduled task$/i.test(trimmed)
    || /^Schedule\b/i.test(trimmed)
  );
}

function canAutoTitle(conversation: G4fConversation): boolean {
  if (conversation.titleMode === "manual") return false;
  // Missing titleMode (legacy sessions) still auto-title while name looks placeholder.
  if (conversation.titleMode === "auto") return true;
  return isPlaceholderConversationName(conversation.name);
}

function normalizeTitleSource(content: string): string[] {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .split(/\n{2,}|[。！？!?]\s+|\.\s+/)
    .map((part) =>
      part
        .replace(/[#*_~>\-[\](){}]/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

/** Instant local fallback from the first user message (no model call). */
function fallbackTitleFromMessages(messages: G4fMessage[], maxLength = 28): string | null {
  const firstUser = messages.find((message) => message.role === "user" && message.content.trim());
  if (!firstUser) return null;
  const paragraphs = normalizeTitleSource(firstUser.content);
  const source = (paragraphs[0] || firstUser.content.replace(/\s+/g, " ").trim()).trim();
  if (!source) return null;
  const chars = [...source];
  if (chars.length <= maxLength) return source;
  return `${chars.slice(0, Math.max(1, maxLength - 1)).join("")}…`;
}

function sanitizeAiTitle(raw: string, maxLength = 24): string | null {
  let title = raw
    .trim()
    .replace(/^["'「『《]+|["'」』》]+$/g, "")
    .replace(/^标题[:：]\s*/i, "")
    .replace(/^title[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // Single line only
  title = title.split(/\n/)[0]?.trim() || "";
  if (!title || title.length < 2) return null;
  if (/^(chat|new chat|对话|新对话)\b/i.test(title)) return null;
  const chars = [...title];
  if (chars.length > maxLength) {
    title = `${chars.slice(0, maxLength - 1).join("")}…`;
  }
  return title;
}

/** Local fallback title as soon as the user sends the first message. */
function withAutoTitle(conversation: G4fConversation): G4fConversation {
  if (!canAutoTitle(conversation)) return conversation;
  const title = fallbackTitleFromMessages(conversation.messages);
  if (!title) return conversation;
  // Don't thrash if already the same fallback / short title.
  if (conversation.name.trim() === title) {
    return { ...conversation, titleMode: conversation.titleMode ?? "auto" };
  }
  // Only replace placeholders or previous auto titles that still look generic.
  if (
    conversation.titleMode === "auto"
    || isPlaceholderConversationName(conversation.name)
  ) {
    return { ...conversation, name: title, titleMode: "auto" };
  }
  return conversation;
}

const titleJobs = new Set<string>();
let sessionsLoadPromise: Promise<void> | null = null;

/**
 * Ask the chat model for a short title after the first assistant turn.
 * Fire-and-forget; failures leave the local fallback name in place.
 */
async function maybeGenerateAiTitle(conversationId: string): Promise<void> {
  if (titleJobs.has(conversationId)) return;
  const state = useG4fStore.getState();
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation || !canAutoTitle(conversation)) return;
  if (!isTauriRuntime()) return;

  const userText = conversation.messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("\n")
    .slice(0, 600);
  const assistantText = conversation.messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .slice(-1)[0]
    ?.slice(0, 400);
  if (!userText || !assistantText) return;

  titleJobs.add(conversationId);
  try {
    const prompt = [
      "Generate a short conversation title for a chat list.",
      "Rules: max 18 characters (or ~10 CJK chars), no quotes, no trailing punctuation,",
      "same language as the user, no markdown, output title only.",
      "",
      `User: ${userText}`,
      `Assistant: ${assistantText}`,
      "Title:",
    ].join("\n");

    const raw = await invoke<string>("g4f_chat", {
      provider: conversation.provider,
      model: conversation.model,
      messages: [
        { role: "system", content: "You write concise chat titles." },
        { role: "user", content: prompt },
      ],
    });
    const title = sanitizeAiTitle(raw);
    if (!title) return;

    // Re-read: user may have renamed or switched chats mid-flight.
    const latest = useG4fStore.getState().conversations.find((item) => item.id === conversationId);
    if (!latest || !canAutoTitle(latest)) return;

    useG4fStore.setState((current) => ({
      conversations: current.conversations.map((item) =>
        item.id === conversationId
          ? { ...item, name: title, titleMode: "auto" as const }
          : item,
      ),
    }));
  } catch (error) {
    console.warn("qxai title generation failed", error);
  } finally {
    titleJobs.delete(conversationId);
  }
}

function makeCustomProviderId(): string {
  return "custom:" + generateId();
}

interface G4fStore {
  conversations: G4fConversation[];
  currentConversationId: string | null;
  builtInProviders: G4fProvider[];
  builtInCredentials: BuiltInProviderCredential[];
  customProviders: CustomProvider[];
  loading: boolean;
  sessionsLoaded: boolean;
  runs: Record<string, QxAiConversationRun>;
  messageQueue: QueuedAiMessage[];
  error: string | null;
  view: G4fView;
  defaultSystemPrompt: string;
  currentProvider: string;
  currentModel: string;

  setView: (v: G4fView) => void;
  setCurrentProvider: (p: string) => void;
  setCurrentModel: (m: string) => void;
  setDefaultSystemPrompt: (p: string) => void;

  /** Combined list of built-in + custom providers for UI selection. */
  providers: G4fProvider[];

  /**
   * Create a chat. Pass `{ background: true }` for schedule / headless runs so
   * the UI does not steal focus from the conversation the user is reading.
   */
  createConversation: (
    provider?: string,
    model?: string,
    options?: { background?: boolean; name?: string },
  ) => string;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, name: string) => void;
  selectConversation: (id: string) => void;
  setConversationModel: (id: string, provider: string, model: string) => void;
  setConversationReasoning: (id: string, enabled: boolean) => void;
  loadSessions: () => Promise<void>;

  sendMessage: (content: string, skill?: QxAiSkillDocument, conversationId?: string, attachments?: QxAiFileAttachment[]) => Promise<void>;
  runNextQueuedMessage: (conversationId: string) => void;
  removeQueuedMessage: (id: string) => void;
  /** Update a queued message body (and optional skill) before it runs. */
  updateQueuedMessage: (
    id: string,
    patch: { content?: string; skill?: QxAiSkillDocument | null },
  ) => void;
  /** Replace or remove one persisted transcript message by its full-array index. */
  updateMessage: (conversationId: string, messageIndex: number, content: string) => void;
  /** Jan-style edit: assistant edits stay local; user edits restart the turn. */
  editMessage: (conversationId: string, messageIndex: number, content: string) => Promise<void>;
  deleteMessage: (conversationId: string, messageIndex: number) => void;
  /**
   * Jan regenerate: drop the assistant turn (and anything after) plus its
   * preceding user turn, then re-send that user content.
   */
  regenerateMessage: (conversationId: string, assistantIndex: number) => Promise<void>;
  clearMessages: () => void;

  loadProviders: () => Promise<void>;
  saveBuiltInProviderKey: (id: string, apiKey: string) => Promise<void>;
  getCurrentConversation: () => G4fConversation | undefined;

  // BYOK
  addCustomProvider: (p: Omit<CustomProvider, "id">) => Promise<void>;
  removeCustomProvider: (id: string) => Promise<void>;
  updateCustomProvider: (id: string, p: Partial<CustomProvider>) => Promise<void>;
}

function buildProviders(
  builtIns: G4fProvider[],
  customs: CustomProvider[],
): G4fProvider[] {
  const mapped: G4fProvider[] = customs.map((c) => ({
    id: c.id,
    name: c.name,
    models: c.models,
  }));
  return [...builtIns, ...mapped];
}

function resolveProviderModel(
  providers: G4fProvider[],
  provider?: string,
  model?: string,
): { provider: string; model: string } {
  if (providers.length === 0) return { provider: provider ?? "", model: model ?? "" };

  const preferredProvider = provider
    ? providers.find((item) => item.id === provider)
    : undefined;
  const selectedProvider = preferredProvider ?? providers[0];
  const preferredModel = model
    ? selectedProvider.models.find((item) => item.id === model)
    : undefined;

  // Keep an explicit model when its provider matched, even if the catalog has
  // not listed it yet (custom endpoints / delayed model lists). Falling back
  // to models[0] would silently unstick the user's default model.
  if (preferredProvider && model && !preferredModel) {
    return { provider: preferredProvider.id, model };
  }

  return {
    provider: selectedProvider.id,
    model: preferredModel?.id ?? selectedProvider.models[0]?.id ?? model ?? "",
  };
}

/** Persisted defaults in Settings → AI Agent (source of truth across restarts). */
function readAgentDefaultSelection(): { provider: string; model: string } {
  const agent = useSettingsStore.getState().settings.agent;
  return {
    provider: agent.default_provider?.trim() ?? "",
    model: agent.default_model?.trim() ?? "",
  };
}

function writeAgentDefaultSelection(provider: string, model: string): void {
  const settings = useSettingsStore.getState();
  const agent = settings.settings.agent;
  if (agent.default_provider === provider && agent.default_model === model) return;
  settings.patch("agent", {
    ...agent,
    default_provider: provider,
    default_model: model,
  });
}

function applyDefaultSelection(
  providers: G4fProvider[],
  provider?: string,
  model?: string,
): { provider: string; model: string } {
  const persisted = readAgentDefaultSelection();
  return resolveProviderModel(
    providers,
    provider || persisted.provider,
    model || persisted.model,
  );
}

function generateStreamRequestId(): string {
  return "qxai-stream-" + generateId();
}

async function withSelectedSkill(
  basePrompt: string,
  skill?: QxAiSkillDocument,
): Promise<string> {
  if (!skill) return basePrompt;
  const agentSettings = useSettingsStore.getState().settings.agent;
  const capabilityBlock = await withSkillCapabilityBinding(
    skill.id,
    skill.content,
    agentSettings,
  );
  return `${basePrompt.trim()}\n\nSelected Qx Skill: ${skill.name} (${skill.id})\nFollow this skill for the current user request. Treat it as task instructions, while system safety and explicit user instructions remain higher priority.\nExecute bound Qx capabilities via run_qx_capability / run_module_action / named tools (or list_plugins for marketplace plugins).\n\n<qx-skill id="${skill.id}" mode="selected">\n${skill.content}\n\n${capabilityBlock}\n</qx-skill>`;
}

async function withAutoAndSelectedSkills(
  basePrompt: string,
  userMessage: string,
  skill?: QxAiSkillDocument,
): Promise<string> {
  const agentSettings = useSettingsStore.getState().settings.agent;
  const autoBlock = await buildAutoSkillPromptBlock(
    userMessage,
    agentSettings,
    skill?.id,
  );
  const withSelected = await withSelectedSkill(basePrompt, skill);
  if (!autoBlock) return withSelected;
  return `${withSelected.trim()}\n\n${autoBlock}`;
}

/** Load agent harness only when a chat turn needs tools (keeps module shell light). */
async function loadAgentHarness() {
  return import("./agent");
}

const STREAM_TIMEOUT_MS = 180_000;

interface StreamChatEventsArgs {
  requestId: string;
  provider: string;
  model: string;
  messages: G4fMessage[];
  /** One atomic snapshot keeps content, reasoning, and timing in sync. */
  onUpdate: (content: string, reasoning: string) => void;
  onMetrics?: (metrics: AgentStreamMetrics) => void;
  reasoning: boolean;
}

async function streamChatEvents({
  requestId,
  provider,
  model,
  messages,
  onUpdate,
  onMetrics,
  reasoning,
}: StreamChatEventsArgs): Promise<string> {
  let responseText = "";
  let reasoningText = "";
  let unlisten: (() => void) | undefined;
  let settled = false;
  let timer: number | undefined;
  let flushTimer: number | undefined;
  let lastFlushAt = 0;

  // Providers may emit hundreds of SSE deltas per second. Keep the complete
  // accumulator for correctness, but publish UI snapshots at a bounded rate.
  const flush = () => {
    if (flushTimer !== undefined) {
      window.clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    lastFlushAt = Date.now();
    if (responseText || reasoningText) onUpdate(responseText, reasoningText);
  };
  const scheduleFlush = () => {
    if (flushTimer !== undefined) return;
    const delay = Math.max(0, 48 - (Date.now() - lastFlushAt));
    flushTimer = window.setTimeout(flush, delay);
  };

  const stop = () => {
    if (settled) return false;
    settled = true;
    if (timer !== undefined) window.clearTimeout(timer);
    if (flushTimer !== undefined) window.clearTimeout(flushTimer);
    try {
      unlisten?.();
    } catch {
      // ignore
    }
    return true;
  };

  return await new Promise<string>((resolve, reject) => {
    timer = window.setTimeout(() => {
      if (stop()) reject(new Error("AI stream timed out"));
    }, STREAM_TIMEOUT_MS);

    listen<StreamEvent>("qxai-stream", (event) => {
      if (event.payload.requestId !== requestId) return;
      if (event.payload.error) {
        if (stop()) reject(new Error(event.payload.error));
        return;
      }
      if (event.payload.done) {
        if (event.payload.chunk && !responseText) responseText = event.payload.chunk;
        flush();
        onMetrics?.({
          tokenCount: event.payload.tokenCount,
          promptTokenCount: event.payload.promptTokenCount,
          totalTokenCount: event.payload.totalTokenCount,
          durationMs: event.payload.durationMs,
          tokenSpeed: event.payload.tokenSpeed,
        });
        if (stop()) resolve(responseText || event.payload.chunk);
        return;
      }
      if (event.payload.kind === "reasoning") {
        reasoningText += event.payload.chunk;
      } else {
        responseText += event.payload.chunk;
      }
      scheduleFlush();
    })
      .then((un) => {
        if (settled) {
          try {
            un();
          } catch {
            // ignore
          }
          return;
        }
        unlisten = un;
        return invoke("qxai_stream_chat_events", {
          requestId,
          provider,
          model,
          messages,
          reasoning,
        });
      })
      .catch((err) => {
        if (stop()) reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

export const useG4fStore = create<G4fStore>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  builtInProviders: [],
  builtInCredentials: [],
  customProviders: [],
  loading: false,
  sessionsLoaded: false,
  runs: {},
  messageQueue: [],
  error: null,
  view: "chat",
  defaultSystemPrompt: "You are a helpful AI assistant.",
  currentProvider: "",
  currentModel: "",

  // computed – kept in sync by actions
  providers: [],

  setView: (view) => set({ view: view === "list" ? "chat" : view }),
  setCurrentProvider: (currentProvider) => {
    const { providers, currentModel } = get();
    const next = resolveProviderModel(providers, currentProvider, currentModel);
    set({ currentProvider: next.provider, currentModel: next.model });
    if (next.provider) writeAgentDefaultSelection(next.provider, next.model);
  },
  setCurrentModel: (currentModel) => {
    const { providers, currentProvider } = get();
    const next = resolveProviderModel(providers, currentProvider, currentModel);
    set({ currentProvider: next.provider, currentModel: next.model });
    if (next.provider) writeAgentDefaultSelection(next.provider, next.model);
  },
  setDefaultSystemPrompt: (defaultSystemPrompt) => set({ defaultSystemPrompt }),

  loadSessions: async () => {
    if (get().sessionsLoaded) return;
    if (sessionsLoadPromise) return sessionsLoadPromise;
    sessionsLoadPromise = (async () => {
      try {
        // Fresh layout may return [] after one-time wipe of legacy/broken trees.
        const stored = await loadQxAiSessions();
        const conversations = Array.isArray(stored) ? stored : [];
        const preferred =
          get().currentConversationId
          ?? readLastConversationId();
        const currentConversationId = pickConversationId(conversations, preferred);
        writeLastConversationId(currentConversationId);
        set({
          conversations,
          sessionsLoaded: true,
          currentConversationId,
          view: "chat",
          error: null,
        });
      } catch (error) {
        // Never block the workbench on storage errors — start empty.
        console.warn("qxai loadSessions failed; starting empty", error);
        set({
          conversations: [],
          sessionsLoaded: true,
          currentConversationId: null,
          view: "chat",
          error: null,
        });
      } finally {
        sessionsLoadPromise = null;
      }
    })();
    return sessionsLoadPromise;
  },

  createConversation: (provider, model, options) => {
    const { currentProvider, currentModel, conversations, defaultSystemPrompt, providers } =
      get();
    // Prefer explicit args → persisted agent defaults → in-memory selection.
    const selection = applyDefaultSelection(
      providers,
      provider ?? currentProvider,
      model ?? currentModel,
    );
    const id = generateId();
    const background = options?.background === true;
    const displayName =
      options?.name?.trim()
      || (background
        ? `Schedule ${new Date().toLocaleString()}`
        : `Chat ${conversations.length + 1}`);
    const conv: G4fConversation = {
      id,
      name: displayName,
      createdAt: Date.now(),
      messages: defaultSystemPrompt
        ? [{ role: "system", content: defaultSystemPrompt }]
        : [],
      provider: selection.provider,
      model: selection.model,
      reasoningEnabled: providers
        .find((item) => item.id === selection.provider)
        ?.models.find((item) => item.id === selection.model)?.reasoning ?? false,
      // Placeholder / schedule names stay auto until the user renames.
      titleMode: "auto",
    };
    if (background) {
      // Headless / schedule: append only — do not steal current conversation or last-id.
      set({
        conversations: [...conversations, conv],
      });
    } else {
      writeLastConversationId(id);
      set({
        conversations: [...conversations, conv],
        currentConversationId: id,
        view: "chat",
      });
    }
    return id;
  },

  deleteConversation: (id) => {
    const { conversations, currentConversationId } = get();
    const remaining = conversations.filter((c) => c.id !== id);
    const nextId =
      currentConversationId === id
        ? pickConversationId(remaining, null)
        : currentConversationId;
    writeLastConversationId(nextId);
    set({
      conversations: remaining,
      currentConversationId: nextId,
      messageQueue: get().messageQueue.filter((message) => message.conversationId !== id),
      runs: Object.fromEntries(Object.entries(get().runs).filter(([conversationId]) => conversationId !== id)),
      view: "chat",
    });
    dismissQxAiRun(id);
  },

  renameConversation: (id, name) => {
    const next = name.trim();
    if (!next) return;
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, name: next, titleMode: "manual" as const } : c,
      ),
    }));
  },

  selectConversation: (id) => {
    writeLastConversationId(id);
    set({ currentConversationId: id, view: "chat" });
  },

  setConversationModel: (id, provider, model) => {
    const { providers } = get();
    const selection = resolveProviderModel(providers, provider, model);
    // Per-conversation only — do not overwrite the fixed global default model.
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id
          ? {
              ...c,
              provider: selection.provider,
              model: selection.model,
              reasoningEnabled:
                providers
                  .find((item) => item.id === selection.provider)
                  ?.models.find((item) => item.id === selection.model)?.reasoning
                  ? (c.reasoningEnabled ?? true)
                  : false,
            }
          : c,
      ),
      error: null,
    }));
  },

  setConversationReasoning: (id, enabled) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === id
          ? { ...conversation, reasoningEnabled: enabled }
          : conversation,
      ),
    }));
  },

  sendMessage: async (content, skill, requestedConversationId, attachments) => {
    const targetConversationId = requestedConversationId ?? get().currentConversationId;
    if (!targetConversationId) return;
    if (get().runs[targetConversationId]?.streaming) {
      set((state) => ({
        messageQueue: [
          ...state.messageQueue,
          {
            id: `queue-${generateId()}`,
            conversationId: targetConversationId,
            content,
            skill,
            attachments,
          },
        ],
      }));
      return;
    }
    const {
      conversations,
      customProviders,
      providers,
      currentProvider,
      currentModel,
      defaultSystemPrompt,
    } = get();
    const currentConversationId = targetConversationId;
    const scheduleNext = () =>
      queueMicrotask(() => get().runNextQueuedMessage(currentConversationId));

    const conv = conversations.find((c) => c.id === currentConversationId);
    if (!conv) return;

    const selection = resolveProviderModel(
      providers,
      conv.provider || currentProvider,
      conv.model || currentModel,
    );

    const touchesActiveChat = get().currentConversationId === currentConversationId;

    if (!selection.provider) {
      const msg = "No AI provider available. Open QxAI Settings first.";
      set({
        ...(touchesActiveChat ? { error: msg } : {}),
        runs: {
          ...get().runs,
          [currentConversationId]: {
            streaming: false,
            streamedContent: "",
            streamedReasoning: "",
            streamingSteps: [],
            error: msg,
            startedAt: Date.now(),
          },
        },
      });
      scheduleNext();
      return;
    }

    if (!selection.model) {
      const msg = `No model available for provider "${selection.provider}".`;
      set({
        ...(touchesActiveChat ? { error: msg } : {}),
        runs: {
          ...get().runs,
          [currentConversationId]: {
            streaming: false,
            streamedContent: "",
            streamedReasoning: "",
            streamingSteps: [],
            error: msg,
            startedAt: Date.now(),
          },
        },
      });
      scheduleNext();
      return;
    }

    const modelMeta = providers
      .find((provider) => provider.id === selection.provider)
      ?.models.find((model) => model.id === selection.model);
    const agentSettings = useSettingsStore.getState().settings.agent;
    const hasImages =
      messageHasImages(attachments)
      || conv.messages.some((message) => messageHasImages(message.attachments));
    if (
      hasImages
      && !resolveModelVision(selection.provider, modelMeta ?? { id: selection.model, name: selection.model }, agentSettings.model_capabilities)
    ) {
      const error =
        `Model "${selection.model}" does not support vision/images. Choose a multimodal model, enable Vision in Settings → AI Agent, or remove image attachments.`;
      set({
        ...(touchesActiveChat ? { error } : {}),
        runs: {
          ...get().runs,
          [currentConversationId]: {
            streaming: false,
            streamedContent: "",
            streamedReasoning: "",
            streamingSteps: [],
            error,
            startedAt: Date.now(),
          },
        },
      });
      scheduleNext();
      return;
    }

    const updatedConv: G4fConversation = {
      ...conv,
      provider: selection.provider,
      model: selection.model,
      messages: [
        ...conv.messages,
        {
          role: "user",
          content,
          createdAt: Date.now(),
          ...(attachments?.length ? { attachments } : {}),
          ...(skill ? { skill: { id: skill.id, name: skill.name } } : {}),
        },
      ],
    };
    const titledConv = withAutoTitle(updatedConv);

    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === currentConversationId ? titledConv : c,
      ),
      runs: {
        ...state.runs,
        [currentConversationId]: {
          streaming: true,
          streamedContent: "",
          streamedReasoning: "",
          streamingSteps: [],
          error: null,
          startedAt: Date.now(),
          firstTokenAt: undefined,
          lastDeltaAt: undefined,
          generationMs: 0,
          liveTokenSpeed: undefined,
          liveTokenCount: undefined,
        },
      },
      // Never clear the active chat's global error banner for a background turn.
      ...(touchesActiveChat ? { error: null } : {}),
    }));
    showQxAiRun(currentConversationId, titledConv.name);

    if (!isTauriRuntime()) {
      set((state) => ({
        runs: {
          ...state.runs,
          [currentConversationId]: {
            ...state.runs[currentConversationId],
            streaming: false,
          },
        },
      }));
      dismissQxAiRun(currentConversationId);
      scheduleNext();
      return;
    }

    try {
      // The native tool boundary re-reads persisted settings for security. Flush
      // the debounced Settings store first so a freshly enabled Bash/Tools switch
      // cannot race the first tool invocation.
      await useSettingsStore.getState().flush();
      const fullSettings = useSettingsStore.getState().settings;
      const agentSettings = fullSettings.agent;

      // Agent tools/harness load only for this turn — never at module import.
      const {
        getEnabledTools,
        loadMemorySnapshot,
        runFunctionCallingAgent,
        runReactAgent,
        runMemoryDream,
        shouldDreamAfterTurn,
        buildQxHostSystemPrompt,
      } = await loadAgentHarness();
      const enabledTools = getEnabledTools(agentSettings, fullSettings);
      const useAgent = enabledTools.length > 0;

      if (selection.provider.startsWith("custom:")) {
        const cp = customProviders.find((p) => p.id === selection.provider);
        if (!cp) throw new Error(`Custom provider "${selection.provider}" not found`);
      }

      if (useAgent) {
        const basePrompt = await withAutoAndSelectedSkills(
          titledConv.messages.find((m) => m.role === "system")?.content?.trim() ||
            defaultSystemPrompt,
          content,
          skill,
        );
        const nonSystem = titledConv.messages.filter((m) => m.role !== "system");

        // Native function calling is opt-in because many compatible models do
        // not accept tool schemas. The prompt-based ReAct transport remains the
        // portable path and still executes the same permissioned local tools.
        const runAgent = agentSettings.model_tools_enabled
          ? runFunctionCallingAgent
          : runReactAgent;
        let latestProviderMetrics: AgentStreamMetrics | undefined;

        // Hermes frozen memory snapshot (prefix-cache friendly; live writes via tools).
        const memorySnapshot = agentSettings.memory_tool_enabled
          ? await loadMemorySnapshot()
          : "";

        const result = await runAgent({
          messages: nonSystem,
          provider: selection.provider,
          model: selection.model,
          basePrompt,
          agentSettings,
          memorySnapshot,
          conversationId: currentConversationId,
          userMessage: content,
          reasoning: Boolean(titledConv.reasoningEnabled),
          onStep: (step) =>
            set((state) => {
              const run = state.runs[currentConversationId];
              if (!run?.streaming) return state;
              const updated = updateReasoningTiming(run, Date.now(), true);
              return {
                runs: {
                  ...state.runs,
                  [currentConversationId]: {
                    ...updated,
                    streamingSteps: [...updated.streamingSteps, step],
                  },
                },
              };
            }),
          onStepUpdate: (id, patch) =>
            set((state) => {
              const run = state.runs[currentConversationId];
              if (!run?.streaming) return state;
              const updated = updateReasoningTiming(run, Date.now(), true);
              return {
                runs: {
                  ...state.runs,
                  [currentConversationId]: {
                    ...updated,
                    streamingSteps: updated.streamingSteps.map((step) =>
                      step.id === id ? { ...step, ...patch } : step,
                    ),
                  },
                },
              };
            }),
          onStreamUpdate: (text, reasoningText) =>
            set((state) => {
              const updated = updateStreamRun(
                state.runs[currentConversationId],
                text,
                reasoningText,
              );
              return updated
                ? {
                    runs: {
                      ...state.runs,
                      [currentConversationId]: updated,
                    },
                  }
                : state;
            }),
          onAssistantStream: (text) =>
            set((state) => {
              const run = state.runs[currentConversationId];
              const updated = updateStreamRun(run, text, run?.streamedReasoning ?? "");
              const thinkingRun = updated
                ? updateReasoningTiming(updated, Date.now(), true)
                : undefined;
              return thinkingRun
                ? {
                    runs: {
                      ...state.runs,
                      [currentConversationId]: thinkingRun,
                    },
                  }
                : state;
            }),
          onReasoningStream: (text) =>
            set((state) => {
              const run = state.runs[currentConversationId];
              const updated = updateStreamRun(run, run?.streamedContent ?? "", text);
              return updated
                ? {
                    runs: {
                      ...state.runs,
                      [currentConversationId]: updated,
                    },
                  }
                : state;
            }),
          onStreamMetrics: (metrics) => {
            latestProviderMetrics = metrics;
            set((state) => {
              const updated = updateStreamMetrics(state.runs[currentConversationId], metrics);
              return updated
                ? {
                    runs: {
                      ...state.runs,
                      [currentConversationId]: updated,
                    },
                  }
                : state;
            });
          },
        });

        const finishedRun = get().runs[currentConversationId];
        const finishedAt = Date.now();
        const finishedTiming = finishedRun
          ? finishStreamTiming(finishedRun, finishedAt)
          : undefined;
        const reasoningDurationMs = reasoningDurationFromRun(finishedRun, finishedAt);
        const estimatedTokenCount = estimateTokens(result.finalAnswer);
        const tokenCount = latestProviderMetrics?.tokenCount && latestProviderMetrics.tokenCount > 0
          ? latestProviderMetrics.tokenCount
          : estimatedTokenCount;
        const durationMs = Math.max(
          1,
          latestProviderMetrics?.durationMs && latestProviderMetrics.durationMs > 0
            ? latestProviderMetrics.durationMs
            : finishedTiming
              ? resolveStreamDuration(finishedTiming, finishedAt)
              : 1,
        );
        const tokenSpeed = latestProviderMetrics?.tokenSpeed && latestProviderMetrics.tokenSpeed > 0
          ? Math.round(latestProviderMetrics.tokenSpeed * 100) / 100
          : speedFromDuration(tokenCount, durationMs);
        const assistantMessage: G4fMessage = {
          role: "assistant",
          content: result.finalAnswer,
          createdAt: finishedAt,
          reasoning: result.reasoning,
          steps: result.steps,
          attachments: result.attachments,
          tokenCount,
          tokenSpeed,
          durationMs,
          usage: buildTokenUsage(
            latestProviderMetrics,
            estimateInputTokens(nonSystem),
            tokenCount,
          ),
          ...(reasoningDurationMs ? { reasoningDurationMs } : {}),
        };

        if (!get().conversations.some((conversation) => conversation.id === currentConversationId)) {
          dismissQxAiRun(currentConversationId);
          return;
        }

        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === currentConversationId
              ? { ...c, messages: [...c.messages, assistantMessage] }
              : c,
          ),
          runs: {
            ...s.runs,
            [currentConversationId]: {
              ...s.runs[currentConversationId],
              streaming: false,
              streamedContent: "",
              streamedReasoning: "",
              streamingSteps: [],
              liveTokenSpeed: undefined,
              liveTokenCount: undefined,
              error: null,
            },
          },
        }));
        completeQxAiRun(currentConversationId, titledConv.name);
        // AI list title (async); local fallback already applied via withAutoTitle.
        void maybeGenerateAiTitle(currentConversationId);

        // Hermes-style sleep/dream: background consolidate after substantial tool work.
        if (agentSettings.memory_tool_enabled) {
          const toolCallCount = result.steps.filter((step) => step.kind === "action").length;
          const memoryToolUsed = result.steps.some(
            (step) =>
              step.kind === "action"
              && (step.tool === "memory"
                || step.tool === "memory_add"
                || step.tool === "memory_dream"),
          );
          if (
            shouldDreamAfterTurn({
              toolCallCount,
              steps: result.steps.length,
              memoryToolUsed,
            })
          ) {
            const transcript = nonSystem
              .slice(-8)
              .map((message) => `${message.role}: ${String(message.content).slice(0, 400)}`)
              .join("\n");
            void runMemoryDream(`${transcript}\nassistant: ${result.finalAnswer.slice(0, 800)}`).catch(
              () => {
                // Dream is best-effort; never fail the user-facing turn.
              },
            );
          }
        }

        scheduleNext();
        return;
      }

      const requestId = generateStreamRequestId();
      const basePrompt = await withAutoAndSelectedSkills(
        titledConv.messages.find((message) => message.role === "system")?.content?.trim()
          || defaultSystemPrompt,
        content,
        skill,
      );
      const requestMessages: G4fMessage[] = [
        { role: "system", content: buildQxHostSystemPrompt(basePrompt) },
        ...titledConv.messages.filter((message) => message.role !== "system"),
      ];
      let latestProviderMetrics: AgentStreamMetrics | undefined;
      const response = await streamChatEvents({
        requestId,
        provider: selection.provider,
        model: selection.model,
        messages: requestMessages,
        reasoning: Boolean(titledConv.reasoningEnabled),
        onUpdate: (full, reasoningText) =>
          set((state) => {
            const updated = updateStreamRun(
              state.runs[currentConversationId],
              full,
              reasoningText,
            );
            return updated
              ? {
                  runs: {
                    ...state.runs,
                    [currentConversationId]: updated,
                  },
                }
              : state;
          }),
        onMetrics: (metrics) => {
          latestProviderMetrics = metrics;
          set((state) => {
            const updated = updateStreamMetrics(state.runs[currentConversationId], metrics);
            return updated
              ? {
                  runs: {
                    ...state.runs,
                    [currentConversationId]: updated,
                  },
                }
              : state;
          });
        },
      });

      const finishedRun = get().runs[currentConversationId];
      const finishedAt = Date.now();
      const finishedTiming = finishedRun
        ? finishStreamTiming(finishedRun, finishedAt)
        : undefined;
      const reasoningDurationMs = reasoningDurationFromRun(finishedRun, finishedAt);
      const estimatedTokenCount = estimateTokens(response);
      const tokenCount = latestProviderMetrics?.tokenCount && latestProviderMetrics.tokenCount > 0
        ? latestProviderMetrics.tokenCount
        : estimatedTokenCount;
      const durationMs = Math.max(
        1,
        latestProviderMetrics?.durationMs && latestProviderMetrics.durationMs > 0
          ? latestProviderMetrics.durationMs
          : finishedTiming
            ? resolveStreamDuration(finishedTiming, finishedAt)
            : 1,
      );
      const tokenSpeed = latestProviderMetrics?.tokenSpeed && latestProviderMetrics.tokenSpeed > 0
        ? Math.round(latestProviderMetrics.tokenSpeed * 100) / 100
        : speedFromDuration(tokenCount, durationMs);
      const assistantMessage: G4fMessage = {
        role: "assistant",
        content: response,
        createdAt: finishedAt,
        tokenCount,
        tokenSpeed,
        durationMs,
        usage: buildTokenUsage(
          latestProviderMetrics,
          estimateInputTokens(requestMessages),
          tokenCount,
        ),
        ...(reasoningDurationMs ? { reasoningDurationMs } : {}),
        reasoning: finishedRun?.streamedReasoning || undefined,
      };

      if (!get().conversations.some((conversation) => conversation.id === currentConversationId)) {
        dismissQxAiRun(currentConversationId);
        return;
      }

      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === currentConversationId
            ? { ...c, messages: [...c.messages, assistantMessage] }
            : c,
        ),
        runs: {
          ...s.runs,
          [currentConversationId]: {
            ...s.runs[currentConversationId],
            streaming: false,
            streamedContent: "",
            streamedReasoning: "",
            streamingSteps: [],
            error: null,
          },
        },
      }));
      completeQxAiRun(currentConversationId, titledConv.name);
      void maybeGenerateAiTitle(currentConversationId);
      scheduleNext();
    } catch (e) {
      if (!get().conversations.some((conversation) => conversation.id === currentConversationId)) {
        dismissQxAiRun(currentConversationId);
        return;
      }
      set((s) => ({
        runs: {
          ...s.runs,
          [currentConversationId]: {
            ...s.runs[currentConversationId],
            streaming: false,
            streamedContent: "",
            streamedReasoning: "",
            streamingSteps: [],
            error: String(e),
          },
        },
      }));
      failQxAiRun(currentConversationId, titledConv.name, e);
      scheduleNext();
    }
  },

  runNextQueuedMessage: (conversationId) => {
    if (get().runs[conversationId]?.streaming) return;
    const queue = get().messageQueue;
    const next = queue.find((message) => message.conversationId === conversationId);
    if (!next) {
      return;
    }
    set({ messageQueue: queue.filter((message) => message.id !== next.id) });
    queueMicrotask(() => {
      void get().sendMessage(next.content, next.skill, next.conversationId, next.attachments);
    });
  },

  removeQueuedMessage: (id) => {
    set((state) => ({
      messageQueue: state.messageQueue.filter((message) => message.id !== id),
    }));
  },

  updateQueuedMessage: (id, patch) => {
    const nextContent =
      typeof patch.content === "string" ? patch.content.trim() : undefined;
    if (nextContent !== undefined && !nextContent) {
      // Empty content removes the queued turn (same as discard).
      get().removeQueuedMessage(id);
      return;
    }
    set((state) => ({
      messageQueue: state.messageQueue.map((message) => {
        if (message.id !== id) return message;
        return {
          ...message,
          ...(nextContent !== undefined ? { content: nextContent } : {}),
          ...(patch.skill === null
            ? { skill: undefined }
            : patch.skill
              ? { skill: patch.skill }
              : {}),
        };
      }),
    }));
  },

  updateMessage: (conversationId, messageIndex, content) => {
    const nextContent = content.trim();
    if (!nextContent) return;
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        if (messageIndex < 0 || messageIndex >= conversation.messages.length) return conversation;
        const target = conversation.messages[messageIndex];
        if (!target || target.role === "system") return conversation;
        return {
          ...conversation,
          messages: conversation.messages.map((message, index) =>
            index === messageIndex
              ? {
                  ...message,
                  content: nextContent,
                  ...(message.role === "assistant"
                    ? {
                        reasoning: undefined,
                        steps: undefined,
                        tokenCount: undefined,
                        tokenSpeed: undefined,
                        durationMs: undefined,
                        usage: undefined,
                      }
                    : {}),
                }
              : message,
          ),
        };
      }),
    }));
  },

  editMessage: async (conversationId, messageIndex, content) => {
    const nextContent = content.trim();
    if (!nextContent) return;
    const conversation = get().conversations.find((item) => item.id === conversationId);
    const target = conversation?.messages[messageIndex];
    if (!conversation || !target || target.role === "system") return;

    if (target.role === "assistant") {
      get().updateMessage(conversationId, messageIndex, nextContent);
      return;
    }

    // Jan forks an edited user message and immediately regenerates its reply.
    // QxAI keeps a linear transcript, so retain the prefix and send the edited
    // user turn as the next request.
    const prefix = conversation.messages.slice(0, messageIndex);
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === conversationId
          ? { ...item, messages: prefix }
          : item,
      ),
    }));
    await get().sendMessage(nextContent, undefined, conversationId, target.attachments);
  },

  deleteMessage: (conversationId, messageIndex) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        if (messageIndex < 0 || messageIndex >= conversation.messages.length) return conversation;
        if (conversation.messages[messageIndex]?.role === "system") return conversation;
        return {
          ...conversation,
          messages: conversation.messages.filter((_, index) => index !== messageIndex),
        };
      }),
    }));
  },

  regenerateMessage: async (conversationId, assistantIndex) => {
    const conv = get().conversations.find((item) => item.id === conversationId);
    if (!conv) return;
    if (get().runs[conversationId]?.streaming) return;
    if (assistantIndex < 0 || assistantIndex >= conv.messages.length) return;
    if (conv.messages[assistantIndex]?.role !== "assistant") return;

    let userIndex = -1;
    for (let i = assistantIndex - 1; i >= 0; i -= 1) {
      if (conv.messages[i]?.role === "user") {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) return;

    const userMessage = conv.messages[userIndex];
    const kept = conv.messages.slice(0, userIndex);
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === conversationId ? { ...item, messages: kept } : item,
      ),
    }));

    await get().sendMessage(
      userMessage.content,
      undefined,
      conversationId,
      userMessage.attachments,
    );
  },

  clearMessages: () => {
    const { currentConversationId, conversations } = get();
    if (!currentConversationId) return;
    set({
      conversations: conversations.map((c) =>
        c.id === currentConversationId ? { ...c, messages: [] } : c,
      ),
      messageQueue: get().messageQueue.filter(
        (message) => message.conversationId !== currentConversationId,
      ),
    });
  },

  loadProviders: async () => {
    if (!isTauriRuntime()) {
      set({ providers: [] });
      return;
    }
    set({ loading: true, error: null });
    try {
      const [providers, customProviders, builtInCredentials] = await Promise.all([
        invoke<G4fProvider[]>("qxai_list_providers"),
        invoke<CustomProvider[]>("qxai_get_custom_providers"),
        invoke<BuiltInProviderCredential[]>("qxai_get_builtin_provider_credentials"),
      ]);
      const builtInProviders = providers.filter((provider) => !provider.id.startsWith("custom:"));
      const customProvidersWithModels = customProviders.map((provider) => {
        const catalogProvider = providers.find((item) => item.id === provider.id);
        return catalogProvider
          ? { ...provider, models: catalogProvider.models }
          : provider;
      });
      const combinedProviders = buildProviders(builtInProviders, customProvidersWithModels);
      set({
        builtInProviders,
        builtInCredentials,
        customProviders: customProvidersWithModels,
        providers: combinedProviders,
        loading: false,
      });
      // Hydrate in-memory selection from persisted agent defaults so restarts
      // and new chats keep the fixed default model.
      const selection = applyDefaultSelection(combinedProviders);
      set({
        currentProvider: selection.provider,
        currentModel: selection.model,
      });
      // Only seed empty agent defaults; never clobber a user-chosen fixed model.
      const persisted = readAgentDefaultSelection();
      if (selection.provider && (!persisted.provider || !persisted.model)) {
        writeAgentDefaultSelection(selection.provider, selection.model);
      }
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  getCurrentConversation: () => {
    const { currentConversationId, conversations } = get();
    return conversations.find((c) => c.id === currentConversationId);
  },

  saveBuiltInProviderKey: async (id, apiKey) => {
    const previousCredentials = get().builtInCredentials;
    const credentials = previousCredentials.filter((item) => item.id !== id);
    if (apiKey.trim()) credentials.push({ id, apiKey: apiKey.trim() });
    set({ builtInCredentials: credentials, error: null });
    if (isTauriRuntime()) {
      try {
        await invoke("qxai_save_builtin_provider_credentials", { credentials });
      } catch (error) {
        set({ builtInCredentials: previousCredentials, error: String(error) });
        throw error;
      }
    }
  },

  // BYOK actions

  addCustomProvider: async (input) => {
    const id = makeCustomProviderId();
    const newProvider: CustomProvider = { id, ...input };
    const { customProviders: oldCustoms, builtInProviders } = get();
    const customProviders = [...oldCustoms, newProvider];
    const providers = buildProviders(builtInProviders, customProviders);
    const selection = resolveProviderModel(providers, get().currentProvider, get().currentModel);
    set({
      customProviders,
      providers,
      currentProvider: selection.provider,
      currentModel: selection.model,
    });
    if (isTauriRuntime()) {
      await invoke("qxai_save_custom_providers", { providers: customProviders });
    }
  },

  removeCustomProvider: async (id) => {
    const { customProviders: oldCustoms, builtInProviders, currentProvider, currentModel } = get();
    const customProviders = oldCustoms.filter((p) => p.id !== id);
    const providers = buildProviders(builtInProviders, customProviders);
    const selection = resolveProviderModel(providers, currentProvider, currentModel);
    set({
      customProviders,
      providers,
      currentProvider: selection.provider,
      currentModel: selection.model,
      conversations: get().conversations.map((c) =>
        c.provider === id
          ? { ...c, provider: selection.provider, model: selection.model }
          : c,
      ),
    });
    if (isTauriRuntime()) {
      await invoke("qxai_save_custom_providers", { providers: customProviders });
    }
  },

  updateCustomProvider: async (id, patch) => {
    const { customProviders: oldCustoms, builtInProviders, currentProvider, currentModel } = get();
    const customProviders = oldCustoms.map((p) =>
      p.id === id ? { ...p, ...patch } : p,
    );
    const providers = buildProviders(builtInProviders, customProviders);
    const selection = resolveProviderModel(providers, currentProvider, currentModel);
    set({
      customProviders,
      providers,
      currentProvider: selection.provider,
      currentModel: selection.model,
      conversations: get().conversations.map((c) => {
        if (c.provider !== id) return c;
        const next = resolveProviderModel(providers, c.provider, c.model);
        return { ...c, provider: next.provider, model: next.model };
      }),
    });
    if (isTauriRuntime()) {
      await invoke("qxai_save_custom_providers", { providers: customProviders });
    }
  },
}));

let persistedConversations = useG4fStore.getState().conversations;
let persistenceBaselineReady = false;
const pendingSessionWrites = new Map<string, G4fConversation>();
const pendingSessionDeletes = new Set<string>();
let persistTimer: number | undefined;
let persistenceRunning = false;

function scheduleQxAiPersistence(delayMs = 180): void {
  if (persistTimer !== undefined) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = undefined;
    void flushQxAiPersistence().catch((error) => {
      useG4fStore.setState({ error: String(error) });
      scheduleQxAiPersistence(1000);
    });
  }, delayMs);
}

async function flushQxAiPersistence(): Promise<void> {
  if (persistenceRunning) return;
  persistenceRunning = true;
  try {
    while (pendingSessionWrites.size > 0 || pendingSessionDeletes.size > 0) {
      const writes = [...pendingSessionWrites.values()];
      const deletes = [...pendingSessionDeletes];
      pendingSessionWrites.clear();
      pendingSessionDeletes.clear();
      try {
        await Promise.all([
          ...writes.map((conversation) => saveQxAiSession(conversation)),
          ...deletes.map((conversationId) => deleteQxAiSessionFiles(conversationId)),
        ]);
      } catch (error) {
        // Keep failed work durable; a newer mutation already queued for the
        // same id wins and must not be replaced by this older snapshot.
        for (const conversation of writes) {
          if (!pendingSessionWrites.has(conversation.id) && !pendingSessionDeletes.has(conversation.id)) {
            pendingSessionWrites.set(conversation.id, conversation);
          }
        }
        for (const conversationId of deletes) {
          if (!pendingSessionWrites.has(conversationId) && !pendingSessionDeletes.has(conversationId)) {
            pendingSessionDeletes.add(conversationId);
          }
        }
        throw error;
      }
    }
  } finally {
    persistenceRunning = false;
  }
}

useG4fStore.subscribe((state) => {
  if (!state.sessionsLoaded) return;
  if (!persistenceBaselineReady) {
    persistedConversations = state.conversations;
    persistenceBaselineReady = true;
    return;
  }
  if (state.conversations === persistedConversations) return;
  const previousById = new Map(persistedConversations.map((conversation) => [conversation.id, conversation]));
  const nextIds = new Set(state.conversations.map((conversation) => conversation.id));
  for (const conversation of state.conversations) {
    if (previousById.get(conversation.id) !== conversation) {
      pendingSessionWrites.set(conversation.id, conversation);
      pendingSessionDeletes.delete(conversation.id);
    }
  }
  for (const conversation of persistedConversations) {
    if (!nextIds.has(conversation.id)) {
      pendingSessionWrites.delete(conversation.id);
      pendingSessionDeletes.add(conversation.id);
    }
  }
  persistedConversations = state.conversations;
  scheduleQxAiPersistence();
});
