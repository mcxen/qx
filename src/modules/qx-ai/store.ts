import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface G4fMessage {
  role: "user" | "assistant" | "system";
  content: string;
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
}

export interface CustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: { id: string; name: string }[];
}

export type G4fView = "list" | "chat" | "settings";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function makeCustomProviderId(): string {
  return "custom:" + generateId();
}

interface G4fStore {
  conversations: G4fConversation[];
  currentConversationId: string | null;
  builtInProviders: G4fProvider[];
  customProviders: CustomProvider[];
  loading: boolean;
  streaming: boolean;
  streamedContent: string;
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

export const useG4fStore = create<G4fStore>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  builtInProviders: [],
  customProviders: [],
  loading: false,
  streaming: false,
  streamedContent: "",
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

    set({
      conversations: conversations.map((c) =>
        c.id === currentConversationId ? updatedConv : c,
      ),
      streaming: true,
      streamedContent: "",
      error: null,
    });

    if (!isTauriRuntime()) {
      set({ streaming: false, streamedContent: "" });
      return;
    }

    try {
      let response: string;

      if (selection.provider.startsWith("custom:")) {
        // BYOK provider
        const cp = customProviders.find((p) => p.id === selection.provider);
        if (!cp) throw new Error(`Custom provider "${selection.provider}" not found`);
        response = await invoke<string>("g4f_chat_custom", {
          baseUrl: cp.baseUrl,
          apiKey: cp.apiKey,
          model: selection.model,
          messages: updatedConv.messages,
        });
      } else {
        response = await invoke<string>("g4f_chat", {
          provider: selection.provider,
          model: selection.model,
          messages: updatedConv.messages,
        });
      }

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
        streamedContent: response,
      }));
    } catch (e) {
      set({ streaming: false, error: String(e) });
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
      const providers = await invoke<G4fProvider[]>("qxai_list_providers");
      const customProviders = await invoke<CustomProvider[]>(
        "qxai_get_custom_providers",
      );
      const builtInProviders = providers.filter((provider) => !provider.id.startsWith("custom:"));
      const customProvidersWithModels = customProviders.map((provider) => {
        const catalogProvider = providers.find((item) => item.id === provider.id);
        return catalogProvider
          ? { ...provider, models: catalogProvider.models }
          : provider;
      });
      set({
        builtInProviders,
        customProviders: customProvidersWithModels,
        providers,
        loading: false,
      });
      const { currentProvider, currentModel } = get();
      const selection = resolveProviderModel(providers, currentProvider, currentModel);
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
