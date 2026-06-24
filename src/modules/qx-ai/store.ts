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

export type G4fView = "list" | "chat" | "settings";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

interface G4fStore {
  conversations: G4fConversation[];
  currentConversationId: string | null;
  providers: G4fProvider[];
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

  createConversation: (provider?: string, model?: string) => string;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, name: string) => void;
  selectConversation: (id: string) => void;

  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;

  loadProviders: () => Promise<void>;
  getCurrentConversation: () => G4fConversation | undefined;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export const useG4fStore = create<G4fStore>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  providers: [],
  loading: false,
  streaming: false,
  streamedContent: "",
  error: null,
  view: "list",
  defaultSystemPrompt: "You are a helpful AI assistant.",
  currentProvider: "",
  currentModel: "",

  setView: (view) => set({ view }),
  setCurrentProvider: (currentProvider) => set({ currentProvider }),
  setCurrentModel: (currentModel) => set({ currentModel }),
  setDefaultSystemPrompt: (defaultSystemPrompt) => set({ defaultSystemPrompt }),
  setStreamedContent: (streamedContent) => set({ streamedContent }),

  createConversation: (provider, model) => {
    const {
      currentProvider,
      currentModel,
      conversations,
      defaultSystemPrompt,
    } = get();
    const id = generateId();
    const conv: G4fConversation = {
      id,
      name: `Chat ${conversations.length + 1}`,
      createdAt: Date.now(),
      messages: defaultSystemPrompt
        ? [{ role: "system", content: defaultSystemPrompt }]
        : [],
      provider: provider ?? currentProvider,
      model: model ?? currentModel,
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

  sendMessage: async (content) => {
    const { currentConversationId, conversations } = get();
    if (!currentConversationId) return;

    const conv = conversations.find((c) => c.id === currentConversationId);
    if (!conv) return;

    const updatedConv: G4fConversation = {
      ...conv,
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
      set({
        streaming: false,
        streamedContent: "",
      });
      return;
    }

    try {
      const response = await invoke<string>("g4f_chat", {
        provider: conv.provider,
        model: conv.model || null,
        messages: updatedConv.messages,
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
        streamedContent: response,
      }));
    } catch (e) {
      set({
        streaming: false,
        error: String(e),
      });
    }
  },

  clearMessages: () => {
    const { currentConversationId, conversations } = get();
    if (!currentConversationId) return;
    set({
      conversations: conversations.map((c) =>
        c.id === currentConversationId
          ? { ...c, messages: [] }
          : c,
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
      const providers = await invoke<G4fProvider[]>("g4f_list_providers");
      set({ providers, loading: false });
      if (providers.length > 0 && !get().currentProvider) {
        set({
          currentProvider: providers[0].id,
          currentModel: providers[0].models[0]?.id ?? "",
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
}));
