import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { LoadingLabel, Row, Select, SettingsCard, Skeleton } from "../../components/ui";
import { useQxModuleShell } from "../../hooks/useQxModuleShell";
import { useT } from "../../i18n";
import { openAgentSettingsTab } from "./AiProviderConfig";
import { useG4fStore } from "./store";

/**
 * Chat defaults inside the AI module (provider / model / system prompt).
 * Keys, custom endpoints, memory, and agent tools: Settings → AI Agent.
 *
 * Esc: useQxModuleShell stepBack only — never put kbd:"Esc" on primaryAction.
 */
export default function QxAiSettings() {
  const t = useT();
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
  } = useG4fStore();

  const goBack = useCallback(() => setView("list"), [setView]);

  const defaultIsland = useMemo<BottomIslandContent>(
    () => ({
      label: t("qxai.settings.island", "Chat Settings"),
      detail: t("qxai.settings.island.detail", "{n} providers").replace(
        "{n}",
        String(builtInProviders.length + customProviders.length),
      ),
    }),
    [builtInProviders.length, customProviders.length, t],
  );

  const [island, setIsland] = useState<BottomIslandContent>(defaultIsland);
  const islandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const promptDebounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const transientRef = useRef(false);

  const flashSaved = useCallback(
    (detail?: string) => {
      transientRef.current = true;
      setIsland({
        label: t("qxai.settings.saved", "Saved"),
        detail: detail ?? t("qxai.settings.saved.detail", "Settings updated"),
        tone: "success",
      });
      clearTimeout(islandTimer.current);
      islandTimer.current = setTimeout(() => {
        transientRef.current = false;
        setIsland(defaultIsland);
      }, 2500);
    },
    [defaultIsland, t],
  );

  useEffect(() => {
    if (!transientRef.current) setIsland(defaultIsland);
  }, [defaultIsland]);

  const allProviders = useMemo(() => {
    const builtIn: { value: string; label: string; disabled?: boolean }[] = builtInProviders.map(
      (p) => ({ value: p.id, label: p.name }),
    );
    const custom: { value: string; label: string; disabled?: boolean }[] = customProviders.map(
      (p) => ({ value: p.id, label: p.name }),
    );
    if (custom.length > 0) {
      builtIn.push({ value: "---divider---", label: "──────────", disabled: true });
    }
    return [...builtIn, ...custom];
  }, [builtInProviders, customProviders]);

  const models = useMemo(() => {
    const allProvs = [
      ...builtInProviders,
      ...customProviders.map((c) => ({ id: c.id, name: c.name, models: c.models })),
    ];
    const prov = allProvs.find((p) => p.id === currentProvider);
    return prov?.models ?? [];
  }, [builtInProviders, customProviders, currentProvider]);

  useEffect(() => {
    if (builtInProviders.length === 0 && customProviders.length === 0) {
      void loadProviders();
    }
  }, [loadProviders, builtInProviders.length, customProviders.length]);

  useEffect(() => {
    if (models.length > 0 && !models.find((m) => m.id === currentModel)) {
      setCurrentModel(models[0].id);
    }
  }, [models, currentModel, setCurrentModel]);

  const handleProviderChange = (next: string) => {
    if (next === "---divider---") return;
    setCurrentProvider(next);
    flashSaved(t("qxai.settings.providerUpdated", "Provider updated"));
    const allProvs = [
      ...builtInProviders,
      ...customProviders.map((c) => ({ id: c.id, name: c.name, models: c.models })),
    ];
    const prov = allProvs.find((p) => p.id === next);
    if (prov && prov.models.length > 0) {
      setCurrentModel(prov.models[0].id);
    }
  };

  const settingsActions = useMemo<QxShellAction[]>(
    () => [
      // No kbd Esc here — Esc is only bottom-left escapeAction (UI_SPEC).
      { label: t("qxai.settings.done", "Done"), onClick: goBack },
      {
        label: t("qxai.agentProviders", "Agent & Providers"),
        onClick: () => openAgentSettingsTab(),
      },
    ],
    [goBack, t],
  );

  const shell = useQxModuleShell({
    leave: goBack,
    island,
    t,
  });

  return (
    <QxShell
      title={t("qxai.settings.title", "Chat Settings")}
      islandKey="qx-ai.settings"
      visual="elevated"
      className="qx-qxai-settings-shell"
      onKeyDown={shell.onKeyDown}
      island={shell.island}
      escapeAction={shell.escapeAction}
      primaryAction={{
        label: t("qxai.settings.done", "Done"),
        tone: "primary",
        onClick: goBack,
      }}
      secondaryAction={shell.secondaryAction}
      actionTitle={t("qxai.settings.actions", "Chat Settings Actions")}
      actions={settingsActions}
    >
      <div className="qx-settings-page" style={{ padding: "12px 14px", maxWidth: 720 }}>
        <SettingsCard
          title={t("qxai.settings.defaults", "Chat defaults")}
          description={t(
            "qxai.settings.defaults.desc",
            "Defaults for new chats in this module. API keys, custom endpoints, memory, and agent tools live in Settings → AI Agent.",
          )}
        >
          <Row
            title={t("qxai.provider", "AI Provider")}
            description={t("qxai.provider.desc", "Default provider for new conversations.")}
          >
            {loading ? (
              <div className="qx-skeleton-stack" aria-label={t("qxai.loadingProviders", "Loading providers")}>
                <LoadingLabel>{t("qxai.loadingProviders", "Loading providers…")}</LoadingLabel>
                <Skeleton className="qx-skeleton-line long" />
              </div>
            ) : allProviders.length > 0 ? (
              <Select
                value={currentProvider}
                options={allProviders}
                onChange={handleProviderChange}
                ariaLabel={t("qxai.provider", "AI Provider")}
              />
            ) : (
              <div className="qx-ai-config-muted">
                {error || t("qxai.noProviders", "No providers available")}
              </div>
            )}
          </Row>

          <Row
            title={t("qxai.model", "Model")}
            description={t("qxai.model.desc", "Default model for the selected provider.")}
          >
            {models.length > 0 ? (
              <Select
                value={currentModel}
                options={models.map((m) => ({ value: m.id, label: m.name }))}
                onChange={(next) => {
                  setCurrentModel(next);
                  flashSaved(t("qxai.settings.modelUpdated", "Model updated"));
                }}
                ariaLabel={t("qxai.model", "Model")}
              />
            ) : (
              <div className="qx-ai-config-muted">
                {currentProvider
                  ? t("qxai.noModels", "No models available for this provider")
                  : t("qxai.selectProviderFirst", "Select a provider first")}
              </div>
            )}
          </Row>

          <div style={{ padding: "10px 0 4px" }}>
            <label className="qx-ai-config-field-label">
              {t("qxai.systemPrompt", "Default System Prompt")}
            </label>
            <textarea
              value={defaultSystemPrompt}
              onChange={(e) => {
                setDefaultSystemPrompt(e.target.value);
                clearTimeout(promptDebounce.current);
                promptDebounce.current = setTimeout(
                  () => flashSaved(t("qxai.settings.promptUpdated", "System prompt updated")),
                  1500,
                );
              }}
              rows={4}
              className="qx-ai-system-prompt"
              placeholder={t("qxai.systemPrompt.placeholder", "You are a helpful AI assistant.")}
            />
          </div>
        </SettingsCard>

        <SettingsCard
          title={t("qxai.advanced", "Advanced configuration")}
          description={t(
            "qxai.advanced.desc",
            "API keys, custom OpenAI-compatible providers, memory, agent tools, bash, and grep.",
          )}
        >
          <div style={{ padding: "4px 0 8px" }}>
            <button
              className="qx-command-button primary"
              type="button"
              onClick={() => openAgentSettingsTab()}
            >
              {t("qxai.openAgentSettings", "Open Settings → AI Agent")}
            </button>
          </div>
        </SettingsCard>
      </div>
    </QxShell>
  );
}
