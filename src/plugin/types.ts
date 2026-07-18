import type { PluginWorkbenchItem, PluginWorkbenchState } from "./workbenchTypes";

export interface PluginPreference {
  id: string;
  label: string;
  /**
   * - `string` — single-line
   * - `textarea` — multi-line (repos, path lists, JSON snippets)
   * - `password` | `number` | `boolean` | `select`
   */
  type: "string" | "textarea" | "password" | "number" | "boolean" | "select";
  required?: boolean;
  default?: string | number | boolean;
  options?: { label: string; value: string }[];
  description?: string;
  /** Optional rows for `textarea` (default 4). */
  rows?: number;
  placeholder?: string;
}

export interface PluginCommand {
  name: string;
  title: string;
  description?: string;
  icon?: string;
  keywords?: string[];
  mode?: string;
  interval?: string;
}

export type PluginPlatform = "macos" | "windows" | "linux";
export type PluginCompatibilityStatus = "supported" | "partial" | "mac-only" | "unsupported";

export interface PluginPlatformCompatibility {
  status: PluginCompatibilityStatus;
  features?: string[];
  degraded?: string[];
  unsupported?: string[];
  notes?: string[];
}

export interface PluginRaycastMetadata {
  source?: string;
  compatible?: string;
  sourceCommands?: string[];
  sourceTools?: string[];
  platformCompatibility?: Partial<Record<PluginPlatform, PluginPlatformCompatibility>>;
}

export interface PluginShortcut {
  command: string;
  key: string;
  enabled?: boolean;
}

export interface PluginPanel {
  title?: string;
  icon?: string;
  keywords?: string[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
  screenshots?: string[];
  platforms?: PluginPlatform[];
  keywords?: string[];
  permissions?: string[];
  preferences?: PluginPreference[];
  commands?: PluginCommand[];
  shortcuts?: PluginShortcut[];
  panel?: PluginPanel;
  dependencies?: string[];
  min_app_version?: string;
  entry?: string;
  raycast?: PluginRaycastMetadata;
  signature?: string;
  pubkey?: string;
}

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  path: string;
  enabled: boolean;
  permissions: string[];
  author: string;
  manifest?: PluginManifest;
}

export interface PluginIndexEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  download_url: string;
  size_bytes?: number;
  checksum_sha256?: string;
  required_permissions?: string[];
  updated_at?: string;
  author?: string;
  min_app_version?: string;
}

export interface PluginIndex {
  schema_version: number;
  plugins: PluginIndexEntry[];
}

export interface PluginRuntimeStatus {
  kind: "activity" | "success" | "error";
  pluginId?: string;
  label: string;
  detail?: string;
}

export interface PluginAiMessage {
  role: "system" | "user" | "assistant";
  content: string | PluginAiContentPart[];
}

export type PluginAiContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: {
        url: string;
        detail?: "auto" | "low" | "high";
      };
    };

export interface PluginAiModel {
  id: string;
  name: string;
}

export interface PluginAiProvider {
  id: string;
  name: string;
  models: PluginAiModel[];
}

export interface PluginAiModelSelection {
  provider: string;
  model: string;
}

export interface PluginAiAgentSettings {
  agent_mode_enabled: boolean;
  default_provider: string;
  default_model: string;
  model_tools_enabled: boolean;
  tools_enabled: boolean;
  memory_tool_enabled: boolean;
  app_search_enabled: boolean;
  file_search_enabled: boolean;
  http_fetch_enabled: boolean;
  notifications_enabled: boolean;
  mcp_enabled: boolean;
  bash_enabled: boolean;
  bash_timeout_ms: number;
  bash_cwd: string;
  grep_search_enabled: boolean;
  grep_command: string;
  grep_root: string;
  grep_max_results: number;
  background_tasks_enabled: boolean;
}

export interface PluginAiChatOptions {
  provider?: string;
  model?: string;
  system?: string;
  prompt?: string;
  images?: string[];
  imageDetail?: "auto" | "low" | "high";
  messages?: PluginAiMessage[];
}

export interface PluginAiBashResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface PluginAiMemoryEntry {
  id: string;
  text: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PluginAiGrepResult {
  path: string;
  line?: number;
  text: string;
}

export type PluginAiTaskState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface PluginAiTask {
  id: string;
  title: string;
  state: PluginAiTaskState;
  createdAt: number;
  updatedAt: number;
  result?: string;
  error?: string;
}

export interface PluginAiTaskInput extends PluginAiChatOptions {
  title?: string;
  notify?: boolean;
}

/** Argv-style CLI run request (`context.cli.run`). */
export interface PluginCliRunRequest {
  /** Absolute path or bare program name (resolved via login-shell PATH + brew bins). */
  program: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Default 60000, clamped 1000–600000. */
  timeoutMs?: number;
}

/** Full bash script request (`context.cli.bash`) — `bash -lc`, login PATH. */
export interface PluginCliBashRequest {
  script: string;
  cwd?: string;
  env?: Record<string, string>;
  /** Default 60000, clamped 1000–600000. */
  timeoutMs?: number;
}

export interface PluginCliRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Resolved program path used for spawn (or `bash -lc` label). */
  program: string;
}

/** Async CLI job kind. */
export type PluginCliJobKind = "run" | "bash";

export type PluginCliJobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timedOut";

/** Start an async CLI job (`context.cli.start`). */
export type PluginCliStartRequest =
  | (PluginCliRunRequest & { kind: "run" })
  | (PluginCliBashRequest & { kind: "bash" });

export interface PluginCliJobSnapshot {
  id: string;
  pluginId: string;
  kind: string;
  state: PluginCliJobState;
  program: string;
  stdout: string;
  stderr: string;
  status: number | null;
  timedOut: boolean;
  startedAt: number;
  finishedAt: number | null;
  error?: string | null;
  running: boolean;
}

/** Host system info for CLI workbenches (`context.system.env`). */
export interface PluginSystemEnv {
  platform: "macos" | "windows" | "linux" | "unknown" | string;
  arch: string;
  homeDir: string;
  tempDir: string;
  pathSep: string;
  exePath?: string | null;
}

/** One row a plugin contributes to the host system tray menu. */
export interface PluginTrayItem {
  id: string;
  title: string;
  enabled?: boolean;
  /** Run this plugin command name when the user clicks the row. */
  command?: string;
}

/** Live host metrics for tray labels / dashboards (`system-stats`). */
export interface PluginSystemStats {
  cpu: number;
  memory: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  gpu?: number | null;
}

/** Network byte counters (`system-info`); sample twice to derive rates. */
export interface PluginNetworkCounters {
  totalBytesIn: number;
  totalBytesOut: number;
  interfaces?: Array<{ name: string; bytesIn: number; bytesOut: number }>;
}

export type PluginIslandTone = "neutral" | "success" | "warning" | "danger";
export type PluginIslandActionIcon = "pause" | "play" | "stop" | "open";

/** Structured, host-rendered content for the optional external QxIsland surface. */
export interface PluginIslandDisplayInput {
  primary: string;
  secondary?: string;
  tone?: PluginIslandTone;
  /** Real progress from 0–100. Omit for a non-progress display. */
  progress?: number;
  /** Host-rendered real-time countdown; use endsAt while running. */
  countdown?: {
    endsAt?: number;
    remainingMs?: number;
    durationMs?: number;
    paused?: boolean;
  };
  /** One manifest command that the user may run from the island. */
  action?: {
    label: string;
    command: string;
    icon?: PluginIslandActionIcon;
    variant?: "default" | "danger";
  };
  /** Optional expiry. Omit for a standing data display. */
  ttlMs?: number;
}

export interface PluginContext {
  pluginId: string;
  display: {
    raycastActionPanel: boolean;
  };
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  showToast: (msg: string) => void;
  prompt: (label: string, defaultValue?: string) => Promise<string | null>;
  openUrl: (url: string) => Promise<void>;
  getPreference: (id: string) => Promise<unknown>;
  setTimeout: (handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => number;
  setInterval: (handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => number;
  clearTimeout: (id: number) => void;
  clearInterval: (id: number) => void;
  clipboard: {
    read: () => Promise<string>;
    write: (text: string) => Promise<void>;
  };
  /** Requires manifest permission `island`. */
  island: {
    show: (input: PluginIslandDisplayInput) => Promise<void>;
    update: (input: PluginIslandDisplayInput) => Promise<void>;
    dismiss: () => Promise<void>;
  };
  http: {
    fetch: (
      url: string,
      options?: {
        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
        headers?: Record<string, string>;
        body?: string;
        timeoutMs?: number;
      },
    ) => Promise<{
      status: number;
      ok: boolean;
      headers: Record<string, string>;
      body: string;
      text: () => Promise<string>;
      json: () => Promise<unknown>;
    }>;
  };
  /**
   * Plugin CLI port — preferred way to run local tools (brew, release-cli, …).
   * Requires permission `cli`. Not gated by AI Agent bash toggle.
   *
   * - `run` / `which`: argv-style (safe default). Host injects a login-shell PATH.
   * - `bash`: full `bash -lc` when you need pipes / globs.
   * - `start` / `poll` / `cancel` / `wait` / `listJobs`: async concurrent jobs.
   * - `map`: bounded parallel fan-out over many argv runs.
   * - `ensure` / `json` / `lines` / `text` / `jsonBash`: CLI→GUI helpers (throw on failure).
   */
  cli: {
    run: (request: PluginCliRunRequest) => Promise<PluginCliRunResult>;
    /** Login-shell bash (`bash -lc`). Prefer `run` when a single program + args suffice. */
    bash: (request: PluginCliBashRequest | string) => Promise<PluginCliRunResult>;
    which: (program: string) => Promise<string | null>;
    /**
     * Start a background CLI job (returns immediately). Stream output via `poll` / `wait`.
     * Host limits: 6 concurrent jobs per plugin, 32 global.
     */
    start: (request: PluginCliStartRequest) => Promise<PluginCliJobSnapshot>;
    /** Snapshot of a job (partial stdout/stderr while running; each stream is host-bounded). */
    poll: (jobId: string) => Promise<PluginCliJobSnapshot>;
    /** Kill a running job. */
    cancel: (jobId: string) => Promise<PluginCliJobSnapshot>;
    /** List this plugin's recent jobs. */
    listJobs: () => Promise<PluginCliJobSnapshot[]>;
    /**
     * Poll until the job finishes. Optional `onUpdate` for live UI.
     * Throws only if cancelled wait via AbortSignal — job failure returns the snapshot.
     */
    wait: (
      jobId: string,
      options?: {
        pollMs?: number;
        onUpdate?: (job: PluginCliJobSnapshot) => void;
        signal?: AbortSignal;
      },
    ) => Promise<PluginCliJobSnapshot>;
    /**
     * Run many argv jobs with bounded concurrency (default 4).
     * Uses fire-and-wait `run` under the hood — safe for short tools.
     */
    map: <T, R>(
      items: T[],
      worker: (item: T, index: number) => Promise<R>,
      options?: { concurrency?: number },
    ) => Promise<R[]>;
    /** Like `run`, but throws on timeout / non-zero exit. */
    ensure: (request: PluginCliRunRequest) => Promise<PluginCliRunResult>;
    /** `ensure` + parse stdout as JSON (or JSONL when `jsonl: true`). */
    json: <T = unknown>(
      request: PluginCliRunRequest & { allowNonZero?: boolean; jsonl?: boolean },
    ) => Promise<T>;
    /** `ensure` + split stdout into lines. */
    lines: (
      request: PluginCliRunRequest & { allowNonZero?: boolean; trimEmpty?: boolean },
    ) => Promise<string[]>;
    /** `ensure` + trimmed stdout text. */
    text: (request: PluginCliRunRequest) => Promise<string>;
    /** `bash` + parse stdout as JSON. */
    jsonBash: <T = unknown>(
      script: string | PluginCliBashRequest,
      options?: { allowNonZero?: boolean; jsonl?: boolean },
    ) => Promise<T>;
    /** Parse helpers (no spawn). */
    parseJson: (text: string) => unknown;
    parseJsonLines: (text: string) => unknown[];
  };
  /** Declarative list/detail/action/island data rendered by Qx. */
  ui: {
    itemsFromJson: (value: unknown) => Array<{
      id?: string;
      title: string;
      subtitle?: string;
      meta?: string;
      badge?: string;
      icon?: string;
      image?: {
        url: string;
        alt?: string;
        fit?: "cover" | "contain";
      };
      progress?: number;
      tone?: string;
      raw?: unknown;
    }>;
    mountWorkbench: (
      state: PluginWorkbenchState,
      handlers?: {
        onTab?: (id: string) => void;
        onAction?: (id: string, item?: PluginWorkbenchItem) => void;
        onCommandComplete?: (event: { command: string; at: number }) => void;
        onBackgroundPoll?: (event: {
          command: string;
          at: number;
          ok: boolean;
          error?: string;
        }) => void;
        onQuery?: (value: string) => void;
        onSelect?: (id: string, item: PluginWorkbenchItem) => void;
      },
    ) => void;
  };
  notification: {
    show: (input: { title: string; body?: string; subtitle?: string }) => Promise<void>;
  };
  ai: {
    providers: () => Promise<PluginAiProvider[]>;
    models: (provider?: string) => Promise<PluginAiModel[]>;
    defaultModel: () => Promise<PluginAiModelSelection | null>;
    agentSettings: () => Promise<PluginAiAgentSettings>;
    chat: (
      input: string | PluginAiChatOptions | PluginAiMessage[],
      options?: Omit<PluginAiChatOptions, "prompt" | "messages">,
    ) => Promise<string>;
    stream: (
      input: string | PluginAiChatOptions | PluginAiMessage[],
      onChunk: (chunk: string) => void,
      options?: Omit<PluginAiChatOptions, "prompt" | "messages">,
    ) => Promise<string>;
    runBash: (
      script: string,
      options?: { cwd?: string; timeoutMs?: number },
    ) => Promise<PluginAiBashResult>;
    memory: {
      list: () => Promise<PluginAiMemoryEntry[]>;
      add: (text: string, tags?: string[]) => Promise<PluginAiMemoryEntry>;
      delete: (id: string) => Promise<void>;
    };
    search: {
      grep: (
        query: string,
        options?: { root?: string; maxResults?: number },
      ) => Promise<PluginAiGrepResult[]>;
    };
    tasks: {
      submit: (input: string | PluginAiTaskInput) => Promise<PluginAiTask>;
      list: () => Promise<PluginAiTask[]>;
      get: (id: string) => Promise<PluginAiTask | null>;
      cancel: (id: string) => Promise<PluginAiTask>;
    };
  };
  /**
   * System tray port (permission `tray`) — host capability for plugins.
   * Full contract: `public/doc/plugin-tray.md`.
   *
   * Plugins push menu rows; optional `command` maps to this plugin's `commands[].name`.
   * Combine with `system.stats` / `system.networkCounters` to show live Memory / Net labels.
   */
  tray: {
    /** Replace all tray items for this plugin (max 12). */
    setItems: (items: PluginTrayItem[]) => Promise<void>;
    /** Remove this plugin's tray items. */
    clear: () => Promise<void>;
    /** Read back items currently registered by this plugin. */
    list: () => Promise<PluginTrayItem[]>;
  };
  /**
   * System info + path helpers.
   * - `env` / `openPath` / `revealPath`: permission `system`
   * - `stats` / `networkCounters`: `system-stats` / `system-info` (for tray live labels, etc.)
   */
  system: {
    /** Platform / home / temp (permission `system`). */
    env: () => Promise<PluginSystemEnv>;
    /** Open path with OS default app (permission `system`). */
    openPath: (path: string) => Promise<void>;
    /** Reveal path in Finder / Explorer (permission `system`). */
    revealPath: (path: string) => Promise<void>;
    /** CPU / memory snapshot (permission `system-stats`). */
    stats: () => Promise<PluginSystemStats>;
    /** Raw interface byte counters (permission `system-info`). Diff for rates. */
    networkCounters: () => Promise<PluginNetworkCounters>;
    info: () => Promise<unknown>;
    storage: () => Promise<unknown>;
    network: () => Promise<unknown>;
    qxStorageOverview: () => Promise<unknown>;
    processes: {
      list: () => Promise<unknown>;
      kill: (pid: number) => Promise<unknown>;
    };
  };
  permissions: {
    status: () => Promise<unknown>;
    request: (id: string) => Promise<boolean>;
    openSettings: (id: string) => Promise<void>;
  };
  apps: {
    search: (query: string) => Promise<unknown[]>;
  };
  files: {
    search: (query: string, limit?: number) => Promise<unknown[]>;
  };
  qx: {
    invokeRust: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  storage: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
    session: {
      get: (key: string) => Promise<unknown>;
      set: (key: string, value: unknown) => Promise<void>;
      delete: (key: string) => Promise<void>;
    };
    persist: {
      get: (key: string) => Promise<unknown>;
      set: (key: string, value: unknown) => Promise<void>;
      delete: (key: string) => Promise<void>;
      /** List keys with approximate value sizes (bytes). */
      keys: () => Promise<Array<{ key: string; bytes: number }>>;
      /** Clear all persist KV for this plugin. */
      clear: () => Promise<void>;
    };
  };
}

export interface PluginModule {
  default?: {
    commands?: Array<{
      name: string;
      title: string;
      description?: string;
      icon?: string;
      keywords?: string[];
      run?: (ctx: PluginContext) => Promise<void> | void;
    }>;
    panel?: {
      title?: string;
      icon?: string;
      keywords?: string[];
      render?: (container: HTMLElement, ctx: PluginContext) => Promise<void> | void;
      destroy?: (container: HTMLElement) => Promise<void> | void;
    };
  };
}

export interface PluginCommandRunOptions {
  /** Raycast-compatible launch type. Interval jobs should use background. */
  launchType?: "userInitiated" | "background";
  /** Override worker request timeout (ms). Background network jobs need longer. */
  timeoutMs?: number;
}

export interface RegisteredCommand extends PluginCommand {
  pluginId: string;
  pluginName: string;
  pluginIcon?: string;
  run: (ctx: PluginContext, options?: PluginCommandRunOptions) => Promise<void> | void;
}

export interface RegisteredPanel {
  pluginId: string;
  pluginName: string;
  pluginIcon?: string;
  title: string;
  icon?: string;
  keywords: string[];
  render: (container: HTMLElement, ctx: PluginContext) => Promise<void> | void;
  destroy?: (container: HTMLElement) => Promise<void> | void;
}
