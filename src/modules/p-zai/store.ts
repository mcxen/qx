import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../settings/store";
import {
  getEnabledTools,
  loadMemorySnapshot,
  runFunctionCallingAgent,
  runReactAgent,
  type AgentStep,
} from "../qx-ai/react-agent";

export type PzaiDisplayMode = "original" | "summary" | "draft" | "split";

export interface PzaiFeed {
  id: number;
  title: string;
  url: string;
  unread_count: number;
}

export interface PzaiArticle {
  id: number;
  feed_id: number;
  title: string;
  summary: string;
  content: string;
  author: string;
  link: string;
  image_url: string;
  is_read: boolean;
  is_starred: boolean;
  published_at: number;
}

export interface PzaiWorkbench {
  articleId: number | null;
  feedId: number | null;
  title: string;
  link: string;
  author: string;
  originalHtml: string;
  originalText: string;
  /** AI or user written summary shown in workbench */
  summary: string;
  /** Editable article body (Markdown/plain) for rewrite/polish */
  draft: string;
  notes: string;
  displayMode: PzaiDisplayMode;
  tags: string[];
  updatedAt: number;
}

interface PzaiRun {
  streaming: boolean;
  streamedContent: string;
  steps: AgentStep[];
  error: string | null;
}

interface PzaiStore {
  feeds: PzaiFeed[];
  articles: PzaiArticle[];
  selectedFeedId: number | null;
  selectedArticleId: number | null;
  onlyUnread: boolean;
  query: string;
  loading: boolean;
  error: string | null;
  workbench: PzaiWorkbench;
  instruction: string;
  run: PzaiRun;
  loadFeeds: () => Promise<void>;
  loadArticles: (feedId?: number | null) => Promise<void>;
  selectFeed: (id: number | null) => Promise<void>;
  openArticle: (id: number) => Promise<void>;
  setQuery: (q: string) => void;
  setOnlyUnread: (v: boolean) => void;
  setDisplayMode: (mode: PzaiDisplayMode) => void;
  setSummary: (summary: string) => void;
  setDraft: (draft: string) => void;
  setNotes: (notes: string) => void;
  setTags: (tags: string[]) => void;
  setInstruction: (text: string) => void;
  patchWorkbench: (patch: Partial<PzaiWorkbench>) => void;
  markRead: (id: number, isRead?: boolean) => Promise<void>;
  saveDraftToDocs: () => Promise<string>;
  runPzai: (instruction?: string) => Promise<void>;
  getWorkbenchSnapshot: () => PzaiWorkbench;
}

const emptyWorkbench = (): PzaiWorkbench => ({
  articleId: null,
  feedId: null,
  title: "",
  link: "",
  author: "",
  originalHtml: "",
  originalText: "",
  summary: "",
  draft: "",
  notes: "",
  displayMode: "original",
  tags: [],
  updatedAt: Date.now(),
});

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const P_ZAI_SYSTEM = `你是 P仔（Pzai），Qx 里的阅读搭子智能体。
你继承 QxAI Agent 能力，专注 RSS 文章阅读与改写。

职责：
1. 读取当前 Workbench 中的文章（original / summary / draft）
2. 用工具拉 RSS 列表、文章正文、刷新订阅
3. 用 pzai_* 工具改 Workbench 展示：摘要、草稿、显示模式、笔记、标签
4. 不要编造未获取的正文；先 open 文章或 rss_get_article
5. 用户要改文章时更新 draft；要速览时更新 summary 并切到 summary 模式
6. 回答简洁，中文优先（用户用中文时）

显示模式：original | summary | draft | split
`;

export const usePzaiStore = create<PzaiStore>((set, get) => ({
  feeds: [],
  articles: [],
  selectedFeedId: null,
  selectedArticleId: null,
  onlyUnread: false,
  query: "",
  loading: false,
  error: null,
  workbench: emptyWorkbench(),
  instruction: "",
  run: { streaming: false, streamedContent: "", steps: [], error: null },

  getWorkbenchSnapshot: () => get().workbench,

  patchWorkbench: (patch) =>
    set((state) => ({
      workbench: { ...state.workbench, ...patch, updatedAt: Date.now() },
    })),

  setQuery: (query) => set({ query }),
  setOnlyUnread: (onlyUnread) => set({ onlyUnread }),
  setDisplayMode: (displayMode) => get().patchWorkbench({ displayMode }),
  setSummary: (summary) => get().patchWorkbench({ summary }),
  setDraft: (draft) => get().patchWorkbench({ draft }),
  setNotes: (notes) => get().patchWorkbench({ notes }),
  setTags: (tags) => get().patchWorkbench({ tags }),
  setInstruction: (instruction) => set({ instruction }),

  loadFeeds: async () => {
    set({ loading: true, error: null });
    try {
      const feeds = await invoke<PzaiFeed[]>("rss_list_feeds");
      set({ feeds, loading: false });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  loadArticles: async (feedId) => {
    const state = get();
    const id = feedId === undefined ? state.selectedFeedId : feedId;
    set({ loading: true, error: null });
    try {
      const articles = await invoke<PzaiArticle[]>("rss_list_articles", {
        feedId: id,
        onlyUnread: state.onlyUnread,
        query: state.query.trim() || null,
      });
      set({ articles, loading: false });
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  selectFeed: async (id) => {
    set({ selectedFeedId: id, selectedArticleId: null });
    await get().loadArticles(id);
  },

  openArticle: async (id) => {
    set({ loading: true, error: null, selectedArticleId: id });
    try {
      const article = await invoke<PzaiArticle | null>("rss_get_article", { id });
      if (!article) {
        set({ loading: false, error: `Article ${id} not found` });
        return;
      }
      const html = article.content || article.summary || "";
      const text = stripHtml(html) || article.title;
      set({
        loading: false,
        selectedArticleId: article.id,
        selectedFeedId: article.feed_id,
        workbench: {
          articleId: article.id,
          feedId: article.feed_id,
          title: article.title,
          link: article.link,
          author: article.author || "",
          originalHtml: html,
          originalText: text,
          summary: article.summary ? stripHtml(article.summary) : "",
          draft: text,
          notes: "",
          displayMode: "original",
          tags: [],
          updatedAt: Date.now(),
        },
      });
      if (!article.is_read) {
        void get().markRead(article.id, true);
      }
    } catch (error) {
      set({ loading: false, error: String(error) });
    }
  },

  markRead: async (id, isRead = true) => {
    await invoke("rss_mark_read", { id, isRead });
    set((state) => ({
      articles: state.articles.map((item) =>
        item.id === id ? { ...item, is_read: isRead } : item,
      ),
    }));
  },

  saveDraftToDocs: async () => {
    const wb = get().workbench;
    if (!wb.articleId) throw new Error("No article open");
    const safe = (wb.title || "article")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .slice(0, 48);
    const name = `p-zai-${wb.articleId}-${safe}.md`;
    const body = [
      `# ${wb.title}`,
      "",
      wb.link ? `来源: ${wb.link}` : "",
      wb.author ? `作者: ${wb.author}` : "",
      "",
      "## 摘要",
      wb.summary || "（无）",
      "",
      "## 草稿 / 改写",
      wb.draft || "（无）",
      "",
      "## 笔记",
      wb.notes || "（无）",
      "",
    ]
      .filter((line) => line !== undefined)
      .join("\n");
    await invoke("docs_write_file", { name, content: body });
    return name;
  },

  runPzai: async (instruction) => {
    const text = (instruction ?? get().instruction).trim();
    if (!text) return;
    const fullSettings = useSettingsStore.getState().settings;
    const agentSettings = fullSettings.agent;
    if (!agentSettings.agent_mode_enabled) {
      set({
        run: {
          streaming: false,
          streamedContent: "",
          steps: [],
          error: "Enable Agent mode in Settings → AI Agent.",
        },
      });
      return;
    }

    set({
      instruction: "",
      run: { streaming: true, streamedContent: "", steps: [], error: null },
    });

    try {
      await useSettingsStore.getState().flush();
      const providers = await invoke<
        Array<{ id: string; models: Array<{ id: string }> }>
      >("qxai_list_providers");
      const provider =
        agentSettings.default_provider
        || providers[0]?.id
        || "";
      const providerModels =
        providers.find((item) => item.id === provider)?.models ?? providers[0]?.models ?? [];
      const model =
        agentSettings.default_model
        || providerModels[0]?.id
        || "";
      if (!provider || !model) {
        throw new Error("Configure a default provider/model in Settings → AI Agent.");
      }

      const wb = get().workbench;
      const contextBlock = wb.articleId
        ? [
            `Current workbench article #${wb.articleId}: ${wb.title}`,
            `link: ${wb.link}`,
            `displayMode: ${wb.displayMode}`,
            `summary(${wb.summary.length} chars): ${wb.summary.slice(0, 1200)}`,
            `draft(${wb.draft.length} chars): ${wb.draft.slice(0, 2000)}`,
            `notes: ${wb.notes.slice(0, 500)}`,
            `original excerpt: ${wb.originalText.slice(0, 2500)}`,
          ].join("\n")
        : "No article open in workbench yet. List feeds/articles then open one.";

      const memorySnapshot = agentSettings.memory_tool_enabled
        ? await loadMemorySnapshot()
        : "";

      const runAgent = agentSettings.model_tools_enabled
        ? runFunctionCallingAgent
        : runReactAgent;

      // Ensure module-gated tools see rss + p-zai + documents as needed.
      const enabled = getEnabledTools(agentSettings, fullSettings);
      if (enabled.length === 0) {
        throw new Error("No agent tools enabled. Turn on Agent tools in Settings → AI Agent.");
      }

      const result = await runAgent({
        messages: [
          {
            role: "user",
            content: `${contextBlock}\n\nUser request:\n${text}`,
          },
        ],
        provider,
        model,
        basePrompt: P_ZAI_SYSTEM,
        agentSettings,
        memorySnapshot,
        reasoning: false,
        onStep: (step) =>
          set((state) => ({
            run: {
              ...state.run,
              steps: [...state.run.steps, step],
            },
          })),
        onStepUpdate: (id, patch) =>
          set((state) => ({
            run: {
              ...state.run,
              steps: state.run.steps.map((step) =>
                step.id === id ? { ...step, ...patch } : step,
              ),
            },
          })),
        onAssistantStream: (streamedContent) =>
          set((state) => ({
            run: { ...state.run, streamedContent },
          })),
        onReasoningStream: () => {},
      });

      set({
        run: {
          streaming: false,
          streamedContent: result.finalAnswer,
          steps: result.steps,
          error: null,
        },
      });
    } catch (error) {
      set({
        run: {
          streaming: false,
          streamedContent: "",
          steps: get().run.steps,
          error: String(error),
        },
      });
    }
  },
}));
