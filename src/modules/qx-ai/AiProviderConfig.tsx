import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoadingLabel } from "../../components/ui";
import { useT } from "../../i18n";
import { openSettings } from "../settings/openSettings";
import {
  useG4fStore,
  type BuiltInProviderCredential,
  type CustomProvider,
  type G4fProvider,
} from "./store";

export interface AiMemoryEntry {
  id: string;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export function BuiltInProviderKeys({
  providers,
  credentials,
  onSave,
}: {
  providers: G4fProvider[];
  credentials: BuiltInProviderCredential[];
  onSave: (id: string, apiKey: string) => Promise<void>;
}) {
  const t = useT();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(Object.fromEntries(credentials.map((item) => [item.id, item.apiKey])));
  }, [credentials]);

  if (providers.length === 0) return null;

  return (
    <div className="qx-ai-config-block">
      <div className="qx-ai-config-title">{t("qxai.builtinKeys", "Built-in Provider Keys")}</div>
      <div className="qx-ai-config-desc">
        {t(
          "qxai.builtinKeys.desc",
          "Qx manages the endpoint and recommended models. Add only your API key.",
        )}
      </div>
      <div className="qx-ai-config-stack">
        {providers.map((provider) => {
          const savedKey = credentials.find((item) => item.id === provider.id)?.apiKey ?? "";
          const draft = drafts[provider.id] ?? "";
          const isSaving = savingId === provider.id;
          return (
            <div key={provider.id} className="qx-ai-config-card">
              <div className="qx-ai-config-card-title">{provider.name}</div>
              <div className="qx-ai-config-card-meta">{provider.baseUrl}</div>
              <div className="qx-ai-config-row">
                <input
                  type="password"
                  value={draft}
                  onChange={(event) =>
                    setDrafts((current) => ({ ...current, [provider.id]: event.target.value }))
                  }
                  placeholder={provider.id === "openrouter" ? "sk-or-v1-..." : "sk-..."}
                  aria-label={`${provider.name} API Key`}
                  className="qx-inline-input"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  className="qx-command-button primary"
                  type="button"
                  disabled={isSaving || draft === savedKey}
                  onClick={() => {
                    setSavingId(provider.id);
                    setSaveError(null);
                    void onSave(provider.id, draft)
                      .catch((error) => setSaveError(String(error)))
                      .finally(() => setSavingId(null));
                  }}
                >
                  {isSaving
                    ? t("qxai.key.saving", "Saving...")
                    : draft.trim()
                      ? t("qxai.key.save", "Save Key")
                      : t("qxai.key.remove", "Remove Key")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {saveError && (
        <div role="alert" className="qx-ai-config-error">
          {saveError}
        </div>
      )}
    </div>
  );
}

export function AddProviderForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: CustomProvider;
  onSave: (p: { name: string; baseUrl: string; apiKey: string; models: { id: string; name: string }[] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [modelsText, setModelsText] = useState(
    initial?.models.map((m) => m.id).join(", ") ?? "",
  );
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const canFetchModels = Boolean(baseUrl.trim() && apiKey.trim() && !fetchingModels);
  const canSave = Boolean(name.trim() && baseUrl.trim() && apiKey.trim());

  const fetchModels = async () => {
    if (!canFetchModels) return;
    setFetchingModels(true);
    setModelsError(null);
    try {
      const models = await invoke<{ id: string; name: string }[]>("qxai_fetch_models", {
        baseUrl: baseUrl.trim(),
        apiKey,
      });
      setModelsText(models.map((model) => model.id).join(", "));
    } catch (error) {
      setModelsError(String(error));
    } finally {
      setFetchingModels(false);
    }
  };

  return (
    <div className="qx-ai-config-card qx-ai-config-form">
      <div className="qx-ai-config-card-title">
        {initial ? "Edit Custom Provider" : "Add Custom Provider"}
      </div>

      <label className="qx-ai-config-field">
        Provider Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My OpenAI"
          className="qx-inline-input"
        />
      </label>

      <label className="qx-ai-config-field">
        Base URL
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="e.g. https://api.openai.com/v1"
          className="qx-inline-input"
        />
      </label>

      <label className="qx-ai-config-field">
        API Key
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          type="password"
          className="qx-inline-input"
        />
      </label>

      <label className="qx-ai-config-field">
        Models (fetched from API, optional cache)
        <input
          value={modelsText}
          onChange={(e) => setModelsText(e.target.value)}
          placeholder="Fetch from /models or enter gpt-4o, gpt-4o-mini..."
          className="qx-inline-input"
        />
      </label>
      <div className="qx-ai-config-row">
        <button
          className="qx-command-button"
          type="button"
          disabled={!canFetchModels}
          onClick={() => void fetchModels()}
        >
          {fetchingModels ? <LoadingLabel>Fetch Models</LoadingLabel> : "Fetch Models"}
        </button>
        {modelsError && <span className="qx-ai-config-error">{modelsError}</span>}
      </div>

      <div className="qx-ai-config-row is-end">
        <button className="qx-command-button" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="qx-command-button primary"
          type="button"
          disabled={!canSave}
          onClick={() => {
            if (!canSave) return;
            const models = modelsText
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
              .map((id) => ({ id, name: id }));
            onSave({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey, models });
          }}
        >
          {initial ? "Save" : "Add"}
        </button>
      </div>
    </div>
  );
}

export function CustomProvidersSection({ onSaved }: { onSaved?: (detail: string) => void }) {
  const {
    customProviders,
    addCustomProvider,
    removeCustomProvider,
    updateCustomProvider,
  } = useG4fStore();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const maskedKey = (cp: CustomProvider) => {
    if (cp.apiKey.length <= 8) return "********";
    return `${cp.apiKey.slice(0, 4)}…${cp.apiKey.slice(-4)}`;
  };

  return (
    <div className="qx-ai-config-block">
      <div className="qx-ai-config-header">
        <span className="qx-ai-config-title">Custom Providers (BYOK)</span>
        {!adding && (
          <button className="qx-command-button primary" type="button" onClick={() => setAdding(true)}>
            + Add
          </button>
        )}
      </div>

      {adding && (
        <div style={{ marginBottom: 12 }}>
          <AddProviderForm
            onSave={(data) => {
              void addCustomProvider(data);
              setAdding(false);
              onSaved?.("Provider added");
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {customProviders.length === 0 && !adding && (
        <div className="qx-ai-config-muted">
          No custom providers yet. Add your own API key-based providers.
        </div>
      )}

      {customProviders.map((cp) => {
        const isEditing = editingId === cp.id;
        return (
          <div key={cp.id} className="qx-ai-config-card" style={{ marginBottom: 8 }}>
            {isEditing ? (
              <AddProviderForm
                initial={cp}
                onSave={(data) => {
                  void updateCustomProvider(cp.id, data);
                  setEditingId(null);
                  onSaved?.("Provider updated");
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div className="qx-ai-config-card-row">
                <div style={{ minWidth: 0 }}>
                  <div className="qx-ai-config-card-title">{cp.name}</div>
                  <div className="qx-ai-config-card-meta">Base URL: {cp.baseUrl}</div>
                  <div className="qx-ai-config-card-meta">API Key: {maskedKey(cp)}</div>
                  <div className="qx-ai-config-card-meta">
                    Models: {cp.models.map((m) => m.id).join(", ")}
                  </div>
                </div>
                <div className="qx-ai-config-row">
                  <button
                    className="qx-command-button"
                    type="button"
                    onClick={() => setEditingId(cp.id)}
                  >
                    Edit
                  </button>
                  <button
                    className="qx-command-button"
                    type="button"
                    style={{ color: "var(--qx-danger)" }}
                    onClick={() => {
                      if (window.confirm(`Delete provider "${cp.name}"?`)) {
                        void removeCustomProvider(cp.id);
                        onSaved?.("Provider removed");
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MemorySection({ onSaved }: { onSaved?: (detail: string) => void }) {
  const [memories, setMemories] = useState<AiMemoryEntry[]>([]);
  const [memoryText, setMemoryText] = useState("");
  const [memoryTags, setMemoryTags] = useState("");
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);

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
      onSaved?.("Memory added");
    } catch (err) {
      setMemoryError(String(err));
    }
  };

  const deleteMemory = async (id: string) => {
    setMemoryError(null);
    try {
      await invoke("plugin_ai_memory_delete", { id });
      await loadMemories();
      onSaved?.("Memory deleted");
    } catch (err) {
      setMemoryError(String(err));
    }
  };

  return (
    <div className="qx-ai-config-block">
      <div className="qx-ai-config-header">
        <span className="qx-ai-config-title">Memory</span>
        <button
          className="qx-command-button"
          type="button"
          disabled={memoryLoading}
          onClick={() => void loadMemories()}
        >
          {memoryLoading ? <LoadingLabel>Refresh</LoadingLabel> : "Refresh"}
        </button>
      </div>

      <textarea
        value={memoryText}
        onChange={(event) => setMemoryText(event.target.value)}
        rows={3}
        className="qx-inline-input"
        placeholder="Add a persistent user preference or fact..."
        style={{
          width: "100%",
          boxSizing: "border-box",
          minHeight: 72,
          resize: "vertical",
          lineHeight: 1.5,
          marginBottom: 8,
        }}
      />
      <div className="qx-ai-config-row" style={{ marginBottom: 12 }}>
        <input
          value={memoryTags}
          onChange={(event) => setMemoryTags(event.target.value)}
          placeholder="tags, comma-separated"
          className="qx-inline-input"
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          className="qx-command-button primary"
          type="button"
          disabled={!memoryText.trim()}
          onClick={() => void addMemory()}
        >
          Add Memory
        </button>
      </div>

      {memoryError && <div className="qx-ai-config-error">{memoryError}</div>}

      {memories.length === 0 ? (
        <div className="qx-ai-config-muted">No memory saved yet.</div>
      ) : (
        <div className="qx-ai-config-stack">
          {memories.map((memory) => (
            <div key={memory.id} className="qx-ai-config-card">
              <div className="qx-ai-config-card-row">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                    {memory.text}
                  </div>
                  <div className="qx-ai-config-card-meta" style={{ marginTop: 4 }}>
                    {memory.tags.length > 0 ? memory.tags.join(", ") : "untagged"} ·{" "}
                    {new Date(memory.updatedAt).toLocaleString()}
                  </div>
                </div>
                <button
                  className="qx-command-button"
                  type="button"
                  style={{ color: "var(--qx-danger)", flex: "0 0 auto" }}
                  onClick={() => void deleteMemory(memory.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Open host Settings → AI Agent, returning to the current QxAI tab on Esc. */
export function openAgentSettingsTab() {
  openSettings({ section: "agent" });
}
