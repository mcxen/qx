import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
} from "lucide-react";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { QxActionList } from "../../components/QxActionPanel";
import { QxModuleSearch } from "../../components/QxModuleSearch";
import { Button, Select, Toggle } from "../../components/ui";
import { requestPanelKeyWindow } from "../../hooks/usePanelKeyWindow";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { useT } from "../../i18n";
import { useStore } from "../../store";
import { isBuiltinModuleEnabled } from "../moduleAvailability";
import { useSettingsStore } from "../settings/store";
import { openAgentSettingsTab } from "../qx-ai/AiProviderConfig";
import {
  usePzaiStore,
  type PzaiDisplayMode,
} from "./store";

export default function PzaiPanel() {
  const t = useT();
  const setTab = useStore((state) => state.setTab);
  const settings = useSettingsStore((state) => state.settings);
  const rssOn = isBuiltinModuleEnabled("rss", settings);
  const docsOn = isBuiltinModuleEnabled("documents", settings);

  const {
    feeds,
    articles,
    selectedFeedId,
    selectedArticleId,
    onlyUnread,
    query,
    loading,
    error,
    workbench,
    instruction,
    run,
    loadFeeds,
    loadArticles,
    selectFeed,
    openArticle,
    setQuery,
    setOnlyUnread,
    setDisplayMode,
    setSummary,
    setDraft,
    setNotes,
    setInstruction,
    markRead,
    saveDraftToDocs,
    runPzai,
  } = usePzaiStore();

  const [saveMsg, setSaveMsg] = useState("");
  /** ≤720px: list/detail mutual exclusive (master–detail). */
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 720px)").matches : false,
  );

  useEffect(() => {
    void loadFeeds().then(() => void loadArticles(null));
  }, [loadFeeds, loadArticles]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadArticles(selectedFeedId);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query, onlyUnread, loadArticles, selectedFeedId]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // On narrow screens, split mode is too cramped — collapse to summary if needed.
  useEffect(() => {
    if (narrow && workbench.displayMode === "split") {
      setDisplayMode("summary");
    }
  }, [narrow, workbench.displayMode, setDisplayMode]);

  const goLauncher = useCallback(() => setTab("launcher"), [setTab]);
  const closeArticle = useCallback(() => {
    usePzaiStore.setState({
      selectedArticleId: null,
      workbench: {
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
      },
    });
  }, []);

  const island: BottomIslandContent = run.streaming
    ? {
        label: t("pzai.title", "P仔"),
        detail: t("pzai.thinking", "Reading with agent…"),
        activity: "dots",
      }
    : {
        label: t("pzai.title", "P仔"),
        detail: workbench.articleId
          ? workbench.title
          : t("pzai.island.empty", "Pick an article"),
      };

  const shell = useQxModuleShell({
    leave: goLauncher,
    esc: {
      // Narrow: first Esc leaves reading back to list (inner).
      inner: {
        active: narrow && Boolean(workbench.articleId),
        close: closeArticle,
      },
      query: {
        active: query.length > 0 || instruction.length > 0,
        clear: () => {
          if (instruction) {
            setInstruction("");
            return;
          }
          setQuery("");
        },
      },
    },
    island,
  });

  const modeOptions = useMemo(() => {
    const rows: Array<[PzaiDisplayMode, string]> = [
      ["original", t("pzai.mode.original", "Original")],
      ["summary", t("pzai.mode.summary", "Summary")],
      ["draft", t("pzai.mode.draft", "Draft")],
    ];
    // Split is wide-layout only.
    if (!narrow) {
      rows.push(["split", t("pzai.mode.split", "Split")]);
    }
    return rows.map(([value, label]) => ({ value, label }));
  }, [narrow, t]);

  const quickActions = useMemo(
    () => [
      {
        id: "summarize",
        label: t("pzai.action.summarize", "Summarize"),
        prompt: t(
          "pzai.prompt.summarize",
          "为当前文章写简洁中文摘要，写入 workbench summary，并把显示模式设为 summary。",
        ),
      },
      {
        id: "rewrite",
        label: t("pzai.action.rewrite", "Rewrite draft"),
        prompt: t(
          "pzai.prompt.rewrite",
          "改写当前文章为更清晰的中文草稿，写入 draft，显示模式 draft。保留关键事实，不要编造。",
        ),
      },
      {
        id: "bullets",
        label: t("pzai.action.bullets", "Key points"),
        prompt: t(
          "pzai.prompt.bullets",
          "提取 5–8 条要点列表，写入 summary，模式 summary。",
        ),
      },
      {
        id: "edit-tone",
        label: t("pzai.action.tone", "Softer tone"),
        prompt: t(
          "pzai.prompt.tone",
          "把 draft 改成更温和专业的语气，更新 draft，模式 draft。",
        ),
      },
    ],
    [t],
  );

  const actions = useMemo<QxShellAction[]>(
    () => [
      {
        id: "run",
        label: run.streaming
          ? t("pzai.running", "Running…")
          : t("pzai.run", "Ask P仔"),
        kbd: "↵",
        disabled: run.streaming || !instruction.trim(),
        onClick: () => void runPzai(),
      },
      {
        id: "refresh",
        label: t("pzai.refresh", "Refresh list"),
        onClick: () => void loadArticles(selectedFeedId),
      },
      {
        id: "save-docs",
        label: t("pzai.saveDocs", "Save to Text Toolbox"),
        disabled: !workbench.articleId || !docsOn,
        onClick: () => {
          void saveDraftToDocs()
            .then((name) => setSaveMsg(t("pzai.saved", "Saved {name}").replace("{name}", name)))
            .catch((err) => setSaveMsg(String(err)));
        },
      },
      {
        id: "agent-settings",
        label: t("qxai.agentProviders", "Agent & Providers"),
        onClick: () => openAgentSettingsTab(),
      },
    ],
    [
      docsOn,
      instruction,
      loadArticles,
      run.streaming,
      runPzai,
      saveDraftToDocs,
      selectedFeedId,
      t,
      workbench.articleId,
    ],
  );

  if (!rssOn) {
    return (
      <QxShell
        title={t("pzai.title", "P仔")}
        islandKey="p-zai"
        island={shell.island}
        escapeAction={shell.escapeAction}
        onKeyDown={shell.onKeyDown}
        actions={[]}
      >
        <div className="qx-ai-empty-state">
          {t(
            "pzai.needRss",
            "P仔 needs the RSS module enabled. Turn it on in Settings → Extensions.",
          )}
        </div>
      </QxShell>
    );
  }

  return (
    <QxShell
      title={t("pzai.title", "P仔")}
      islandKey="p-zai"
      className="qx-pzai-shell"
      onKeyDown={shell.onKeyDown}
      search={
        <QxModuleSearch
          value={query}
          onChange={(value) => {
            setQuery(value);
          }}
          onFocus={requestPanelKeyWindow}
          placeholder={t("pzai.search", "Search articles…")}
        />
      }
      context={
        <div className="qx-action-panel qx-pzai-context">
          <div className="qx-action-title">{t("pzai.context.workbench", "Workbench")}</div>
          <Select
            value={workbench.displayMode}
            options={modeOptions}
            onChange={(value) => setDisplayMode(value as PzaiDisplayMode)}
            ariaLabel={t("pzai.mode", "Display mode")}
            className="qx-inline-select"
          />
          <div className="qx-pzai-context-meta">
            {workbench.articleId
              ? `#${workbench.articleId} · ${workbench.displayMode}`
              : t("pzai.noArticle", "No article selected")}
          </div>

          <div className="qx-action-title">{t("pzai.context.quick", "Quick ops")}</div>
          <div className="qx-pzai-quick">
            {quickActions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant="ghost"
                disabled={run.streaming || !workbench.articleId}
                onClick={() => void runPzai(action.prompt)}
              >
                <Sparkles size={14} />
                {action.label}
              </Button>
            ))}
          </div>

          <div className="qx-action-title">{t("pzai.context.summary", "Summary")}</div>
          <textarea
            className="qx-pzai-edit"
            rows={4}
            value={workbench.summary}
            placeholder={t("pzai.summary.placeholder", "AI summary appears here…")}
            onChange={(event) => setSummary(event.target.value)}
            onFocus={requestPanelKeyWindow}
          />

          <div className="qx-action-title">{t("pzai.context.notes", "Notes")}</div>
          <textarea
            className="qx-pzai-edit"
            rows={3}
            value={workbench.notes}
            placeholder={t("pzai.notes.placeholder", "Your notes…")}
            onChange={(event) => setNotes(event.target.value)}
            onFocus={requestPanelKeyWindow}
          />

          <div className="qx-action-title">{t("common.actions", "Actions")}</div>
          <QxActionList
            actions={actions.filter((action) => action.id !== "run" && !action.disabled)}
            showShortcuts={false}
          />
          {saveMsg ? <div className="qx-ai-tool-hint">{saveMsg}</div> : null}
        </div>
      }
      island={shell.island}
      escapeAction={shell.escapeAction}
      primaryActionId="run"
      actionTitle={t("pzai.actions", "P仔 actions")}
      actions={actions}
    >
      <div
        className={`qx-pzai-layout${narrow ? " is-narrow" : ""}${
          narrow && workbench.articleId ? " is-reading" : ""
        }`}
      >
        <aside className="qx-pzai-sidebar" data-qx-region="pzai-list" data-qx-region-initial="true">
          <div className="qx-pzai-sidebar-head">
            <Select
              value={selectedFeedId != null ? String(selectedFeedId) : "all"}
              options={[
                { value: "all", label: t("pzai.allFeeds", "All feeds") },
                ...feeds.map((feed) => ({
                  value: String(feed.id),
                  label: `${feed.title}${feed.unread_count ? ` (${feed.unread_count})` : ""}`,
                })),
              ]}
              onChange={(value) => {
                void selectFeed(value === "all" ? null : Number(value));
              }}
              ariaLabel={t("pzai.feed", "Feed")}
              className="qx-inline-select"
            />
            <div className="qx-pzai-sidebar-tools">
              <label className="qx-pzai-unread">
                <Toggle
                  value={onlyUnread}
                  onChange={(value) => setOnlyUnread(value)}
                  ariaLabel={t("pzai.unreadOnly", "Unread only")}
                />
                <span>{t("pzai.unreadOnly", "Unread only")}</span>
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title={t("pzai.refresh", "Refresh list")}
                onClick={() => void loadArticles(selectedFeedId)}
              >
                <RefreshCw size={14} className={loading ? "qx-spin" : undefined} />
              </Button>
            </div>
          </div>
          <div className="qx-pzai-article-list" data-qx-region-scroll>
            {articles.map((article) => (
              <button
                key={article.id}
                type="button"
                className={`qx-list-row qx-pzai-article-row${
                  selectedArticleId === article.id ? " is-active" : ""
                }${!article.is_read ? " is-unread" : ""}`}
                onClick={() => void openArticle(article.id)}
              >
                <div className="qx-list-copy">
                  <div className="qx-list-title">{article.title || t("pzai.untitled", "Untitled")}</div>
                  <div className="qx-list-subtitle">
                    {article.is_starred ? <Star size={11} /> : null}
                    {new Date(article.published_at || Date.now()).toLocaleString()}
                  </div>
                </div>
              </button>
            ))}
            {!loading && articles.length === 0 ? (
              <div className="qx-ai-empty-state">
                {t("pzai.emptyArticles", "No articles. Refresh RSS or pick another feed.")}
              </div>
            ) : null}
          </div>
        </aside>

        <section className="qx-pzai-main" data-qx-region="pzai-read">
          {!workbench.articleId ? (
            <div className="qx-ai-empty-state qx-pzai-empty-main">
              <BookOpen size={28} />
              <p>{t("pzai.pick", "Select an article. P仔 can summarize, rewrite, and edit it in Context.")}</p>
            </div>
          ) : (
            <>
              <header className="qx-pzai-article-head">
                {narrow ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="qx-pzai-back"
                    onClick={closeArticle}
                  >
                    <ChevronLeft size={16} />
                    {t("pzai.backToList", "Articles")}
                  </Button>
                ) : null}
                <h2>{workbench.title}</h2>
                <div className="qx-pzai-article-meta">
                  {workbench.author ? <span>{workbench.author}</span> : null}
                  {workbench.link ? (
                    <a href={workbench.link} target="_blank" rel="noreferrer">
                      {t("pzai.openLink", "Open original")}
                    </a>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void markRead(workbench.articleId!, !articles.find((a) => a.id === workbench.articleId)?.is_read)
                    }
                  >
                    {t("pzai.toggleRead", "Toggle read")}
                  </Button>
                </div>
              </header>

              <div className="qx-pzai-workbench" data-qx-region-scroll>
                {(workbench.displayMode === "original" || workbench.displayMode === "split") && (
                  <article className="qx-pzai-pane">
                    <h3>
                      <FileText size={14} />
                      {t("pzai.mode.original", "Original")}
                    </h3>
                    {workbench.originalHtml ? (
                      <div
                        className="qx-pzai-html"
                        // RSS content is already sanitized by the RSS host pipeline for display in-app.
                        dangerouslySetInnerHTML={{ __html: workbench.originalHtml }}
                      />
                    ) : (
                      <pre className="qx-pzai-text">{workbench.originalText}</pre>
                    )}
                  </article>
                )}
                {(workbench.displayMode === "summary" || workbench.displayMode === "split") && (
                  <article className="qx-pzai-pane is-summary">
                    <h3>
                      <Sparkles size={14} />
                      {t("pzai.mode.summary", "Summary")}
                    </h3>
                    <pre className="qx-pzai-text">{workbench.summary || t("pzai.summary.empty", "No summary yet — ask P仔.")}</pre>
                  </article>
                )}
                {(workbench.displayMode === "draft" || workbench.displayMode === "split") && (
                  <article className="qx-pzai-pane is-draft">
                    <h3>
                      <FileText size={14} />
                      {t("pzai.mode.draft", "Draft")}
                    </h3>
                    <textarea
                      className="qx-pzai-draft-editor"
                      value={workbench.draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onFocus={requestPanelKeyWindow}
                      rows={16}
                    />
                  </article>
                )}
              </div>
            </>
          )}

          <div className="qx-pzai-composer">
            {run.error ? <div className="qx-ai-config-error">{run.error}</div> : null}
            {run.streaming || run.streamedContent ? (
              <div className="qx-pzai-agent-stream">
                {run.streaming ? <Loader2 size={14} className="qx-spin" /> : <Sparkles size={14} />}
                <div>{run.streamedContent || t("pzai.thinking", "Reading with agent…")}</div>
              </div>
            ) : null}
            <div className="qx-jan-composer">
              <textarea
                className="qx-jan-composer-input"
                rows={2}
                value={instruction}
                disabled={run.streaming}
                placeholder={t(
                  "pzai.composer",
                  "Ask P仔… e.g. 总结这篇文章 / 改写成口语 / 提取行动项",
                )}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void runPzai();
                  }
                }}
                onFocus={requestPanelKeyWindow}
              />
              <Button
                type="button"
                className="qx-jan-composer-send"
                disabled={run.streaming || !instruction.trim()}
                onClick={() => void runPzai()}
              >
                {t("pzai.run", "Ask P仔")}
              </Button>
            </div>
          </div>
        </section>
      </div>
      {error ? <div className="qx-ai-config-error qx-pzai-error">{error}</div> : null}
    </QxShell>
  );
}
