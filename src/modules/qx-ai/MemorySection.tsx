import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingLabel } from "../../components/ui";
import { useLocale, useT } from "../../i18n";
import { useIslandError } from "../../island";

interface AiMemoryEntry {
  id: string;
  text: string;
  tags: string[];
  source?: string;
  type?: "core" | "episodic";
  importance?: number;
  supersedes?: string[];
  createdAt: number;
  updatedAt: number;
}

export function MemorySection({ onSaved }: { onSaved?: (detail: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const [memories, setMemories] = useState<AiMemoryEntry[]>([]);
  const [memoryText, setMemoryText] = useState("");
  const [memoryTags, setMemoryTags] = useState("");
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
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
    setMemoryLoading(true);
    setMemoryError(null);
    try {
      const list = await invoke<AiMemoryEntry[]>("plugin_ai_memory_list");
      setMemories(list.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (err) {
      setMemoryError(String(err));
    } finally {
      setMemoryLoading(false);
    }
  };

  useEffect(() => {
    void loadMemories();
  }, []);

  const addMemory = async () => {
    const text = memoryText.trim();
    if (!text) return;
    setMemoryError(null);
    try {
      const tags = memoryTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      await invoke<AiMemoryEntry>("plugin_ai_memory_add", {
        input: { text, tags },
      });
      setMemoryText("");
      setMemoryTags("");
      await loadMemories();
      onSaved?.(t("agent.memory.saved", "Memory added"));
    } catch (err) {
      setMemoryError(String(err));
    }
  };

  const deleteMemory = async (id: string) => {
    setMemoryError(null);
    try {
      await invoke("plugin_ai_memory_delete", { id });
      await loadMemories();
      onSaved?.(t("agent.memory.deleted", "Memory deleted"));
    } catch (err) {
      setMemoryError(String(err));
    }
  };

  const formatMemoryType = (type?: AiMemoryEntry["type"]) =>
    type === "episodic"
      ? t("agent.memory.type.episodic", "Episodic")
      : t("agent.memory.type.core", "Core");

  const formatMemorySource = (source?: string) =>
    !source || source === "manual"
      ? t("agent.memory.source.manual", "Manual")
      : source;

  return (
    <div className="qx-ai-memory-manager">
      <div className="qx-ai-memory-toolbar">
        <span className="qx-settings-muted">
          {t("agent.memory.count", "{n} saved").replace("{n}", memories.length.toLocaleString(locale))}
        </span>
        <button
          className="qx-command-button"
          type="button"
          disabled={memoryLoading}
          onClick={() => void loadMemories()}
        >
          {memoryLoading ? (
            <LoadingLabel>{t("common.refresh", "Refresh")}</LoadingLabel>
          ) : (
            t("common.refresh", "Refresh")
          )}
        </button>
      </div>

      <textarea
        value={memoryText}
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
        <input
          value={memoryTags}
          onChange={(event) => setMemoryTags(event.target.value)}
          placeholder={t("agent.memory.tags.placeholder", "Tags, comma-separated")}
          aria-label={t("agent.memory.tags", "Memory tags")}
          className="qx-inline-input"
        />
        <button
          className="qx-command-button primary"
          type="button"
          disabled={!memoryText.trim()}
          onClick={() => void addMemory()}
        >
          {t("agent.memory.add", "Add Memory")}
        </button>
      </div>

      {memories.length === 0 ? (
        <div className="qx-ai-config-muted">{t("agent.memory.empty", "No memory saved yet.")}</div>
      ) : (
        <div className="qx-ai-memory-list">
          {memories.map((memory) => (
            <article key={memory.id} className="qx-ai-memory-item">
              <div className="qx-ai-memory-item-main">
                <div className="qx-ai-memory-text">{memory.text}</div>
                <div className="qx-ai-memory-meta">
                  <span>{formatMemoryType(memory.type)}</span>
                  <span>{formatMemorySource(memory.source)}</span>
                  <span>
                    {t("agent.memory.importance", "Importance {n}").replace(
                      "{n}",
                      String(memory.importance ?? 60),
                    )}
                  </span>
                  <span>
                    {(memory.tags?.length ?? 0) > 0
                      ? memory.tags.join(", ")
                      : t("agent.memory.untagged", "Untagged")}
                  </span>
                  <time dateTime={new Date(memory.updatedAt).toISOString()}>
                    {dateFormatter.format(new Date(memory.updatedAt))}
                  </time>
                </div>
              </div>
              <button
                className="qx-command-button qx-ai-memory-delete"
                type="button"
                onClick={() => void deleteMemory(memory.id)}
              >
                {t("common.delete", "Delete")}
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
