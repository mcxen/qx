import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  FilePenLine,
  Languages,
  ListPlus,
  ListTree,
  MessageSquareText,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "../../components/ui";
import { requestPanelKeyWindow } from "../../hooks/usePanelKeyWindow";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { AiMessageContent } from "../qx-ai/message-rendering";
import { presentQxAiError } from "../qx-ai/error-presentation";
import { useG4fStore } from "../qx-ai/store";
import { usePzaiStore } from "./store";

export interface PzaiAssistantArticle {
  id: number;
  title: string;
  link: string;
  author: string;
  content: string;
}

interface PzaiAssistantPanelProps {
  article: PzaiAssistantArticle;
  conversationId?: string;
  onConversationCreated: (articleId: number, conversationId: string) => void;
  onClose: () => void;
}

function articleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function buildArticleSystemPrompt(article: PzaiAssistantArticle): string {
  return [
    "You are P仔, Qx's contextual reading assistant.",
    "The open RSS article below is the default context for this conversation.",
    "Use the RSS tools when the user asks about other or all saved articles.",
    "For summaries, also update the P仔 summary with pzai_set_summary.",
    "For translations, rewrites, or edits, write the complete result to the P仔 draft with pzai_set_draft.",
    "Never overwrite or claim to overwrite the immutable RSS source article; edits are a working draft.",
    "Answer in the user's language and keep ordinary chat concise.",
    "",
    `<current_article id="${article.id}">`,
    `title: ${article.title}`,
    `author: ${article.author || "unknown"}`,
    `url: ${article.link}`,
    "content:",
    articleText(article.content) || article.title,
    "</current_article>",
  ].join("\n");
}

type AssistantView = "chat" | "draft";

export default function PzaiAssistantPanel({
  article,
  conversationId: initialConversationId,
  onConversationCreated,
  onClose,
}: PzaiAssistantPanelProps) {
  const t = useT();
  const setTab = useStore((state) => state.setTab);
  const {
    conversations,
    runs,
    messageQueue,
    removeQueuedMessage,
    selectConversation,
    sendMessage,
  } = useG4fStore();
  const workbench = usePzaiStore((state) => state.workbench);
  const setDraft = usePzaiStore((state) => state.setDraft);
  const saveDraftToDocs = usePzaiStore((state) => state.saveDraftToDocs);
  const [conversationId, setConversationId] = useState(initialConversationId ?? "");
  const [input, setInput] = useState("");
  const [view, setView] = useState<AssistantView>("chat");
  const [initializing, setInitializing] = useState(!initialConversationId);
  const [saveMessage, setSaveMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const qxai = useG4fStore.getState();
      if (!qxai.sessionsLoaded) await qxai.loadSessions();
      if (qxai.providers.length === 0) await qxai.loadProviders();
      if (cancelled) return;

      await usePzaiStore.getState().openArticle(article.id);
      if (cancelled) return;

      if (initialConversationId) {
        setConversationId(initialConversationId);
      } else {
        const name = `${t("pzai.title", "P仔")} · ${article.title || t("rss.untitled", "(untitled)")}`;
        const id = useG4fStore.getState().createConversation(undefined, undefined, {
          background: true,
          name,
          systemPrompt: buildArticleSystemPrompt(article),
        });
        setConversationId(id);
        onConversationCreated(article.id, id);
      }
      setInitializing(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    })().catch((error) => {
      if (!cancelled) {
        setInitializing(false);
        setSaveMessage(String(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [article, initialConversationId, onConversationCreated, t]);

  const conversation = conversations.find((item) => item.id === conversationId);
  const run = conversationId ? runs[conversationId] : undefined;
  const visibleMessages = useMemo(
    () => conversation?.messages.filter((message) => message.role !== "system") ?? [],
    [conversation],
  );
  const queuedMessages = useMemo(
    () => messageQueue.filter((message) => message.conversationId === conversationId),
    [conversationId, messageQueue],
  );
  const streaming = Boolean(run?.streaming);
  const currentError = useMemo(() => {
    if (!run?.error) return "";
    const presentation = presentQxAiError(run.error);
    return presentation.kind === "missing-api-key"
      ? t(
          "qxai.error.apiKeyMissing",
          "{provider} is missing an API key. Add it in Settings → AI Agent.",
        ).replace("{provider}", presentation.provider)
      : presentation.detail;
  }, [run?.error, t]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [run?.streamedContent, run?.streamedReasoning, run?.streamingSteps, visibleMessages.length]);

  const submit = (prompt = input) => {
    const content = prompt.trim();
    if (!content || !conversationId || initializing) return;
    setInput("");
    void sendMessage(content, undefined, conversationId);
  };

  const quickActions = [
    {
      id: "summary",
      icon: ListTree,
      label: t("pzai.action.summarize", "Summarize"),
      prompt: t(
        "pzai.assistant.prompt.summary",
        "Summarize the current article clearly. Save the summary to the P仔 summary as well.",
      ),
    },
    {
      id: "translate",
      icon: Languages,
      label: t("pzai.action.translate", "Translate"),
      prompt: t(
        "pzai.assistant.prompt.translate",
        "Translate the complete current article into Chinese and save the complete translation to the P仔 draft.",
      ),
    },
    {
      id: "rewrite",
      icon: FilePenLine,
      label: t("pzai.action.rewrite", "Rewrite draft"),
      prompt: t(
        "pzai.assistant.prompt.rewrite",
        "Rewrite the current article into a clearer polished draft, preserve all facts, and save the complete result to the P仔 draft.",
      ),
    },
  ];

  const openInQxAi = () => {
    if (!conversationId) return;
    selectConversation(conversationId);
    setTab("qx-ai");
  };

  return (
    <aside className="qx-pzai-assistant" aria-label={t("pzai.assistant", "P仔 assistant")}>
      <header className="qx-pzai-assistant-head">
        <div className="qx-pzai-assistant-title">
          <Sparkles size={15} aria-hidden="true" />
          <div>
            <strong>{t("pzai.title", "P仔")}</strong>
            <span title={article.title}>{article.title}</span>
          </div>
        </div>
        <div className="qx-pzai-assistant-head-actions">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={t("pzai.openInQxAi", "Open in QxAI")}
            disabled={!conversationId}
            onClick={openInQxAi}
          >
            <MessageSquareText size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={t("common.close", "Close")}
            onClick={onClose}
          >
            <X size={14} />
          </Button>
        </div>
      </header>

      <div className="qx-pzai-assistant-tabs" role="tablist">
        <Button
          type="button"
          variant={view === "chat" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setView("chat")}
        >
          {t("pzai.chat", "Chat")}
        </Button>
        <Button
          type="button"
          variant={view === "draft" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setView("draft")}
        >
          {t("pzai.mode.draft", "Draft")}
        </Button>
      </div>

      {view === "chat" ? (
        <>
          <div className="qx-pzai-assistant-quick" aria-label={t("pzai.context.quick", "Quick ops")}>
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={initializing}
                  onClick={() => submit(action.prompt)}
                >
                  <Icon size={13} />
                  {action.label}
                </Button>
              );
            })}
          </div>

          <div ref={scrollRef} className="qx-pzai-assistant-messages" data-qx-region-scroll>
            {initializing ? (
              <div className="qx-pzai-assistant-empty">{t("pzai.assistant.preparing", "Preparing article context…")}</div>
            ) : visibleMessages.length === 0 && !streaming ? (
              <div className="qx-pzai-assistant-empty">
                <Sparkles size={18} />
                <span>{t("pzai.assistant.ready", "The current article is ready. Ask about it or the full RSS library.")}</span>
              </div>
            ) : null}
            {visibleMessages.map((message, index) => (
              <div key={`${message.createdAt ?? index}-${index}`} className={`qx-pzai-assistant-message is-${message.role}`}>
                <div className={`qx-ai-message-bubble is-jan is-${message.role}`}>
                  <AiMessageContent
                    content={message.content}
                    reasoning={message.reasoning}
                    steps={message.steps}
                    attachments={message.attachments}
                  />
                </div>
              </div>
            ))}
            {streaming ? (
              <div className="qx-pzai-assistant-message is-assistant">
                <div className="qx-ai-message-bubble is-jan is-assistant">
                  <AiMessageContent
                    content={run?.streamedContent ?? ""}
                    reasoning={run?.streamedReasoning}
                    steps={run?.streamingSteps}
                    streaming
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="qx-pzai-assistant-composer">
            {queuedMessages.length > 0 ? (
              <div className="qx-pzai-assistant-queue">
                {queuedMessages.map((message) => (
                  <div key={message.id} className="qx-pzai-assistant-queue-item">
                    <ListPlus size={12} aria-hidden="true" />
                    <span title={message.content}>{message.content}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("qxai.queue.remove", "Remove queued message")}
                      onClick={() => removeQueuedMessage(message.id)}
                    >
                      <X size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            {currentError || saveMessage ? (
              <div className="qx-pzai-assistant-error">{currentError || saveMessage}</div>
            ) : null}
            <div className="qx-jan-composer">
              <textarea
                ref={inputRef}
                className="qx-jan-composer-input"
                rows={2}
                value={input}
                placeholder={t("pzai.composer", "Ask P仔… e.g. summarize, translate, or rewrite")}
                onChange={(event) => setInput(event.target.value)}
                onFocus={requestPanelKeyWindow}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <Button
                type="button"
                className={`qx-jan-composer-send${input.trim() ? " is-ready" : ""}`}
                size="icon"
                disabled={!input.trim() || initializing}
                aria-label={t("pzai.run", "Ask P仔")}
                onClick={() => submit()}
              >
                <ArrowUp size={15} />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="qx-pzai-assistant-draft">
          <p>{t("pzai.draft.help", "Edits are kept as a working draft; the RSS source remains unchanged.")}</p>
          <textarea
            value={workbench.articleId === article.id ? workbench.draft : ""}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={requestPanelKeyWindow}
            placeholder={t("pzai.draft.empty", "Ask P仔 to translate or rewrite this article.")}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={workbench.articleId !== article.id || !workbench.draft.trim()}
            onClick={() => {
              setSaveMessage("");
              void saveDraftToDocs()
                .then((name) => setSaveMessage(t("pzai.saved", "Saved {name}").replace("{name}", name)))
                .catch((error) => setSaveMessage(String(error)));
            }}
          >
            <Save size={14} />
            {t("pzai.saveDocs", "Save to Text Toolbox")}
          </Button>
          {saveMessage ? <div className="qx-pzai-assistant-status">{saveMessage}</div> : null}
        </div>
      )}
    </aside>
  );
}
