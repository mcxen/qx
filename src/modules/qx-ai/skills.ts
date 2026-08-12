import { invoke } from "@tauri-apps/api/core";
import type { AgentSettings, QxAiSkillLoadMode } from "../settings/store";
import { useSettingsStore } from "../settings/store";

export type { QxAiSkillLoadMode };

/** Re-export parser without pulling agent tools into every skills import site. */
export async function parseSkillCapabilities(content: string): Promise<string[]> {
  const { parseSkillCapabilities: parse } = await import("./agent/capabilities");
  return parse(content);
}

export interface QxAiSkillSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  mode: QxAiSkillLoadMode;
}

export interface QxAiSkillDocument extends QxAiSkillSummary {
  content: string;
}

export interface QxAiMcpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: string[];
  enabled: boolean;
  notes: string;
}

export interface QxAiMcpConfig {
  servers: QxAiMcpServer[];
}

export async function listQxAiSkills(): Promise<QxAiSkillSummary[]> {
  const skills = await invoke<Array<QxAiSkillSummary & { mode?: string }>>("qxai_list_skills");
  return skills.map((skill) => ({
    ...skill,
    mode: normalizeSkillMode(skill.mode),
  }));
}

export async function readQxAiSkill(id: string): Promise<QxAiSkillDocument> {
  const skill = await invoke<QxAiSkillDocument & { mode?: string }>("qxai_read_skill", { id });
  return { ...skill, mode: normalizeSkillMode(skill.mode) };
}

export async function writeQxAiSkill(
  id: string,
  content: string,
  mode?: QxAiSkillLoadMode,
): Promise<QxAiSkillDocument> {
  const skill = await invoke<QxAiSkillDocument & { mode?: string }>("qxai_write_skill", {
    id,
    content,
    mode: mode ?? null,
  });
  return { ...skill, mode: normalizeSkillMode(skill.mode) };
}

export async function openQxAiSkillsDirectory(): Promise<void> {
  const path = await invoke<string>("qxai_skills_directory");
  await invoke("plugin_system_open_path", { path });
}

export async function readQxAiMcpConfig(): Promise<QxAiMcpConfig> {
  return invoke<QxAiMcpConfig>("qxai_read_mcp_config");
}

export async function writeQxAiMcpConfig(config: QxAiMcpConfig): Promise<QxAiMcpConfig> {
  return invoke<QxAiMcpConfig>("qxai_write_mcp_config", { config });
}

export async function openQxAiMcpConfig(): Promise<void> {
  const path = await invoke<string>("qxai_mcp_config_path");
  await invoke("plugin_system_open_path", { path });
}

export function normalizeSkillMode(value: unknown): QxAiSkillLoadMode {
  const raw = String(value ?? "smart").toLowerCase();
  if (raw === "fixed" || raw === "always" || raw === "pinned") return "fixed";
  if (raw === "disabled" || raw === "off" || raw === "false") return "disabled";
  return "smart";
}

/** Effective mode = settings override → skill frontmatter → smart. */
export function resolveSkillMode(
  skill: Pick<QxAiSkillSummary, "id" | "mode">,
  settings: Pick<AgentSettings, "skill_modes">,
): QxAiSkillLoadMode {
  const override = settings.skill_modes?.[skill.id];
  if (override === "fixed" || override === "smart" || override === "disabled") {
    return override;
  }
  return normalizeSkillMode(skill.mode);
}

function fuzzyScore(value: string, query: string): number | null {
  const haystack = value.toLocaleLowerCase();
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return 0;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return exact;
  let cursor = 0;
  let score = 100;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found < 0) return null;
    score += found - cursor;
    cursor = found + 1;
  }
  return score;
}

export function filterQxAiSkills(
  skills: QxAiSkillSummary[],
  query: string,
): QxAiSkillSummary[] {
  return skills
    .map((skill) => ({
      skill,
      score: fuzzyScore(`${skill.name} ${skill.id} ${skill.description}`, query),
    }))
    .filter((entry): entry is { skill: QxAiSkillSummary; score: number } => entry.score !== null)
    .sort((left, right) => left.score - right.score || left.skill.name.localeCompare(right.skill.name))
    .map((entry) => entry.skill);
}

const MAX_AUTO_SKILL_CHARS = 6_000;
const MAX_SMART_SKILLS = 2;

async function enabledToolNamesForSkills(settings: AgentSettings): Promise<string[]> {
  try {
    const app = useSettingsStore.getState().settings;
    // Dynamic: skill listing UI must not load the full agent tool graph.
    const { getEnabledTools } = await import("./agent/tools");
    return getEnabledTools(settings, app).map((tool) => tool.name);
  } catch {
    return [];
  }
}

/** Append live capability binding for a skill document (frontmatter capabilities:). */
export async function withSkillCapabilityBinding(
  skillId: string,
  skillContent: string,
  settings: AgentSettings,
): Promise<string> {
  const app = useSettingsStore.getState().settings;
  const [{ buildSkillCapabilityPromptBlock }, toolNames] = await Promise.all([
    import("./agent/capabilities"),
    enabledToolNamesForSkills(settings),
  ]);
  return buildSkillCapabilityPromptBlock(skillId, skillContent, app, toolNames);
}

/**
 * Build an auto-loaded skill block for the agent system prompt.
 * - fixed: always included
 * - smart: top relevance matches for the user message
 * - disabled: skipped (explicit /skill pick still works via withSelectedSkill)
 * Each skill may declare `capabilities:` to bind Qx module/plugin ports.
 */
export async function buildAutoSkillPromptBlock(
  userMessage: string,
  settings: AgentSettings,
  excludeId?: string,
): Promise<string> {
  let skills: QxAiSkillSummary[] = [];
  try {
    skills = await listQxAiSkills();
  } catch {
    return "";
  }
  if (skills.length === 0) return "";

  const fixed = skills.filter(
    (skill) =>
      skill.id !== excludeId && resolveSkillMode(skill, settings) === "fixed",
  );
  const smartPool = skills.filter(
    (skill) =>
      skill.id !== excludeId && resolveSkillMode(skill, settings) === "smart",
  );
  const smart = filterQxAiSkills(smartPool, userMessage)
    .filter((skill) => {
      // Require some lexical hit so empty/unrelated chats do not pull noise.
      const hay = `${skill.name} ${skill.id} ${skill.description}`.toLowerCase();
      const tokens = userMessage
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length >= 2);
      if (tokens.length === 0) return false;
      return tokens.some((token) => hay.includes(token));
    })
    .slice(0, MAX_SMART_SKILLS);

  const selected = [...fixed, ...smart].filter(
    (skill, index, list) => list.findIndex((item) => item.id === skill.id) === index,
  );
  if (selected.length === 0) return "";

  const app = useSettingsStore.getState().settings;
  const [{ buildSkillCapabilityPromptBlock }, toolNames] = await Promise.all([
    import("./agent/capabilities"),
    enabledToolNamesForSkills(settings),
  ]);
  const chunks: string[] = [];
  let used = 0;
  for (const summary of selected) {
    try {
      const doc = await readQxAiSkill(summary.id);
      const mode = resolveSkillMode(summary, settings);
      const body = doc.content.slice(0, Math.max(400, MAX_AUTO_SKILL_CHARS - used));
      used += body.length;
      const capabilityBlock = buildSkillCapabilityPromptBlock(
        doc.id,
        doc.content,
        app,
        toolNames,
      );
      chunks.push(
        `<qx-skill id="${doc.id}" mode="${mode}">\n# ${doc.name}\n${body}\n\n${capabilityBlock}\n</qx-skill>`,
      );
      if (used >= MAX_AUTO_SKILL_CHARS) break;
    } catch {
      // Skip unreadable skills.
    }
  }
  if (chunks.length === 0) return "";
  return [
    "Auto-loaded Qx skills for this turn (fixed always-on + smart matches).",
    "Follow them when relevant. Explicit user instructions still win.",
    "Skills may bind Qx capabilities (modules/plugins); use list_qx_capabilities / run_qx_capability to execute them.",
    ...chunks,
  ].join("\n\n");
}
