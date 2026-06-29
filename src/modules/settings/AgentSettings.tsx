import { useEffect, useMemo } from "react";
import { Row, SegmentedControl, Select, Slider, Toggle } from "../../components/ui";
import { useG4fStore } from "../qx-ai/store";
import { useT } from "../../i18n";
import { useSettingsStore, type AgentSettings as AgentSettingsValue } from "./store";

type ProviderOption = { value: string; label: string; disabled?: boolean };

function SectionLabel({ children }: { children: string }) {
  return <div className="qx-settings-section-label">{children}</div>;
}

export default function AgentSettings() {
  const { settings, patch } = useSettingsStore();
  const {
    providers,
    builtInProviders,
    customProviders,
    currentProvider,
    currentModel,
    loading,
    error,
    loadProviders,
    setCurrentProvider,
    setCurrentModel,
  } = useG4fStore();
  const t = useT();
  const agent = settings.agent;

  useEffect(() => {
    if (providers.length === 0 && builtInProviders.length === 0 && customProviders.length === 0) {
      void loadProviders();
    }
  }, [builtInProviders.length, customProviders.length, loadProviders, providers.length]);

  const allProviders = useMemo(() => {
    if (providers.length > 0) return providers;
    return [
      ...builtInProviders,
      ...customProviders.map((provider) => ({
        id: provider.id,
        name: provider.name,
        models: provider.models,
      })),
    ];
  }, [builtInProviders, customProviders, providers]);

  const providerOptions = useMemo<ProviderOption[]>(() => {
    const builtIn = allProviders
      .filter((provider) => !provider.id.startsWith("custom:"))
      .map((provider) => ({ value: provider.id, label: provider.name }));
    const custom = allProviders
      .filter((provider) => provider.id.startsWith("custom:"))
      .map((provider) => ({ value: provider.id, label: provider.name }));
    return custom.length > 0
      ? [...builtIn, { value: "---divider---", label: "──────────", disabled: true }, ...custom]
      : builtIn;
  }, [allProviders]);

  const effectiveProvider =
    agent.default_provider ||
    currentProvider ||
    providerOptions.find((option) => !option.disabled)?.value ||
    "";

  const selectedProvider = allProviders.find((provider) => provider.id === effectiveProvider);
  const modelOptions = (selectedProvider?.models ?? []).map((model) => ({
    value: model.id,
    label: model.name,
  }));
  const effectiveModel =
    agent.default_model ||
    (currentProvider === effectiveProvider ? currentModel : "") ||
    modelOptions[0]?.value ||
    "";

  const patchAgent = (partial: Partial<AgentSettingsValue>) =>
    patch("agent", { ...agent, ...partial });

  const selectProvider = (provider: string) => {
    if (provider === "---divider---") return;
    const nextProvider = allProviders.find((item) => item.id === provider);
    const nextModel = nextProvider?.models[0]?.id ?? "";
    patchAgent({ default_provider: provider, default_model: nextModel });
    setCurrentProvider(provider);
    if (nextModel) setCurrentModel(nextModel);
  };

  const selectModel = (model: string) => {
    patchAgent({ default_provider: effectiveProvider, default_model: model });
    setCurrentModel(model);
  };

  const toolCount = [
    agent.memory_tool_enabled,
    agent.app_search_enabled,
    agent.file_search_enabled,
    agent.http_fetch_enabled,
    agent.notifications_enabled,
    agent.mcp_enabled,
    agent.bash_enabled,
    agent.grep_search_enabled,
  ].filter(Boolean).length;

  return (
    <div className="qx-settings-page">
      <Row
        title={t("agent.mode", "Agent Mode")}
        description={t("agent.mode.desc", "Allow QxAI and plugins to run multi-step agent tasks with model and tool settings.")}
      >
        <Toggle
          value={agent.agent_mode_enabled}
          onChange={(value) => patchAgent({ agent_mode_enabled: value })}
        />
      </Row>

      <Row
        title={t("agent.defaultModel", "Default Agent Model")}
        description={t("agent.defaultModel.desc", "Model used when an agent task does not specify provider or model.")}
      >
        <div className="qx-agent-control-stack">
          {loading ? (
            <span className="qx-settings-muted">{t("agent.loadingModels", "Loading models...")}</span>
          ) : providerOptions.length > 0 ? (
            <>
              <Select
                value={effectiveProvider}
                onChange={selectProvider}
                options={providerOptions}
                ariaLabel={t("agent.provider", "Agent Provider")}
              />
              {modelOptions.length > 0 ? (
                <Select
                  value={effectiveModel}
                  onChange={selectModel}
                  options={modelOptions}
                  ariaLabel={t("agent.model", "Agent Model")}
                />
              ) : (
                <span className="qx-settings-muted">{t("agent.noModels", "No models for this provider")}</span>
              )}
            </>
          ) : (
            <span className="qx-settings-muted">{error || t("agent.noProviders", "No AI providers available")}</span>
          )}
        </div>
      </Row>

      <Row
        title={t("agent.modelTools", "Model Tool Calling")}
        description={t("agent.modelTools.desc", "Mark the selected model as allowed to receive tool schemas when the runtime supports it.")}
      >
        <Toggle
          value={agent.model_tools_enabled}
          onChange={(value) => patchAgent({ model_tools_enabled: value })}
        />
      </Row>

      <SectionLabel>{t("agent.tools", "Tools")}</SectionLabel>
      <Row
        title={t("agent.tools.enabled", "Enable Tools")}
        description={`${t("agent.tools.enabled.desc", "Master switch for agent tool execution.")} ${toolCount} tool groups selected.`}
      >
        <Toggle
          value={agent.tools_enabled}
          onChange={(value) => patchAgent({ tools_enabled: value })}
        />
      </Row>
      <Row
        title={t("agent.tools.memory", "Memory Tool")}
        description={t("agent.tools.memory.desc", "Allow agents to read and write user-managed QxAI memory.")}
      >
        <Toggle
          value={agent.memory_tool_enabled}
          onChange={(value) => patchAgent({ memory_tool_enabled: value })}
        />
      </Row>
      <Row
        title={t("agent.tools.search", "App & File Search")}
        description={t("agent.tools.search.desc", "Expose Qx app search and file search as agent tools.")}
      >
        <div className="qx-agent-inline-toggles">
          <span>{t("agent.tools.apps", "Apps")}</span>
          <Toggle
            value={agent.app_search_enabled}
            onChange={(value) => patchAgent({ app_search_enabled: value })}
          />
          <span>{t("agent.tools.files", "Files")}</span>
          <Toggle
            value={agent.file_search_enabled}
            onChange={(value) => patchAgent({ file_search_enabled: value })}
          />
        </div>
      </Row>
      <Row
        title={t("agent.tools.network", "HTTP & Notifications")}
        description={t("agent.tools.network.desc", "Optional external fetch and completion notification tools.")}
      >
        <div className="qx-agent-inline-toggles">
          <span>{t("agent.tools.http", "HTTP")}</span>
          <Toggle
            value={agent.http_fetch_enabled}
            onChange={(value) => patchAgent({ http_fetch_enabled: value })}
          />
          <span>{t("agent.tools.notify", "Notify")}</span>
          <Toggle
            value={agent.notifications_enabled}
            onChange={(value) => patchAgent({ notifications_enabled: value })}
          />
        </div>
      </Row>
      <Row
        title={t("agent.tools.mcp", "MCP Tools")}
        description={t("agent.tools.mcp.desc", "Reserve MCP tool access for the agent runtime. Individual MCP servers are still configured separately.")}
      >
        <Toggle
          value={agent.mcp_enabled}
          onChange={(value) => patchAgent({ mcp_enabled: value })}
        />
      </Row>
      <Row
        title={t("agent.background", "Background Tasks")}
        description={t("agent.background.desc", "Allow agent tasks to continue while Qx is hidden and notify when they finish.")}
      >
        <Toggle
          value={agent.background_tasks_enabled}
          onChange={(value) => patchAgent({ background_tasks_enabled: value })}
        />
      </Row>

      <SectionLabel>{t("agent.bash", "Bash Tool")}</SectionLabel>
      <Row
        title={t("agent.bash.enabled", "Enable Bash")}
        description={t("agent.bash.enabled.desc", "Allow permissioned plugins to run real /bin/bash scripts through the AI runtime.")}
      >
        <Toggle
          value={agent.bash_enabled}
          onChange={(value) => patchAgent({ bash_enabled: value })}
        />
      </Row>
      <Row
        title={t("agent.bash.cwd", "Default Working Directory")}
        description={t("agent.bash.cwd.desc", "Optional cwd used when a task does not provide one. Empty uses the app process cwd.")}
      >
        <input
          className="qx-inline-input"
          value={agent.bash_cwd}
          onChange={(event) => patchAgent({ bash_cwd: event.target.value })}
          placeholder="~/Documents/OpenSpring/Qx"
        />
      </Row>
      <Row
        title={t("agent.bash.timeout", "Bash Timeout")}
        description={t("agent.bash.timeout.desc", "Upper bound for each bash call. Plugin requests are clamped to this value.")}
      >
        <Slider
          value={agent.bash_timeout_ms}
          min={5000}
          max={120000}
          step={5000}
          onChange={(value) => patchAgent({ bash_timeout_ms: value })}
          formatLabel={(value) => `${Math.round(value / 1000)}s`}
          ariaLabel={t("agent.bash.timeout", "Bash Timeout")}
        />
      </Row>

      <SectionLabel>{t("agent.grep", "Grep Search")}</SectionLabel>
      <Row
        title={t("agent.grep.enabled", "Enable Grep Search")}
        description={t("agent.grep.enabled.desc", "Expose a real rg/grep text search tool for agent tasks.")}
      >
        <Toggle
          value={agent.grep_search_enabled}
          onChange={(value) => patchAgent({ grep_search_enabled: value })}
        />
      </Row>
      <Row
        title={t("agent.grep.command", "Search Backend")}
        description={t("agent.grep.command.desc", "Use ripgrep when available; grep is the system fallback.")}
      >
        <SegmentedControl
          value={agent.grep_command}
          onChange={(value) => patchAgent({ grep_command: value })}
          options={[
            { value: "rg", label: "rg" },
            { value: "grep", label: "grep" },
          ]}
        />
      </Row>
      <Row
        title={t("agent.grep.root", "Default Search Root")}
        description={t("agent.grep.root.desc", "Optional folder used when a grep task does not provide a root. Empty uses the home folder.")}
      >
        <input
          className="qx-inline-input"
          value={agent.grep_root}
          onChange={(event) => patchAgent({ grep_root: event.target.value })}
          placeholder="~/Documents"
        />
      </Row>
      <Row
        title={t("agent.grep.limit", "Max Grep Results")}
        description={t("agent.grep.limit.desc", "Result cap returned to the agent for each grep search.")}
      >
        <Slider
          value={agent.grep_max_results}
          min={10}
          max={250}
          step={10}
          onChange={(value) => patchAgent({ grep_max_results: value })}
          formatLabel={(value) => `${value}`}
          ariaLabel={t("agent.grep.limit", "Max Grep Results")}
        />
      </Row>
    </div>
  );
}
