import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentSettings } from "../settings/store";
import type { G4fMessage } from "./store";
import {
  getQxDesktopPlatform,
  type QxDesktopPlatform,
} from "../../utils/keyboard";

export interface AgentStep {
  id: string;
  kind: "thought" | "action" | "observation" | "final" | "error";
  tool?: string;
  input?: string;
  output?: string;
  text?: string;
  state: "running" | "completed" | "error";
}

export interface QxAiFileAttachment {
  path: string;
  name: string;
  kind: string;
  size: number;
  mimeType?: string;
}

interface ToolExecutionResult {
  observation: string;
  attachments?: QxAiFileAttachment[];
}

interface StreamEvent {
  requestId: string;
  chunk: string;
  done: boolean;
  error?: string;
}

interface ToolSpec {
  name: string;
  description: string;
  inputHint: string;
  parameters: Record<string, unknown>;
  isEnabled: (s: AgentSettings) => boolean;
  run: (input: unknown) => Promise<string | ToolExecutionResult>;
}

const MAX_OBSERVATION_CHARS = 4000;

function truncate(text: string, limit = MAX_OBSERVATION_CHARS): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} chars]`;
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // fall through
      }
    }
  }
  return {};
}

function stringField(rec: Record<string, unknown>, key: string, fallback = ""): string {
  const value = rec[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function numberField(rec: Record<string, unknown>, key: string, fallback: number): number {
  const value = rec[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeToolResult(result: string | ToolExecutionResult): ToolExecutionResult {
  return typeof result === "string" ? { observation: result } : result;
}

export const TOOLS: ToolSpec[] = [
  {
    name: "bash",
    description:
      "Run a shell command through the Bash-compatible runtime resolved by Qx. Use for filesystem operations, listing files, reading text files, and CLIs. Avoid destructive commands without an explicit user instruction.",
    inputHint: '{"script": "ls -la ~/Documents", "cwd": "~"}',
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "Shell script to execute" },
        cwd: { type: "string", description: "Optional working directory" },
        timeoutMs: { type: "number", description: "Timeout in ms (default 30000)" },
      },
      required: ["script"],
    },
    isEnabled: (s) => s.bash_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const script = stringField(rec, "script") || stringField(rec, "command");
      if (!script.trim()) return "Error: bash requires a non-empty 'script' field.";
      const cwd = stringField(rec, "cwd").trim();
      const timeoutMs = numberField(rec, "timeoutMs", 30_000);
      const result = await invoke<{
        status: number | null;
        stdout: string;
        stderr: string;
        timedOut: boolean;
      }>("plugin_ai_run_bash", {
        req: {
          script,
          cwd: cwd || undefined,
          timeoutMs,
        },
      });
      const parts: string[] = [];
      parts.push(`exit=${result.status ?? "?"}${result.timedOut ? " (timeout)" : ""}`);
      if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
      if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
      return truncate(parts.join("\n"));
    },
  },
  {
    name: "grep",
    description:
      "Search text inside files recursively under an explicit directory using ripgrep. Use only for file-content search, never to locate a filename. Returns matching lines with paths and line numbers.",
    inputHint: '{"query": "TODO", "root": "~/code", "maxResults": 40}',
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search pattern (regex supported)" },
        root: { type: "string", description: "Directory to search in" },
        maxResults: { type: "number", description: "Max results to return (default 40)" },
      },
      required: ["query", "root"],
    },
    isEnabled: (s) => s.grep_search_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const query = stringField(rec, "query");
      if (!query.trim()) return "Error: grep requires a 'query' field.";
      const root = stringField(rec, "root").trim();
      if (!root) {
        return "Error: grep requires an explicit 'root' directory. Use the files tool for filename search.";
      }
      const maxResults = numberField(rec, "maxResults", 40);
      const results = await invoke<Array<{ path: string; line: number | null; text: string }>>(
        "plugin_ai_grep_search",
        {
          req: {
            query,
            root: root || undefined,
            maxResults,
          },
        },
      );
      if (results.length === 0) return "No matches.";
      return truncate(
        results
          .map((r) => `${r.path}:${r.line ?? "?"}: ${r.text}`)
          .join("\n"),
      );
    },
  },
  {
    name: "http",
    description:
      "Make an HTTP GET (or other method) request and return the response body. Use for reading docs, APIs, RSS feeds.",
    inputHint: '{"url": "https://example.com", "method": "GET"}',
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute HTTP(S) URL" },
        method: { type: "string", description: "HTTP method (default GET)" },
        headers: { type: "object", description: "Optional headers map" },
        body: { type: "string", description: "Optional request body" },
      },
      required: ["url"],
    },
    isEnabled: (s) => s.http_fetch_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const url = stringField(rec, "url");
      if (!url.trim()) return "Error: http requires a 'url' field.";
      const method = stringField(rec, "method", "GET").toUpperCase();
      const headersRaw = rec.headers;
      const headers: Record<string, string> = {};
      if (headersRaw && typeof headersRaw === "object" && !Array.isArray(headersRaw)) {
        for (const [k, v] of Object.entries(headersRaw)) {
          if (typeof v === "string") headers[k] = v;
        }
      }
      const body = typeof rec.body === "string" ? rec.body : undefined;
      const response = await invoke<{
        status: number;
        ok: boolean;
        body: string;
      }>("plugin_http_fetch", {
        req: { url, method, headers, body, timeout_ms: 15_000 },
      });
      return truncate(`HTTP ${response.status}${response.ok ? "" : " (failed)"}:\n${response.body}`);
    },
  },
  {
    name: "apps",
    description:
      "Search applications installed on the current operating system by name. Returns matching app paths.",
    inputHint: '{"query": "safari"}',
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "App name fragment to search" },
      },
      required: ["query"],
    },
    isEnabled: (s) => s.app_search_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const query = stringField(rec, "query");
      const results = await invoke<Array<{ name: string; path: string; kind: string }>>(
        "search_apps",
        { query },
      );
      if (results.length === 0) return "No matching apps.";
      return truncate(
        results
          .slice(0, 20)
          .map((r) => `${r.name} (${r.kind}) — ${r.path}`)
          .join("\n"),
      );
    },
  },
  {
    name: "files",
    description:
      "Search files on the current operating system by name fragment through Qx's cross-platform file index. Returns paths.",
    inputHint: '{"query": "invoice.pdf"}',
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filename fragment to search" },
      },
      required: ["query"],
    },
    isEnabled: (s) => s.file_search_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const query = stringField(rec, "query");
      if (!query.trim()) return "Error: files requires a 'query' field.";
      const results = await invoke<Array<{ name: string; path: string }>>("search_files", {
        query,
      });
      if (results.length === 0) return "No matching files.";
      return truncate(results.map((r) => `${r.name} — ${r.path}`).join("\n"));
    },
  },
  {
    name: "open_path",
    description:
      "Open a local file or directory with the operating system's default application. Use only when the user asks to open it.",
    inputHint: '{"path": "<absolute path returned by files>"}',
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Existing local file or directory path" } },
      required: ["path"],
    },
    isEnabled: (s) => s.qx_host_actions_enabled,
    run: async (input) => {
      const path = stringField(asRecord(input), "path").trim();
      if (!path) return "Error: open_path requires a 'path' field.";
      await invoke("plugin_system_open_path", { path });
      return `Opened ${path}.`;
    },
  },
  {
    name: "reveal_path",
    description:
      "Reveal and select a local file or directory in Finder or Windows File Explorer. Use when the user asks for the containing folder or file location.",
    inputHint: '{"path": "<absolute path returned by files>"}',
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Existing local file or directory path" } },
      required: ["path"],
    },
    isEnabled: (s) => s.qx_host_actions_enabled,
    run: async (input) => {
      const path = stringField(asRecord(input), "path").trim();
      if (!path) return "Error: reveal_path requires a 'path' field.";
      await invoke("plugin_system_reveal_path", { path });
      return `Revealed ${path} in the system file manager.`;
    },
  },
  {
    name: "copy_to_clipboard",
    description:
      "Copy text or real local files to the system clipboard. For files, use paths so Finder/Explorer receives native file references rather than path text.",
    inputHint: '{"paths": ["<absolute path returned by files>"]}',
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to copy when no file paths are supplied" },
        paths: { type: "array", items: { type: "string" }, description: "Local file or directory paths to copy natively" },
      },
    },
    isEnabled: (s) => s.qx_host_actions_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const paths = Array.isArray(rec.paths)
        ? rec.paths.filter((path): path is string => typeof path === "string" && path.trim().length > 0)
        : [];
      if (paths.length > 0) {
        await invoke("clipboard_write_file_paths", { paths });
        return `Copied ${paths.length} file${paths.length === 1 ? "" : "s"} to the system clipboard.`;
      }
      const text = stringField(rec, "text");
      if (!text) return "Error: copy_to_clipboard requires non-empty 'text' or 'paths'.";
      await invoke("plugin_clipboard_write", { text });
      return "Copied text to the system clipboard.";
    },
  },
  {
    name: "send_file",
    description:
      "Attach an existing local file to the QxAI response so the user receives a file card with Open, Reveal, and Copy actions. Do not use for directories.",
    inputHint: '{"path": "<absolute path returned by files>"}',
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Existing local file path to send" } },
      required: ["path"],
    },
    isEnabled: (s) => s.qx_host_actions_enabled,
    run: async (input) => {
      const path = stringField(asRecord(input), "path").trim();
      if (!path) return "Error: send_file requires a 'path' field.";
      const metadata = await invoke<QxAiFileAttachment>("clipboard_file_metadata", { path });
      if (metadata.kind === "folder") return "Error: send_file accepts files, not directories.";
      return {
        observation: `Attached ${metadata.name} to the response.`,
        attachments: [metadata],
      };
    },
  },
  {
    name: "notify",
    description:
      "Show a native Qx completion notification. Use for a requested completion alert, especially after a longer task.",
    inputHint: '{"title": "QxAI", "body": "Task completed"}',
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Notification title" },
        body: { type: "string", description: "Notification body" },
      },
      required: ["title"],
    },
    isEnabled: (s) => s.notifications_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const title = stringField(rec, "title").trim();
      if (!title) return "Error: notify requires a 'title' field.";
      await invoke("plugin_notification_show", {
        req: { title, body: stringField(rec, "body"), subtitle: "" },
      });
      return "Notification shown.";
    },
  },
  {
    name: "memory_list",
    description:
      "List all stored memory entries (long-term notes the user has saved across sessions).",
    inputHint: "{}",
    parameters: {
      type: "object",
      properties: {},
    },
    isEnabled: (s) => s.memory_tool_enabled,
    run: async () => {
      const entries = await invoke<Array<{ id: string; text: string; tags: string[] }>>(
        "plugin_ai_memory_list",
      );
      if (entries.length === 0) return "No memory entries.";
      return truncate(
        entries
          .map(
            (m) =>
              `- [${m.id}] ${m.text}${m.tags.length ? ` (tags: ${m.tags.join(", ")})` : ""}`,
          )
          .join("\n"),
      );
    },
  },
  {
    name: "memory_add",
    description:
      "Save a new memory entry. Use only when the user asks you to remember something explicitly.",
    inputHint: '{"text": "User prefers dark mode", "tags": ["preference"]}',
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Memory content to store" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags",
        },
      },
      required: ["text"],
    },
    isEnabled: (s) => s.memory_tool_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const text = stringField(rec, "text");
      if (!text.trim()) return "Error: memory_add requires a 'text' field.";
      const tags = Array.isArray(rec.tags)
        ? (rec.tags as unknown[]).filter((t): t is string => typeof t === "string")
        : [];
      const entry = await invoke<{ id: string }>("plugin_ai_memory_add", {
        input: { text, tags },
      });
      return `Stored memory id=${entry.id}.`;
    },
  },
  {
    name: "memory_delete",
    description: "Remove a stored memory entry by id.",
    inputHint: '{"id": "..."}',
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory entry id to delete" },
      },
      required: ["id"],
    },
    isEnabled: (s) => s.memory_tool_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const id = stringField(rec, "id");
      if (!id.trim()) return "Error: memory_delete requires an 'id' field.";
      await invoke("plugin_ai_memory_delete", { id });
      return `Deleted memory ${id}.`;
    },
  },
];

export function getEnabledTools(settings: AgentSettings): ToolSpec[] {
  if (!settings.agent_mode_enabled || !settings.tools_enabled) return [];
  return TOOLS.filter((tool) => tool.isEnabled(settings));
}

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
- Use files for filename or folder-name searches; it runs Qx's complete native system search.
- Use grep only to search file contents under an explicit root directory. Never use grep as a filename-search fallback.
- Use apps only when the user is looking for an installed application, not a document or folder.
- Use open_path, reveal_path, copy_to_clipboard, send_file, and notify only when they directly fulfill the user's request; these tools have visible host side effects.
- When the user asks you to send or provide a local file, call send_file so Qx renders a real file attachment card. Do not merely print the path.

Available tools:
${toolBlock}`;

  return `${hostPrompt}\n${protocol}`;
}

interface ParsedAction {
  kind: "action" | "final" | "none";
  thought?: string;
  tool?: string;
  input?: string;
  finalAnswer?: string;
}

export function parseAgentResponse(text: string): ParsedAction {
  const finalMatch = text.match(/Final Answer\s*:\s*([\s\S]*?)$/i);
  const actionMatch = text.match(
    /Action\s*:\s*([^\n]+)\n\s*Action Input\s*:\s*([\s\S]*?)(?=\n(?:Observation|Thought|Action|Final Answer)\s*:|$)/i,
  );
  const thoughtMatch = text.match(/Thought\s*:\s*([^\n]+)/i);
  const thought = thoughtMatch?.[1]?.trim();

  if (actionMatch && (!finalMatch || actionMatch.index! < finalMatch.index!)) {
    return {
      kind: "action",
      thought,
      tool: actionMatch[1].trim(),
      input: actionMatch[2].trim(),
    };
  }

  if (finalMatch) {
    return {
      kind: "final",
      thought,
      finalAnswer: finalMatch[1].trim(),
    };
  }

  return { kind: "none", thought };
}

function nextStepId(): string {
  return `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function streamOnce(
  messages: G4fMessage[],
  provider: string,
  model: string,
  onChunk: (text: string) => void,
): Promise<string> {
  const requestId = `qxai-agent-${Math.random().toString(36).slice(2, 10)}`;
  let acc = "";

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | undefined;
    const finish = (err: Error | null, value: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      try {
        unlisten?.();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve(value);
    };
    const timeout = window.setTimeout(
      () => finish(new Error("AI stream timed out"), ""),
      180_000,
    );

    // Throttle UI updates so long streams do not re-render on every chunk.
    const THROTTLE_MS = 80;
    let lastFlush = 0;
    let flushTimer: number | undefined;
    const flush = () => {
      window.clearTimeout(flushTimer);
      flushTimer = undefined;
      lastFlush = Date.now();
      if (!settled) onChunk(acc);
    };
    const scheduleFlush = () => {
      if (flushTimer !== undefined) return;
      const now = Date.now();
      const delay = Math.max(0, THROTTLE_MS - (now - lastFlush));
      flushTimer = window.setTimeout(flush, delay);
    };

    listen<StreamEvent>("qxai-stream", (event) => {
      if (event.payload.requestId !== requestId) return;
      if (event.payload.error) {
        finish(new Error(event.payload.error), "");
        return;
      }
      if (event.payload.done) {
        flush();
        finish(null, acc || event.payload.chunk);
        return;
      }
      acc += event.payload.chunk;
      if (Date.now() - lastFlush >= THROTTLE_MS) {
        flush();
      } else {
        scheduleFlush();
      }
    })
      .then((un) => {
        if (settled) {
          try {
            un();
          } catch {
            // ignore
          }
          return;
        }
        unlisten = un;
        return invoke("qxai_stream_chat_events", {
          requestId,
          provider,
          model,
          messages,
        });
      })
      .catch((err) => finish(err instanceof Error ? err : new Error(String(err)), ""));
  });
}

export interface AgentRunOptions {
  messages: G4fMessage[];
  provider: string;
  model: string;
  basePrompt: string;
  agentSettings: AgentSettings;
  onStep: (step: AgentStep) => void;
  onStepUpdate: (id: string, patch: Partial<AgentStep>) => void;
  onAssistantStream: (text: string) => void;
  onReasoningStream: (text: string) => void;
  reasoning: boolean;
  maxIterations?: number;
}

export interface AgentRunResult {
  finalAnswer: string;
  reasoning?: string;
  steps: AgentStep[];
  attachments: QxAiFileAttachment[];
}

function appendAttachments(
  target: QxAiFileAttachment[],
  incoming: QxAiFileAttachment[] | undefined,
) {
  for (const attachment of incoming ?? []) {
    if (!target.some((item) => item.path === attachment.path)) target.push(attachment);
  }
}

export async function runReactAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const enabled = getEnabledTools(opts.agentSettings);
  const systemPrompt = buildReactSystemPrompt(opts.basePrompt, enabled);

  const working: G4fMessage[] = opts.messages.map((m) => ({ ...m }));
  if (working.length > 0 && working[0].role === "system") {
    working[0] = { role: "system", content: systemPrompt };
  } else {
    working.unshift({ role: "system", content: systemPrompt });
  }

  const steps: AgentStep[] = [];
  const attachments: QxAiFileAttachment[] = [];
  const maxIterations = opts.maxIterations ?? opts.agentSettings.agent_max_iterations ?? 12;
  let lastRaw = "";
  let scratchpad = "";

  for (let i = 0; i < maxIterations; i++) {
    const messagesForTurn: G4fMessage[] = scratchpad
      ? [
          ...working,
          { role: "assistant", content: scratchpad.trim() },
          {
            role: "user",
            content:
              "Continue. If you have enough information, respond with `Final Answer: ...`. Otherwise emit the next `Thought / Action / Action Input`.",
          },
        ]
      : working;

    lastRaw = await streamOnce(
      messagesForTurn,
      opts.provider,
      opts.model,
      (partial) => opts.onAssistantStream(scratchpad ? `${scratchpad}\n${partial}` : partial),
    );

    const parsed = parseAgentResponse(lastRaw);

    if (parsed.thought) {
      const thoughtStep: AgentStep = {
        id: nextStepId(),
        kind: "thought",
        text: parsed.thought,
        state: "completed",
      };
      steps.push(thoughtStep);
      opts.onStep(thoughtStep);
    }

    if (parsed.kind === "final") {
      const finalStep: AgentStep = {
        id: nextStepId(),
        kind: "final",
        text: parsed.finalAnswer ?? lastRaw.trim(),
        state: "completed",
      };
      steps.push(finalStep);
      opts.onStep(finalStep);
      return { finalAnswer: parsed.finalAnswer ?? lastRaw.trim(), steps, attachments };
    }

    if (parsed.kind === "none") {
      const finalStep: AgentStep = {
        id: nextStepId(),
        kind: "final",
        text: lastRaw.trim(),
        state: "completed",
      };
      steps.push(finalStep);
      opts.onStep(finalStep);
      return { finalAnswer: lastRaw.trim(), steps, attachments };
    }

    const tool = enabled.find((t) => t.name === parsed.tool);
    const actionStep: AgentStep = {
      id: nextStepId(),
      kind: "action",
      tool: parsed.tool,
      input: parsed.input,
      state: "running",
    };
    steps.push(actionStep);
    opts.onStep(actionStep);

    let observation: string;
    if (!tool) {
      observation = `Error: tool "${parsed.tool}" is not available. Enabled tools: ${
        enabled.map((t) => t.name).join(", ") || "(none)"
      }.`;
      opts.onStepUpdate(actionStep.id, { state: "error", output: observation });
    } else {
      try {
        let parsedInput: unknown = parsed.input;
        try {
          parsedInput = JSON.parse(parsed.input ?? "{}");
        } catch {
          // pass raw string to tool, individual tools handle it
        }
        const result = normalizeToolResult(await tool.run(parsedInput));
        observation = result.observation;
        appendAttachments(attachments, result.attachments);
        opts.onStepUpdate(actionStep.id, { state: "completed", output: observation });
      } catch (err) {
        observation = `Error: ${err instanceof Error ? err.message : String(err)}`;
        opts.onStepUpdate(actionStep.id, { state: "error", output: observation });
      }
    }

    const obsStep: AgentStep = {
      id: nextStepId(),
      kind: "observation",
      tool: parsed.tool,
      output: observation,
      state: "completed",
    };
    steps.push(obsStep);
    opts.onStep(obsStep);

    scratchpad = `${scratchpad ? `${scratchpad}\n` : ""}${lastRaw.trim()}\nObservation: ${observation}`;
  }

  const recoveryMessages: G4fMessage[] = [
    ...working,
    { role: "assistant", content: scratchpad.trim() },
    {
      role: "user",
      content:
        "You have reached the maximum number of steps. Review the observations above carefully and provide your best `Final Answer:` now. Summarize what you learned and respond directly to the user's request.",
    },
  ];

  try {
    const recoveryText = await streamOnce(
      recoveryMessages,
      opts.provider,
      opts.model,
      (partial) => opts.onAssistantStream(scratchpad ? `${scratchpad}\n${partial}` : partial),
    );
    const parsed = parseAgentResponse(recoveryText);
    const answer = parsed.kind === "final" ? (parsed.finalAnswer ?? recoveryText.trim()) : recoveryText.trim();
    const finalStep: AgentStep = {
      id: nextStepId(),
      kind: "final",
      text: answer,
      state: "completed",
    };
    steps.push(finalStep);
    opts.onStep(finalStep);
    return { finalAnswer: answer, steps, attachments };
  } catch {
    // recovery failed, fall through to error
  }

  const truncatedFinal = "Unable to complete: hit iteration limit. " + scratchpad.slice(0, 500);
  const finalStep: AgentStep = {
    id: nextStepId(),
    kind: "error",
    text: truncatedFinal,
    state: "error",
  };
  steps.push(finalStep);
  opts.onStep(finalStep);
  return { finalAnswer: truncatedFinal, steps, attachments };
}

function toolsToOpenAISchema(enabled: ToolSpec[]): Array<Record<string, unknown>> {
  return enabled.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function messageContentToOpenAI(content: G4fMessage["content"]): unknown {
  if (typeof content === "string") return content;
  return content;
}

interface OpenAIToolCall {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  reasoning_content?: string;
  reasoning_details?: unknown[];
}

interface FunctionStreamEvent {
  requestId: string;
  kind: "text" | "reasoning" | "done";
  chunk: string;
  done: boolean;
  message?: OpenAIMessage;
  error?: string;
}

function assertNamedToolCalls(message: OpenAIMessage, transport: string): OpenAIMessage {
  for (const [index, call] of (message.tool_calls ?? []).entries()) {
    if (!call.function?.name?.trim()) {
      throw new Error(`${transport} returned tool call ${index + 1} without a function name`);
    }
  }
  return message;
}

async function streamFunctionCallingOnce(
  opts: AgentRunOptions,
  messages: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
  onReasoningStream: (text: string) => void = opts.onReasoningStream,
): Promise<OpenAIMessage> {
  const requestId = `qxai-tools-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
  let content = "";
  let reasoning = "";
  let unlisten: (() => void) | undefined;
  let settled = false;
  const stop = () => {
    if (settled) return false;
    settled = true;
    try {
      unlisten?.();
    } catch {
      // ignore listener cleanup failures
    }
    return true;
  };

  const streamPromise = new Promise<OpenAIMessage>((resolve, reject) => {
    listen<FunctionStreamEvent>("qxai-stream", (event) => {
      if (event.payload.requestId !== requestId) return;
      if (event.payload.error) {
        if (stop()) reject(new Error(event.payload.error));
        return;
      }
      if (event.payload.done) {
        if (stop()) {
          resolve(event.payload.message ?? {
            role: "assistant",
            content: content || null,
            reasoning_content: reasoning || undefined,
          });
        }
        return;
      }
      if (event.payload.kind === "reasoning") {
        reasoning += event.payload.chunk;
        onReasoningStream(reasoning);
      } else {
        content += event.payload.chunk;
        opts.onAssistantStream(content);
      }
    })
      .then((un) => {
        if (settled) {
          un();
          return;
        }
        unlisten = un;
        return invoke("qxai_stream_chat_with_tools_events", {
          requestId,
          provider: opts.provider,
          model: opts.model,
          messages,
          tools,
          toolChoice: "auto",
          reasoning: opts.reasoning,
        });
      })
      .catch((error) => {
        if (stop()) reject(error instanceof Error ? error : new Error(String(error)));
      });
  });

  try {
    return assertNamedToolCalls(await streamPromise, "Streaming provider");
  } catch (streamError) {
    // Some OpenAI-compatible providers support function calling but not
    // streaming tool-call deltas. Preserve the working pre-stream transport as
    // a compatibility fallback; no local tool has executed at this point.
    try {
      const message = assertNamedToolCalls(await invoke<OpenAIMessage>("qxai_chat_with_tools", {
        provider: opts.provider,
        model: opts.model,
        messages,
        tools,
        toolChoice: tools.length > 0 ? "auto" : "none",
      }), "Compatibility provider");
      if (message.reasoning_content) {
        onReasoningStream(message.reasoning_content);
      }
      if (message.content) {
        opts.onAssistantStream(message.content);
      }
      return message;
    } catch (fallbackError) {
      const streamMessage =
        streamError instanceof Error ? streamError.message : String(streamError);
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        `Streaming tool call failed: ${streamMessage}; compatibility fallback failed: ${fallbackMessage}`,
      );
    }
  }
}

function createOrderedReasoningRecorder(steps: AgentStep[], opts: AgentRunOptions) {
  let reasoningStep: AgentStep | undefined;
  return {
    update(text: string) {
      if (!text) return;
      if (!reasoningStep) {
        reasoningStep = {
          id: nextStepId(),
          kind: "thought",
          text,
          state: "running",
        };
        steps.push(reasoningStep);
        opts.onStep(reasoningStep);
        return;
      }
      reasoningStep.text = text;
      opts.onStepUpdate(reasoningStep.id, { text });
    },
    complete() {
      if (!reasoningStep) return;
      reasoningStep.state = "completed";
      opts.onStepUpdate(reasoningStep.id, { state: "completed" });
    },
  };
}

export async function runFunctionCallingAgent(
  opts: AgentRunOptions,
): Promise<AgentRunResult> {
  const enabled = getEnabledTools(opts.agentSettings);
  const tools = toolsToOpenAISchema(enabled);

  const working: Array<Record<string, unknown>> = [];
  const systemPrompt = buildQxHostSystemPrompt(opts.basePrompt);
  if (systemPrompt) {
    working.push({ role: "system", content: systemPrompt });
  }
  for (const m of opts.messages) {
    if (m.role === "system" && working.length > 0 && working[0].role === "system") {
      working[0] = {
        role: "system",
        content: `${working[0].content as string}\n${
          typeof m.content === "string" ? m.content : JSON.stringify(m.content)
        }`,
      };
      continue;
    }
    working.push({
      role: m.role,
      content: messageContentToOpenAI(m.content),
      ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    });
  }

  const steps: AgentStep[] = [];
  const attachments: QxAiFileAttachment[] = [];
  const maxIterations = opts.maxIterations ?? opts.agentSettings.agent_max_iterations ?? 12;
  let lastFinal = "";

  for (let i = 0; i < maxIterations; i++) {
    let message: OpenAIMessage;
    const reasoning = createOrderedReasoningRecorder(steps, opts);
    try {
      message = await streamFunctionCallingOnce(opts, working, tools, reasoning.update);
      reasoning.complete();
    } catch (err) {
      reasoning.complete();
      const errStep: AgentStep = {
        id: nextStepId(),
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
        state: "error",
      };
      steps.push(errStep);
      opts.onStep(errStep);
      return { finalAnswer: errStep.text ?? "", steps, attachments };
    }

    const toolCalls = message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const finalText = message.content?.trim() ?? "";
      lastFinal = finalText;
      const finalStep: AgentStep = {
        id: nextStepId(),
        kind: "final",
        text: finalText,
        state: "completed",
      };
      steps.push(finalStep);
      opts.onStep(finalStep);
      return {
        finalAnswer: finalText,
        steps,
        attachments,
      };
    }

    working.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: toolCalls,
      ...(message.reasoning_content
        ? { reasoning_content: message.reasoning_content }
        : {}),
      ...(message.reasoning_details
        ? { reasoning_details: message.reasoning_details }
        : {}),
    });

    for (const call of toolCalls) {
      const name = call.function?.name ?? "";
      const rawArgs = call.function?.arguments ?? "{}";
      let parsedArgs: unknown = rawArgs;
      try {
        parsedArgs = JSON.parse(rawArgs);
      } catch {
        // pass raw string
      }
      const tool = enabled.find((t) => t.name === name);
      const actionStep: AgentStep = {
        id: nextStepId(),
        kind: "action",
        tool: name,
        input: rawArgs,
        state: "running",
      };
      steps.push(actionStep);
      opts.onStep(actionStep);

      let observation: string;
      if (!tool) {
        observation = `Error: tool "${name}" is not available. Enabled: ${
          enabled.map((t) => t.name).join(", ") || "(none)"
        }.`;
        opts.onStepUpdate(actionStep.id, { state: "error", output: observation });
      } else {
        try {
          const result = normalizeToolResult(await tool.run(parsedArgs));
          observation = result.observation;
          appendAttachments(attachments, result.attachments);
          opts.onStepUpdate(actionStep.id, { state: "completed", output: observation });
        } catch (err) {
          observation = `Error: ${err instanceof Error ? err.message : String(err)}`;
          opts.onStepUpdate(actionStep.id, { state: "error", output: observation });
        }
      }

      const obsStep: AgentStep = {
        id: nextStepId(),
        kind: "observation",
        tool: name,
        output: observation,
        state: "completed",
      };
      steps.push(obsStep);
      opts.onStep(obsStep);

      working.push({
        role: "tool",
        tool_call_id: call.id,
        content: observation,
      });
    }
  }

  const recoveryMessages: Array<Record<string, unknown>> = [
    ...working,
    {
      role: "user",
      content:
        "You have reached the maximum number of steps. Review the observations above and provide your final answer to the user's request. Respond with text only, no more tool calls.",
    },
  ];

  const recoveryReasoning = createOrderedReasoningRecorder(steps, opts);
  try {
    const recoveryMessage = await streamFunctionCallingOnce(
      opts,
      recoveryMessages,
      [],
      recoveryReasoning.update,
    );
    recoveryReasoning.complete();
    const finalText = (recoveryMessage.content?.trim() ?? lastFinal).trim();
    const finalStep: AgentStep = {
      id: nextStepId(),
      kind: "final",
      text: finalText,
      state: "completed",
    };
    steps.push(finalStep);
    opts.onStep(finalStep);
    return {
      finalAnswer: finalText,
      steps,
      attachments,
    };
  } catch {
    recoveryReasoning.complete();
    // recovery failed, fall through to error
  }

  const errStep: AgentStep = {
    id: nextStepId(),
    kind: "error",
    text: "Function calling agent hit iteration limit without producing a final answer.",
    state: "error",
  };
  steps.push(errStep);
  opts.onStep(errStep);
  return { finalAnswer: lastFinal, steps, attachments };
}
