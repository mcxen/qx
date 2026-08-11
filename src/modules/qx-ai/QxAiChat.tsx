import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Bot,
  Clock3,
  FolderOpen,
  Hammer,
  ListPlus,
  Paperclip,
  RefreshCw,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { QxActionList } from "../../components/QxActionPanel";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import { Button, Select, Toggle } from "../../components/ui";
import { requestPanelKeyWindow } from "../../hooks/usePanelKeyWindow";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { useT } from "../../i18n";
import { useSettingsStore } from "../settings/store";
import { openAgentSettingsTab } from "./AiProviderConfig";
import { AiMessageContent } from "./message-rendering";
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
import type { QxAiFileAttachment } from "./react-agent";

export default function QxAiChat() {
  const t = useT();
  const {
    conversations,
    currentConversationId,
    runs,
    messageQueue,
    error,
    providers,
    setView,
    sendMessage,
    removeQueuedMessage,
    clearMessages,
    deleteConversation,
    createConversation,
    setConversationModel,
    setConversationReasoning,
    loadProviders,
  } = useG4fStore();

  const [input, setInput] = useState("");
  const [skills, setSkills] = useState<QxAiSkillSummary[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsFailed, setSkillsFailed] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<QxAiSkillDocument | null>(null);
  const [skillCursor, setSkillCursor] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<QxAiFileAttachment[]>([]);
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const agentSettings = useSettingsStore((state) => state.settings.agent);

  const conv = conversations.find((c) => c.id === currentConversationId);
  const run = conv ? runs[conv.id] : undefined;
  const isCurrentConversationStreaming = Boolean(run?.streaming);
  const streamedContent = run?.streamedContent ?? "";
  const streamedReasoning = run?.streamedReasoning ?? "";
  const streamingSteps = run?.streamingSteps ?? [];
  const currentError = run?.error ?? error;
  const enabledTools = useMemo(() => {
    if (!agentSettings.agent_mode_enabled || !agentSettings.tools_enabled) return [];
    return [
      agentSettings.memory_tool_enabled && "memory",
      agentSettings.app_search_enabled && "apps",
      agentSettings.file_search_enabled && "files",
      agentSettings.http_fetch_enabled && "http",
      agentSettings.notifications_enabled && "notify",
      agentSettings.grep_search_enabled && "grep",
      agentSettings.bash_enabled && "bash",
      agentSettings.qx_host_actions_enabled && "qx",
      agentSettings.mcp_enabled && "mcp",
    ].filter(Boolean) as string[];
  }, [agentSettings]);
  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === conv?.provider),
    [providers, conv?.provider],
  );
  const activeModels = activeProvider?.models ?? [];
  const activeModel = activeModels.find((model) => model.id === conv?.model);
  const canChat = Boolean(
    conv &&
      activeProvider &&
      activeModels.some((model) => model.id === conv.model),
  );
  const skillPickerOpen = input.startsWith("/");
  const skillMatches = useMemo(
    () => filterQxAiSkills(skills, skillPickerOpen ? input.slice(1) : "").slice(0, 12),
    [input, skillPickerOpen, skills],
  );
  const queuedMessages = useMemo(
    () => messageQueue.filter((message) => message.conversationId === conv?.id),
    [conv?.id, messageQueue],
  );

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

  const leave = useCallback(() => setView("list"), [setView]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if ((!trimmed && pendingAttachments.length === 0) || !canChat) return;
    setInput("");
    setSelectedSkill(null);
    setPendingAttachments([]);
    setAttachmentsError("");
    void sendMessage(
      trimmed || t("qxai.attachments.review", "Please review the attached files."),
      selectedSkill ?? undefined,
      undefined,
      pendingAttachments,
    );
  }, [canChat, input, pendingAttachments, selectedSkill, sendMessage, t]);

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

  const handleComposerKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (!skillPickerOpen || event.nativeEvent.isComposing) return;
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
    }
  }, [selectSkill, skillCursor, skillMatches, skillPickerOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv?.messages, streamedContent]);

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
  }, [conv?.id]);

  useEffect(() => {
    if (!conv || providers.length === 0 || canChat) return;
    const provider = providers.find((p) => p.id === conv.provider) ?? providers[0];
    setConversationModel(conv.id, provider.id, provider.models[0]?.id ?? "");
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
          setView("list");
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
            userMessageCount > 0
              ? t("qxai.messages", "{n} messages").replace("{n}", String(userMessageCount))
              : conv?.provider
                ? `${conv.provider} · ${conv.model}`
                : t("qxai.noMessages", "No messages yet"),
        };

  const shell = useQxModuleShell({
    leave,
    esc: {
      query: {
        active: input.length > 0 || pendingAttachments.length > 0 || Boolean(attachmentsError),
        clear: () => {
          setInput("");
          setPendingAttachments([]);
          setAttachmentsError("");
        },
      },
    },
    island,
  });

  const messages = conv?.messages.filter((m) => m.role !== "system") ?? [];

  return (
    <QxShell
      title={conv?.name ?? t("qxai.title", "QxAI Chat")}
      islandKey="qx-ai.chat"
      className="qx-qxai-chat-shell"
      onKeyDown={shell.onKeyDown}
      search={
        <div className="qx-ai-composer">
          <QxModuleSearch
            value={input}
            autoFocus
            onChange={setInput}
            onKeyDown={handleComposerKeyDown}
            onFocus={requestPanelKeyWindow}
            disabled={!conv}
            placeholder={
              isCurrentConversationStreaming
                ? t("qxai.queue.placeholder", "Type another message to queue…")
                : t("qxai.typeMessage", "Type a message… (Enter to send, / for Skills)")
            }
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!conv || attachmentsBusy}
            title={t("qxai.attachments.add", "Attach Images or Files")}
            aria-label={t("qxai.attachments.add", "Attach Images or Files")}
            onClick={() => void handleAttach()}
          >
            <Paperclip size={16} className={attachmentsBusy ? "qx-spin" : undefined} />
          </Button>
        </div>
      }
      context={
        <div className="qx-action-panel">
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
              {activeModels.length > 0 ? (
                <Select
                  value={conv.model}
                  options={activeModels.map((model) => ({
                    value: model.id,
                    label: model.name,
                  }))}
                  onChange={(model) => setConversationModel(conv.id, conv.provider, model)}
                  ariaLabel={t("qxai.model", "Model")}
                  className="qx-inline-select"
                />
              ) : (
                <div className="qx-ai-tool-hint">
                  {t("qxai.noModels", "No models available for this provider")}
                </div>
              )}
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
          <div className="qx-ai-tool-summary">
            <div className="qx-ai-tool-summary-head">
              <Hammer size={14} />
              <span>
                {enabledTools.length
                  ? t("qxai.tools.enabled", "{n} enabled").replace(
                      "{n}",
                      String(enabledTools.length),
                    )
                  : t("qxai.tools.disabled", "Disabled")}
              </span>
            </div>
            {enabledTools.length > 0 ? (
              <div className="qx-ai-tool-chips">
                {enabledTools.map((tool) => (
                  <span key={tool}>{tool}</span>
                ))}
              </div>
            ) : (
              <div className="qx-ai-tool-hint">
                {!agentSettings.agent_mode_enabled
                  ? t("qxai.tools.enableAgent", "Enable Agent mode in Settings → AI Agent.")
                  : !agentSettings.tools_enabled
                    ? t("qxai.tools.masterOff", "Master tools switch is off in Settings → AI Agent.")
                    : t(
                        "qxai.tools.none",
                        "No individual tools enabled. Configure them in Settings → AI Agent.",
                      )}
              </div>
            )}
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
      primaryActionId="send"
      actionTitle="Chat Actions"
      actions={actions}
    >
      <div className="qx-ai-conversation">
        {skillPickerOpen && (
          <div className="qx-ai-skill-picker" role="listbox" aria-label={t("qxai.skills.title", "Skills")}>
            <div className="qx-ai-skill-picker-head">
              <div>
                <Sparkles size={15} />
                <strong>{t("qxai.skills.title", "Skills")}</strong>
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
            <div className="qx-ai-skill-options">
              {skillMatches.map((skill, index) => (
                <Button
                  key={skill.id}
                  type="button"
                  variant="ghost"
                  role="option"
                  aria-selected={index === skillCursor}
                  className={`qx-ai-skill-option${index === skillCursor ? " is-selected" : ""}`}
                  onMouseEnter={() => setSkillCursor(index)}
                  onClick={() => void selectSkill(skill)}
                >
                  <Sparkles size={15} />
                  <span>
                    <strong>{skill.name}</strong>
                    <small>{skill.description || `/${skill.id}`}</small>
                  </span>
                  <code>/{skill.id}</code>
                </Button>
              ))}
              {!skillsLoading && skillMatches.length === 0 && (
                <div className="qx-ai-skill-empty">
                  {skillsFailed
                    ? t("qxai.skills.error", "Skills could not be loaded. Refresh to try again.")
                    : t("qxai.skills.empty", "No matching Skills. Add SKILL.md files in the Skills folder.")}
                </div>
              )}
            </div>
          </div>
        )}

        {(selectedSkill || pendingAttachments.length > 0 || attachmentsError || queuedMessages.length > 0) && (
          <div className="qx-ai-composer-status">
            {selectedSkill && (
              <div className="qx-ai-selected-skill">
                <Sparkles size={14} />
                <span>
                  {t("qxai.skills.using", "Using Skill")}: <strong>{selectedSkill.name}</strong>
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
            )}
            {pendingAttachments.length > 0 && (
              <div className="qx-ai-pending-attachments">
                {pendingAttachments.map((attachment) => (
                  <div className="qx-ai-pending-attachment" key={attachment.path}>
                    <Paperclip size={14} aria-hidden="true" />
                    <span title={attachment.path}>{attachment.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={t("common.remove", "Remove")}
                      aria-label={t("common.remove", "Remove")}
                      onClick={() => setPendingAttachments((items) =>
                        items.filter((item) => item.path !== attachment.path))}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {attachmentsError && (
              <div className="qx-ai-config-error">{attachmentsError}</div>
            )}
            {queuedMessages.length > 0 && (
              <div className="qx-ai-message-queue">
                <div className="qx-ai-message-queue-title">
                  <ListPlus size={14} />
                  <strong>{t("qxai.queue.title", "Queued messages")}</strong>
                  <span>{queuedMessages.length}</span>
                </div>
                {queuedMessages.map((message) => (
                  <div className="qx-ai-message-queue-row" key={message.id}>
                    <Clock3 size={14} />
                    <span>{message.content}</span>
                    {message.skill && (
                      <small><Sparkles size={12} />{message.skill.name}</small>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title={t("qxai.queue.remove", "Remove queued message")}
                      aria-label={t("qxai.queue.remove", "Remove queued message")}
                      onClick={() => removeQueuedMessage(message.id)}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="qx-ai-message-list">
          {messages.map((msg, i) => (
            <div
              key={`${conv?.id ?? "chat"}-${msg.role}-${i}-${msg.content.slice(0, 24)}`}
              className={`qx-ai-message is-${msg.role}`}
            >
              <div className="qx-ai-message-avatar" aria-hidden="true">
                {msg.role === "user" ? <UserRound size={14} /> : <Bot size={14} />}
              </div>
              <div className="qx-ai-message-body">
                <div className="qx-ai-message-meta">
                  {msg.role === "user" ? "You" : conv?.provider || "AI"}
                  {msg.role === "user" && msg.skill && (
                    <span className="qx-ai-message-skill">
                      <Sparkles size={11} />
                      {msg.skill.name}
                    </span>
                  )}
                </div>
                <div className="qx-ai-message-bubble">
                  <AiMessageContent
                    content={msg.content}
                    reasoning={msg.reasoning}
                    steps={msg.steps}
                    attachments={msg.attachments}
                  />
                </div>
              </div>
            </div>
          ))}

          {isCurrentConversationStreaming
            && (streamedContent || streamedReasoning || streamingSteps.length > 0) && (
            <div className="qx-ai-message is-assistant">
              <div className="qx-ai-message-avatar" aria-hidden="true">
                <Bot size={14} />
              </div>
              <div className="qx-ai-message-body">
                <div className="qx-ai-message-meta">{conv?.provider || "AI"}</div>
                <div className="qx-ai-message-bubble">
                  <AiMessageContent
                    content={streamedContent}
                    reasoning={streamedReasoning}
                    streaming
                    steps={streamingSteps}
                  />
                </div>
              </div>
            </div>
          )}

          {conv && messages.length === 0 && !isCurrentConversationStreaming && (
            <div className="qx-ai-empty-state">
              {conv.provider
                ? `Chatting with ${conv.provider} (${conv.model}). Type a message below.`
                : "No provider selected. Open Chat Settings or Settings → AI Agent."}
            </div>
          )}

          {!conv && (
            <div className="qx-ai-empty-state">
              Select or create a conversation to begin.
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>
    </QxShell>
  );
}
