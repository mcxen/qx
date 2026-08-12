import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  LoadingLabel,
  Row,
  Select,
  SettingsCard,
  Slider,
  Toggle,
} from "../../components/ui";
import {
  MemorySection,
  ProviderListSection,
} from "../qx-ai/AiProviderConfig";
import { useG4fStore } from "../qx-ai/store";
import {
  listQxAiSkills,
  openQxAiMcpConfig,
  openQxAiSkillsDirectory,
  readQxAiMcpConfig,
  resolveSkillMode,
  writeQxAiMcpConfig,
  type QxAiMcpConfig,
  type QxAiSkillLoadMode,
  type QxAiSkillSummary,
} from "../qx-ai/skills";
import {
  modelCapabilityKey,
  resolveModelVision,
} from "../qx-ai/model-capabilities";
import {
  deleteQxAiSchedule,
  listQxAiSchedules,
  runQxAiScheduleNow,
  upsertQxAiSchedule,
} from "../qx-ai/schedule-bridge";
import { useT } from "../../i18n";
import { useSettingsStore, type AgentSettings as AgentSettingsValue } from "./store";

type ScheduleRow = {
  id: string;
  name: string;
  enabled: boolean;
  kind: string;
  dailyTime: string;
  skillId?: string | null;
  prompt?: string | null;
  lastRunAt?: number | null;
  lastError?: string | null;
};

type ProviderOption = { value: string; label: string; disabled?: boolean };

const MODE_OPTIONS: { value: QxAiSkillLoadMode; labelKey: string; fallback: string }[] = [
  { value: "fixed", labelKey: "agent.skills.mode.fixed", fallback: "Fixed" },
  { value: "smart", labelKey: "agent.skills.mode.smart", fallback: "Smart" },
  { value: "disabled", labelKey: "agent.skills.mode.disabled", fallback: "Disabled" },
];

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
  const [skills, setSkills] = useState<QxAiSkillSummary[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [mcp, setMcp] = useState<QxAiMcpConfig>({ servers: [] });
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpDraft, setMcpDraft] = useState("");
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  const [schedulesError, setSchedulesError] = useState<string | null>(null);
  const [scheduleBusyId, setScheduleBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (providers.length === 0 && builtInProviders.length === 0 && customProviders.length === 0) {
      void loadProviders();
    }
  }, [builtInProviders.length, customProviders.length, loadProviders, providers.length]);

  const refreshSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      setSkills(await listQxAiSkills());
    } catch (loadError) {
      setSkills([]);
      setSkillsError(String(loadError));
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  const refreshMcp = useCallback(async () => {
    setMcpLoading(true);
    setMcpError(null);
    try {
      const config = await readQxAiMcpConfig();
      setMcp(config);
      setMcpDraft(JSON.stringify(config, null, 2));
    } catch (loadError) {
      setMcp({ servers: [] });
      setMcpError(String(loadError));
    } finally {
      setMcpLoading(false);
    }
  }, []);

  const refreshSchedules = useCallback(async () => {
    setSchedulesLoading(true);
    setSchedulesError(null);
    try {
      const rows = (await listQxAiSchedules()) as ScheduleRow[];
      setSchedules(rows);
    } catch (loadError) {
      setSchedules([]);
      setSchedulesError(String(loadError));
    } finally {
      setSchedulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSkills();
    void refreshMcp();
    void refreshSchedules();
  }, [refreshMcp, refreshSchedules, refreshSkills]);

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
    allProviders.find((provider) => provider.id === agent.default_provider)?.id ||
    allProviders.find((provider) => provider.id === currentProvider)?.id ||
    providerOptions.find((option) => !option.disabled)?.value ||
    agent.default_provider ||
    "";

  const selectedProvider = allProviders.find((provider) => provider.id === effectiveProvider);
  const modelOptions = (() => {
    const models = selectedProvider?.models ?? [];
    const options = models.map((model) => ({
      value: model.id,
      label: model.name,
    }));
    // Keep a saved default visible even if the catalog has not listed it yet.
    const savedModel = agent.default_model.trim();
    if (
      savedModel
      && effectiveProvider
      && (agent.default_provider === effectiveProvider || !agent.default_provider)
      && !options.some((option) => option.value === savedModel)
    ) {
      options.unshift({ value: savedModel, label: savedModel });
    }
    return options;
  })();
  const effectiveModel =
    modelOptions.find((option) => option.value === agent.default_model)?.value ||
    modelOptions.find((option) => option.value === currentModel)?.value ||
    modelOptions[0]?.value ||
    agent.default_model ||
    "";

  const patchAgent = (partial: Partial<AgentSettingsValue>) =>
    patch("agent", { ...agent, ...partial });

  const selectProvider = (provider: string) => {
    if (provider === "---divider---") return;
    // Store setters persist agent.default_* — avoid double-write races.
    setCurrentProvider(provider);
  };

  const selectModel = (model: string) => {
    // Ensure provider + model land together in settings.
    if (effectiveProvider && currentProvider !== effectiveProvider) {
      setCurrentProvider(effectiveProvider);
    }
    setCurrentModel(model);
  };

  const selectedCatalogModel = selectedProvider?.models.find(
    (model) => model.id === effectiveModel,
  );
  const effectiveVision = resolveModelVision(
    effectiveProvider,
    selectedCatalogModel ?? (effectiveModel ? { id: effectiveModel, name: effectiveModel } : undefined),
    agent.model_capabilities,
  );

  const setDefaultModelVision = (vision: boolean) => {
    if (!effectiveProvider || !effectiveModel) return;
    const key = modelCapabilityKey(effectiveProvider, effectiveModel);
    patchAgent({
      model_capabilities: {
        ...(agent.model_capabilities ?? {}),
        [key]: {
          ...(agent.model_capabilities?.[key] ?? {}),
          vision,
        },
      },
    });
  };

  const setSkillMode = (id: string, mode: QxAiSkillLoadMode) => {
    patchAgent({
      skill_modes: {
        ...(agent.skill_modes ?? {}),
        [id]: mode,
      },
    });
  };

  const saveMcpDraft = async () => {
    setMcpError(null);
    try {
      const parsed = JSON.parse(mcpDraft) as QxAiMcpConfig;
      const saved = await writeQxAiMcpConfig({
        servers: Array.isArray(parsed.servers) ? parsed.servers : [],
      });
      setMcp(saved);
      setMcpDraft(JSON.stringify(saved, null, 2));
    } catch (saveError) {
      setMcpError(String(saveError));
    }
  };

  return (
    <div className="qx-settings-page">
      <SettingsCard title={t("agent.providers.title", "Providers & Keys")}>
        <ProviderListSection />
        <MemorySection />
      </SettingsCard>

      <SettingsCard title={t("agent.basics.title", "Chat & Agent")}>
        <Row
          title={t("agent.mode", "Agent Mode")}
          description={t(
            "agent.mode.desc",
            "On by default. Lets QxAI use tools for multi-step tasks. Turn off for plain chat only.",
          )}
        >
          <Toggle
            value={agent.agent_mode_enabled}
            onChange={(value) => patchAgent({ agent_mode_enabled: value })}
          />
        </Row>

        <Row
          title={t("agent.defaultModel", "Default Model")}
          description={t("agent.defaultModel.desc", "Used for new chats and agent runs.")}
        >
          <div className="qx-agent-control-stack">
            {loading ? (
              <span className="qx-settings-muted">
                <LoadingLabel>{t("agent.loadingModels", "Loading models...")}</LoadingLabel>
              </span>
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
                    options={modelOptions.map((option) => {
                      const meta = selectedProvider?.models.find((model) => model.id === option.value);
                      const vision = resolveModelVision(
                        effectiveProvider,
                        meta ?? { id: option.value, name: option.label },
                        agent.model_capabilities,
                      );
                      return {
                        ...option,
                        label: vision
                          ? `${option.label} · ${t("agent.model.vision.badge", "Vision")}`
                          : option.label,
                      };
                    })}
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
          title={t("agent.model.vision", "Vision (images)")}
          description={t(
            "agent.model.vision.desc",
            "Auto-detected from the model catalog. Override when detection is wrong so image attachments can be sent and previewed correctly.",
          )}
        >
          <Toggle
            value={effectiveVision}
            disabled={!effectiveProvider || !effectiveModel}
            onChange={setDefaultModelVision}
            ariaLabel={t("agent.model.vision", "Vision (images)")}
          />
        </Row>

        <Row
          title={t("agent.tools.enabled", "Tools")}
          description={t(
            "agent.tools.enabled.desc",
            "Master switch. Host tools, system stats, skills, and MCP editing stay available when on.",
          )}
        >
          <Toggle
            value={agent.tools_enabled}
            onChange={(value) => patchAgent({ tools_enabled: value })}
          />
        </Row>

        <Row
          title={t("agent.modelTools", "Native Tool Calling")}
          description={t(
            "agent.modelTools.desc",
            "Prefer model function-calling schemas. Off falls back to the portable ReAct prompt path.",
          )}
        >
          <Toggle
            value={agent.model_tools_enabled}
            onChange={(value) => patchAgent({ model_tools_enabled: value })}
          />
        </Row>

        <Row
          title={t("agent.maxIterations", "Max Iterations")}
          description={t("agent.maxIterations.desc", "Cap Thought/Action rounds before the agent must answer.")}
        >
          <Slider
            value={agent.agent_max_iterations}
            min={3}
            max={50}
            step={1}
            onChange={(value) => patchAgent({ agent_max_iterations: value })}
            formatLabel={(value) => `${value}`}
            ariaLabel={t("agent.maxIterations", "Max Iterations")}
          />
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("agent.safety.title", "Safety & SOLO")}
        description={t(
          "agent.safety.desc",
          "Dangerous tools (bash, writes, plugin commands, schedules…) are classified automatically. Keep the guard on for safer chat; enable SOLO only when you want full autonomy.",
        )}
      >
        <Row
          title={t("agent.safety.guard", "Dangerous tools guard")}
          description={t(
            "agent.safety.guard.desc",
            "When on, high-impact tools are blocked mid-turn unless SOLO mode is enabled. Turn off to disable recognition and blocking entirely.",
          )}
        >
          <Toggle
            value={agent.dangerous_tools_guard_enabled !== false}
            onChange={(value) => patchAgent({ dangerous_tools_guard_enabled: value })}
            ariaLabel={t("agent.safety.guard", "Dangerous tools guard")}
          />
        </Row>
        <Row
          title={t("agent.safety.solo", "SOLO mode")}
          description={t(
            "agent.safety.solo.desc",
            "Autonomous mode: bypass the dangerous-tools gate so the agent may run bash, writes, plugin commands, and schedules without blocking. Use only when you trust the current task.",
          )}
        >
          <Toggle
            value={agent.solo_mode === true}
            disabled={agent.dangerous_tools_guard_enabled === false}
            onChange={(value) => patchAgent({ solo_mode: value })}
            ariaLabel={t("agent.safety.solo", "SOLO mode")}
          />
        </Row>
        <p className="qx-settings-muted">
          {agent.dangerous_tools_guard_enabled === false
            ? t(
                "agent.safety.status.off",
                "Guard off — dangerous tools are not auto-blocked.",
              )
            : agent.solo_mode
              ? t(
                  "agent.safety.status.solo",
                  "SOLO on — dangerous tools are allowed this session policy.",
                )
              : t(
                  "agent.safety.status.guarded",
                  "Guard on — dangerous tools blocked until you enable SOLO.",
                )}
        </p>
        <p className="qx-settings-muted">
          {t(
            "agent.safety.examples",
            "Examples: bash, write_skill, write_mcp_config, docs_write, run_plugin_command, run_module_action, upsert/delete/run_schedule, open_path, copy_to_clipboard, screencap_recapture, brightness.",
          )}
        </p>
      </SettingsCard>

      <SettingsCard
        title={t("agent.tools.groups", "Tool groups")}
        description={t(
          "agent.tools.groups.desc",
          "All groups default on. Disable only what you do not want the model to call.",
        )}
      >
        <Row title={t("agent.tools.memory", "Memory")} description={t("agent.tools.memory.desc", "Read/write long-term notes.")}>
          <Toggle value={agent.memory_tool_enabled} onChange={(value) => patchAgent({ memory_tool_enabled: value })} />
        </Row>
        <Row title={t("agent.tools.search", "Apps & Files")} description={t("agent.tools.search.desc", "Search installed apps and the file index.")}>
          <div className="qx-agent-inline-toggles">
            <span>{t("agent.tools.apps", "Apps")}</span>
            <Toggle value={agent.app_search_enabled} onChange={(value) => patchAgent({ app_search_enabled: value })} />
            <span>{t("agent.tools.files", "Files")}</span>
            <Toggle value={agent.file_search_enabled} onChange={(value) => patchAgent({ file_search_enabled: value })} />
          </div>
        </Row>
        <Row title={t("agent.tools.qxHost", "Host actions")} description={t("agent.tools.qxHost.desc", "Open/reveal paths, clipboard, attach files.")}>
          <Toggle value={agent.qx_host_actions_enabled} onChange={(value) => patchAgent({ qx_host_actions_enabled: value })} />
        </Row>
        <Row title={t("agent.tools.qxSystem", "System")} description={t("agent.tools.qxSystem.desc", "CPU/memory, displays, windows, processes.")}>
          <Toggle value={agent.qx_system_tools_enabled} onChange={(value) => patchAgent({ qx_system_tools_enabled: value })} />
        </Row>
        <Row title={t("agent.tools.shell", "Shell & Grep")} description={t("agent.tools.shell.desc", "Bash scripts and content search.")}>
          <div className="qx-agent-inline-toggles">
            <span>{t("agent.bash.enabled", "Bash")}</span>
            <Toggle value={agent.bash_enabled} onChange={(value) => patchAgent({ bash_enabled: value })} />
            <span>{t("agent.grep.enabled", "Grep")}</span>
            <Toggle value={agent.grep_search_enabled} onChange={(value) => patchAgent({ grep_search_enabled: value })} />
          </div>
        </Row>
        <Row title={t("agent.tools.network", "HTTP & Notify")} description={t("agent.tools.network.desc", "Fetch URLs and show completion toasts.")}>
          <div className="qx-agent-inline-toggles">
            <span>{t("agent.tools.http", "HTTP")}</span>
            <Toggle value={agent.http_fetch_enabled} onChange={(value) => patchAgent({ http_fetch_enabled: value })} />
            <span>{t("agent.tools.notify", "Notify")}</span>
            <Toggle value={agent.notifications_enabled} onChange={(value) => patchAgent({ notifications_enabled: value })} />
          </div>
        </Row>
        <Row title={t("agent.background", "Background tasks")} description={t("agent.background.desc", "Continue agent work while Qx is hidden.")}>
          <Toggle value={agent.background_tasks_enabled} onChange={(value) => patchAgent({ background_tasks_enabled: value })} />
        </Row>
      </SettingsCard>

      <SettingsCard
        title={t("agent.schedules.title", "Schedules")}
        description={t(
          "agent.schedules.desc",
          "Timed QxAI jobs. Morning desk log captures the desktop and writes a Markdown journal under Downloads/QxLogs. Host actions must stay enabled.",
        )}
      >
        <div className="qx-agent-skill-toolbar">
          <button
            type="button"
            className="qx-command-button"
            onClick={() => void refreshSchedules()}
            disabled={schedulesLoading}
          >
            {schedulesLoading ? t("common.loading", "Loading…") : t("agent.schedules.refresh", "Refresh")}
          </button>
        </div>
        {schedulesError && <p className="qx-settings-muted is-error">{schedulesError}</p>}
        {!schedulesLoading && schedules.length === 0 && !schedulesError && (
          <p className="qx-settings-muted">
            {t("agent.schedules.empty", "No schedules yet. Ask QxAI to upsert_schedule, or reinstall to seed Morning desk log.")}
          </p>
        )}
        <div className="qx-agent-schedule-list">
          {schedules.map((schedule) => (
            <article key={schedule.id} className="qx-agent-schedule-card">
              <header className="qx-agent-schedule-head">
                <strong>{schedule.name}</strong>
                <code>{schedule.dailyTime}</code>
              </header>
              <p className="qx-agent-schedule-meta">
                {schedule.kind} · {schedule.id}
                {schedule.lastError ? ` · ${schedule.lastError}` : ""}
              </p>
              <div className="qx-agent-schedule-actions">
                <Toggle
                  value={schedule.enabled}
                  onChange={(enabled) => {
                    void upsertQxAiSchedule({ ...schedule, enabled }).then(() => refreshSchedules());
                  }}
                  ariaLabel={t("agent.schedules.enabled", "Enabled")}
                />
                <button
                  type="button"
                  className="qx-command-button"
                  disabled={scheduleBusyId === schedule.id}
                  onClick={() => {
                    setScheduleBusyId(schedule.id);
                    void runQxAiScheduleNow(schedule.id)
                      .then(() => refreshSchedules())
                      .catch((error) => setSchedulesError(String(error)))
                      .finally(() => setScheduleBusyId(null));
                  }}
                >
                  {scheduleBusyId === schedule.id
                    ? t("common.loading", "Loading…")
                    : t("agent.schedules.runNow", "Run now")}
                </button>
                <button
                  type="button"
                  className="qx-command-button"
                  onClick={() => {
                    void deleteQxAiSchedule(schedule.id).then(() => refreshSchedules());
                  }}
                >
                  {t("common.delete", "Delete")}
                </button>
              </div>
            </article>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        title={t("agent.skills.title", "Skills")}
        description={t(
          "agent.skills.desc",
          "Markdown skills auto-load by mode: Fixed always, Smart by query, Disabled only via /name.",
        )}
      >
        <div className="qx-agent-skill-toolbar">
          <button type="button" className="qx-command-button" onClick={() => void refreshSkills()} disabled={skillsLoading}>
            {skillsLoading ? t("common.loading", "Loading…") : t("agent.skills.refresh", "Refresh")}
          </button>
          <button type="button" className="qx-command-button" onClick={() => void openQxAiSkillsDirectory()}>
            {t("agent.skills.openFolder", "Open skills folder")}
          </button>
        </div>
        {skillsError && <p className="qx-settings-muted is-error">{skillsError}</p>}
        {!skillsLoading && skills.length === 0 && !skillsError && (
          <p className="qx-settings-muted">
            {t("agent.skills.empty", "No skills yet. Drop SKILL.md files into the skills folder, or ask QxAI to write_skill.")}
          </p>
        )}
        <div className="qx-agent-skill-grid">
          {skills.map((skill) => {
            const mode = resolveSkillMode(skill, agent);
            const modeMeta = MODE_OPTIONS.find((option) => option.value === mode)
              ?? MODE_OPTIONS[1];
            return (
              <article key={skill.id} className={`qx-agent-skill-card is-${mode}`}>
                <div className="qx-agent-skill-card-top">
                  <span className="qx-agent-skill-icon" aria-hidden="true">
                    <Sparkles size={16} strokeWidth={1.75} />
                  </span>
                  <span className={`qx-agent-skill-badge is-${mode}`}>
                    {t(modeMeta.labelKey, modeMeta.fallback)}
                  </span>
                </div>
                <header className="qx-agent-skill-card-head">
                  <strong>{skill.name}</strong>
                  <code className="qx-agent-skill-id">/{skill.id}</code>
                </header>
                <p className="qx-agent-skill-desc">
                  {skill.description || t("agent.skills.noDescription", "No description")}
                </p>
                <div className="qx-agent-skill-card-foot">
                  <span className="qx-agent-skill-mode-label">
                    {t("agent.skills.mode", "Load mode")}
                  </span>
                  <Select
                    value={mode}
                    onChange={(value) => setSkillMode(skill.id, value as QxAiSkillLoadMode)}
                    options={MODE_OPTIONS.map((option) => ({
                      value: option.value,
                      label: t(option.labelKey, option.fallback),
                    }))}
                    ariaLabel={t("agent.skills.mode", "Load mode")}
                  />
                </div>
              </article>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        title={t("agent.mcp.title", "MCP servers")}
        description={t(
          "agent.mcp.desc",
          "User-managed MCP config (~/.qx/mcp.json). The agent can read/write this file when MCP tools are enabled.",
        )}
      >
        <Row
          title={t("agent.tools.mcp", "MCP Tools")}
          description={t("agent.tools.mcp.desc", "Allow the agent to read and edit the MCP config file.")}
        >
          <Toggle value={agent.mcp_enabled} onChange={(value) => patchAgent({ mcp_enabled: value })} />
        </Row>
        <div className="qx-agent-skill-toolbar">
          <button type="button" className="qx-command-button" onClick={() => void refreshMcp()} disabled={mcpLoading}>
            {mcpLoading ? t("common.loading", "Loading…") : t("agent.mcp.reload", "Reload")}
          </button>
          <button type="button" className="qx-command-button" onClick={() => void openQxAiMcpConfig()}>
            {t("agent.mcp.openFile", "Open mcp.json")}
          </button>
          <button type="button" className="qx-command-button" onClick={() => void saveMcpDraft()}>
            {t("agent.mcp.save", "Save config")}
          </button>
        </div>
        {mcpError && <p className="qx-settings-muted is-error">{mcpError}</p>}
        <p className="qx-settings-muted">
          {t("agent.mcp.serverCount", "{n} servers").replace("{n}", String(mcp.servers?.length ?? 0))}
        </p>
        <textarea
          className="qx-agent-mcp-editor"
          value={mcpDraft}
          onChange={(event) => setMcpDraft(event.target.value)}
          rows={12}
          spellCheck={false}
          aria-label={t("agent.mcp.editor", "MCP JSON")}
        />
      </SettingsCard>
    </div>
  );
}
