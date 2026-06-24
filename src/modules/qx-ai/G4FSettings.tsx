import { useEffect, useMemo } from "react";
import QxShell from "../../components/QxShell";
import { useEscBack } from "../../hooks/useEscBack";
import { useG4fStore } from "./store";

export default function G4FSettings() {
  const {
    providers,
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

  useEffect(() => {
    if (providers.length === 0) {
      void loadProviders();
    }
  }, [loadProviders, providers.length]);

  const models = useMemo(() => {
    const prov = providers.find((p) => p.id === currentProvider);
    return prov?.models ?? [];
  }, [providers, currentProvider]);

  const { onKeyDown } = useEscBack({
    launcher: () => setView("list"),
  });

  return (
    <QxShell
      title="AI Chat Settings"
      className="qx-g4f-settings-shell"
      onKeyDown={onKeyDown}
      onBack={() => setView("list")}
      backLabel="Conversations"
      island={{
        label: "Settings",
        detail: `${providers.length} provider${providers.length !== 1 ? "s" : ""}`,
      }}
      escapeAction={{ label: "Esc", kbd: "Esc", onClick: () => setView("list") }}
    >
      <div
        style={{
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Provider selector */}
        <div>
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--qx-fg, #cdd6f4)",
              marginBottom: 6,
            }}
          >
            AI Provider
          </label>
          {loading ? (
            <div
              style={{
                fontSize: 13,
                color: "var(--qx-fg-subtle, #6c7086)",
              }}
            >
              Loading providers...
            </div>
          ) : providers.length > 0 ? (
            <select
              value={currentProvider}
              onChange={(e) => {
                const next = e.target.value;
                setCurrentProvider(next);
                const prov = providers.find((p) => p.id === next);
                if (prov && prov.models.length > 0) {
                  setCurrentModel(prov.models[0].id);
                }
              }}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "var(--qx-card-radius, 6px)",
                border: "1px solid var(--qx-border-1, #313244)",
                background: "var(--qx-bg-2, #1e1e2e)",
                color: "var(--qx-fg, #cdd6f4)",
                fontSize: 14,
                outline: "none",
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <div
              style={{
                fontSize: 13,
                color: "var(--qx-fg-subtle, #6c7086)",
              }}
            >
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
              color: "var(--qx-fg, #cdd6f4)",
              marginBottom: 6,
            }}
          >
            Model
          </label>
          {models.length > 0 ? (
            <select
              value={currentModel}
              onChange={(e) => setCurrentModel(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: "var(--qx-card-radius, 6px)",
                border: "1px solid var(--qx-border-1, #313244)",
                background: "var(--qx-bg-2, #1e1e2e)",
                color: "var(--qx-fg, #cdd6f4)",
                fontSize: 14,
                outline: "none",
              }}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <div
              style={{
                fontSize: 13,
                color: "var(--qx-fg-subtle, #6c7086)",
              }}
            >
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
              color: "var(--qx-fg, #cdd6f4)",
              marginBottom: 6,
            }}
          >
            Default System Prompt
          </label>
          <textarea
            value={defaultSystemPrompt}
            onChange={(e) => setDefaultSystemPrompt(e.target.value)}
            rows={4}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "var(--qx-card-radius, 6px)",
              border: "1px solid var(--qx-border-1, #313244)",
              background: "var(--qx-bg-2, #1e1e2e)",
              color: "var(--qx-fg, #cdd6f4)",
              fontSize: 13,
              fontFamily: "inherit",
              lineHeight: 1.5,
              resize: "vertical",
              outline: "none",
            }}
            placeholder="You are a helpful AI assistant."
          />
        </div>

        {/* Info */}
        <div
          style={{
            fontSize: 12,
            color: "var(--qx-fg-subtle, #6c7086)",
            lineHeight: 1.5,
          }}
        >
          Changes take effect when creating new conversations. Existing
          conversations retain their original provider and model settings.
        </div>
      </div>
    </QxShell>
  );
}
