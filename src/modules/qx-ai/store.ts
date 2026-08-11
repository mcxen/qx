import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "../settings/store";
import {
  type AgentStep,
  type QxAiFileAttachment,
  buildQxHostSystemPrompt,
  getEnabledTools,
  runFunctionCallingAgent,
  runReactAgent,
} from "./react-agent";
import type { QxAiSkillDocument } from "./skills";
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

export type { AgentStep } from "./react-agent";

export interface G4fMessage {
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  steps?: AgentStep[];
  attachments?: QxAiFileAttachment[];
  skill?: Pick<QxAiSkillDocument, "id" | "name">;
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
  startedAt: number;
}

export interface G4fConversation {
  id: string;
  name: string;
  createdAt: number;
  messages: G4fMessage[];
  provider: string;
  model: string;
  reasoningEnabled?: boolean;
}

export interface G4fProvider {
  id: string;
  name: string;
  models: { id: string; name: string; reasoning?: boolean }[];
  baseUrl?: string;
  requiresApiKey?: boolean;
}

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: { id: string; name: string }[];
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

export type G4fView = "list" | "chat" | "settings";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function isDefaultConversationName(name: string): boolean {
  return /^Chat \d+$/.test(name);
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

function compactConversationTitle(messages: G4fMessage[]): string | null {
  const userMessages = messages.filter((message) => message.role === "user");
  const paragraphs = userMessages.flatMap((message) => normalizeTitleSource(message.content));

  if (userMessages.length < 2 && paragraphs.length < 2) return null;

  const source = paragraphs.slice(0, 2).join(" ");
  if (!source) return null;

  const maxLength = 32;
  const title = source.length > maxLength ? `${source.slice(0, maxLength - 1).trimEnd()}...` : source;
  return title || null;
}

function withAutoTitle(conversation: G4fConversation): G4fConversation {
  if (!isDefaultConversationName(conversation.name)) return conversation;
  const title = compactConversationTitle(conversation.messages);
  return title ? { ...conversation, name: title } : conversation;
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

  createConversation: (provider?: string, model?: string) => string;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, name: string) => void;
  selectConversation: (id: string) => void;
  setConversationModel: (id: string, provider: string, model: string) => void;
  setConversationReasoning: (id: string, enabled: boolean) => void;
  loadSessions: () => Promise<void>;

  sendMessage: (content: string, skill?: QxAiSkillDocument, conversationId?: string, attachments?: QxAiFileAttachment[]) => Promise<void>;
  runNextQueuedMessage: (conversationId: string) => void;
  removeQueuedMessage: (id: string) => void;
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

  const selectedProvider =
    providers.find((p) => p.id === provider) ?? providers[0];
  const selectedModel =
    selectedProvider.models.find((m) => m.id === model) ??
    selectedProvider.models[0];

  return {
    provider: selectedProvider.id,
    model: selectedModel?.id ?? "",
  };
}

function generateStreamRequestId(): string {
  return "qxai-stream-" + generateId();
}

function withSelectedSkill(basePrompt: string, skill?: QxAiSkillDocument): string {
  if (!skill) return basePrompt;
  return `${basePrompt.trim()}\n\nSelected Qx Skill: ${skill.name} (${skill.id})\nFollow this skill for the current user request. Treat it as task instructions, while system safety and explicit user instructions remain higher priority.\n\n<qx-skill>\n${skill.content}\n</qx-skill>`;
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
  view: "list",
  defaultSystemPrompt: "You are a helpful AI assistant.",
  currentProvider: "",
  currentModel: "",

  // computed – kept in sync by actions
  providers: [],

  setView: (view) => set({ view }),
  setCurrentProvider: (currentProvider) => {
    const { providers, currentModel } = get();
    const next = resolveProviderModel(providers, currentProvider, currentModel);
    set({ currentProvider: next.provider, currentModel: next.model });
  },
  setCurrentModel: (currentModel) => set({ currentModel }),
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
      set({ conversations, sessionsLoaded: true });
    } catch (error) {
      set({ sessionsLoaded: true, error: String(error) });
    }
  },

  createConversation: (provider, model) => {
    const { currentProvider, currentModel, conversations, defaultSystemPrompt, providers } =
      get();
    const selection = resolveProviderModel(
      providers,
      provider ?? currentProvider,
      model ?? currentModel,
    );
    const id = generateId();
    const conv: G4fConversation = {
      id,
      name: `Chat ${conversations.length + 1}`,
      createdAt: Date.now(),
      messages: defaultSystemPrompt
        ? [{ role: "system", content: defaultSystemPrompt }]
        : [],
      provider: selection.provider,
      model: selection.model,
      reasoningEnabled: providers
        .find((item) => item.id === selection.provider)
        ?.models.find((item) => item.id === selection.model)?.reasoning ?? false,
    };
    set({
      conversations: [...conversations, conv],
      currentConversationId: id,
      view: "chat",
    });
    return id;
  },

  deleteConversation: (id) => {
    const { conversations, currentConversationId } = get();
    set({
      conversations: conversations.filter((c) => c.id !== id),
      currentConversationId:
        currentConversationId === id ? null : currentConversationId,
      messageQueue: get().messageQueue.filter((message) => message.conversationId !== id),
      runs: Object.fromEntries(Object.entries(get().runs).filter(([conversationId]) => conversationId !== id)),
    });
    dismissQxAiRun(id);
    void deleteQxAiSessionFiles(id);
  },

  renameConversation: (id, name) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === id ? { ...c, name } : c,
      ),
    }));
  },

  selectConversation: (id) => {
    set({ currentConversationId: id, view: "chat" });
  },

  setConversationModel: (id, provider, model) => {
    const { providers } = get();
    const selection = resolveProviderModel(providers, provider, model);
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
      currentProvider: selection.provider,
      currentModel: selection.model,
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

    if (!selection.provider) {
      set({ error: "No AI provider available. Open QxAI Settings first." });
      scheduleNext();
      return;
    }

    if (!selection.model) {
      set({ error: `No model available for provider "${selection.provider}".` });
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
        },
      },
      error: null,
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
      const agentSettings = useSettingsStore.getState().settings.agent;
      const enabledTools = getEnabledTools(agentSettings);
      const useAgent = enabledTools.length > 0;

      if (selection.provider.startsWith("custom:")) {
        const cp = customProviders.find((p) => p.id === selection.provider);
        if (!cp) throw new Error(`Custom provider "${selection.provider}" not found`);
      }

      if (useAgent) {
        const basePrompt = withSelectedSkill(
          titledConv.messages.find((m) => m.role === "system")?.content?.trim() ||
            defaultSystemPrompt,
          skill,
        );
        const nonSystem = titledConv.messages.filter((m) => m.role !== "system");

        // Native function calling is opt-in because many compatible models do
        // not accept tool schemas. The prompt-based ReAct transport remains the
        // portable path and still executes the same permissioned local tools.
        const runAgent = agentSettings.model_tools_enabled
          ? runFunctionCallingAgent
          : runReactAgent;

        const result = await runAgent({
          messages: nonSystem,
          provider: selection.provider,
          model: selection.model,
          basePrompt,
          agentSettings,
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
              return !run?.streaming ? state : {
                runs: {
                  ...state.runs,
                  [currentConversationId]: { ...run, streamedContent: text },
                },
              };
            }),
          onReasoningStream: (text) =>
            set((state) => {
              const run = state.runs[currentConversationId];
              return !run?.streaming ? state : {
                runs: {
                  ...state.runs,
                  [currentConversationId]: { ...run, streamedReasoning: text },
                },
              };
            }),
        });

        const assistantMessage: G4fMessage = {
          role: "assistant",
          content: result.finalAnswer,
          reasoning: result.reasoning,
          steps: result.steps,
          attachments: result.attachments,
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
        scheduleNext();
        return;
      }

      const requestId = generateStreamRequestId();
      const basePrompt = withSelectedSkill(
        titledConv.messages.find((message) => message.role === "system")?.content?.trim()
          || defaultSystemPrompt,
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
            return !run?.streaming ? state : {
              runs: {
                ...state.runs,
                [currentConversationId]: { ...run, streamedContent: full },
              },
            };
          }),
        onReasoning: (full) =>
          set((state) => {
            const run = state.runs[currentConversationId];
            return !run?.streaming ? state : {
              runs: {
                ...state.runs,
                [currentConversationId]: { ...run, streamedReasoning: full },
              },
            };
          }),
      });

      const assistantMessage: G4fMessage = {
        role: "assistant",
        content: response,
        reasoning: get().runs[currentConversationId]?.streamedReasoning || undefined,
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
      const { currentProvider, currentModel } = get();
      const selection = resolveProviderModel(combinedProviders, currentProvider, currentModel);
      if (selection.provider !== currentProvider || selection.model !== currentModel) {
        set({
          currentProvider: selection.provider,
          currentModel: selection.model,
        });
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
