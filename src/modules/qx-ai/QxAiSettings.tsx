import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QxShell, { type BottomIslandContent, type QxShellAction } from "../../components/QxShell";
import { LoadingLabel, Skeleton, Select } from "../../components/ui";
import { useEscBack } from "../../hooks/useEscBack";
import { useT } from "../../i18n";
import { getQxShortcutPreset } from "../../utils/keyboard";
import { openAgentSettingsTab } from "./AiProviderConfig";
import { useG4fStore } from "./store";

/**
 * Simple chat defaults inside the AI module.
 * API keys, custom providers, memory, and agent tools live in Settings → AI Agent.
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

  const defaultIsland = useMemo<BottomIslandContent>(
    () => ({
      label: "Chat Settings",
      detail: `${builtInProviders.length + customProviders.length} providers`,
    }),
    [builtInProviders.length, customProviders.length],
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

  useEffect(() => {
    if (!transientRef.current) {
      setIsland(defaultIsland);
    }
  }, [defaultIsland]);

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
    const allProvs = [
      ...builtInProviders,
      ...customProviders.map((c) => ({ id: c.id, name: c.name, models: c.models })),
    ];
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

  useEffect(() => {
    if (models.length > 0 && !models.find((m) => m.id === currentModel)) {
      setCurrentModel(models[0].id);
    }
  }, [models, currentModel, setCurrentModel]);

  const handleProviderChange = (next: string) => {
    if (next === "---divider---") return;
    setCurrentProvider(next);
    flashSaved("Provider updated");
    const allProvs = [
      ...builtInProviders,
      ...customProviders.map((c) => ({ id: c.id, name: c.name, models: c.models })),
    ];
    const prov = allProvs.find((p) => p.id === next);
    if (prov && prov.models.length > 0) {
      setCurrentModel(prov.models[0].id);
    }
  };

  const actionMenuShortcut = getQxShortcutPreset().actionMenu;
  const settingsActions = useMemo<QxShellAction[]>(
    () => [
      { label: "Done", kbd: "Esc", onClick: () => setView("list") },
      { label: "Agent & Providers", onClick: () => openAgentSettingsTab() },
    ],
    [setView],
  );

  return (
    <QxShell
      title="Chat Settings"
      className="qx-qxai-settings-shell"
      onKeyDown={onKeyDown}
      island={island}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: () => setView("list") }}
      primaryAction={{
        label: "Done",
        kbd: "Esc",
        onClick: () => setView("list"),
      }}
      secondaryAction={{
        label: "Actions",
        kbd: actionMenuShortcut,
      }}
      actionTitle="Chat Settings Actions"
      actions={settingsActions}
    >
      <div className="qx-ai-simple-settings">
        <div className="qx-ai-simple-lead">
          Defaults for new chats. Provider keys, custom endpoints, memory, and agent tools are in
          Settings → AI Agent.
        </div>

        <div>
          <label className="qx-ai-config-field-label">AI Provider</label>
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
            <div className="qx-ai-config-muted">{error || "No providers available"}</div>
          )}
        </div>

        <div>
          <label className="qx-ai-config-field-label">Model</label>
          {models.length > 0 ? (
            <Select
              value={currentModel}
              options={models.map((m) => ({ value: m.id, label: m.name }))}
              onChange={(next) => {
                setCurrentModel(next);
                flashSaved("Model updated");
              }}
              ariaLabel="Model"
            />
          ) : (
            <div className="qx-ai-config-muted">
              {currentProvider
                ? "No models available for this provider"
                : "Select a provider first"}
            </div>
          )}
        </div>

        <div>
          <label className="qx-ai-config-field-label">Default System Prompt</label>
          <textarea
            value={defaultSystemPrompt}
            onChange={(e) => {
              setDefaultSystemPrompt(e.target.value);
              clearTimeout(promptDebounce.current);
              promptDebounce.current = setTimeout(() => flashSaved("System prompt updated"), 1500);
            }}
            rows={4}
            className="qx-ai-system-prompt"
            placeholder="You are a helpful AI assistant."
          />
        </div>

        <div className="qx-ai-simple-advanced">
          <div className="qx-ai-config-title">{t("qxai.advanced", "Advanced configuration")}</div>
          <div className="qx-ai-config-desc">
            API keys, custom OpenAI-compatible providers, memory, agent tools, bash, and grep.
          </div>
          <button
            className="qx-command-button primary"
            type="button"
            onClick={() => openAgentSettingsTab()}
          >
            Open Settings → AI Agent
          </button>
        </div>
      </div>
    </QxShell>
  );
}
