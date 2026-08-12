/**
 * Unified Qx capability catalogue for the agent.
 *
 * Layers (skill-driven extensibility):
 * 1. Module actions — intentional ops (`rss.refresh_all`, `plugin:<id>:<action>`)
 * 2. Plugin launcher commands — installed marketplace/built-in plugin commands
 * 3. Skill frontmatter `capabilities:` — binds a skill workflow to (1)+(2)+tool names
 *
 * Agent tools: `list_qx_capabilities` / `run_qx_capability` / `list_plugins` /
 * `run_plugin_command`. Skills inject a bound-capability hint when loaded.
 */

import {
  ensureBuiltinModuleActionsRegistered,
  listModuleActions,
  runModuleAction,
  type ModuleActionPublic,
} from "./module-actions";
import { truncate } from "./types";
import type { Settings } from "../../settings/store";
import { useSettingsStore } from "../../settings/store";
import { usePluginRegistry } from "../../../plugin/registry";

export type QxCapabilityKind = "module_action" | "plugin_command" | "agent_tool";

export interface QxCapabilityPublic {
  /** Stable id: `rss.refresh_all` | `command:v2ex:latest` | `tool:qx_screenshot` */
  id: string;
  kind: QxCapabilityKind;
  title: string;
  description: string;
  /** Builtin module id, plugin id, or "agent". */
  source: string;
  risk?: string;
  inputHint?: string;
}

export interface ListQxCapabilitiesFilter {
  query?: string;
  source?: string;
  kind?: QxCapabilityKind | "all";
  /** Only these capability ids (skill binding). */
  ids?: string[];
}

/** Parse `capabilities:` from skill frontmatter (YAML list or comma-separated). */
export function parseSkillCapabilities(content: string): string[] {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return [];
  const caps: string[] = [];
  let inList = false;
  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const line = raw.trim();
    if (line === "---") break;
    if (inList) {
      const item = line.match(/^-\s+(.+)$/);
      if (item) {
        const id = normalizeCapabilityId(item[1] ?? "");
        if (id) caps.push(id);
        continue;
      }
      // End of list when a non-list key appears.
      if (line && !line.startsWith("#") && line.includes(":")) {
        inList = false;
      } else if (!line) {
        continue;
      } else {
        inList = false;
      }
    }
    const inline = line.match(/^capabilities:\s*(.*)$/i);
    if (!inline) continue;
    const rest = (inline[1] ?? "").trim();
    if (!rest || rest === "|" || rest === ">") {
      inList = true;
      continue;
    }
    // capabilities: a, b, c  OR  capabilities: [a, b]
    const stripped = rest.replace(/^\[/, "").replace(/\]$/, "");
    for (const part of stripped.split(/[,，]/)) {
      const id = normalizeCapabilityId(part);
      if (id) caps.push(id);
    }
  }
  return [...new Set(caps)];
}

export function normalizeCapabilityId(raw: string): string {
  let id = raw.trim().replace(/^["']|["']$/g, "");
  if (!id) return "";
  // Allow bare action ids and aliases.
  if (id.startsWith("action:")) id = id.slice("action:".length);
  return id.trim();
}

function pluginCommandsAsCapabilities(): QxCapabilityPublic[] {
  const state = usePluginRegistry.getState();
  const enabled = new Set(
    state.plugins.filter((plugin) => plugin.enabled !== false).map((plugin) => plugin.id),
  );
  const out: QxCapabilityPublic[] = [];
  for (const command of state.commands) {
    if (!enabled.has(command.pluginId)) continue;
    // Skip pure background interval jobs from the interactive catalogue noise.
    if (command.mode === "no-view" && command.interval) continue;
    out.push({
      id: `command:${command.pluginId}:${command.name}`,
      kind: "plugin_command",
      title: command.title || command.name,
      description:
        command.description
        || `Run plugin command ${command.pluginName} → ${command.name}`,
      source: command.pluginId,
      risk: "write",
      inputHint: `{"pluginId":"${command.pluginId}","command":"${command.name}"}`,
    });
  }
  return out;
}

function actionToCapability(action: ModuleActionPublic): QxCapabilityPublic {
  return {
    id: action.id,
    kind: "module_action",
    title: action.title,
    description: action.description,
    source: action.pluginId || action.moduleId,
    risk: action.risk,
    inputHint: action.inputHint,
  };
}

export function listQxCapabilities(
  filter: ListQxCapabilitiesFilter = {},
  settings: Settings = useSettingsStore.getState().settings,
  enabledToolNames: string[] = [],
): QxCapabilityPublic[] {
  ensureBuiltinModuleActionsRegistered();
  const actions = listModuleActions(
    {
      moduleId: filter.source,
      query: filter.query,
    },
    settings,
  ).map(actionToCapability);

  let pluginCommands = pluginCommandsAsCapabilities();
  if (filter.source) {
    pluginCommands = pluginCommands.filter((item) => item.source === filter.source);
  }

  const tools: QxCapabilityPublic[] = enabledToolNames.map((name) => ({
    id: `tool:${name}`,
    kind: "agent_tool" as const,
    title: name,
    description: `Call the agent tool "${name}" directly (function/ReAct tool by name).`,
    source: "agent",
    risk: "read",
    inputHint: `Use tool name: ${name}`,
  }));

  let all = [...actions, ...pluginCommands, ...tools];

  if (filter.kind && filter.kind !== "all") {
    all = all.filter((item) => item.kind === filter.kind);
  }
  if (filter.ids && filter.ids.length > 0) {
    const wanted = new Set(filter.ids.map(normalizeCapabilityId));
    all = all.filter((item) => {
      if (wanted.has(item.id)) return true;
      // skill may list bare tool name without tool: prefix
      if (item.kind === "agent_tool" && wanted.has(item.id.replace(/^tool:/, ""))) return true;
      if (item.kind === "plugin_command" && wanted.has(item.id.replace(/^command:/, ""))) {
        return true;
      }
      return false;
    });
  }
  if (filter.query) {
    const q = filter.query.trim().toLowerCase();
    if (q) {
      all = all.filter((item) =>
        `${item.id} ${item.title} ${item.description} ${item.source}`.toLowerCase().includes(q),
      );
    }
  }

  all.sort((a, b) => a.id.localeCompare(b.id));
  return all;
}

export async function runQxCapability(
  id: string,
  input: Record<string, unknown> = {},
  settings: Settings = useSettingsStore.getState().settings,
): Promise<string> {
  const capId = normalizeCapabilityId(id);
  if (!capId) return "Error: capability id is required.";

  // tool:name → instruct the model to call the tool (cannot re-enter tool loop here).
  if (capId.startsWith("tool:")) {
    const toolName = capId.slice("tool:".length);
    return `Capability ${capId} is an agent tool. Call the tool named "${toolName}" directly with its own parameters (do not wrap again in run_qx_capability).`;
  }

  // command:pluginId:commandName
  if (capId.startsWith("command:")) {
    const rest = capId.slice("command:".length);
    const colon = rest.indexOf(":");
    if (colon <= 0) {
      return `Error: invalid plugin command id "${capId}". Expected command:<pluginId>:<commandName>.`;
    }
    const pluginId = rest.slice(0, colon);
    const command = rest.slice(colon + 1);
    return runPluginCommandCapability(pluginId, command, input);
  }

  // Bare pluginId:command when skill lists short form without prefix and action missing.
  // Prefer module action first.
  const actionResult = await runModuleAction(capId, input, settings);
  if (!actionResult.startsWith("Error: unknown module action")) {
    return actionResult;
  }

  // Fallback: treat as pluginId:commandName
  const colon = capId.indexOf(":");
  if (colon > 0 && !capId.startsWith("plugin:")) {
    const pluginId = capId.slice(0, colon);
    const command = capId.slice(colon + 1);
    if (pluginId && command) {
      return runPluginCommandCapability(pluginId, command, input);
    }
  }

  // plugin:<pluginId>:<action> already handled by runModuleAction when registered.
  return actionResult;
}

export async function runPluginCommandCapability(
  pluginId: string,
  commandName: string,
  _input: Record<string, unknown> = {},
): Promise<string> {
  try {
    const registry = usePluginRegistry.getState();
    const command = await registry.resolveCommand(pluginId, commandName);
    if (!command) {
      return `Error: plugin command not found: ${pluginId}:${commandName}. Call list_plugins or list_qx_capabilities.`;
    }
    await registry.runCommand(command, { launchType: "userInitiated" });
    return `Dispatched plugin command ${pluginId}:${commandName} (${command.title || command.name}).`;
  } catch (error) {
    return `Error running plugin command ${pluginId}:${commandName}: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

export function listInstalledPluginsForAgent(): Array<{
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  description: string;
  commands: Array<{ name: string; title: string; description?: string }>;
}> {
  const state = usePluginRegistry.getState();
  return state.plugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    enabled: plugin.enabled !== false,
    description: plugin.description || "",
    commands: state.commands
      .filter((command) => command.pluginId === plugin.id)
      .filter((command) => !(command.mode === "no-view" && command.interval))
      .map((command) => ({
        name: command.name,
        title: command.title || command.name,
        description: command.description,
      })),
  }));
}

/** Format capability list for prompts / tool observations. */
export function formatCapabilities(caps: QxCapabilityPublic[], limit = 12_000): string {
  if (caps.length === 0) return "No matching Qx capabilities.";
  return truncate(
    caps
      .map(
        (c) =>
          `- ${c.id} [${c.kind}/${c.risk ?? "n/a"}] (${c.source}): ${c.title} — ${c.description}${
            c.inputHint ? ` Example: ${c.inputHint}` : ""
          }`,
      )
      .join("\n"),
    limit,
  );
}

/**
 * Build a skill-bound capability block for the system prompt.
 * Resolves frontmatter capabilities against the live catalogue.
 */
export function buildSkillCapabilityPromptBlock(
  skillId: string,
  skillContent: string,
  settings: Settings = useSettingsStore.getState().settings,
  enabledToolNames: string[] = [],
): string {
  const declared = parseSkillCapabilities(skillContent);
  if (declared.length === 0) {
    return [
      `Skill "${skillId}" has no frontmatter capabilities: list.`,
      "Discover host ports with list_qx_capabilities / list_module_actions when the workflow needs Qx modules or plugins.",
    ].join("\n");
  }
  const available = listQxCapabilities(
    { ids: declared },
    settings,
    enabledToolNames,
  );
  const availableIds = new Set(available.map((item) => item.id));
  const missing = declared.filter((id) => {
    if (availableIds.has(id) || availableIds.has(`tool:${id}`) || availableIds.has(`command:${id}`)) {
      return false;
    }
    // module actions match bare ids
    return !available.some((item) => item.id === id || item.id.endsWith(`:${id}`));
  });

  const lines = [
    `## Bound Qx capabilities for skill "${skillId}"`,
    "Execute this skill by calling these ports (prefer run_qx_capability / run_module_action / named tools).",
    "Do not invent success when a capability is missing — modules may be disabled or plugins uninstalled.",
    formatCapabilities(available, 6_000),
  ];
  if (missing.length > 0) {
    lines.push(
      `Unavailable (module off / not installed / unknown): ${missing.join(", ")}`,
    );
  }
  return lines.join("\n");
}
