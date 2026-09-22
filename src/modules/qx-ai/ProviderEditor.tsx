import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Input, LoadingLabel, Select } from "../../components/ui";
import { useT } from "../../i18n";
import { useIslandError } from "../../island";
import { normalizeCatalogModel } from "./model-capabilities";
import type { CustomProvider, G4fProvider, QxAiModelInfo } from "./store";

export type ProviderEditorInitial =
  | { kind: "builtin"; provider: G4fProvider; apiKey: string }
  | { kind: "custom"; provider: CustomProvider };

export type ProviderEditorResult =
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

export function ProviderEditor({
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
  useIslandError({
    id: "settings.ai-provider-models",
    title: t("qxai.providers.fetchModels", "Fetch models"),
    error: modelsError,
  });
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

      {isBuiltIn ? (
        <div className="qx-ai-config-card-meta">{baseUrl}</div>
      ) : <div className="qx-ai-provider-editor-grid">
        <label className="qx-ai-config-field">
          {t("qxai.providers.name", "Provider name")}
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t("qxai.providers.namePlaceholder", "e.g. My OpenAI")}
            readOnly={isBuiltIn}
            autoFocus
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
      </div>}

      <label className="qx-ai-config-field">
        {t("qxai.providers.apiKey", "API key")}
        <Input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t("qxai.providers.apiKeyPlaceholder", "Paste an API key")}
          autoComplete="off"
          autoFocus={isBuiltIn}
        />
      </label>

      {!isBuiltIn && <label className="qx-ai-config-field">
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
      </label>}
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
