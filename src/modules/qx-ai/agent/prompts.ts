import {
  getQxDesktopPlatform,
  type QxDesktopPlatform,
} from "../../../utils/keyboard";
import type { ToolSpec } from "./types";

export function buildQxHostSystemPrompt(
  basePrompt: string,
  platform: QxDesktopPlatform = getQxDesktopPlatform(),
): string {
  const platformContext = platform === "windows"
    ? `Qx host environment:
- The current operating system is Windows.
- Use Windows paths, applications, keyboard conventions, and terminology.
- Qx files/apps tools are cross-platform host APIs. Do not claim that Windows searches use macOS-only Spotlight, mdfind, Finder, or AppleScript.`
    : `Qx host environment:
- The current operating system is macOS.
- Use macOS paths, applications, keyboard conventions, and terminology.
- Qx files/apps tools are host APIs; Spotlight or mdfind may be used behind the file-search port.`;

  return [basePrompt.trim(), platformContext].filter(Boolean).join("\n\n");
}

export function buildReactSystemPrompt(
  basePrompt: string,
  enabled: ToolSpec[],
): string {
  const hostPrompt = buildQxHostSystemPrompt(basePrompt);
  if (enabled.length === 0) return hostPrompt;

  const toolBlock = enabled
    .map(
      (tool) =>
        `- ${tool.name}: ${tool.description}\n  Example input: ${tool.inputHint}`,
    )
    .join("\n");

  const names = new Set(enabled.map((tool) => tool.name));
  const ruleIf = (name: string, line: string) => (names.has(name) ? line : null);
  const capabilityRules = [
    ruleIf("files", "- Use files for filename or folder-name searches; it runs Qx's complete native system search."),
    ruleIf("grep", "- Use grep only to search file contents under an explicit root directory. Never use grep as a filename-search fallback."),
    ruleIf("apps", "- Use apps only when the user is looking for an installed application, not a document or folder."),
    names.has("open_path") || names.has("reveal_path") || names.has("copy_to_clipboard") || names.has("send_file") || names.has("notify")
      ? "- Use open_path, reveal_path, copy_to_clipboard, send_file, and notify only when they directly fulfill the user's request; these tools have visible host side effects."
      : null,
    names.has("qx_system_info") || names.has("qx_displays")
      ? "- Qx system tools (qx_system_info, qx_system_stats, qx_displays, qx_desktop_windows, qx_processes) read host state only."
      : null,
    names.has("qx_screenshot") || names.has("screencap_history")
      ? "- Screencap tools are available (module enabled): qx_screenshot, screencap_history, screencap_recapture when listed."
      : null,
    names.has("qx_clipboard_history") || names.has("clipboard_get_entry")
      ? "- Clipboard tools are available (module enabled): qx_clipboard_history, clipboard_get_entry when listed."
      : null,
    names.has("docs_list") || names.has("docs_read")
      ? "- Text Toolbox (documents) tools are available when listed: docs_list/read/write/inspect."
      : null,
    names.has("rss_dashboard") || names.has("rss_list_feeds")
      ? "- RSS tools are available when listed: dashboard, feeds, articles, mark_read, rss_refresh_feed, rss_refresh_all."
      : null,
    names.has("list_module_actions") || names.has("run_module_action")
      ? "- Module actions: use list_module_actions to discover stable ids (rss.refresh_all, pzai.*, plugin:<id>:*), then run_module_action. Prefer this port for intentional module operations plugins also expose."
      : null,
    names.has("list_qx_capabilities") || names.has("run_qx_capability")
      ? "- Qx capabilities (skill-driven): list_qx_capabilities discovers module actions + plugin commands + tools. run_qx_capability executes action/command ids. Skills may declare capabilities: in frontmatter — follow that list. list_plugins / run_plugin_command for marketplace plugins."
      : null,
    names.has("pzai_get_workbench") || names.has("pzai_set_summary")
      ? "- P仔 workbench tools when listed: pzai_get/set summary|draft|display_mode|notes, pzai_open_article, pzai_save_docs."
      : null,
    names.has("weather_current") || names.has("weather_for_location")
      ? "- Weather tools are available when the Weather module is enabled."
      : null,
    names.has("ocr_recognize_path") || names.has("ocr_status")
      ? "- OCR tools are available when Settings → OCR is enabled."
      : null,
    names.has("qx_storage_info") || names.has("qx_power") || names.has("qx_network_info")
      ? "- Extra system tools when listed: storage, network, power, display brightness."
      : null,
    names.has("list_schedules") || names.has("run_schedule_now")
      ? "- Schedules: list/upsert/delete/run_schedule_* for timed QxAI jobs; qx_logs_directory for Downloads/QxLogs."
      : null,
    names.has("list_skills")
      ? "- Skills: list_skills / read_skill / write_skill manage ~/.qx/skills. Prefer writing frontmatter mode: fixed|smart|disabled."
      : null,
    names.has("memory") || names.has("memory_list")
      ? "- Memory: memory tool with add/replace/remove/status on targets memory|user (char-capped). Snapshot is frozen in the system prompt. Use memory_dream to consolidate when full. Use session_search for past chats."
      : null,
    names.has("read_mcp_config")
      ? "- MCP: read_mcp_config / write_mcp_config manage ~/.qx/mcp.json. Only change MCP when the user asks."
      : null,
    names.has("send_file")
      ? "- When the user asks you to send or provide a local file, call send_file so Qx renders a real file attachment card. Do not merely print the path."
      : null,
    "- Only use tools listed under Available tools. Do not invent module capabilities that are not listed (disabled or uninstalled modules are invisible on purpose).",
  ]
    .filter(Boolean)
    .join("\n");

  const protocol = `
You are an autonomous agent that can call tools when helpful.
You may use this exact reasoning format, line by line:

Thought: <your reasoning about what to do next>
Action: <one of: ${enabled.map((t) => t.name).join(", ")}>
Action Input: <a single-line JSON object matching the tool's schema>

After each Action the runtime will append a line:
Observation: <the tool result>

You may chain several Thought/Action/Observation rounds.
When you have enough information, finish with:

Final Answer: <the answer to the user's question, in plain prose>

Rules:
- Emit at most one Action per turn, then stop and wait for the Observation.
- If no tool is needed, skip directly to "Final Answer:".
- Action Input MUST be valid JSON on a single line.
- Do not invent observations. Do not output "Observation:" yourself.
- If a tool errors, read the error in the Observation and adapt.
${capabilityRules}

Available tools:
${toolBlock}`;

  return `${hostPrompt}\n${protocol}`;
}
