/**
 * Dangerous-tool catalogue for the agent safety gate.
 *
 * Guard policy (Settings → AI Agent):
 * - dangerous_tools_guard_enabled: identify + block dangerous tools (default on)
 * - solo_mode: autonomous mode — bypass the gate (default off)
 *
 * When guard is on and SOLO is off, before_tool hooks cancel matching tools
 * with a clear message so the model can choose a safer path or ask the user
 * to enable SOLO.
 */

export type DangerousToolLevel = "high" | "medium";

export interface DangerousToolSpec {
  /** Exact agent tool name. */
  name: string;
  level: DangerousToolLevel;
  /** Short English reason for the block message. */
  reason: string;
}

/**
 * Tools with irreversible or high-impact host side effects.
 * Keep in sync with TOOLS / module tools names.
 */
export const DANGEROUS_TOOLS: DangerousToolSpec[] = [
  {
    name: "bash",
    level: "high",
    reason: "runs arbitrary shell commands on this machine",
  },
  {
    name: "write_skill",
    level: "medium",
    reason: "creates or overwrites skill files under ~/.qx/skills",
  },
  {
    name: "write_mcp_config",
    level: "high",
    reason: "rewrites MCP server config (can launch external processes)",
  },
  {
    name: "docs_write",
    level: "medium",
    reason: "writes files into the Text Toolbox workspace",
  },
  {
    name: "docs.write",
    level: "medium",
    reason: "module action that writes Text Toolbox files",
  },
  {
    name: "qx_set_display_brightness",
    level: "medium",
    reason: "changes display brightness (visible hardware side effect)",
  },
  {
    name: "screencap_recapture",
    level: "medium",
    reason: "captures the screen without a picker UI",
  },
  {
    name: "screencap.recapture",
    level: "medium",
    reason: "module action that recaptures the last region",
  },
  {
    name: "open_path",
    level: "medium",
    reason: "opens a path in an external application",
  },
  {
    name: "copy_to_clipboard",
    level: "medium",
    reason: "overwrites the system clipboard",
  },
  {
    name: "run_plugin_command",
    level: "high",
    reason: "dispatches an arbitrary installed plugin command",
  },
  {
    name: "run_qx_capability",
    level: "high",
    reason: "may run network/write plugin or module actions",
  },
  {
    name: "run_module_action",
    level: "high",
    reason: "may run network/write module actions",
  },
  {
    name: "rss_refresh_all",
    level: "medium",
    reason: "network refresh of all RSS feeds",
  },
  {
    name: "rss.refresh_all",
    level: "medium",
    reason: "module action that refreshes all RSS feeds",
  },
  {
    name: "rss_refresh_feed",
    level: "medium",
    reason: "network refresh of one RSS feed",
  },
  {
    name: "rss.refresh_feed",
    level: "medium",
    reason: "module action that refreshes one RSS feed",
  },
  {
    name: "upsert_schedule",
    level: "high",
    reason: "creates or changes timed agent jobs",
  },
  {
    name: "delete_schedule",
    level: "high",
    reason: "deletes timed agent jobs",
  },
  {
    name: "run_schedule_now",
    level: "high",
    reason: "immediately runs a schedule (may capture screen / call models)",
  },
];

const byName = new Map(DANGEROUS_TOOLS.map((item) => [item.name, item]));

/** Capability / action ids treated as dangerous when run via run_* ports. */
const DANGEROUS_CAPABILITY_IDS = new Set([
  "rss.refresh_all",
  "rss.refresh_feed",
  "docs.write",
  "screencap.recapture",
  "weather.refresh",
]);

export function getDangerousTool(name: string | undefined): DangerousToolSpec | undefined {
  if (!name) return undefined;
  return byName.get(name.trim());
}

export function isDangerousToolName(name: string | undefined): boolean {
  return Boolean(getDangerousTool(name));
}

export function listDangerousToolNames(level?: DangerousToolLevel): string[] {
  return DANGEROUS_TOOLS.filter((item) => !level || item.level === level).map((item) => item.name);
}

/**
 * For capability runners, also inspect the target id inside tool input.
 * Returns a synthetic danger spec when the nested action is high-impact.
 */
export function resolveDangerousToolCall(
  toolName: string | undefined,
  toolInput: unknown,
): DangerousToolSpec | undefined {
  const direct = getDangerousTool(toolName);
  if (direct && direct.name !== "run_qx_capability" && direct.name !== "run_module_action") {
    return direct;
  }

  if (
    toolName !== "run_qx_capability"
    && toolName !== "run_module_action"
    && toolName !== "run_plugin_command"
  ) {
    return direct;
  }

  const rec =
    toolInput && typeof toolInput === "object" && !Array.isArray(toolInput)
      ? (toolInput as Record<string, unknown>)
      : {};
  const id =
    typeof rec.id === "string"
      ? rec.id.trim()
      : typeof rec.action === "string"
        ? rec.action.trim()
        : "";
  const pluginId =
    typeof rec.pluginId === "string"
      ? rec.pluginId.trim()
      : typeof rec.plugin_id === "string"
        ? rec.plugin_id.trim()
        : "";
  const command =
    typeof rec.command === "string"
      ? rec.command.trim()
      : typeof rec.name === "string"
        ? rec.name.trim()
        : "";

  if (toolName === "run_plugin_command" && (pluginId || command)) {
    return {
      name: `run_plugin_command:${pluginId || "?"}:${command || "?"}`,
      level: "high",
      reason: "dispatches an installed plugin command with possible side effects",
    };
  }

  if (id.startsWith("command:")) {
    return {
      name: id,
      level: "high",
      reason: "runs a plugin launcher command",
    };
  }
  if (id.startsWith("plugin:")) {
    return {
      name: id,
      level: "high",
      reason: "runs a plugin-registered module action",
    };
  }
  if (DANGEROUS_CAPABILITY_IDS.has(id) || byName.has(id)) {
    const known = byName.get(id);
    return (
      known ?? {
        name: id,
        level: "medium",
        reason: "module action with host side effects",
      }
    );
  }

  // Generic write/network-ish action ids
  if (
    /\.(write|delete|set_|refresh|run_|create|remove|kill)/i.test(id)
    || /^(write|delete|set_|refresh|run_)/i.test(id)
  ) {
    return {
      name: id || toolName || "unknown",
      level: "medium",
      reason: "action id looks like a write/network/control operation",
    };
  }

  return direct;
}

export function formatDangerousToolsBlock(): string {
  const high = listDangerousToolNames("high");
  const medium = listDangerousToolNames("medium");
  return [
    `high: ${high.join(", ") || "(none)"}`,
    `medium: ${medium.join(", ") || "(none)"}`,
  ].join("\n");
}
