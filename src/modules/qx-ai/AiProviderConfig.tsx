import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { Badge, Button, Input, LoadingLabel, Select, Toggle } from "../../components/ui";
import { useT } from "../../i18n";
import { useSettingsStore } from "../settings/store";
import { openSettings } from "../settings/openSettings";
import {
  formatContextLength,
  formatModelPickerLabel,
  isFavoriteModel,
  modelCapabilityKey,
  normalizeCatalogModel,
  resolveModelContextLength,
  resolveModelReasoning,
  resolveModelVision,
  resolveModelVisionState,
  sortModelsForPicker,
  toggleFavoriteModelList,
} from "./model-capabilities";
import {
  useG4fStore,
  type BuiltInProviderCredential,
  type CustomProvider,
  type G4fProvider,
  type QxAiModelInfo,
} from "./store";

export interface AiMemoryEntry {
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
      const models = await invoke<Array<{ id: string; name: string; vision?: boolean; reasoning?: boolean }>>(
        "qxai_fetch_models",
        {
          baseUrl: baseUrl.trim(),
          apiKey,
        },
      );
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

type ProviderEditorInitial =
  | { kind: "builtin"; provider: G4fProvider; apiKey: string }
  | { kind: "custom"; provider: CustomProvider };

type ProviderEditorResult =
  | { kind: "builtin"; id: string; apiKey: string }
  | {
      kind: "custom";
      data: {
        name: string;
        baseUrl: string;
        apiKey: string;
        models: QxAiModelInfo[];
      };
    };

function parseModelsFromText(text: string): QxAiModelInfo[] {
  return text
    .split(/[,\n]/)
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => {
      const vision = /vision|vl|gpt-4o|gpt-4\.1|claude-|gemini|pixtral|llava|llama-?4|openrouter\/auto/i
        .test(id);
      return vision ? { id, name: id, vision: true } : { id, name: id };
    });
}

function maskProviderKey(apiKey: string, emptyLabel: string): string {
  if (!apiKey) return emptyLabel;
  if (apiKey.length <= 8) return "••••••••";
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

function ProviderEditor({
  builtInProviders,
  initial,
  onSave,
  onCancel,
}: {
  builtInProviders: G4fProvider[];
  initial?: ProviderEditorInitial;
  onSave: (result: ProviderEditorResult) => Promise<void> | void;
  onCancel: () => void;
}) {
  const t = useT();
  const initialProvider = initial?.kind === "builtin"
    ? initial.provider
    : initial?.kind === "custom"
      ? initial.provider
      : undefined;
  const [templateId, setTemplateId] = useState(
    initial?.kind === "builtin" ? initial.provider.id : "custom",
  );
  const [name, setName] = useState(initialProvider?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initialProvider?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(
    initial?.kind === "builtin" ? initial.apiKey : initial?.provider.apiKey ?? "",
  );
  const [models, setModels] = useState<QxAiModelInfo[]>(
    (initialProvider?.models ?? []).map(normalizeCatalogModel),
  );
  const [modelsText, setModelsText] = useState(
    (initialProvider?.models ?? []).map((model) => model.id).join(", "),
  );
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedTemplate = builtInProviders.find((provider) => provider.id === templateId);
  const isBuiltIn = Boolean(selectedTemplate);

  const canFetchModels = Boolean(baseUrl.trim() && apiKey.trim() && !fetchingModels && !isBuiltIn);
  const canSave = Boolean(
    name.trim()
    && baseUrl.trim()
    && (apiKey.trim() || (isBuiltIn && initial?.kind === "builtin")),
  );

  const applyTemplate = (nextId: string) => {
    setTemplateId(nextId);
    const template = builtInProviders.find((provider) => provider.id === nextId);
    if (!template) {
      setName("");
      setBaseUrl("");
      setApiKey("");
      setModels([]);
      setModelsText("");
      return;
    }
    setName(template.name);
    setBaseUrl(template.baseUrl ?? "");
    const nextModels = template.models.map(normalizeCatalogModel);
    setModels(nextModels);
    setModelsText(nextModels.map((model) => model.id).join(", "));
  };

  const fetchModels = async () => {
    if (!canFetchModels) return;
    setFetchingModels(true);
    setModelsError(null);
    try {
      const fetched = await invoke<QxAiModelInfo[]>("qxai_fetch_models", {
        baseUrl: baseUrl.trim(),
        apiKey,
      });
      const next = fetched.map(normalizeCatalogModel);
      setModels(next);
      setModelsText(next.map((model) => model.id).join(", "));
    } catch (error) {
      setModelsError(String(error));
    } finally {
      setFetchingModels(false);
    }
  };

  const submit = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      if (isBuiltIn) {
        await onSave({
          kind: "builtin",
          id: selectedTemplate?.id ?? (initial?.kind === "builtin" ? initial.provider.id : ""),
          apiKey: apiKey.trim(),
        });
      } else {
        const fromText = parseModelsFromText(modelsText);
        // Prefer structured fetch metadata when ids still match.
        const byId = new Map(models.map((model) => [model.id, model]));
        const merged = fromText.map((model) => byId.get(model.id) ?? model);
        await onSave({
          kind: "custom",
          data: {
            name: name.trim(),
            baseUrl: baseUrl.trim(),
            apiKey: apiKey.trim(),
            models: merged,
          },
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="qx-ai-provider-editor">
      {!initial && (
        <label className="qx-ai-config-field">
          {t("qxai.providers.template", "Provider template")}
          <Select
            value={templateId}
            options={[
              {
                value: "custom",
                label: t("qxai.providers.customTemplate", "Custom OpenAI-compatible provider"),
              },
              ...builtInProviders.map((provider) => ({
                value: provider.id,
                label: `${provider.name} · ${t("qxai.providers.templateLabel", "Template")}`,
              })),
            ]}
            ariaLabel={t("qxai.providers.template", "Provider template")}
            onChange={applyTemplate}
          />
        </label>
      )}

      <div className="qx-ai-provider-editor-grid">
        <label className="qx-ai-config-field">
          {t("qxai.providers.name", "Provider name")}
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("qxai.providers.namePlaceholder", "e.g. My OpenAI")}
            readOnly={isBuiltIn}
          />
        </label>
        <label className="qx-ai-config-field">
          {t("qxai.providers.baseUrl", "Base URL")}
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
            readOnly={isBuiltIn}
          />
        </label>
      </div>

      <label className="qx-ai-config-field">
        {t("qxai.providers.apiKey", "API key")}
        <Input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t("qxai.providers.apiKeyPlaceholder", "Paste an API key")}
          autoComplete="off"
        />
      </label>

      <label className="qx-ai-config-field">
        {t("qxai.providers.models", "Models")}
        <Input
          value={modelsText}
          onChange={(event) => setModelsText(event.target.value)}
          placeholder={t(
            "qxai.providers.modelsPlaceholder",
            "Fetch from /models or enter gpt-4o, gpt-4o-mini…",
          )}
          readOnly={isBuiltIn}
        />
      </label>
      {!isBuiltIn && models.length > 0 && (
        <div className="qx-ai-config-card-meta">
          {t(
            "qxai.providers.modelsPreview",
            "{count} models cached · vision / context filled when the catalog provides them",
          ).replace("{count}", String(models.length))}
        </div>
      )}

      {!isBuiltIn && (
        <div className="qx-ai-config-row">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canFetchModels}
            onClick={() => void fetchModels()}
          >
            {fetchingModels
              ? <LoadingLabel>{t("qxai.providers.fetchingModels", "Fetching models…")}</LoadingLabel>
              : t("qxai.providers.fetchModels", "Fetch models")}
          </Button>
          {modelsError && <span className="qx-ai-config-error">{modelsError}</span>}
        </div>
      )}

      <div className="qx-ai-config-row is-end">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel", "Cancel")}
        </Button>
        <Button type="button" variant="default" size="sm" disabled={!canSave || saving} onClick={() => void submit()}>
          {saving
            ? t("qxai.providers.saving", "Saving…")
            : initial
              ? t("common.save", "Save")
              : t("qxai.providers.add", "Add provider")}
        </Button>
      </div>
    </div>
  );
}

function ProviderModelTable({
  providerId,
  models,
  isCustom,
  onRefreshModels,
  refreshing,
}: {
  providerId: string;
  models: QxAiModelInfo[];
  isCustom: boolean;
  onRefreshModels?: () => void;
  refreshing?: boolean;
}) {
  const t = useT();
  const { settings, patch } = useSettingsStore();
  const agent = settings.agent;
  const [query, setQuery] = useState("");

  const favorites = agent.favorite_models ?? [];
  const caps = agent.model_capabilities ?? {};

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? models.filter(
          (model) =>
            model.id.toLowerCase().includes(q) || (model.name || "").toLowerCase().includes(q),
        )
      : models;
    return sortModelsForPicker(providerId, list, favorites);
  }, [favorites, models, providerId, query]);

  const patchAgent = (partial: Partial<typeof agent>) =>
    patch("agent", { ...agent, ...partial });

  const toggleStar = (modelId: string) => {
    patchAgent({
      favorite_models: toggleFavoriteModelList(favorites, providerId, modelId),
    });
  };

  const setVision = (modelId: string, vision: boolean) => {
    const key = modelCapabilityKey(providerId, modelId);
    patchAgent({
      model_capabilities: {
        ...caps,
        [key]: { ...(caps[key] ?? {}), vision },
      },
    });
  };

  if (models.length === 0) {
    return (
      <div className="qx-ai-model-table-empty">
        {t("qxai.providers.noModelsInProvider", "No models in this provider yet.")}
        {isCustom && onRefreshModels && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={onRefreshModels}
          >
            <RefreshCw size={13} aria-hidden="true" />
            {refreshing
              ? t("qxai.providers.fetchingModels", "Fetching models…")
              : t("qxai.providers.fetchModels", "Fetch models")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="qx-ai-model-table">
      <div className="qx-ai-model-table-toolbar">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("qxai.providers.modelSearch", "Search models…")}
          aria-label={t("qxai.providers.modelSearch", "Search models…")}
          className="qx-ai-model-search"
        />
        {isCustom && onRefreshModels && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={onRefreshModels}
          >
            <RefreshCw size={13} aria-hidden="true" />
            {t("qxai.providers.refreshModels", "Refresh")}
          </Button>
        )}
      </div>
      <div className="qx-ai-model-table-head" aria-hidden="true">
        <span />
        <span>{t("qxai.providers.col.model", "Model")}</span>
        <span>{t("qxai.providers.col.caps", "Capabilities")}</span>
        <span>{t("qxai.providers.col.context", "Context")}</span>
        <span>{t("qxai.providers.col.vision", "Vision")}</span>
      </div>
      <div className="qx-ai-model-table-body" role="list">
        {filtered.map((model) => {
          const starred = isFavoriteModel(providerId, model.id, favorites);
          const vision = resolveModelVision(providerId, model, caps);
          const visionState = resolveModelVisionState(providerId, model, caps);
          const reasoning = resolveModelReasoning(providerId, model, caps);
          const ctx = formatContextLength(
            resolveModelContextLength(providerId, model, caps),
          );
          return (
            <div key={model.id} className="qx-ai-model-row" role="listitem">
              <button
                type="button"
                className={`qx-ai-model-star${starred ? " is-on" : ""}`}
                title={
                  starred
                    ? t("qxai.providers.unstar", "Remove star")
                    : t("qxai.providers.star", "Star for quick pick")
                }
                aria-label={
                  starred
                    ? t("qxai.providers.unstar", "Remove star")
                    : t("qxai.providers.star", "Star for quick pick")
                }
                aria-pressed={starred}
                onClick={() => toggleStar(model.id)}
              >
                <Star size={14} fill={starred ? "currentColor" : "none"} aria-hidden="true" />
              </button>
              <div className="qx-ai-model-row-name" title={model.id}>
                <span className="qx-ai-model-row-title">{model.name || model.id}</span>
                {model.name && model.name !== model.id && (
                  <span className="qx-ai-model-row-id">{model.id}</span>
                )}
              </div>
              <div className="qx-ai-model-badges">
                {vision && (
                  <Badge variant="outline" className="qx-ai-cap-badge is-vision">
                    <Eye size={11} aria-hidden="true" />
                    {t("agent.model.vision.badge", "Vision")}
                  </Badge>
                )}
                {reasoning && (
                  <Badge variant="outline" className="qx-ai-cap-badge is-reasoning">
                    {t("agent.model.reasoning.badge", "Reasoning")}
                  </Badge>
                )}
                {visionState === "unknown" && (
                  <Badge variant="outline" className="qx-ai-cap-badge">
                    {t("qxai.providers.caps.auto", "Auto detect")}
                  </Badge>
                )}
                {visionState === "unsupported" && !reasoning && (
                  <span className="qx-ai-config-card-meta">
                    {t("qxai.providers.caps.none", "Text")}
                  </span>
                )}
              </div>
              <div className="qx-ai-model-ctx" title={ctx ? `${ctx} tokens` : undefined}>
                {ctx ?? "—"}
              </div>
              <div className="qx-ai-model-vision-toggle">
                <Toggle
                  value={vision}
                  onChange={(value) => setVision(model.id, value)}
                  ariaLabel={`${model.id} ${t("agent.model.vision", "Vision (images)")}`}
                />
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && (
        <div className="qx-ai-model-table-empty">
          {t("qxai.providers.modelSearchEmpty", "No models match this search.")}
        </div>
      )}
    </div>
  );
}

export function ProviderListSection() {
  const t = useT();
  const agentCaps = useSettingsStore((s) => s.settings.agent.model_capabilities);
  const {
    builtInProviders,
    builtInCredentials,
    customProviders,
    addCustomProvider,
    removeCustomProvider,
    updateCustomProvider,
    saveBuiltInProviderKey,
    loadProviders,
  } = useG4fStore();
  const [editor, setEditor] = useState<ProviderEditorInitial | "new" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const configured = [
    ...builtInProviders.map((provider) => ({
      kind: "builtin" as const,
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl ?? "",
      models: provider.models,
      apiKey: builtInCredentials.find((credential) => credential.id === provider.id)?.apiKey ?? "",
      provider,
    })),
    ...customProviders.map((provider) => ({
      kind: "custom" as const,
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      models: provider.models,
      apiKey: provider.apiKey,
      provider,
    })),
  ];

  const closeEditor = () => {
    setEditor(null);
    setActionError(null);
  };

  const saveEditor = async (result: ProviderEditorResult) => {
    try {
      if (result.kind === "builtin") {
        await saveBuiltInProviderKey(result.id, result.apiKey);
      } else if (editor && editor !== "new" && editor.kind === "custom") {
        await updateCustomProvider(editor.provider.id, result.data);
      } else {
        await addCustomProvider(result.data);
      }
      closeEditor();
      void loadProviders();
    } catch (error) {
      setActionError(String(error));
    }
  };

  const remove = async (provider: CustomProvider) => {
    if (!window.confirm(
      t("qxai.providers.deleteConfirm", "Delete provider \"{name}\"?").replace("{name}", provider.name),
    )) return;
    try {
      await removeCustomProvider(provider.id);
      if (expandedId === provider.id) setExpandedId(null);
    } catch (error) {
      setActionError(String(error));
    }
  };

  const refreshCustomModels = async (provider: CustomProvider) => {
    if (!provider.baseUrl.trim() || !provider.apiKey.trim()) {
      setActionError(t(
        "qxai.providers.refreshNeedKey",
        "Set base URL and API key before refreshing models.",
      ));
      return;
    }
    setRefreshingId(provider.id);
    setActionError(null);
    try {
      const fetched = await invoke<QxAiModelInfo[]>("qxai_fetch_models", {
        baseUrl: provider.baseUrl.trim(),
        apiKey: provider.apiKey,
      });
      await updateCustomProvider(provider.id, {
        models: fetched.map(normalizeCatalogModel),
      });
      void loadProviders();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setRefreshingId(null);
    }
  };

  const editorInitial = editor && editor !== "new" ? editor : undefined;

  return (
    <div className="qx-ai-provider-section">
      <div className="qx-ai-config-header">
        <div className="qx-ai-config-desc">
          {t(
            "qxai.providers.desc",
            "Built-in templates and OpenAI-compatible providers. Expand a row to star models, toggle vision, and see context windows — same idea as Jan’s provider model list.",
          )}
        </div>
        {!editor && (
          <Button type="button" size="sm" onClick={() => setEditor("new")}>
            <Plus size={14} aria-hidden="true" />
            {t("qxai.providers.add", "Add provider")}
          </Button>
        )}
      </div>

      {editor && (
        <div className="qx-ai-provider-editor-wrap">
          <div className="qx-ai-config-card-title">
            {editor === "new"
              ? t("qxai.providers.addTitle", "Add provider")
              : t("qxai.providers.editTitle", "Edit provider")}
          </div>
          <ProviderEditor
            builtInProviders={builtInProviders}
            initial={editorInitial}
            onSave={saveEditor}
            onCancel={closeEditor}
          />
        </div>
      )}

      {actionError && <div role="alert" className="qx-ai-config-error">{actionError}</div>}

      {configured.length === 0 ? (
        <div className="qx-ai-config-muted">
          {t("qxai.providers.empty", "No providers configured yet.")}
        </div>
      ) : (
        <div className="qx-ai-provider-list" role="list">
          {configured.map((provider) => {
            const isCustom = provider.kind === "custom";
            const expanded = expandedId === provider.id;
            const visionCount = provider.models.filter((model) =>
              resolveModelVision(provider.id, model, agentCaps),
            ).length;
            return (
              <div
                key={provider.id}
                className={`qx-ai-provider-list-row${expanded ? " is-expanded" : ""}`}
                role="listitem"
              >
                <div className="qx-ai-provider-list-main">
                  <button
                    type="button"
                    className="qx-ai-provider-expand"
                    aria-expanded={expanded}
                    onClick={() => setExpandedId(expanded ? null : provider.id)}
                  >
                    {expanded
                      ? <ChevronDown size={15} aria-hidden="true" />
                      : <ChevronRight size={15} aria-hidden="true" />}
                    <span className="qx-ai-provider-list-title-text">{provider.name}</span>
                    <Badge variant="outline">
                      {isCustom
                        ? t("qxai.providers.customBadge", "Custom")
                        : t("qxai.providers.templateBadge", "Template")}
                    </Badge>
                  </button>
                  <div className="qx-ai-config-card-meta">{provider.baseUrl}</div>
                  <div className="qx-ai-config-card-meta">
                    {provider.apiKey
                      ? `${t("qxai.providers.key", "Key")}: ${maskProviderKey(provider.apiKey, "")}`
                      : t("qxai.providers.notConfigured", "API key not configured")}
                    {` · ${provider.models.length} ${t("qxai.providers.modelsCount", "models")}`}
                    {visionCount > 0
                      ? ` · ${visionCount} ${t("qxai.providers.visionCount", "vision")}`
                      : ""}
                  </div>
                </div>
                <div className="qx-ai-provider-list-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditor(
                      isCustom
                        ? { kind: "custom", provider: provider.provider as CustomProvider }
                        : {
                            kind: "builtin",
                            provider: provider.provider as G4fProvider,
                            apiKey: provider.apiKey,
                          },
                    )}
                  >
                    <Pencil size={13} aria-hidden="true" />
                    {t("common.edit", "Edit")}
                  </Button>
                  {isCustom && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="qx-ai-provider-delete"
                      onClick={() => void remove(provider.provider as CustomProvider)}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      {t("common.delete", "Delete")}
                    </Button>
                  )}
                </div>
                {expanded && (
                  <div className="qx-ai-provider-models-panel">
                    <ProviderModelTable
                      providerId={provider.id}
                      models={provider.models}
                      isCustom={isCustom}
                      refreshing={refreshingId === provider.id}
                      onRefreshModels={
                        isCustom
                          ? () => void refreshCustomModels(provider.provider as CustomProvider)
                          : undefined
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Shared model option labels for Settings / chat selectors. */
export function buildModelSelectOptions(options: {
  providerId: string;
  models: QxAiModelInfo[];
  favorites?: string[];
  capabilities?: Record<string, { vision?: boolean; reasoning?: boolean; context_length?: number }>;
  extraModelId?: string;
  visionBadge?: string;
  reasoningBadge?: string;
}): { value: string; label: string }[] {
  const {
    providerId,
    models,
    favorites,
    capabilities,
    extraModelId,
    visionBadge = "Vision",
    reasoningBadge = "Reasoning",
  } = options;
  const list = [...models];
  if (extraModelId && !list.some((model) => model.id === extraModelId)) {
    list.unshift({ id: extraModelId, name: extraModelId });
  }
  return sortModelsForPicker(providerId, list, favorites).map((model) => ({
    value: model.id,
    label: formatModelPickerLabel({
      providerId,
      model,
      favorites,
      overrides: capabilities,
      visionLabel: visionBadge,
      reasoningLabel: reasoningBadge,
    }),
  }));
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
                    {memory.type ?? "core"} · {memory.source ?? "manual"} · {memory.importance ?? 60} ·{" "}
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
