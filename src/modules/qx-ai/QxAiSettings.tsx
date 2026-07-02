import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import QxShell from "../../components/QxShell";
import type { BottomIslandContent } from "../../components/QxBottomIsland";
import { LoadingLabel, Skeleton, Select } from "../../components/ui";
import { useEscBack } from "../../hooks/useEscBack";
import { useG4fStore, type CustomProvider } from "./store";

interface AiMemoryEntry {
  id: string;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

function AddProviderForm({
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

  const canFetchModels = baseUrl.trim() && apiKey.trim() && !fetchingModels;
  const canSave = name.trim() && baseUrl.trim() && apiKey.trim();

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
    <div
      style={{
        background: "var(--qx-bg-component-2)",
        borderRadius: "var(--qx-card-radius)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--qx-text-primary)" }}>
        {initial ? "Edit Custom Provider" : "Add Custom Provider"}
      </div>

      <label style={{ fontSize: 12, color: "var(--qx-text-secondary)" }}>
        Provider Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My OpenAI"
          className="qx-inline-input"
          style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }}
        />
      </label>

      <label style={{ fontSize: 12, color: "var(--qx-text-secondary)" }}>
        Base URL
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="e.g. https://api.openai.com/v1"
          className="qx-inline-input"
          style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }}
        />
      </label>

      <label style={{ fontSize: 12, color: "var(--qx-text-secondary)" }}>
        API Key
        <input
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          type="password"
          className="qx-inline-input"
          style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }}
        />
      </label>

      <label style={{ fontSize: 12, color: "var(--qx-text-secondary)" }}>
        Models (fetched from API, optional cache)
        <input
          value={modelsText}
          onChange={(e) => setModelsText(e.target.value)}
          placeholder="Fetch from /models or enter gpt-4o, gpt-4o-mini..."
          className="qx-inline-input"
          style={{ width: "100%", marginTop: 4, boxSizing: "border-box" }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="qx-command-button"
          disabled={!canFetchModels}
          onClick={() => void fetchModels()}
        >
          {fetchingModels ? <LoadingLabel>Fetch Models</LoadingLabel> : "Fetch Models"}
        </button>
        {modelsError && (
          <span style={{ color: "var(--qx-danger)", fontSize: 12 }}>
            {modelsError}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="qx-command-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="qx-command-button primary"
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

export default function QxAiSettings() {
  const {
    builtInProviders,
    customProviders,
    loading,
    error,
    defaultSystemPrompt,
    currentProvider,
    currentModel,
    setDefaultSystemPrompt,
    setCurrentProvider,
    setCurrentModel,
    setView,
    loadProviders,
    addCustomProvider,
    removeCustomProvider,
    updateCustomProvider,
  } = useG4fStore();

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [memories, setMemories] = useState<AiMemoryEntry[]>([]);
  const [memoryText, setMemoryText] = useState("");
  const [memoryTags, setMemoryTags] = useState("");
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);

  const defaultIsland = useMemo<BottomIslandContent>(
    () => ({
      label: "Settings",
      detail: `${builtInProviders.length + customProviders.length} providers · ${memories.length} memories`,
    }),
    [builtInProviders.length, customProviders.length, memories.length],
  );

  const [island, setIsland] = useState<BottomIslandContent>(defaultIsland);
  const islandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const promptDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const transientRef = useRef(false);

  const flashSaved = useCallback((detail?: string) => {
    transientRef.current = true;
    setIsland({ label: "Saved", detail: detail ?? "Settings updated", tone: "success" });
    clearTimeout(islandTimer.current);
    islandTimer.current = setTimeout(() => {
      transientRef.current = false;
      setIsland(defaultIsland);
    }, 2500);
  }, [defaultIsland]);

  // sync island when defaultIsland changes, but not during transient "Saved" display
  useEffect(() => {
    if (!transientRef.current) {
      setIsland(defaultIsland);
    }
  }, [defaultIsland]);

  // Merge built-in + custom for the Select
  const allProviders = useMemo(() => {
    const builtIn: { value: string; label: string; disabled?: boolean }[] = builtInProviders.map((p) => ({
      value: p.id,
      label: p.name,
    }));
    const custom: { value: string; label: string; disabled?: boolean }[] = customProviders.map((p) => ({
      value: p.id,
      label: p.name,
    }));
    if (custom.length > 0) {
      builtIn.push({ value: "---divider---", label: "──────────", disabled: true });
    }
    return [...builtIn, ...custom];
  }, [builtInProviders, customProviders]);

  const models = useMemo(() => {
    const allProvs = [...builtInProviders, ...customProviders.map((c) => ({ id: c.id, name: c.name, models: c.models }))];
    const prov = allProvs.find((p) => p.id === currentProvider);
    return prov?.models ?? [];
  }, [builtInProviders, customProviders, currentProvider]);

  const { onKeyDown } = useEscBack({
    launcher: () => setView("list"),
  });

  useEffect(() => {
    if (builtInProviders.length === 0 && customProviders.length === 0) {
      void loadProviders();
    }
  }, [loadProviders, builtInProviders.length, customProviders.length]);

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
      flashSaved("Memory added");
    } catch (err) {
      setMemoryError(String(err));
    }
  };

  const deleteMemory = async (id: string) => {
    setMemoryError(null);
    try {
      await invoke("plugin_ai_memory_delete", { id });
      await loadMemories();
      flashSaved("Memory deleted");
    } catch (err) {
      setMemoryError(String(err));
    }
  };

  // Select auto-switches to first model if current model gone
  useEffect(() => {
    if (models.length > 0 && !models.find((m) => m.id === currentModel)) {
      setCurrentModel(models[0].id);
    }
  }, [models, currentModel, setCurrentModel]);

  const handleProviderChange = (next: string) => {
    if (next === "---divider---") return;
    setCurrentProvider(next);
    flashSaved("Provider updated");
    const allProvs = [...builtInProviders, ...customProviders.map((c) => ({ id: c.id, name: c.name, models: c.models }))];
    const prov = allProvs.find((p) => p.id === next);
    if (prov && prov.models.length > 0) {
      setCurrentModel(prov.models[0].id);
    }
  };

  const maskedKey = (cp: CustomProvider) => {
    if (cp.apiKey.length <= 8) return "********";
    return cp.apiKey.slice(0, 4) + "…" + cp.apiKey.slice(-4);
  };

  return (
    <QxShell
      title="QxAI Settings"
      className="qx-qxai-settings-shell"
      onKeyDown={onKeyDown}
      onBack={() => setView("list")}
      backLabel="Back"
      island={island}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: () => setView("list") }}
    >
      <div
        style={{
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
          color: "var(--qx-text-primary)",
          fontSize: 14,
        }}
      >
        {/* Provider selector */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--qx-text-primary)",
              marginBottom: 6,
            }}
          >
            AI Provider
          </label>
          {loading ? (
            <div className="qx-skeleton-stack" aria-label="Loading providers">
              <LoadingLabel>Loading providers...</LoadingLabel>
              <Skeleton className="qx-skeleton-line long" />
              <Skeleton className="qx-skeleton-line medium" />
            </div>
          ) : allProviders.length > 0 ? (
            <Select
              value={currentProvider}
              options={allProviders}
              onChange={handleProviderChange}
              ariaLabel="AI Provider"
            />
          ) : (
            <div style={{ fontSize: 13, color: "var(--qx-text-tertiary)" }}>
              {error || "No providers available"}
            </div>
          )}
        </div>

        {/* Model selector */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--qx-text-primary)",
              marginBottom: 6,
            }}
          >
            Model
          </label>
          {models.length > 0 ? (
            <Select
              value={currentModel}
              options={models.map((m) => ({ value: m.id, label: m.name }))}
              onChange={(next) => { setCurrentModel(next); flashSaved("Model updated"); }}
              ariaLabel="Model"
            />
          ) : (
            <div style={{ fontSize: 13, color: "var(--qx-text-tertiary)" }}>
              {currentProvider
                ? "No models available for this provider"
                : "Select a provider first"}
            </div>
          )}
        </div>

        {/* Default system prompt */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--qx-text-primary)",
              marginBottom: 6,
            }}
          >
            Default System Prompt
          </label>
          <textarea
            value={defaultSystemPrompt}
            onChange={(e) => {
              setDefaultSystemPrompt(e.target.value);
              clearTimeout(promptDebounce.current);
              promptDebounce.current = setTimeout(() => flashSaved("System prompt updated"), 1500);
            }}
            rows={4}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "var(--qx-control-radius)",
              border: "1px solid var(--qx-border-1)",
              background: "var(--qx-bg-component-1)",
              color: "var(--qx-text-primary)",
              fontSize: 13,
              fontFamily: "inherit",
              lineHeight: 1.5,
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
            placeholder="You are a helpful AI assistant."
          />
        </div>

        {/* User memory */}
        <div
          style={{
            borderTop: "1px solid var(--qx-border-1)",
            paddingTop: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>Memory</span>
            <button
              className="qx-command-button"
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
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input
              value={memoryTags}
              onChange={(event) => setMemoryTags(event.target.value)}
              placeholder="tags, comma-separated"
              className="qx-inline-input"
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              className="qx-command-button primary"
              disabled={!memoryText.trim()}
              onClick={() => void addMemory()}
            >
              Add Memory
            </button>
          </div>

          {memoryError && (
            <div style={{ color: "var(--qx-danger)", fontSize: 12, marginBottom: 8 }}>
              {memoryError}
            </div>
          )}

          {memories.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--qx-text-tertiary)" }}>
              No memory saved yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {memories.map((memory) => (
                <div
                  key={memory.id}
                  style={{
                    background: "var(--qx-bg-component-2)",
                    borderRadius: "var(--qx-card-radius)",
                    padding: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                        {memory.text}
                      </div>
                      <div style={{ color: "var(--qx-text-tertiary)", fontSize: 11, marginTop: 4 }}>
                        {memory.tags.length > 0 ? memory.tags.join(", ") : "untagged"} · {new Date(memory.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      className="qx-command-button"
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

        {/* ——— Custom Providers (BYOK) ——— */}
        <div
          style={{
            borderTop: "1px solid var(--qx-border-1)",
            paddingTop: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>Custom Providers (BYOK)</span>
            {!adding && (
              <button
                className="qx-command-button primary"
                onClick={() => setAdding(true)}
              >
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
                  flashSaved("Provider added");
                }}
                onCancel={() => setAdding(false)}
              />
            </div>
          )}

          {customProviders.length === 0 && !adding && (
            <div style={{ fontSize: 13, color: "var(--qx-text-tertiary)" }}>
              No custom providers yet. Add your own API key-based providers.
            </div>
          )}

          {customProviders.map((cp) => {
            const isEditing = editingId === cp.id;
            return (
              <div
                key={cp.id}
                style={{
                  background: "var(--qx-bg-component-2)",
                  borderRadius: "var(--qx-card-radius)",
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                {isEditing ? (
                  <AddProviderForm
                    initial={cp}
                    onSave={(data) => {
                      void updateCustomProvider(cp.id, data);
                      setEditingId(null);
                      flashSaved("Provider updated");
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                          {cp.name}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--qx-text-secondary)", marginBottom: 2 }}>
                          Base URL: {cp.baseUrl}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--qx-text-secondary)", marginBottom: 2 }}>
                          API Key: {maskedKey(cp)}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--qx-text-secondary)" }}>
                          Models: {cp.models.map((m) => m.id).join(", ")}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="qx-command-button"
                          onClick={() => setEditingId(cp.id)}
                        >
                          Edit
                        </button>
                        <button
                          className="qx-command-button"
                          style={{ color: "var(--qx-danger)" }}
                          onClick={() => {
                            if (window.confirm(`Delete provider "${cp.name}"?`)) {
                              void removeCustomProvider(cp.id);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Info */}
        <div
          style={{
            fontSize: 12,
            color: "var(--qx-text-tertiary)",
            lineHeight: 1.5,
          }}
        >
          Settings define the default provider and model for new conversations.
          Use the chat sidebar controls to switch an existing conversation.
          Custom providers are persisted locally at ~/.qx/qxai-custom-providers.json.
        </div>
      </div>
    </QxShell>
  );
}
