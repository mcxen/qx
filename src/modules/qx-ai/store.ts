import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "../settings/store";
import {
  type AgentStep,
  getEnabledTools,
  runFunctionCallingAgent,
} from "./react-agent";

export type { AgentStep } from "./react-agent";

export interface G4fMessage {
  role: "user" | "assistant" | "system";
  content: string;
  steps?: AgentStep[];
}

export interface G4fConversation {
  id: string;
  name: string;
  createdAt: number;
  messages: G4fMessage[];
  provider: string;
  model: string;
}

export interface G4fProvider {
  id: string;
  name: string;
  models: { id: string; name: string }[];
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
  chunk: string;
  done: boolean;
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
  streaming: boolean;
  streamingConversationId: string | null;
  streamedContent: string;
  streamingSteps: AgentStep[];
  error: string | null;
  view: G4fView;
  defaultSystemPrompt: string;
  currentProvider: string;
  currentModel: string;

  setView: (v: G4fView) => void;
  setCurrentProvider: (p: string) => void;
  setCurrentModel: (m: string) => void;
  setDefaultSystemPrompt: (p: string) => void;
  setStreamedContent: (c: string) => void;

  /** Combined list of built-in + custom providers for UI selection. */
  providers: G4fProvider[];

  createConversation: (provider?: string, model?: string) => string;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, name: string) => void;
  selectConversation: (id: string) => void;
  setConversationModel: (id: string, provider: string, model: string) => void;

  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;

  loadProviders: () => Promise<void>;
  saveBuiltInProviderKey: (id: string, apiKey: string) => Promise<void>;
  getCurrentConversation: () => G4fConversation | undefined;

  // BYOK
  addCustomProvider: (p: Omit<CustomProvider, "id">) => Promise<void>;
  removeCustomProvider: (id: string) => Promise<void>;
  updateCustomProvider: (id: string, p: Partial<CustomProvider>) => Promise<void>;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
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

const STREAM_TIMEOUT_MS = 180_000;

interface StreamChatEventsArgs {
  requestId: string;
  provider: string;
  model: string;
  messages: G4fMessage[];
  onChunk: (full: string) => void;
}

async function streamChatEvents({
  requestId,
  provider,
  model,
  messages,
  onChunk,
}: StreamChatEventsArgs): Promise<string> {
  let responseText = "";
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

    listen<StreamEvent>("qxai://stream", (event) => {
      if (event.payload.requestId !== requestId) return;
      if (event.payload.error) {
        if (stop()) reject(new Error(event.payload.error));
        return;
      }
      if (event.payload.done) {
        if (stop()) resolve(responseText || event.payload.chunk);
        return;
      }
      responseText += event.payload.chunk;
      onChunk(responseText);
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
  streaming: false,
  streamingConversationId: null,
  streamedContent: "",
  streamingSteps: [],
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
  setStreamedContent: (streamedContent) => set({ streamedContent }),

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
    });
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
          ? { ...c, provider: selection.provider, model: selection.model }
          : c,
      ),
      currentProvider: selection.provider,
      currentModel: selection.model,
      error: null,
    }));
  },

  sendMessage: async (content) => {
    const {
      currentConversationId,
      conversations,
      customProviders,
      providers,
      currentProvider,
      currentModel,
      defaultSystemPrompt,
    } = get();
    if (!currentConversationId) return;

    const conv = conversations.find((c) => c.id === currentConversationId);
    if (!conv) return;

    const selection = resolveProviderModel(
      providers,
      conv.provider || currentProvider,
      conv.model || currentModel,
    );

    if (!selection.provider) {
      set({ error: "No AI provider available. Open QxAI Settings first." });
      return;
    }

    if (!selection.model) {
      set({ error: `No model available for provider "${selection.provider}".` });
      return;
    }

    const updatedConv: G4fConversation = {
      ...conv,
      provider: selection.provider,
      model: selection.model,
      messages: [...conv.messages, { role: "user", content }],
    };
    const titledConv = withAutoTitle(updatedConv);

    set({
      conversations: conversations.map((c) =>
        c.id === currentConversationId ? titledConv : c,
      ),
      streaming: true,
      streamingConversationId: currentConversationId,
      streamedContent: "",
      streamingSteps: [],
      error: null,
    });

    if (!isTauriRuntime()) {
      set({
        streaming: false,
        streamingConversationId: null,
        streamedContent: "",
        streamingSteps: [],
      });
      return;
    }

    const agentSettings = useSettingsStore.getState().settings.agent;
    const enabledTools = getEnabledTools(agentSettings);
    const useAgent = enabledTools.length > 0;

    try {
      if (selection.provider.startsWith("custom:")) {
        const cp = customProviders.find((p) => p.id === selection.provider);
        if (!cp) throw new Error(`Custom provider "${selection.provider}" not found`);
      }

      if (useAgent) {
        const basePrompt =
          titledConv.messages.find((m) => m.role === "system")?.content?.trim() ||
          defaultSystemPrompt;
        const nonSystem = titledConv.messages.filter((m) => m.role !== "system");

        const runAgent = runFunctionCallingAgent;

        const result = await runAgent({
          messages: nonSystem,
          provider: selection.provider,
          model: selection.model,
          basePrompt,
          agentSettings,
          onStep: (step) =>
            set((s) =>
              s.streamingConversationId === currentConversationId
                ? { streamingSteps: [...s.streamingSteps, step] }
                : s,
            ),
          onStepUpdate: (id, patch) =>
            set((s) =>
              s.streamingConversationId === currentConversationId
                ? {
                    streamingSteps: s.streamingSteps.map((step) =>
                      step.id === id ? { ...step, ...patch } : step,
                    ),
                  }
                : s,
            ),
          onAssistantStream: (text) =>
            set((s) =>
              s.streamingConversationId === currentConversationId
                ? { streamedContent: text }
                : s,
            ),
        });

        const assistantMessage: G4fMessage = {
          role: "assistant",
          content: result.finalAnswer,
          steps: result.steps,
        };

        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === currentConversationId
              ? { ...c, messages: [...c.messages, assistantMessage] }
              : c,
          ),
          streaming: false,
          streamingConversationId: null,
          streamedContent: "",
          streamingSteps: [],
        }));
        return;
      }

      const requestId = generateStreamRequestId();
      const response = await streamChatEvents({
        requestId,
        provider: selection.provider,
        model: selection.model,
        messages: titledConv.messages,
        onChunk: (full) =>
          set((s) =>
            s.streamingConversationId === currentConversationId
              ? { streamedContent: full }
              : s,
          ),
      });

      const assistantMessage: G4fMessage = {
        role: "assistant",
        content: response,
      };

      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === currentConversationId
            ? { ...c, messages: [...c.messages, assistantMessage] }
            : c,
        ),
        streaming: false,
        streamingConversationId: null,
        streamedContent: "",
        streamingSteps: [],
      }));
    } catch (e) {
      set((s) => ({
        streaming: false,
        streamingConversationId: null,
        streamedContent: "",
        streamingSteps: [],
        error: s.currentConversationId === currentConversationId ? String(e) : s.error,
      }));
    }
  },

  clearMessages: () => {
    const { currentConversationId, conversations } = get();
    if (!currentConversationId) return;
    set({
      conversations: conversations.map((c) =>
        c.id === currentConversationId ? { ...c, messages: [] } : c,
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
