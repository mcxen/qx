import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  FolderOpen,
  Hammer,
  ListPlus,
  Paperclip,
  Pencil,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import QxResizableSplit from "../../components/QxResizableSplit";
import { QxActionList } from "../../components/QxActionPanel";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Toggle,
} from "../../components/ui";
import { requestPanelKeyWindow } from "../../hooks/usePanelKeyWindow";
import { useQxListSelection } from "../../hooks/useQxListSelection";
import {
  qxMasterDetailIds,
  qxRegionProps,
  useQxMasterDetailFocus,
} from "../../hooks/useQxMasterDetail";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { useSettingsStore } from "../settings/store";
import { buildModelSelectOptions, openAgentSettingsTab } from "./AiProviderConfig";
import { AiMessageContent } from "./message-rendering";
import { QxAiMessageActions } from "./message-actions";
import { QxAiTokenCounter } from "./token-counter";
import QxAiConversationList from "./QxAiConversationList";
import {
  filterQxAiSkills,
  listQxAiSkills,
  openQxAiSkillsDirectory,
  readQxAiSkill,
  type QxAiSkillDocument,
  type QxAiSkillSummary,
} from "./skills";
import { useG4fStore } from "./store";
import { chooseAndImportQxAiAttachments } from "./sessions";
import type { QxAiFileAttachment } from "./agent/types";
import { resolveModelVision } from "./model-capabilities";
import { convertFileSrc } from "@tauri-apps/api/core";

const MASTER_DETAIL = qxMasterDetailIds("qx-ai");
const LIST_WIDTH_KEY = "qx-ai.workbench.listWidth";

export default function QxAiChat() {
  const t = useT();
  const setTab = useStore((state) => state.setTab);
  const {
    conversations,
    currentConversationId,
    runs,
    messageQueue,
    error,
    loading,
    providers,
    setView,
    sendMessage,
    removeQueuedMessage,
    updateQueuedMessage,
    editMessage,
    deleteMessage,
    regenerateMessage,
    clearMessages,
    deleteConversation,
    createConversation,
    selectConversation,
    setConversationModel,
    setConversationReasoning,
    loadProviders,
  } = useG4fStore();

  const [input, setInput] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [skills, setSkills] = useState<QxAiSkillSummary[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsFailed, setSkillsFailed] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<QxAiSkillDocument | null>(null);
  const [skillCursor, setSkillCursor] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<QxAiFileAttachment[]>([]);
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState("");
  const [toolsPopoverOpen, setToolsPopoverOpen] = useState(false);
  const [editingQueueId, setEditingQueueId] = useState<string | null>(null);
  const [editingQueueDraft, setEditingQueueDraft] = useState("");
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [editingMessageDraft, setEditingMessageDraft] = useState("");
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollFrameRef = useRef<number | undefined>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const agentSettings = useSettingsStore((state) => state.settings.agent);
  const { focusList, focusDetail } = useQxMasterDetailFocus(shellRef, MASTER_DETAIL);

  const filteredConversations = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    const sorted = [...conversations].sort((a, b) => b.createdAt - a.createdAt);
    if (!q) return sorted;
    return sorted.filter(
      (c) =>
        c.name.toLowerCase().includes(q)
        || c.provider.toLowerCase().includes(q)
        || c.model.toLowerCase().includes(q),
    );
  }, [conversations, listQuery]);

  const selectedIndex = useMemo(() => {
    if (!currentConversationId) return 0;
    const index = filteredConversations.findIndex((c) => c.id === currentConversationId);
    return index >= 0 ? index : 0;
  }, [currentConversationId, filteredConversations]);

  const setSelectedIndex = useCallback(
    (next: number | ((current: number) => number)) => {
      const resolved =
        typeof next === "function" ? next(selectedIndex) : next;
      if (filteredConversations.length === 0) return;
      const clamped = Math.max(0, Math.min(resolved, filteredConversations.length - 1));
      const target = filteredConversations[clamped];
      if (target) selectConversation(target.id);
    },
    [filteredConversations, selectConversation, selectedIndex],
  );

  const { getItemProps } = useQxListSelection({
    listRef,
    index: selectedIndex,
    listSignature: filteredConversations.map((c) => c.id).join("\0"),
  });

  const openSelectedConversation = useCallback(() => {
    const target = filteredConversations[selectedIndex];
    if (!target) return;
    selectConversation(target.id);
    focusDetail();
    requestAnimationFrame(() => composerRef.current?.focus());
  }, [filteredConversations, focusDetail, selectConversation, selectedIndex]);

  const conv = conversations.find((c) => c.id === currentConversationId);
  const run = conv ? runs[conv.id] : undefined;
  const isCurrentConversationStreaming = Boolean(run?.streaming);
  const streamedContent = run?.streamedContent ?? "";
  const streamedReasoning = run?.streamedReasoning ?? "";
  const streamingSteps = run?.streamingSteps ?? [];
  const currentError = run?.error ?? error;
  const settingsSnapshot = useSettingsStore((state) => state.settings);
  const [enabledTools, setEnabledTools] = useState<string[]>([]);
  // Tool catalogue is optional UI chrome — load async so chat shell paints first.
  useEffect(() => {
    let cancelled = false;
    void import("./agent")
      .then(({ getEnabledTools }) => {
        if (cancelled) return;
        setEnabledTools(getEnabledTools(agentSettings, settingsSnapshot).map((tool) => tool.name));
      })
      .catch(() => {
        if (!cancelled) setEnabledTools([]);
      });
    return () => {
      cancelled = true;
    };
  }, [agentSettings, settingsSnapshot]);
  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === conv?.provider),
    [providers, conv?.provider],
  );
  const activeModels = activeProvider?.models ?? [];
  const activeModel = activeModels.find((model) => model.id === conv?.model);
  const modelSupportsVision = resolveModelVision(
    conv?.provider ?? "",
    activeModel ?? (conv?.model ? { id: conv.model, name: conv.model } : undefined),
    agentSettings.model_capabilities,
  );
  // Allow a conversation model even when the catalog has not listed it yet
  // (custom endpoints / delayed fetch). Empty model still needs recovery.
  const canChat = Boolean(conv && activeProvider && conv.model.trim());
  const skillPickerOpen = input.startsWith("/");
  const skillMatches = useMemo(
    () => filterQxAiSkills(skills, skillPickerOpen ? input.slice(1) : "").slice(0, 12),
    [input, skillPickerOpen, skills],
  );
  const queuedMessages = useMemo(
    () => messageQueue.filter((message) => message.conversationId === conv?.id),
    [conv?.id, messageQueue],
  );

  const contextMaxTokens = useMemo(() => {
    const raw = activeModel?.context_length ?? activeModel?.contextLength;
    const n = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }, [activeModel]);

  const refreshSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillsFailed(false);
    try {
      setSkills(await listQxAiSkills());
    } catch {
      setSkills([]);
      setSkillsFailed(true);
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  const selectSkill = useCallback(async (skill: QxAiSkillSummary) => {
    try {
      setSelectedSkill(await readQxAiSkill(skill.id));
      setInput("");
      setSkillCursor(0);
      setSkillsFailed(false);
    } catch {
      setSkillsFailed(true);
    }
  }, []);

  const leave = useCallback(() => setTab("launcher"), [setTab]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if ((!trimmed && pendingAttachments.length === 0) || !canChat) return;
    setInput("");
    setSelectedSkill(null);
    setPendingAttachments([]);
    setAttachmentsError("");
    if (composerRef.current) {
      composerRef.current.style.height = "auto";
    }
    void sendMessage(
      trimmed || t("qxai.attachments.review", "Please review the attached files."),
      selectedSkill ?? undefined,
      undefined,
      pendingAttachments,
    );
  }, [canChat, input, pendingAttachments, selectedSkill, sendMessage, t]);

  const beginEditMessage = useCallback((messageIndex: number, content: string) => {
    setEditingMessageIndex(messageIndex);
    setEditingMessageDraft(content);
  }, []);

  const cancelEditMessage = useCallback(() => {
    setEditingMessageIndex(null);
    setEditingMessageDraft("");
  }, []);

  const saveEditMessage = useCallback(() => {
    if (!currentConversationId || editingMessageIndex === null) return;
    const next = editingMessageDraft.trim();
    if (!next) return;
    void editMessage(currentConversationId, editingMessageIndex, next);
    cancelEditMessage();
  }, [cancelEditMessage, currentConversationId, editMessage, editingMessageDraft, editingMessageIndex]);

  const copyMessage = useCallback(async (messageIndex: number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageIndex(messageIndex);
      window.setTimeout(() => {
        setCopiedMessageIndex((current) => current === messageIndex ? null : current);
      }, 1400);
    } catch {
      // Clipboard permissions are optional; keeping the message usable is more
      // important than surfacing a global error for a local action.
    }
  }, []);

  const removeMessage = useCallback((messageIndex: number) => {
    if (!currentConversationId) return;
    if (!window.confirm(t("qxai.message.deleteConfirm", "Delete this message?"))) return;
    deleteMessage(currentConversationId, messageIndex);
    if (editingMessageIndex === messageIndex) cancelEditMessage();
  }, [cancelEditMessage, currentConversationId, deleteMessage, editingMessageIndex, t]);

  const handleRegenerate = useCallback(
    (messageIndex: number) => {
      if (!currentConversationId || isCurrentConversationStreaming) return;
      void regenerateMessage(currentConversationId, messageIndex);
    },
    [currentConversationId, isCurrentConversationStreaming, regenerateMessage],
  );

  const handleAttach = useCallback(async () => {
    if (!conv || attachmentsBusy) return;
    setAttachmentsBusy(true);
    setAttachmentsError("");
    try {
      const imported = await chooseAndImportQxAiAttachments(conv.id);
      setPendingAttachments((current) => [
        ...current,
        ...imported.filter((item) => !current.some((existing) => existing.path === item.path)),
      ]);
    } catch (error) {
      setAttachmentsError(String(error));
    } finally {
      setAttachmentsBusy(false);
    }
  }, [attachmentsBusy, conv]);

  const handleComposerKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;

    if (skillPickerOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const offset = event.key === "ArrowDown" ? 1 : -1;
        setSkillCursor((current) => {
          if (skillMatches.length === 0) return 0;
          return (current + offset + skillMatches.length) % skillMatches.length;
        });
        return;
      }
      if (event.key === "Enter" && skillMatches[skillCursor]) {
        event.preventDefault();
        event.stopPropagation();
        void selectSkill(skillMatches[skillCursor]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setInput("");
        return;
      }
    }

    // Jan-style: Enter sends, Shift+Enter inserts a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      handleSend();
    }
  }, [handleSend, selectSkill, skillCursor, skillMatches, skillPickerOpen]);

  const handleComposerInput = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  }, []);

  useLayoutEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 28), 160)}px`;
  }, [input]);

  useEffect(() => {
    if (scrollFrameRef.current !== undefined) {
      cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = undefined;
      // Streaming can publish many deltas per second. Smooth-scroll queues a
      // new animation for every delta and can lock the WebView; one coalesced
      // native-positioned scroll keeps the transcript responsive.
      messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    return () => {
      if (scrollFrameRef.current !== undefined) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = undefined;
      }
    };
  }, [conv?.id, conv?.messages.length, streamedContent, streamedReasoning, streamingSteps.length]);

  useEffect(() => {
    if (providers.length === 0) {
      void loadProviders();
    }
  }, [providers.length, loadProviders]);

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  useEffect(() => {
    setSkillCursor(0);
  }, [input]);

  useEffect(() => {
    setSelectedSkill(null);
    setPendingAttachments([]);
    setAttachmentsError("");
    setEditingQueueId(null);
    setEditingQueueDraft("");
    setEditingMessageIndex(null);
    setEditingMessageDraft("");
    setCopiedMessageIndex(null);
  }, [conv?.id]);

  /** Jan QueuedMessageChip: click text → put back into composer and leave the queue. */
  const editQueuedIntoComposer = useCallback(
    (id: string, content: string) => {
      setInput(content);
      removeQueuedMessage(id);
      setEditingQueueId(null);
      setEditingQueueDraft("");
      requestAnimationFrame(() => composerRef.current?.focus());
    },
    [removeQueuedMessage],
  );

  const beginEditQueued = useCallback((id: string, content: string) => {
    setEditingQueueId(id);
    setEditingQueueDraft(content);
  }, []);

  const cancelEditQueued = useCallback(() => {
    setEditingQueueId(null);
    setEditingQueueDraft("");
  }, []);

  const saveEditQueued = useCallback(() => {
    if (!editingQueueId) return;
    const next = editingQueueDraft.trim();
    if (!next) {
      removeQueuedMessage(editingQueueId);
    } else {
      updateQueuedMessage(editingQueueId, { content: next });
    }
    setEditingQueueId(null);
    setEditingQueueDraft("");
  }, [editingQueueDraft, editingQueueId, removeQueuedMessage, updateQueuedMessage]);

  useEffect(() => {
    if (!conv || providers.length === 0 || canChat) return;
    // Recover only when provider/model are missing — never replace a fixed model
    // with models[0] just because it is not in the current catalog.
    const provider =
      providers.find((item) => item.id === conv.provider) ?? providers[0];
    if (!provider) return;
    const model =
      (conv.model && provider.models.some((item) => item.id === conv.model)
        ? conv.model
        : "") ||
      provider.models[0]?.id ||
      conv.model ||
      "";
    if (provider.id === conv.provider && model === conv.model) return;
    setConversationModel(conv.id, provider.id, model);
  }, [conv, providers, canChat, setConversationModel]);

  const actions = useMemo<QxShellAction[]>(() => [
    {
      id: "send",
      label: isCurrentConversationStreaming
        ? t("qxai.queue.add", "Add to Queue")
        : t("qxai.send", "Send"),
      kbd: "↵",
      disabled: (!input.trim() && pendingAttachments.length === 0) || !canChat,
      onClick: handleSend,
    },
    {
      id: "attach-files",
      label: t("qxai.attachments.add", "Attach Images or Files"),
      disabled: !conv || attachmentsBusy,
      onClick: () => void handleAttach(),
    },
    {
      id: "open-skills-folder",
      label: t("qxai.skills.openFolder", "Open Skills Folder"),
      onClick: () => void openQxAiSkillsDirectory(),
    },
    {
      id: "refresh-skills",
      label: t("qxai.skills.refresh", "Refresh Skills"),
      onClick: () => void refreshSkills(),
    },
    {
      id: "new-chat",
      label: t("qxai.newChat", "New Chat"),
      onClick: () => createConversation(),
    },
    {
      id: "clear-messages",
      label: t("qxai.clearMessages", "Clear Messages"),
      disabled: !conv || conv.messages.length === 0,
      onClick: () => clearMessages(),
    },
    {
      id: "chat-settings",
      label: t("qxai.chatSettings", "Chat Settings"),
      onClick: () => setView("settings"),
    },
    {
      id: "agent-providers",
      label: t("qxai.agentProviders", "Agent & Providers"),
      onClick: () => openAgentSettingsTab(),
    },
    {
      id: "delete-chat",
      label: t("qxai.deleteChat", "Delete Chat"),
      tone: "danger",
      disabled: !conv,
      onClick: () => {
        if (
          currentConversationId
          && window.confirm(t("qxai.deleteConversation", "Delete this conversation?"))
        ) {
          deleteConversation(currentConversationId);
        }
      },
    },
  ], [
    canChat,
    clearMessages,
    conv,
    createConversation,
    currentConversationId,
    deleteConversation,
    attachmentsBusy,
    handleAttach,
    handleSend,
    input,
    isCurrentConversationStreaming,
    pendingAttachments.length,
    refreshSkills,
    setView,
    t,
  ]);

  const userMessageCount = conv?.messages.filter((m) => m.role === "user").length ?? 0;
  const runningCount = Object.values(runs).filter((runItem) => runItem.streaming).length;

  const island: BottomIslandContent = isCurrentConversationStreaming
    ? {
        label: t("qxai.title", "QxAI Chat"),
        detail: queuedMessages.length > 0
          ? t("qxai.queue.streaming", "Streaming… · {n} queued").replace(
              "{n}",
              String(queuedMessages.length),
            )
          : t("qxai.streaming", "Streaming response…"),
        activity: "dots",
      }
    : currentError
      ? { label: t("qxai.title", "QxAI Chat"), detail: currentError, tone: "danger" }
      : {
          label: t("qxai.title", "QxAI Chat"),
          detail:
            runningCount > 0
              ? t("qxai.background.running", "{n} conversations running").replace(
                  "{n}",
                  String(runningCount),
                )
              : userMessageCount > 0
                ? t("qxai.messages", "{n} messages").replace("{n}", String(userMessageCount))
                : conv?.provider
                  ? `${conv.provider} · ${conv.model}`
                  : t("qxai.island.conversations", "{n} conversations").replace(
                      "{n}",
                      String(conversations.length),
                    ),
        };

  const shell = useQxModuleShell({
    leave,
    esc: {
      query: {
        active:
          listQuery.length > 0
          || input.length > 0
          || pendingAttachments.length > 0
          || Boolean(attachmentsError),
        clear: () => {
          if (listQuery) {
            setListQuery("");
            return;
          }
          setInput("");
          setPendingAttachments([]);
          setAttachmentsError("");
        },
      },
    },
    island,
  });

  const messages = useMemo(
    () => conv?.messages.filter((m) => m.role !== "system") ?? [],
    [conv?.messages],
  );

  const primaryActionId =
    canChat && (input.trim() || pendingAttachments.length > 0) ? "send" : "new-chat";

  return (
    <QxShell
      ref={shellRef}
      title={conv?.name ?? t("qxai.title", "QxAI Chat")}
      islandKey="qx-ai.workbench"
      className="qx-qxai-chat-shell qx-content-shell is-jan is-workbench"
      onKeyDown={shell.onKeyDown}
      navigation={{
        index: selectedIndex,
        count: filteredConversations.length,
        onChange: setSelectedIndex,
        onOpen: openSelectedConversation,
        pageSize: 8,
        regionId: MASTER_DETAIL.list,
      }}
      search={
        <QxModuleSearch
          value={listQuery}
          autoFocus={false}
          onChange={setListQuery}
          onFocus={() => {
            requestPanelKeyWindow();
            focusList();
          }}
          placeholder={t("qxai.searchConversations", "Search conversations…")}
        />
      }
      context={
        <div
          className="qx-action-panel"
          {...qxRegionProps(MASTER_DETAIL.actions, {
            label: t("qxai.actions", "AI Actions"),
          })}
        >
          <div className="qx-action-title">{t("qxai.model", "Model")}</div>
          {providers.length > 0 && conv ? (
            <>
              <Select
                value={conv.provider}
                options={providers.map((provider) => ({
                  value: provider.id,
                  label: provider.name,
                }))}
                onChange={(provider) => {
                  const nextProvider = providers.find((p) => p.id === provider);
                  setConversationModel(
                    conv.id,
                    provider,
                    nextProvider?.models[0]?.id ?? "",
                  );
                }}
                ariaLabel={t("qxai.provider", "AI Provider")}
                className="qx-inline-select"
              />
              {activeModels.length > 0 || conv.model ? (
                <Select
                  value={conv.model}
                  options={buildModelSelectOptions({
                    providerId: conv.provider,
                    models: activeModels,
                    favorites: agentSettings.favorite_models,
                    capabilities: agentSettings.model_capabilities,
                    extraModelId: conv.model,
                    visionBadge: t("agent.model.vision.badge", "Vision"),
                    reasoningBadge: t("agent.model.reasoning.badge", "Reasoning"),
                  })}
                  onChange={(model) => setConversationModel(conv.id, conv.provider, model)}
                  ariaLabel={t("qxai.model", "Model")}
                  className="qx-inline-select"
                />
              ) : (
                <div className="qx-ai-tool-hint">
                  {t("qxai.noModels", "No models available for this provider")}
                </div>
              )}
              <div className={`qx-ai-capability-pill${modelSupportsVision ? " is-on" : ""}`}>
                {modelSupportsVision
                  ? t("qxai.model.vision.on", "Vision enabled — images can be sent")
                  : t(
                      "qxai.model.vision.off",
                      "Text only — switch to a vision model or enable Vision in Settings → AI Agent",
                    )}
              </div>
            </>
          ) : (
            <div className="qx-ai-tool-hint">
              {t(
                "qxai.configureProviders",
                "Configure providers in Settings → AI Agent, or open Chat Settings for defaults.",
              )}
            </div>
          )}

          <div className="qx-action-title">{t("qxai.reasoning", "Reasoning")}</div>
          <div className="qx-ai-reasoning-setting">
            <div>
              <strong>{t("qxai.reasoning", "Reasoning")}</strong>
              <span>
                {activeModel?.reasoning
                  ? t("qxai.reasoning.desc", "Show the model's native reasoning stream")
                  : t("qxai.reasoning.unsupported", "Not advertised by this model")}
              </span>
            </div>
            <Toggle
              value={Boolean(conv?.reasoningEnabled)}
              disabled={!conv || !activeModel?.reasoning || isCurrentConversationStreaming}
              onChange={(enabled) => {
                if (conv) setConversationReasoning(conv.id, enabled);
              }}
              ariaLabel={t("qxai.reasoning", "Reasoning")}
            />
          </div>

          <div className="qx-action-title">{t("qxai.tools", "Tools")}</div>
          <div className="qx-ai-tool-summary is-compact">
            <Popover open={toolsPopoverOpen} onOpenChange={setToolsPopoverOpen} modal={false}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={`qx-ai-tool-trigger${toolsPopoverOpen ? " is-open" : ""}`}
                  aria-expanded={toolsPopoverOpen}
                  aria-haspopup="dialog"
                >
                  <Hammer size={14} aria-hidden="true" />
                  <span className="qx-ai-tool-trigger-label">
                    {enabledTools.length
                      ? t("qxai.tools.enabled", "{n} enabled").replace(
                          "{n}",
                          String(enabledTools.length),
                        )
                      : t("qxai.tools.disabled", "Disabled")}
                  </span>
                  <ChevronDown size={14} className="qx-ai-tool-trigger-chevron" aria-hidden="true" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="left"
                sideOffset={10}
                collisionPadding={12}
                className="qx-ai-tool-popover"
              >
                <div className="qx-ai-tool-popover-head">
                  <strong>{t("qxai.tools.listTitle", "Enabled tools")}</strong>
                  <span>{enabledTools.length}</span>
                </div>
                {enabledTools.length > 0 ? (
                  <div className="qx-ai-tool-chips is-popover">
                    {enabledTools.map((tool) => (
                      <span key={tool}>{tool}</span>
                    ))}
                  </div>
                ) : (
                  <div className="qx-ai-tool-hint">
                    {!agentSettings.agent_mode_enabled
                      ? t("qxai.tools.enableAgent", "Enable Agent mode in Settings → AI Agent.")
                      : !agentSettings.tools_enabled
                        ? t(
                            "qxai.tools.masterOff",
                            "Master tools switch is off in Settings → AI Agent.",
                          )
                        : t(
                            "qxai.tools.none",
                            "No individual tools enabled. Configure them in Settings → AI Agent.",
                          )}
                  </div>
                )}
                <p className="qx-ai-tool-popover-foot">
                  {t(
                    "qxai.tools.listHint",
                    "Configure groups and safety under Settings → AI Agent.",
                  )}
                </p>
              </PopoverContent>
            </Popover>
          </div>

          <div className="qx-action-title">{t("common.actions", "Actions")}</div>
          <QxActionList
            actions={actions.filter((action) => action.id !== "send" && !action.disabled)}
            showShortcuts={false}
          />
        </div>
      }
      island={shell.island}
      escapeAction={shell.escapeAction}
      primaryActionId={primaryActionId}
      actionTitle={t("qxai.actions", "AI Actions")}
      actions={actions}
    >
      <div className="qx-ai-workbench">
        <QxResizableSplit
          className="qx-content-split qx-ai-split has-detail"
          storageKey={LIST_WIDTH_KEY}
          defaultLeftWidth={280}
          minLeftWidth={220}
          minRightWidth={320}
          separatorLabel={t("qxai.resizeList", "Resize conversation list")}
        >
          <QxAiConversationList
            listRef={listRef}
            regionIds={MASTER_DETAIL}
            conversations={filteredConversations}
            runs={runs}
            selectedId={currentConversationId}
            loading={loading}
            listQuery={listQuery}
            getItemProps={getItemProps}
            onSelect={selectConversation}
            onOpen={(id) => {
              selectConversation(id);
              focusDetail();
              requestAnimationFrame(() => composerRef.current?.focus());
            }}
            hasActiveConversation={Boolean(conv)}
          />

          <article
            className="qx-content-detail qx-ai-chat-detail"
            {...qxRegionProps(MASTER_DETAIL.detail, {
              label: t("qxai.conversation", "Conversation"),
              initial: Boolean(conv),
              scroll: true,
            })}
          >
            <div className="qx-ai-conversation is-jan" data-qx-ai="conversation">
              <div className="qx-ai-message-list is-jan" data-qx-region-scroll data-qx-ai="conversation-content">
                <div className="qx-ai-message-column">
                  {messages.map((msg) => {
                    const messageIndex = conv?.messages.indexOf(msg) ?? -1;
                    const isEditing = editingMessageIndex === messageIndex;
                    const messageTimestamp = msg.createdAt ?? conv?.createdAt;
                    const isLastAssistant =
                      msg.role === "assistant"
                      && messageIndex === (conv?.messages.length ?? 0) - 1;
                    return (
                      <div
                        key={`${conv?.id ?? "chat"}-${msg.role}-${messageIndex}-${msg.content.slice(0, 24)}`}
                        className={`qx-ai-message is-jan is-${msg.role}`}
                        data-qx-ai="message"
                        data-role={msg.role}
                      >
                        <div className="qx-ai-message-body">
                          <div className="qx-ai-message-meta">
                            {msg.role === "user"
                              ? t("qxai.you", "You")
                              : activeModel?.name || conv?.model || "AI"}
                            {msg.role === "user" && msg.skill ? (
                              <span className="qx-ai-message-skill">
                                <Sparkles size={11} />
                                {msg.skill.name}
                              </span>
                            ) : null}
                          </div>
                          <div
                            className={`qx-ai-message-bubble is-jan is-${msg.role}`}
                            data-qx-ai="message-content"
                          >
                            {isEditing ? (
                              <div className="qx-jan-message-editor">
                                <textarea
                                  className="qx-jan-message-editor-input"
                                  value={editingMessageDraft}
                                  rows={3}
                                  autoFocus
                                  onChange={(event) => setEditingMessageDraft(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.nativeEvent.isComposing) return;
                                    if (event.key === "Escape") {
                                      event.preventDefault();
                                      cancelEditMessage();
                                    }
                                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                      event.preventDefault();
                                      saveEditMessage();
                                    }
                                  }}
                                  aria-label={t("qxai.message.edit", "Edit message")}
                                />
                                <div className="qx-jan-message-editor-actions">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title={t("common.save", "Save")}
                                    aria-label={t("common.save", "Save")}
                                    onClick={saveEditMessage}
                                  >
                                    <Check size={14} />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title={t("common.cancel", "Cancel")}
                                    aria-label={t("common.cancel", "Cancel")}
                                    onClick={cancelEditMessage}
                                  >
                                    <X size={14} />
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <AiMessageContent
                                content={msg.content}
                                reasoning={msg.reasoning}
                                steps={msg.steps}
                                attachments={msg.attachments}
                                tokenSpeed={msg.tokenSpeed}
                                tokenCount={msg.tokenCount}
                                usage={msg.usage}
                                reasoningDurationMs={msg.reasoningDurationMs}
                              />
                            )}
                          </div>
                          {msg.role === "user" || msg.role === "assistant" ? (
                            <QxAiMessageActions
                              role={msg.role}
                              timestamp={messageTimestamp}
                              copied={copiedMessageIndex === messageIndex}
                              disabled={isCurrentConversationStreaming || isEditing}
                              canRegenerate={isLastAssistant && !isCurrentConversationStreaming}
                              onCopy={() => void copyMessage(messageIndex, msg.content)}
                              onEdit={() => beginEditMessage(messageIndex, msg.content)}
                              onDelete={() => removeMessage(messageIndex)}
                              onRegenerate={() => handleRegenerate(messageIndex)}
                            />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {isCurrentConversationStreaming
                    && (streamedContent || streamedReasoning || streamingSteps.length > 0) ? (
                    <div
                      className="qx-ai-message is-jan is-assistant"
                      data-qx-ai="message"
                      data-role="assistant"
                      data-streaming="true"
                    >
                      <div className="qx-ai-message-body">
                        <div className="qx-ai-message-meta">
                          {activeModel?.name || conv?.model || "AI"}
                        </div>
                        <div
                          className="qx-ai-message-bubble is-jan is-assistant"
                          data-qx-ai="message-content"
                        >
                          <AiMessageContent
                            content={streamedContent}
                            reasoning={streamedReasoning}
                            streaming
                            steps={streamingSteps}
                            tokenSpeed={run?.liveTokenSpeed}
                            tokenCount={run?.liveTokenCount}
                            reasoningDurationMs={run?.reasoningMs}
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {conv && messages.length === 0 && !isCurrentConversationStreaming ? (
                    <div className="qx-ai-empty-state">
                      {conv.provider
                        ? t("qxai.empty.chat", "Chatting with {provider} ({model}). Type below.")
                            .replace("{provider}", conv.provider)
                            .replace("{model}", conv.model)
                        : t(
                            "qxai.empty.noProvider",
                            "No provider selected. Open Settings → AI Agent.",
                          )}
                    </div>
                  ) : null}

                  {!conv ? (
                    <div className="qx-ai-empty-state">
                      {t(
                        "qxai.empty.noConversation",
                        "Select or create a conversation to begin.",
                      )}
                    </div>
                  ) : null}

                  <div ref={messagesEndRef} className="qx-ai-message-list-end" />
                </div>
              </div>

              {/* PromptInput dock — Elements structure, BUI field chrome (in-flow). */}
              <div className="qx-ai-prompt-dock qx-jan-composer-dock is-docked-flow" data-qx-ai="prompt-dock">
                {skillPickerOpen ? (
                  <div
                    className="qx-ai-skill-picker is-docked is-vbg"
                    role="listbox"
                    aria-label={t("qxai.skills.title", "Skills")}
                  >
                    <div className="qx-ai-skill-picker-head">
                      <div>
                        <Sparkles size={15} strokeWidth={1.75} />
                        <strong>{t("qxai.skills.title", "Skills")}</strong>
                        <span className="qx-ai-skill-picker-eyebrow">
                          {t("qxai.skills.pickerHint", "Select a skill for this turn")}
                        </span>
                      </div>
                      <div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={t("qxai.skills.openFolder", "Open Skills Folder")}
                          aria-label={t("qxai.skills.openFolder", "Open Skills Folder")}
                          onClick={() => void openQxAiSkillsDirectory()}
                        >
                          <FolderOpen size={15} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={t("qxai.skills.refresh", "Refresh Skills")}
                          aria-label={t("qxai.skills.refresh", "Refresh Skills")}
                          onClick={() => void refreshSkills()}
                        >
                          <RefreshCw size={15} className={skillsLoading ? "qx-spin" : undefined} />
                        </Button>
                      </div>
                    </div>
                    <div className="qx-ai-skill-options is-cards">
                      {skillMatches.map((skill, index) => (
                        <button
                          key={skill.id}
                          type="button"
                          role="option"
                          aria-selected={index === skillCursor}
                          className={`qx-ai-skill-card${index === skillCursor ? " is-selected" : ""}`}
                          onMouseEnter={() => setSkillCursor(index)}
                          onClick={() => void selectSkill(skill)}
                        >
                          <span className="qx-ai-skill-card-icon" aria-hidden="true">
                            <Sparkles size={14} strokeWidth={1.75} />
                          </span>
                          <span className="qx-ai-skill-card-copy">
                            <strong>{skill.name}</strong>
                            <small>
                              {skill.description || t("agent.skills.noDescription", "No description")}
                            </small>
                          </span>
                          <code className="qx-ai-skill-card-id">/{skill.id}</code>
                        </button>
                      ))}
                      {!skillsLoading && skillMatches.length === 0 ? (
                        <div className="qx-ai-skill-empty">
                          {skillsFailed
                            ? t(
                                "qxai.skills.error",
                                "Skills could not be loaded. Refresh to try again.",
                              )
                            : t(
                                "qxai.skills.empty",
                                "No matching Skills. Add SKILL.md files in the Skills folder.",
                              )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {(selectedSkill
                  || pendingAttachments.length > 0
                  || attachmentsError
                  || queuedMessages.length > 0) && (
                  <div className="qx-ai-composer-status is-docked">
                    {selectedSkill ? (
                      <div className="qx-ai-selected-skill is-vbg">
                        <span className="qx-ai-selected-skill-icon" aria-hidden="true">
                          <Sparkles size={14} strokeWidth={1.75} />
                        </span>
                        <span className="qx-ai-selected-skill-copy">
                          <small>{t("qxai.skills.using", "Using Skill")}</small>
                          <strong>{selectedSkill.name}</strong>
                          <code>/{selectedSkill.id}</code>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          title={t("qxai.skills.remove", "Remove Skill")}
                          aria-label={t("qxai.skills.remove", "Remove Skill")}
                          onClick={() => setSelectedSkill(null)}
                        >
                          <X size={14} />
                        </Button>
                      </div>
                    ) : null}

                    {pendingAttachments.length > 0 ? (
                      <div className="qx-ai-pending-attachments">
                        {pendingAttachments.map((attachment) => {
                          const isImage =
                            attachment.kind === "image"
                            || Boolean(attachment.mimeType?.startsWith("image/"));
                          return (
                            <div
                              className={`qx-ai-pending-attachment${isImage ? " is-image" : ""}`}
                              key={attachment.path}
                            >
                              {isImage ? (
                                <img
                                  className="qx-ai-pending-thumb"
                                  src={convertFileSrc(attachment.path)}
                                  alt={attachment.name}
                                />
                              ) : (
                                <Paperclip size={14} aria-hidden="true" />
                              )}
                              <span title={attachment.path}>{attachment.name}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                title={t("common.remove", "Remove")}
                                aria-label={t("common.remove", "Remove")}
                                onClick={() =>
                                  setPendingAttachments((items) =>
                                    items.filter((item) => item.path !== attachment.path),
                                  )
                                }
                              >
                                <X size={14} />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {pendingAttachments.some(
                      (item) => item.kind === "image" || item.mimeType?.startsWith("image/"),
                    ) && !modelSupportsVision ? (
                      <div className="qx-ai-config-error">
                        {t(
                          "qxai.model.vision.required",
                          "Current model cannot read images. Pick a Vision model or enable Vision in Settings → AI Agent.",
                        )}
                      </div>
                    ) : null}
                    {attachmentsError ? (
                      <div className="qx-ai-config-error">{attachmentsError}</div>
                    ) : null}

                    {queuedMessages.length > 0 ? (
                      <div className="qx-ai-queue qx-ai-message-queue" data-qx-ai="queue">
                        <div className="qx-ai-message-queue-title">
                          <ListPlus size={14} />
                          <strong>{t("qxai.queue.title", "Queued messages")}</strong>
                          <span>{queuedMessages.length}</span>
                        </div>
                        {queuedMessages.map((message, index) => {
                          const isEditing = editingQueueId === message.id;
                          return (
                            <div
                              className={`qx-ai-message-queue-row${isEditing ? " is-editing" : ""}`}
                              key={message.id}
                            >
                              <div className="qx-ai-message-queue-index" aria-hidden="true">
                                {index + 1}
                              </div>
                              {isEditing ? (
                                <div className="qx-ai-message-queue-edit">
                                  <textarea
                                    className="qx-ai-message-queue-textarea"
                                    value={editingQueueDraft}
                                    rows={3}
                                    autoFocus
                                    onChange={(event) => setEditingQueueDraft(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.nativeEvent.isComposing) return;
                                      if (event.key === "Escape") {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        cancelEditQueued();
                                      }
                                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        saveEditQueued();
                                      }
                                    }}
                                    aria-label={t("qxai.queue.edit", "Edit queued message")}
                                  />
                                  <div className="qx-ai-message-queue-edit-actions">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      title={t("common.save", "Save")}
                                      aria-label={t("common.save", "Save")}
                                      onClick={saveEditQueued}
                                    >
                                      <Check size={14} />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      title={t("common.cancel", "Cancel")}
                                      aria-label={t("common.cancel", "Cancel")}
                                      onClick={cancelEditQueued}
                                    >
                                      <X size={14} />
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="qx-ai-message-queue-body">
                                    <button
                                      type="button"
                                      className="qx-ai-message-queue-text"
                                      title={t(
                                        "qxai.queue.editIntoComposer",
                                        "Click to edit in the input box",
                                      )}
                                      onClick={() =>
                                        editQueuedIntoComposer(message.id, message.content)
                                      }
                                    >
                                      {message.content}
                                    </button>
                                    {message.skill ? (
                                      <small>
                                        <Sparkles size={12} />
                                        {message.skill.name}
                                      </small>
                                    ) : null}
                                  </div>
                                  <div className="qx-ai-message-queue-actions">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      title={t("qxai.queue.edit", "Edit queued message")}
                                      aria-label={t("qxai.queue.edit", "Edit queued message")}
                                      onClick={() => beginEditQueued(message.id, message.content)}
                                    >
                                      <Pencil size={14} />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      title={t("qxai.queue.remove", "Remove queued message")}
                                      aria-label={t("qxai.queue.remove", "Remove queued message")}
                                      onClick={() => {
                                        if (editingQueueId === message.id) cancelEditQueued();
                                        removeQueuedMessage(message.id);
                                      }}
                                    >
                                      <X size={14} />
                                    </Button>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="qx-ai-prompt qx-jan-composer" data-qx-ai="prompt-input">
                  <textarea
                    ref={composerRef}
                    className="qx-jan-composer-input"
                    value={input}
                    rows={1}
                    disabled={!conv}
                    placeholder={
                      isCurrentConversationStreaming
                        ? t("qxai.queue.placeholder", "Type another message to queue…")
                        : t(
                            "qxai.typeMessage",
                            "Type a message… (Enter to send, / for Skills)",
                          )
                    }
                    onChange={handleComposerInput}
                    onKeyDown={handleComposerKeyDown}
                    onFocus={requestPanelKeyWindow}
                  />
                  <div className="qx-jan-composer-toolbar" data-qx-ai="prompt-toolbar">
                    <div className="qx-jan-composer-tools" data-qx-ai="prompt-tools">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={!conv || attachmentsBusy}
                        title={t("qxai.attachments.add", "Attach Images or Files")}
                        aria-label={t("qxai.attachments.add", "Attach Images or Files")}
                        onClick={() => void handleAttach()}
                      >
                        <Paperclip size={16} className={attachmentsBusy ? "qx-spin" : undefined} />
                      </Button>
                    </div>
                    <div className="qx-jan-composer-meta">
                      {isCurrentConversationStreaming && run?.liveTokenSpeed ? (
                        <span
                          className="qx-jan-composer-speed"
                          title={t("qxai.tokens.speed", "Generation speed")}
                        >
                          {Math.round(run.liveTokenSpeed)}{" "}
                          {t("qxai.tokens.perSec", "tokens/sec")}
                        </span>
                      ) : null}
                      {conv ? (
                        <QxAiTokenCounter
                          messages={conv.messages}
                          draft={input}
                          maxTokens={contextMaxTokens}
                          modelName={activeModel?.name || conv.model}
                        />
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      className={`qx-jan-composer-send${
                        isCurrentConversationStreaming ? " is-queue" : ""
                      }${
                        canChat && (input.trim() || pendingAttachments.length > 0)
                          ? " is-ready"
                          : ""
                      }`}
                      size="icon"
                      disabled={!canChat || (!input.trim() && pendingAttachments.length === 0)}
                      title={
                        isCurrentConversationStreaming
                          ? t("qxai.queue.add", "Add to Queue")
                          : t("qxai.send", "Send")
                      }
                      aria-label={
                        isCurrentConversationStreaming
                          ? t("qxai.queue.add", "Add to Queue")
                          : t("qxai.send", "Send")
                      }
                      onClick={handleSend}
                    >
                      {isCurrentConversationStreaming ? (
                        <ListPlus size={16} strokeWidth={2.2} aria-hidden="true" />
                      ) : (
                        <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </article>
        </QxResizableSplit>
      </div>
    </QxShell>
  );
}
