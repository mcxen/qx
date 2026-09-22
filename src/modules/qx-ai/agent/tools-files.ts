/**
 * Native file and shell tools.
 *
 * Keep model-facing filesystem behavior in one adapter: discovery uses Qx's
 * system index, text operations use bounded Rust commands, and writes require
 * the revision emitted by read_file before an existing file can be changed.
 */
import { invoke } from "@tauri-apps/api/core";
import type { AgentSettings } from "../../settings/store";
import {
  asRecord,
  numberField,
  stringField,
  truncate,
  type QxAiFileAttachment,
  type ToolSpec,
} from "./types";

interface AiFileEntry {
  path: string;
  name: string;
  kind: string;
  size?: number;
  modifiedAtMs?: number;
}

interface AiReadFileResult {
  path: string;
  revision: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  encoding: string;
}

interface AiDirectoryResult {
  path: string;
  entries: AiFileEntry[];
  truncated: boolean;
}

interface AiGlobFilesResult {
  root: string;
  pattern: string;
  paths: string[];
  truncated: boolean;
}

interface AiWriteFileResult {
  path: string;
  revision: string;
  bytes: number;
  created: boolean;
  replacements: number;
}

const filesOn = (settings: AgentSettings) => settings.file_search_enabled;

function requirePath(input: unknown, field = "path"): string {
  const path = stringField(asRecord(input), field).trim();
  if (!path) throw new Error(`${field} is required.`);
  return path;
}

function formatFileEntry(entry: AiFileEntry): string {
  const details = [entry.kind];
  if (typeof entry.size === "number") details.push(`${entry.size} bytes`);
  if (typeof entry.modifiedAtMs === "number") {
    details.push(`modified=${new Date(entry.modifiedAtMs).toISOString()}`);
  }
  return `${entry.path} [${details.join(", ")}]`;
}

export const FILE_TOOLS: ToolSpec[] = [
  {
    name: "bash",
    description:
      "Run a shell command through the Bash-compatible runtime resolved by Qx. Prefer native read_file, glob_files, list_directory, grep, write_file, and edit_file for common file work. Avoid destructive commands without an explicit user instruction.",
    inputHint: '{"script": "git status --short", "cwd": "~/code/project"}',
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "Shell script to execute" },
        cwd: { type: "string", description: "Optional working directory" },
        timeoutMs: { type: "number", description: "Timeout in ms (default 30000)" },
      },
      required: ["script"],
    },
    isEnabled: (settings) => settings.bash_enabled,
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
        req: { script, cwd: cwd || undefined, timeoutMs },
      });
      const parts = [`exit=${result.status ?? "?"}${result.timedOut ? " (timeout)" : ""}`];
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
    isEnabled: (settings) => settings.grep_search_enabled,
    run: async (input) => {
      const rec = asRecord(input);
      const query = stringField(rec, "query");
      if (!query.trim()) return "Error: grep requires a 'query' field.";
      const root = stringField(rec, "root").trim();
      if (!root) {
        return "Error: grep requires an explicit 'root' directory. Use files or glob_files for filename search.";
      }
      const maxResults = numberField(rec, "maxResults", 40);
      const results = await invoke<Array<{ path: string; line: number | null; text: string }>>(
        "plugin_ai_grep_search",
        { req: { query, root, maxResults } },
      );
      if (results.length === 0) return "No matches.";
      return truncate(results.map((result) => `${result.path}:${result.line ?? "?"}: ${result.text}`).join("\n"));
    },
  },
  {
    name: "files",
    description:
      "Search files on the current operating system by name fragment through Qx's cross-platform file index. Returns paths. Use glob_files when the user supplies a path pattern under a known root.",
    inputHint: '{"query": "invoice.pdf"}',
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filename fragment to search" },
      },
      required: ["query"],
    },
    isEnabled: filesOn,
    run: async (input) => {
      const query = stringField(asRecord(input), "query");
      if (!query.trim()) return "Error: files requires a 'query' field.";
      const results = await invoke<Array<{ name: string; path: string }>>("search_files", { query });
      if (results.length === 0) return "No matching files.";
      return truncate(results.map((result) => `${result.name} — ${result.path}`).join("\n"));
    },
  },
  {
    name: "file_info",
    description:
      "Inspect one local file, directory, or symbolic link without opening it. Returns the resolved kind, byte size when applicable, and modification time.",
    inputHint: '{"path": "/path/to/report.md"}',
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    isEnabled: filesOn,
    run: async (input) => formatFileEntry(
      await invoke<AiFileEntry>("qxai_file_info", { path: requirePath(input) }),
    ),
  },
  {
    name: "list_directory",
    description:
      "List one directory without recursion. Directories sort before files; results are bounded. Use glob_files for recursive path-pattern matching.",
    inputHint: '{"path": "~/Documents", "maxEntries": 200}',
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        maxEntries: { type: "number", description: "1-500, default 200" },
      },
      required: ["path"],
    },
    isEnabled: filesOn,
    run: async (input) => {
      const rec = asRecord(input);
      const result = await invoke<AiDirectoryResult>("qxai_list_directory", {
        req: {
          path: requirePath(input),
          maxEntries: numberField(rec, "maxEntries", 200),
        },
      });
      const lines = result.entries.map(formatFileEntry);
      if (result.truncated) lines.push("…[directory listing truncated]");
      return truncate(lines.length > 0 ? lines.join("\n") : `${result.path} is empty.`, 12_000);
    },
  },
  {
    name: "glob_files",
    description:
      "Recursively find files beneath an explicit root using a glob pattern such as **/*.md or src/**/*.ts. Does not follow symbolic links and returns a bounded path list.",
    inputHint: '{"root": "~/code/project", "pattern": "src/**/*.ts", "maxResults": 100}',
    parameters: {
      type: "object",
      properties: {
        root: { type: "string" },
        pattern: { type: "string" },
        maxResults: { type: "number", description: "1-500, default 100" },
      },
      required: ["root", "pattern"],
    },
    isEnabled: filesOn,
    run: async (input) => {
      const rec = asRecord(input);
      const root = requirePath(input, "root");
      const pattern = stringField(rec, "pattern").trim();
      if (!pattern) return "Error: pattern is required.";
      const result = await invoke<AiGlobFilesResult>("qxai_glob_files", {
        req: { root, pattern, maxResults: numberField(rec, "maxResults", 100) },
      });
      if (result.paths.length === 0) return "No files matched the pattern.";
      return truncate(
        `${result.paths.join("\n")}${result.truncated ? "\n…[glob results truncated]" : ""}`,
        12_000,
      );
    },
  },
  {
    name: "read_file",
    description:
      "Read a bounded line range from a local text file. Supports UTF-8, UTF-16, and GB18030; rejects binary and files above 2 MiB. Returns a sha256 revision required by write_file/edit_file when changing an existing file.",
    inputHint: '{"path": "/path/to/file.md", "offset": 1, "limit": 200}',
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        offset: { type: "number", description: "1-based first line, default 1" },
        limit: { type: "number", description: "1-1000 lines, default 200" },
      },
      required: ["path"],
    },
    isEnabled: filesOn,
    run: async (input) => {
      const rec = asRecord(input);
      const result = await invoke<AiReadFileResult>("qxai_read_file", {
        req: {
          path: requirePath(input),
          offset: numberField(rec, "offset", 1),
          limit: numberField(rec, "limit", 200),
        },
      });
      return truncate([
        `path=${result.path}`,
        `revision=${result.revision}`,
        `encoding=${result.encoding} lines=${result.startLine}-${result.endLine}/${result.totalLines}${result.truncated ? " (more available)" : ""}`,
        result.content,
      ].join("\n"), 24_000);
    },
  },
  {
    name: "write_file",
    description:
      "Create a text file or replace a complete existing text file. Existing files require expectedRevision from a prior read_file call, preventing stale overwrites. Creates missing parent directories. Requires safety confirmation unless SOLO is enabled.",
    inputHint: '{"path": "/path/to/new.md", "content": "# Notes", "expectedRevision": "sha256:..."}',
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        expectedRevision: { type: "string", description: "Required when the target already exists" },
      },
      required: ["path", "content"],
    },
    isEnabled: filesOn,
    run: async (input) => {
      const rec = asRecord(input);
      const result = await invoke<AiWriteFileResult>("qxai_write_file", {
        req: {
          path: requirePath(input),
          content: stringField(rec, "content"),
          expectedRevision: stringField(rec, "expectedRevision") || undefined,
        },
      });
      return `${result.created ? "Created" : "Updated"} ${result.path} (${result.bytes} bytes, revision=${result.revision}).`;
    },
  },
  {
    name: "edit_file",
    description:
      "Make one exact text replacement in an existing local file. oldText must occur exactly once and expectedRevision must come from the latest read_file result. Requires safety confirmation unless SOLO is enabled.",
    inputHint: '{"path": "/path/to/file.md", "oldText": "before", "newText": "after", "expectedRevision": "sha256:..."}',
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
        expectedRevision: { type: "string" },
      },
      required: ["path", "oldText", "newText", "expectedRevision"],
    },
    isEnabled: filesOn,
    run: async (input) => {
      const rec = asRecord(input);
      const oldText = stringField(rec, "oldText");
      const expectedRevision = stringField(rec, "expectedRevision").trim();
      if (!oldText) return "Error: oldText must not be empty.";
      if (!expectedRevision) return "Error: expectedRevision from read_file is required.";
      const result = await invoke<AiWriteFileResult>("qxai_edit_file", {
        req: {
          path: requirePath(input),
          oldText,
          newText: stringField(rec, "newText"),
          expectedRevision,
        },
      });
      return `Edited ${result.path} (${result.replacements} replacement, revision=${result.revision}).`;
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
    isEnabled: (settings) => settings.qx_host_actions_enabled,
    run: async (input) => {
      const path = requirePath(input);
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
    isEnabled: (settings) => settings.qx_host_actions_enabled,
    run: async (input) => {
      const path = requirePath(input);
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
    isEnabled: (settings) => settings.qx_host_actions_enabled,
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
    isEnabled: (settings) => settings.qx_host_actions_enabled,
    run: async (input) => {
      const path = requirePath(input);
      const metadata = await invoke<QxAiFileAttachment>("clipboard_file_metadata", { path });
      if (metadata.kind === "folder") return "Error: send_file accepts files, not directories.";
      return {
        observation: `Attached ${metadata.name} to the response.`,
        attachments: [metadata],
      };
    },
  },
];
