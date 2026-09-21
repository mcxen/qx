import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Dialog, DialogContent, DialogTitle, Input, LoadingLabel, Select } from "../../components/ui";
import { useLocale, useT } from "../../i18n";
import { useIslandError } from "../../island";
import { invalidateMemorySnapshot, runMemoryDream } from "./agent/memory";
import { useG4fStore } from "./store";
import { useStore } from "../../store";
import { failedMemoryCount, retryFailedMemories, subscribeMemoryFailures } from "./turn-memory";

type MemoryCategory = "user" | "feedback" | "project" | "reference";

interface AiMemoryEntry {
  scope?: string;
  originConversationId?: string;
  id: string;
  text: string;
  tags: string[];
  source?: string;
  type?: "core" | "episodic";
  category?: MemoryCategory;
  active?: boolean;
  importance?: number;
  supersedes?: string[];
  createdAt: number;
  updatedAt: number;
}

export function MemorySection({ onSaved }: { onSaved?: (detail: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const failedCount = useSyncExternalStore(subscribeMemoryFailures, failedMemoryCount);
  const [memories, setMemories] = useState<AiMemoryEntry[]>([]);
  const conversations = useG4fStore((state) => state.conversations);
  const [scope, setScope] = useState("");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<AiMemoryEntry | null>(null);
  const scopes = [...new Set([...memories.map((m) => m.scope), ...conversations.map((c) => c.memoryScope)].filter((s): s is string => Boolean(s)))];
  const visibleMemories = memories.filter((memory) => (memory.scope ?? "") === scope
    && `${memory.text} ${memory.tags.join(" ")}`.toLocaleLowerCase(locale).includes(query.toLocaleLowerCase(locale)));
  const sourceConversation = conversations.find((conversation) => conversation.id === source?.originConversationId);
  const [memoryText, setMemoryText] = useState("");
  const [memoryTags, setMemoryTags] = useState("");
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryCategory, setMemoryCategory] = useState<MemoryCategory>("user");
  const [operation, setOperation] = useState<"compress" | "write" | null>(null);
  const operationRef = useRef(false);
  const loadGeneration = useRef(0);
  const [compressionResult, setCompressionResult] = useState("");
  const categories: { value: MemoryCategory; label: string }[] = [
    { value: "user", label: t("agent.memory.category.user", "User") },
    { value: "feedback", label: t("agent.memory.category.feedback", "Feedback") },
    { value: "project", label: t("agent.memory.category.project", "Project") },
    { value: "reference", label: t("agent.memory.category.reference", "Reference") },
  ];
  useIslandError({
    id: "settings.ai-memory",
    title: t("agent.memory.manage.title", "Memory Management"),
    error: memoryError,
  });
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }),
    [locale],
  );

  const loadMemories = async () => {
    const generation = ++loadGeneration.current;
    setMemoryLoading(true);
    setMemoryError(null);
    try {
      const list = await invoke<AiMemoryEntry[]>("plugin_ai_memory_list");
      if (generation !== loadGeneration.current) return;
      setMemories(list.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (err) {
      if (generation === loadGeneration.current) setMemoryError(String(err));
    } finally {
      if (generation === loadGeneration.current) setMemoryLoading(false);
    }
  };

  useEffect(() => {
    void loadMemories();
    return () => { loadGeneration.current++; };
  }, []);

  const addMemory = async () => {
    const text = memoryText.trim();
    if (!text || operationRef.current) return;
    operationRef.current = true;
    setOperation("write");
    setMemoryError(null);
    try {
      const tags = memoryTags
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => Boolean(tag) && !/^(category|scope|origin):/.test(tag));
      tags.push(`category:${memoryCategory}`);
      if (scope) tags.push(`scope:${scope}`);
      await invoke<AiMemoryEntry>("plugin_ai_memory_add", {
        input: { text, tags },
      });
      setMemoryText("");
      setMemoryTags("");
      invalidateMemorySnapshot();
      await loadMemories();
      onSaved?.(t("agent.memory.saved", "Memory added"));
    } catch (err) {
      setMemoryError(String(err));
    } finally {
      operationRef.current = false;
      setOperation(null);
    }
  };

  const deleteMemory = async (id: string) => {
    if (operationRef.current) return;
    if (!window.confirm(t("agent.memory.delete.confirm", "Delete this memory? This cannot be undone."))) return;
    operationRef.current = true;
    setOperation("write");
    setMemoryError(null);
    try {
      await invoke("plugin_ai_memory_delete", { id });
      invalidateMemorySnapshot();
      await loadMemories();
      onSaved?.(t("agent.memory.deleted", "Memory deleted"));
    } catch (err) {
      setMemoryError(String(err));
    } finally {
      operationRef.current = false;
      setOperation(null);
    }
  };

  const compressMemory = async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    setOperation("compress");
    setMemoryError(null);
    setCompressionResult("");
    try {
      const result = await runMemoryDream(undefined, "compress", { scope });
      const detail = result.savedChars > 0
        ? t("agent.memory.compressed", "{before} → {after} chars; originals retained")
          .replace("{before}", result.beforeChars.toLocaleString(locale))
          .replace("{after}", result.afterChars.toLocaleString(locale))
        : t("agent.memory.compress.unchanged", "No further compression in this batch");
      setCompressionResult(result.hasMore
        ? `${detail} · ${t("agent.memory.compress.partial", "Processed a limited batch")}`
        : detail);
      await loadMemories();
    } catch (err) {
      setMemoryError(String(err));
    } finally {
      operationRef.current = false;
      setOperation(null);
    }
  };

  const formatMemoryType = (type?: AiMemoryEntry["type"]) =>
    type === "episodic"
      ? t("agent.memory.type.episodic", "Episodic")
      : t("agent.memory.type.core", "Core");

  const formatMemorySource = (source?: string) => {
    if (source === "dream.compress") return t("agent.memory.source.compressed", "Compressed");
    if (source === "dream.smart") return t("agent.memory.source.smart", "Automatic extraction");
    if (source === "dream.manual") return t("agent.memory.source.extracted", "Manual extraction");
    if (source === "plugin") return t("agent.memory.source.plugin", "Plugin");
    return !source || source === "manual"
      ? t("agent.memory.source.manual", "Manual") : source;
  };

  return (
    <div className="qx-ai-memory-manager">
      <div className="qx-ai-memory-toolbar">
        {failedCount > 0 && <Button variant="outline" size="sm" onClick={() => void retryFailedMemories()}>
          {t("agent.memory.retry", "Retry pending ({n})").replace("{n}", String(failedCount))}
        </Button>}
        <Select value={scope ? `project:${scope}` : "global"} onChange={(value) => setScope(value === "global" ? "" : value.slice(8))} disabled={operation !== null}
          ariaLabel={t("agent.memory.scope", "Memory scope")}
          options={[{ value: "global", label: t("agent.memory.scope.global", "Global") }, ...scopes.map((value) => ({ value: `project:${value}`, label: value }))]} />
        <span className="qx-settings-muted">
          {t("agent.memory.count", "{n} saved").replace("{n}", visibleMemories.length.toLocaleString(locale))}
        </span>
        <Button variant="outline" size="sm"
          type="button"
          disabled={memoryLoading || operation !== null || !visibleMemories.some((m) => m.active)}
          onClick={() => void compressMemory()}
        >
          {operation === "compress"
            ? <LoadingLabel>{t("agent.memory.compress.running", "Compressing…")}</LoadingLabel>
            : t("agent.memory.compress", "Compress Memory")}
        </Button>
        <Button variant="outline" size="sm"
          className="qx-command-button"
          type="button"
          disabled={memoryLoading || operation !== null}
          onClick={() => void loadMemories()}
        >
          {memoryLoading ? (
            <LoadingLabel>{t("common.refresh", "Refresh")}</LoadingLabel>
          ) : (
            t("common.refresh", "Refresh")
          )}
        </Button>
      </div>
      {compressionResult && <div className="qx-settings-muted" role="status">{compressionResult}</div>}

      <textarea
        value={memoryText}
        disabled={operation !== null}
        onChange={(event) => setMemoryText(event.target.value)}
        rows={3}
        className="qx-inline-input qx-ai-memory-textarea"
        placeholder={t(
          "agent.memory.placeholder",
          "Add a persistent user preference or fact…",
        )}
        aria-label={t("agent.memory.input", "Memory content")}
      />
      <div className="qx-ai-memory-compose">
        <Select value={memoryCategory} options={categories} onChange={setMemoryCategory}
          disabled={operation !== null}
          ariaLabel={t("agent.memory.category", "Memory category")} />
        <input
          value={memoryTags}
          disabled={operation !== null}
          onChange={(event) => setMemoryTags(event.target.value)}
          placeholder={t("agent.memory.tags.placeholder", "Tags, comma-separated")}
          aria-label={t("agent.memory.tags", "Memory tags")}
          className="qx-inline-input"
        />
        <Button variant="outline" size="sm"
          className="qx-command-button primary"
          type="button"
          disabled={!memoryText.trim() || operation !== null}
          onClick={() => void addMemory()}
        >
          {t("agent.memory.add", "Add Memory")}
        </Button>
      </div>

      <Input value={query} onChange={(event) => setQuery(event.target.value)}
        placeholder={t("agent.memory.search", "Filter memories…")}
        aria-label={t("agent.memory.search", "Filter memories…")} />
      {visibleMemories.length === 0 ? (
        <div className="qx-ai-config-muted">{t("agent.memory.empty", "No memory saved yet.")}</div>
      ) : (
        <div className="qx-ai-memory-list">
          {visibleMemories.map((memory) => (
            <article key={memory.id} className="qx-ai-memory-item">
              <div className="qx-ai-memory-item-main">
                <div className="qx-ai-memory-text">{memory.text}</div>
                <div className="qx-ai-memory-meta">
                  <span>{categories.find((item) => item.value === memory.category)?.label}</span>
                  <span>{formatMemoryType(memory.type)}</span>
                  {memory.type === "core" && memory.active === false &&
                    <span>{t("agent.memory.archived", "Archived original")}</span>}
                  <span>{formatMemorySource(memory.source)}</span>
                  <span>
                    {t("agent.memory.importance", "Importance {n}").replace(
                      "{n}",
                      String(memory.importance ?? 60),
                    )}
                  </span>
                  <span>
                    {(memory.tags?.length ?? 0) > 0
                      ? memory.tags.filter((tag) => !/^(category|scope|origin):/.test(tag)).join(", ")
                      : t("agent.memory.untagged", "Untagged")}
                  </span>
                  <time dateTime={new Date(memory.updatedAt).toISOString()}>
                    {dateFormatter.format(new Date(memory.updatedAt))}
                  </time>
                </div>
              </div>
              {(memory.originConversationId || Boolean(memory.supersedes?.length)) &&
                <Button variant="ghost" size="sm" onClick={() => {
                  setSource(memory);
                  if (!useG4fStore.getState().sessionsLoaded) void useG4fStore.getState().loadSessions();
                }}>
                  {t("agent.memory.source.view", "View source")}
                </Button>}
              <Button variant="ghost" size="sm"
                className="qx-command-button qx-ai-memory-delete"
                type="button"
                disabled={operation !== null}
                onClick={() => void deleteMemory(memory.id)}
              >
                {t("common.delete", "Delete")}
              </Button>
            </article>
          ))}
        </div>
      )}
      <Dialog open={source !== null} onOpenChange={(open) => { if (!open) setSource(null); }}>
        <DialogContent className="qx-plugin-config-dialog">
          <DialogTitle>{t("agent.memory.source.view", "View source")}</DialogTitle>
          <div className="qx-ai-memory-list">
            {source?.originConversationId && <section>
              <h3>{sourceConversation?.name || t("agent.memory.source.missing", "Source conversation was deleted or is unavailable")}</h3>
              <code>{source.originConversationId}</code>
              {sourceConversation && <Button variant="outline" size="sm" onClick={() => {
                useG4fStore.getState().selectConversation(sourceConversation.id);
                useStore.getState().setTab("qx-ai");
                setSource(null);
              }}>{t("agent.memory.source.open", "Open conversation")}</Button>}
            </section>}
            {source?.supersedes?.map((id) => <section key={id}>
              <code>{id}</code>
              <p className="qx-ai-memory-text">{memories.find((memory) => memory.id === id)?.text
                || t("agent.memory.source.missing", "Source conversation was deleted or is unavailable")}</p>
            </section>)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
