import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "../settings/store";
// Types only — agent harness is dynamically imported when a turn actually runs
// so opening QxAI sessions/providers does not parse the full tool graph.
import type { AgentStep, QxAiFileAttachment } from "./agent/types";
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
  saveQxAiSessions,
} from "./sessions";
import {
  completeQxAiRun,
  dismissQxAiRun,
  failQxAiRun,
  showQxAiRun,
} from "./run-island";

export type { AgentStep, QxAiFileAttachment } from "./agent/types";

export interface G4fMessage {
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  steps?: AgentStep[];
  attachments?: QxAiFileAttachment[];
  skill?: Pick<QxAiSkillDocument, "id" | "name">;
  /** Estimated completion tokens (chars/4) for Jan-style speed display. */
  tokenCount?: number;
  /** Tokens per second for the completion stream. */
  tokenSpeed?: number;
  durationMs?: number;
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
}

/** Active decode window: ignore multi-second pauses (tools / TTFT gaps). */
const GENERATION_GAP_MS = 1500;

function nextGenerationTiming(
  run: Pick<QxAiConversationRun, "firstTokenAt" | "lastDeltaAt" | "generationMs">,
  now: number,
  hasText: boolean,
): Pick<QxAiConversationRun, "firstTokenAt" | "lastDeltaAt" | "generationMs"> {
  if (!hasText && run.firstTokenAt == null) {
    return {
      firstTokenAt: run.firstTokenAt,
      lastDeltaAt: run.lastDeltaAt,
      generationMs: run.generationMs,
    };
  }
  const firstTokenAt = run.firstTokenAt ?? now;
  let generationMs = run.generationMs ?? 0;
  if (run.lastDeltaAt != null) {
    const gap = now - run.lastDeltaAt;
    if (gap > 0 && gap <= GENERATION_GAP_MS) generationMs += gap;
  }
  return { firstTokenAt, lastDeltaAt: now, generationMs };
}

function speedFromTiming(tokenCount: number, generationMs?: number, firstTokenAt?: number, now = Date.now()): number {
  const activeMs =
    generationMs && generationMs > 0
      ? generationMs
      : firstTokenAt
        ? Math.max(1, now - firstTokenAt)
        : 0;
  if (tokenCount <= 0 || activeMs <= 0) return 0;
  return Math.round(computeTokenSpeed(tokenCount, activeMs) * 100) / 100;
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
  onChunk: (full: string) => void;
  onReasoning: (full: string) => void;
  reasoning: boolean;
}

async function streamChatEvents({
  requestId,
  provider,
  model,
  messages,
  onChunk,
  onReasoning,
  reasoning,
}: StreamChatEventsArgs): Promise<string> {
  let responseText = "";
  let reasoningText = "";
  let unlisten: (() => void) | undefined;
  let settled = false;
  let timer: number | undefined;

  const stop = () => {
    if (settled) return false;
    settled = true;
    if (timer !== undefined) window.clearTimeout(timer);
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
        if (stop()) resolve(responseText || event.payload.chunk);
        return;
      }
      if (event.payload.kind === "reasoning") {
        reasoningText += event.payload.chunk;
        onReasoning(reasoningText);
      } else {
        responseText += event.payload.chunk;
        onChunk(responseText);
      }
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
    try {
      const stored = await loadQxAiSessions();
      const current = get().conversations;
      const conversations = [
        ...stored,
        ...current.filter((conversation) =>
          !stored.some((saved) => saved.id === conversation.id)),
      ];
      // Open workbench on the last used conversation (or newest by createdAt).
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
      });
    } catch (error) {
      set({ sessionsLoaded: true, error: String(error) });
    }
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
    void deleteQxAiSessionFiles(id);
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
              return !run?.streaming ? state : {
                runs: {
                  ...state.runs,
                  [currentConversationId]: {
                    ...run,
                    streamingSteps: [...run.streamingSteps, step],
                  },
                },
              };
            }),
          onStepUpdate: (id, patch) =>
            set((state) => {
              const run = state.runs[currentConversationId];
              return !run?.streaming ? state : {
                runs: {
                  ...state.runs,
                  [currentConversationId]: {
                    ...run,
                    streamingSteps: run.streamingSteps.map((step) =>
                      step.id === id ? { ...step, ...patch } : step,
                    ),
                  },
                },
              };
            }),
          onAssistantStream: (text) =>
            set((state) => {
              const run = state.runs[currentConversationId];
              if (!run?.streaming) return state;
              const now = Date.now();
              const timing = nextGenerationTiming(run, now, Boolean(text.trim()));
              const liveTokenCount = estimateTokens(text);
              return {
                runs: {
                  ...state.runs,
                  [currentConversationId]: {
                    ...run,
                    streamedContent: text,
                    ...timing,
                    liveTokenCount,
                    liveTokenSpeed: speedFromTiming(
                      liveTokenCount,
                      timing.generationMs,
                      timing.firstTokenAt,
                      now,
                    ),
                  },
                },
              };
            }),
          onReasoningStream: (text) =>
            set((state) => {
              const run = state.runs[currentConversationId];
              if (!run?.streaming) return state;
              const now = Date.now();
              // Reasoning starts the clock; TPS still uses completion text only.
              const timing = nextGenerationTiming(
                run,
                now,
                Boolean(text.trim() || run.streamedContent),
              );
              const liveTokenCount = estimateTokens(run.streamedContent || "");
              return {
                runs: {
                  ...state.runs,
                  [currentConversationId]: {
                    ...run,
                    streamedReasoning: text,
                    ...timing,
                    liveTokenCount,
                    liveTokenSpeed: speedFromTiming(
                      liveTokenCount,
                      timing.generationMs,
                      timing.firstTokenAt,
                      now,
                    ),
                  },
                },
              };
            }),
        });

        const finishedRun = get().runs[currentConversationId];
        const tokenCount = estimateTokens(result.finalAnswer);
        const durationMs = Math.max(
          1,
          finishedRun?.generationMs
            && finishedRun.generationMs > 0
            ? finishedRun.generationMs
            : Date.now() - (finishedRun?.firstTokenAt ?? finishedRun?.startedAt ?? Date.now()),
        );
        const assistantMessage: G4fMessage = {
          role: "assistant",
          content: result.finalAnswer,
          reasoning: result.reasoning,
          steps: result.steps,
          attachments: result.attachments,
          tokenCount,
          tokenSpeed: speedFromTiming(tokenCount, finishedRun?.generationMs, finishedRun?.firstTokenAt),
          durationMs,
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
      const response = await streamChatEvents({
        requestId,
        provider: selection.provider,
        model: selection.model,
        messages: requestMessages,
        reasoning: Boolean(titledConv.reasoningEnabled),
        onChunk: (full) =>
          set((state) => {
            const run = state.runs[currentConversationId];
            if (!run?.streaming) return state;
            const now = Date.now();
            const timing = nextGenerationTiming(run, now, Boolean(full.trim()));
            const liveTokenCount = estimateTokens(full);
            return {
              runs: {
                ...state.runs,
                [currentConversationId]: {
                  ...run,
                  streamedContent: full,
                  ...timing,
                  liveTokenCount,
                  liveTokenSpeed: speedFromTiming(
                    liveTokenCount,
                    timing.generationMs,
                    timing.firstTokenAt,
                    now,
                  ),
                },
              },
            };
          }),
        onReasoning: (full) =>
          set((state) => {
            const run = state.runs[currentConversationId];
            if (!run?.streaming) return state;
            const now = Date.now();
            const timing = nextGenerationTiming(
              run,
              now,
              Boolean(full.trim() || run.streamedContent),
            );
            const liveTokenCount = estimateTokens(run.streamedContent || "");
            return {
              runs: {
                ...state.runs,
                [currentConversationId]: {
                  ...run,
                  streamedReasoning: full,
                  ...timing,
                  liveTokenCount,
                  liveTokenSpeed: speedFromTiming(
                    liveTokenCount,
                    timing.generationMs,
                    timing.firstTokenAt,
                    now,
                  ),
                },
              },
            };
          }),
      });

      const finishedRun = get().runs[currentConversationId];
      const tokenCount = estimateTokens(response);
      const durationMs = Math.max(
        1,
        finishedRun?.generationMs && finishedRun.generationMs > 0
          ? finishedRun.generationMs
          : Date.now() - (finishedRun?.firstTokenAt ?? finishedRun?.startedAt ?? Date.now()),
      );
      const assistantMessage: G4fMessage = {
        role: "assistant",
        content: response,
        tokenCount,
        tokenSpeed: speedFromTiming(tokenCount, finishedRun?.generationMs, finishedRun?.firstTokenAt),
        durationMs,
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
    void deleteQxAiSessionFiles(currentConversationId);
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
let pendingPersistence: G4fConversation[] | null = null;
let persistTimer: number | undefined;
let persistenceRunning = false;

async function flushQxAiPersistence(): Promise<void> {
  if (persistenceRunning) return;
  persistenceRunning = true;
  try {
    while (pendingPersistence) {
      const conversations = pendingPersistence;
      pendingPersistence = null;
      await saveQxAiSessions(conversations);
    }
  } finally {
    persistenceRunning = false;
  }
}

useG4fStore.subscribe((state) => {
  if (!state.sessionsLoaded || state.conversations === persistedConversations) return;
  persistedConversations = state.conversations;
  pendingPersistence = state.conversations;
  if (persistTimer !== undefined) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    void flushQxAiPersistence().catch((error) => {
      useG4fStore.setState({ error: String(error) });
    });
  }, 180);
});
