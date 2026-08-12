/**
 * Dangerous-tool catalogue and content-aware safety gate.
 *
 * Guard policy (Settings → AI Agent):
 * - dangerous_tools_guard_enabled: classify high-impact tools (default on)
 * - solo_mode: autonomous mode — bypass the gate (default off)
 *
 * Bash is **not** blanket-blocked. The gate classifies the script:
 * - blacklist → hard deny (e.g. rm -rf /, mkfs, pipe-to-shell)
 * - safe/read-only (ps, ls, git status, …) → allow
 * - write / other execute → ask the user once (confirm)
 *
 * Other high-impact tools (writes, schedules, plugin runners…) also ask
 * unless SOLO is on. Guard off disables the gate entirely.
 */

export type DangerousToolLevel = "high" | "medium";

/** Gate outcome for a single tool call. */
export type SafetyGateAction = "allow" | "deny" | "ask";

export interface DangerousToolSpec {
  /** Exact agent tool name. */
  name: string;
  level: DangerousToolLevel;
  /** Short English reason for the block / confirm message. */
  reason: string;
  /**
   * How the tool is gated when SOLO is off.
   * - deny: hard block (rare; prefer content blacklists for bash)
   * - ask: prompt the user once (default for catalogue tools)
   */
  gate?: "deny" | "ask";
}

export interface SafetyGateDecision {
  action: SafetyGateAction;
  name: string;
  level: DangerousToolLevel;
  reason: string;
  /** Short preview (e.g. bash script) for the confirm dialog. */
  preview?: string;
}

/**
 * Tools with irreversible or high-impact host side effects.
 * Bash is intentionally **absent** — it is classified by script content.
 * Keep in sync with TOOLS / module tools names.
 */
export const DANGEROUS_TOOLS: DangerousToolSpec[] = [
  {
    name: "write_skill",
    level: "medium",
    reason: "creates or overwrites skill files under ~/.qx/skills",
    gate: "ask",
  },
  {
    name: "write_mcp_config",
    level: "high",
    reason: "rewrites MCP server config (can launch external processes)",
    gate: "ask",
  },
  {
    name: "docs_write",
    level: "medium",
    reason: "writes files into the Text Toolbox workspace",
    gate: "ask",
  },
  {
    name: "docs.write",
    level: "medium",
    reason: "module action that writes Text Toolbox files",
    gate: "ask",
  },
  {
    name: "qx_set_display_brightness",
    level: "medium",
    reason: "changes display brightness (visible hardware side effect)",
    gate: "ask",
  },
  {
    name: "screencap_recapture",
    level: "medium",
    reason: "captures the screen without a picker UI",
    gate: "ask",
  },
  {
    name: "screencap.recapture",
    level: "medium",
    reason: "module action that recaptures the last region",
    gate: "ask",
  },
  {
    name: "open_path",
    level: "medium",
    reason: "opens a path in an external application",
    gate: "ask",
  },
  {
    name: "copy_to_clipboard",
    level: "medium",
    reason: "overwrites the system clipboard",
    gate: "ask",
  },
  {
    name: "run_plugin_command",
    level: "high",
    reason: "dispatches an arbitrary installed plugin command",
    gate: "ask",
  },
  {
    name: "run_qx_capability",
    level: "high",
    reason: "may run network/write plugin or module actions",
    gate: "ask",
  },
  {
    name: "run_module_action",
    level: "high",
    reason: "may run network/write module actions",
    gate: "ask",
  },
  {
    name: "rss_refresh_all",
    level: "medium",
    reason: "network refresh of all RSS feeds",
    gate: "ask",
  },
  {
    name: "rss.refresh_all",
    level: "medium",
    reason: "module action that refreshes all RSS feeds",
    gate: "ask",
  },
  {
    name: "rss_refresh_feed",
    level: "medium",
    reason: "network refresh of one RSS feed",
    gate: "ask",
  },
  {
    name: "rss.refresh_feed",
    level: "medium",
    reason: "module action that refreshes one RSS feed",
    gate: "ask",
  },
  {
    name: "upsert_schedule",
    level: "high",
    reason: "creates or changes timed agent jobs",
    gate: "ask",
  },
  {
    name: "delete_schedule",
    level: "high",
    reason: "deletes timed agent jobs",
    gate: "ask",
  },
  {
    name: "run_schedule_now",
    level: "high",
    reason: "immediately runs a schedule (may capture screen / call models)",
    gate: "ask",
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

// ─── Bash content gate ───────────────────────────────────────────────────────

/**
 * Hard-deny patterns (blacklist). Matched against the full script and each
 * simple segment. Prefer deny only for destructive / unrecoverable actions.
 */
export const BASH_COMMAND_BLACKLIST: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+(-[^\s]*[rf][^\s]*\s+)*(-[^\s]*[rf][^\s]*\s+)?(\/|\~|\$HOME|~\/)\b/i,
    reason: "recursive delete targeting root or home (rm -rf / or ~)",
  },
  {
    pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-rf|-fr)\b/i,
    reason: "recursive force delete (rm -rf)",
  },
  {
    pattern: /\bmkfs(\.\w+)?\b/i,
    reason: "formats a filesystem (mkfs)",
  },
  {
    pattern: /\bdd\s+.*\bif=/i,
    reason: "raw disk write via dd",
  },
  {
    pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/,
    reason: "fork bomb",
  },
  {
    pattern: /\b(shutdown|reboot|halt|poweroff)\b/i,
    reason: "system power control",
  },
  {
    pattern: /\bdiskutil\s+(erase|partition|apfs\s+erase)/i,
    reason: "disk erase / partition",
  },
  {
    pattern: /\b(curl|wget|fetch)\b[^|;\n]*\|\s*(ba)?sh\b/i,
    reason: "pipe remote download into a shell",
  },
  {
    pattern: /\bchmod\s+(-R\s+)?777\s+(\/|~)/i,
    reason: "world-writable chmod on root or home",
  },
  {
    pattern: /\b(>\s*\/dev\/sd[a-z]|of=\/dev\/sd)/i,
    reason: "write to raw block device",
  },
  {
    pattern: /\bsudo\s+rm\b/i,
    reason: "privileged delete (sudo rm)",
  },
  {
    pattern: /\bgit\s+push\s+.*--force(-with-lease)?\b/i,
    reason: "force push rewrites remote history",
  },
];

/**
 * Read-only / low-risk primary commands. Word-boundary matched after peeling
 * common wrappers. Whole-tool bash is never blocked solely for using these.
 */
export const BASH_SAFE_COMMANDS = new Set([
  "ps",
  "pgrep",
  "ls",
  "ll",
  "pwd",
  "echo",
  "printf",
  "cat",
  "head",
  "tail",
  "wc",
  "date",
  "cal",
  "uname",
  "whoami",
  "id",
  "hostname",
  "uptime",
  "df",
  "du",
  "file",
  "stat",
  "which",
  "type",
  "command",
  "env",
  "printenv",
  "true",
  "false",
  "test",
  "[",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "md5",
  "md5sum",
  "shasum",
  "sha256sum",
  "cksum",
  "rg",
  "grep",
  "egrep",
  "fgrep",
  "ag",
  "ack",
  "find",
  "locate",
  "tree",
  "less",
  "more",
  "nl",
  "sort",
  "uniq",
  "cut",
  "tr",
  "column",
  "awk",
  "sed", // still filtered for -i below
  "diff",
  "cmp",
  "comm",
  "jq",
  "yq",
  "python",
  "python3",
  "node", // filtered when -e rewrite-ish; default ask unless simple -c print
  "ruby",
  "perl",
  "sw_vers",
  "sysctl",
  "getconf",
  "arch",
  "locale",
  "groups",
  "logname",
  "tty",
  "who",
  "w",
  "last",
  "history",
  "man",
  "help",
  "info",
  "type",
  "alias",
  "dirs",
  "jobs",
  "sleep",
  "true",
  "false",
  ":",
  "git",
  "cargo",
  "npm",
  "pnpm",
  "yarn",
  "npx",
  "tsc",
  "rustc",
  "go",
]);

/** git subcommands treated as read-only. */
const GIT_SAFE_SUB = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "rev-parse",
  "describe",
  "remote",
  "ls-files",
  "cat-file",
  "blame",
  "shortlog",
  "tag",
  "stash",
  "config",
  "version",
  "help",
  "whatchanged",
  "name-rev",
  "rev-list",
  "ls-tree",
  "ls-remote",
]);

/** cargo subcommands that do not mutate the tree (build/check may write target/ — still ok for agent). */
const CARGO_SAFE_SUB = new Set([
  "check",
  "test",
  "build",
  "clippy",
  "fmt",
  "tree",
  "metadata",
  "version",
  "help",
  "search",
  "info",
]);

/** npm-family read-ish / build-ish — install still asks. */
const NPM_SAFE_SUB = new Set([
  "test",
  "run",
  "exec",
  "ls",
  "list",
  "view",
  "info",
  "outdated",
  "pack",
  "version",
  "help",
  "config",
  "explain",
  "why",
]);

const PROCESS_WRAPPERS = new Set([
  "timeout",
  "nice",
  "ionice",
  "chrt",
  "stdbuf",
  "env",
  "command",
  "builtin",
  "time",
  "gtime",
  "nohup",
]);

function matchBlacklist(text: string): string | undefined {
  for (const item of BASH_COMMAND_BLACKLIST) {
    if (item.pattern.test(text)) return item.reason;
  }
  return undefined;
}

/** Split simple chains; complex syntax falls through to ask. */
function splitBashSegments(script: string): string[] | null {
  const trimmed = script.trim();
  if (!trimmed) return [];
  // Refuse to auto-allow complex shells; classifier returns ask instead.
  if (/[`]|\$\(|\$\{|<\(|>\(|\beval\b|\bsource\b|\b\.\s+\//i.test(trimmed)) {
    return null;
  }
  // background single & (not &&) → treat as complex
  if (/(^|[^&])&([^&]|$)/.test(trimmed)) return null;

  return trimmed
    .split(/(?:&&|\|\||;|\n|\|)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function peelEnvAssignments(tokens: string[]): string[] {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!)) {
    i += 1;
  }
  return tokens.slice(i);
}

function peelWrappers(tokens: string[]): string[] {
  let t = peelEnvAssignments(tokens);
  while (t.length > 0 && PROCESS_WRAPPERS.has(t[0]!.toLowerCase())) {
    // env VAR=val cmd…
    if (t[0]!.toLowerCase() === "env") {
      t = peelEnvAssignments(t.slice(1));
      continue;
    }
    // timeout 10 cmd / timeout -- 10 cmd
    if (t[0]!.toLowerCase() === "timeout" && t.length >= 3) {
      t = t.slice(2);
      // optional duration already consumed loosely
      if (t.length && /^-/.test(t[0]!)) t = t.slice(1);
      continue;
    }
    t = t.slice(1);
    if (t.length && /^-/.test(t[0]!)) {
      // skip one flag group
      while (t.length && /^-/.test(t[0]!)) t = t.slice(1);
    }
  }
  return peelEnvAssignments(t);
}

function tokenizeSegment(segment: string): string[] {
  // Light tokenizer: quotes preserved as single tokens when simple.
  const tokens: string[] = [];
  const re = /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\s]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) {
    tokens.push(m[0]!);
  }
  return tokens;
}

function primaryCommand(segment: string): { cmd: string; args: string[] } | null {
  const raw = tokenizeSegment(segment);
  if (!raw.length) return null;
  const tokens = peelWrappers(raw);
  if (!tokens.length) return null;
  let cmd = tokens[0]!.replace(/^["']|["']$/g, "");
  // path form: /usr/bin/ps → ps
  const base = cmd.includes("/") ? cmd.split("/").pop()! : cmd;
  return { cmd: base.toLowerCase(), args: tokens.slice(1) };
}

function isSafeGit(args: string[]): boolean {
  const sub = (args.find((a) => !a.startsWith("-")) || "").toLowerCase();
  if (!sub) return true; // bare `git` prints help-ish
  if (GIT_SAFE_SUB.has(sub)) return true;
  // `git -C path status`
  const cIdx = args.findIndex((a) => a === "-C");
  if (cIdx >= 0 && args[cIdx + 2]) {
    const sub2 = args[cIdx + 2]!.toLowerCase();
    return GIT_SAFE_SUB.has(sub2);
  }
  return false;
}

function isSafeCargo(args: string[]): boolean {
  const sub = (args.find((a) => !a.startsWith("-")) || "").toLowerCase();
  return !sub || CARGO_SAFE_SUB.has(sub);
}

function isSafeNpmFamily(args: string[]): boolean {
  const sub = (args.find((a) => !a.startsWith("-")) || "").toLowerCase();
  if (!sub) return true;
  if (sub === "install" || sub === "i" || sub === "add" || sub === "uninstall" || sub === "remove" || sub === "ci" || sub === "publish" || sub === "update") {
    return false;
  }
  return NPM_SAFE_SUB.has(sub);
}

function segmentLooksWritable(segment: string): boolean {
  // redirection to files (not /dev/null)
  if (/(^|[^0-9])>{1,2}\s*(?!\/dev\/null\b)/.test(segment)) return true;
  if (/\bsed\s+[^\n]*\s-i\b/.test(segment) || /\bsed\s+-i\b/.test(segment)) return true;
  if (/\btee\b/.test(segment)) return true;
  return false;
}

function isSafeSegment(segment: string): boolean {
  if (matchBlacklist(segment)) return false;
  if (segmentLooksWritable(segment)) return false;

  const primary = primaryCommand(segment);
  if (!primary) return false;
  const { cmd, args } = primary;

  if (!BASH_SAFE_COMMANDS.has(cmd)) return false;

  if (cmd === "git") return isSafeGit(args);
  if (cmd === "cargo") return isSafeCargo(args);
  if (cmd === "npm" || cmd === "pnpm" || cmd === "yarn" || cmd === "npx") {
    return isSafeNpmFamily(args);
  }
  if (cmd === "sed") {
    // non -i sed is a pure filter
    return !args.some((a) => a === "-i" || a.startsWith("-i") || a === "--in-place");
  }
  // python/node one-liners that open files for write are hard to detect; allow only when no -c/-e with open('w')
  if (cmd === "python" || cmd === "python3" || cmd === "node" || cmd === "ruby" || cmd === "perl") {
    const joined = args.join(" ");
    if (/\bopen\s*\([^)]*['\"]w/.test(joined) || /\bwrite(file|FileSync)?\s*\(/.test(joined)) {
      return false;
    }
    // bare interpreter → ask (REPL)
    if (!args.length) return false;
  }
  return true;
}

/**
 * Classify a bash script for the safety gate.
 * - deny: blacklist hit
 * - allow: all simple segments are safe/read-only
 * - ask: writes, installs, unknown commands, or complex shell
 */
export function classifyBashScript(script: string): SafetyGateDecision {
  const text = (script || "").trim();
  if (!text) {
    return {
      action: "allow",
      name: "bash",
      level: "medium",
      reason: "empty script",
    };
  }

  const fullHit = matchBlacklist(text);
  if (fullHit) {
    return {
      action: "deny",
      name: "bash",
      level: "high",
      reason: fullHit,
      preview: text.slice(0, 500),
    };
  }

  const segments = splitBashSegments(text);
  if (segments === null) {
    return {
      action: "ask",
      name: "bash",
      level: "high",
      reason: "complex shell syntax (subshell, eval, source, or background)",
      preview: text.slice(0, 500),
    };
  }

  for (const seg of segments) {
    const hit = matchBlacklist(seg);
    if (hit) {
      return {
        action: "deny",
        name: "bash",
        level: "high",
        reason: hit,
        preview: text.slice(0, 500),
      };
    }
  }

  if (segments.length > 0 && segments.every((seg) => isSafeSegment(seg))) {
    return {
      action: "allow",
      name: "bash",
      level: "medium",
      reason: "read-only / low-risk shell command",
      preview: text.slice(0, 500),
    };
  }

  return {
    action: "ask",
    name: "bash",
    level: "medium",
    reason: "shell command may write files or run non-trivial programs",
    preview: text.slice(0, 500),
  };
}

function extractBashScript(toolInput: unknown): string {
  if (typeof toolInput === "string") return toolInput;
  if (toolInput && typeof toolInput === "object" && !Array.isArray(toolInput)) {
    const rec = toolInput as Record<string, unknown>;
    if (typeof rec.script === "string") return rec.script;
    if (typeof rec.command === "string") return rec.command;
  }
  return "";
}

// ─── Catalogue resolution ────────────────────────────────────────────────────

export function getDangerousTool(name: string | undefined): DangerousToolSpec | undefined {
  if (!name) return undefined;
  return byName.get(name.trim());
}

export function isDangerousToolName(name: string | undefined): boolean {
  if (!name) return false;
  if (name.trim() === "bash") return true; // content-gated, still "classified"
  return Boolean(getDangerousTool(name));
}

export function listDangerousToolNames(level?: DangerousToolLevel): string[] {
  const names = DANGEROUS_TOOLS.filter((item) => !level || item.level === level).map(
    (item) => item.name,
  );
  if (!level || level === "high" || level === "medium") {
    // bash is content-gated; list it under high for discoverability
    if (!level || level === "high") names.unshift("bash(content-gated)");
  }
  return names;
}

/**
 * For capability runners, also inspect the target id inside tool input.
 * Returns a synthetic danger spec when the nested action is high-impact.
 */
export function resolveDangerousToolCall(
  toolName: string | undefined,
  toolInput: unknown,
): DangerousToolSpec | undefined {
  if (toolName === "bash") {
    const decision = classifyBashScript(extractBashScript(toolInput));
    if (decision.action === "allow") return undefined;
    return {
      name: "bash",
      level: decision.level,
      reason: decision.reason,
      gate: decision.action === "deny" ? "deny" : "ask",
    };
  }

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
      gate: "ask",
    };
  }

  if (id.startsWith("command:")) {
    return {
      name: id,
      level: "high",
      reason: "runs a plugin launcher command",
      gate: "ask",
    };
  }
  if (id.startsWith("plugin:")) {
    return {
      name: id,
      level: "high",
      reason: "runs a plugin-registered module action",
      gate: "ask",
    };
  }
  if (DANGEROUS_CAPABILITY_IDS.has(id) || byName.has(id)) {
    const known = byName.get(id);
    return (
      known ?? {
        name: id,
        level: "medium",
        reason: "module action with host side effects",
        gate: "ask",
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
      gate: "ask",
    };
  }

  return direct;
}

/**
 * Full gate decision for a tool call (preferred entry for hooks).
 * Returns null when the call is not gated (allow through).
 */
export function evaluateSafetyGate(
  toolName: string | undefined,
  toolInput: unknown,
): SafetyGateDecision | null {
  if (!toolName) return null;

  if (toolName === "bash") {
    const decision = classifyBashScript(extractBashScript(toolInput));
    if (decision.action === "allow") return null;
    return decision;
  }

  const danger = resolveDangerousToolCall(toolName, toolInput);
  if (!danger) return null;

  const gate = danger.gate ?? "ask";
  return {
    action: gate === "deny" ? "deny" : "ask",
    name: danger.name,
    level: danger.level,
    reason: danger.reason,
    preview:
      typeof toolInput === "string"
        ? toolInput.slice(0, 500)
        : (() => {
            try {
              return JSON.stringify(toolInput).slice(0, 500);
            } catch {
              return undefined;
            }
          })(),
  };
}

/**
 * Prompt the user once for an "ask" decision. Headless / no window → deny.
 */
export function confirmSafetyGate(decision: SafetyGateDecision): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return false;
  }
  const preview = decision.preview?.trim()
    ? `\n\n${decision.preview.trim().slice(0, 400)}`
    : "";
  return window.confirm(
    [
      `QxAI wants to run "${decision.name}" [${decision.level}].`,
      decision.reason,
      preview,
      "",
      "Allow this once?",
    ]
      .filter((line) => line !== undefined)
      .join("\n"),
  );
}

export function formatDangerousToolsBlock(): string {
  const high = listDangerousToolNames("high");
  const medium = listDangerousToolNames("medium");
  return [
    `high: ${high.join(", ") || "(none)"}`,
    `medium: ${medium.join(", ") || "(none)"}`,
    "bash: content-gated (blacklist deny · safe read-only allow · else ask)",
  ].join("\n");
}
