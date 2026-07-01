export interface PluginPreference {
  id: string;
  label: string;
  type: "string" | "password" | "number" | "boolean" | "select";
  required?: boolean;
  default?: string | number | boolean;
  options?: { label: string; value: string }[];
  description?: string;
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

export interface PluginContext {
  pluginId: string;
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
  system: {
    stats: () => Promise<unknown>;
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

export interface RegisteredCommand extends PluginCommand {
  pluginId: string;
  pluginName: string;
  pluginIcon?: string;
  run: (ctx: PluginContext) => Promise<void> | void;
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
