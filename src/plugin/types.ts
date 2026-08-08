import type { PluginWorkbenchItem, PluginWorkbenchState } from "./workbenchTypes";

export interface PluginPreference {
  id: string;
  label: string;
  /**
   * - `string` — single-line
   * - `textarea` — multi-line (repos, path lists, JSON snippets)
   * - `password` | `number` | `boolean` | `select` | `segmented` | `slider`
   */
  type: "string" | "textarea" | "password" | "number" | "boolean" | "select" | "segmented" | "slider";
  required?: boolean;
  default?: string | number | boolean;
  /** Locale → label, for example `{ "zh-CN": "接口密钥", "en": "API Key" }`. */
  labels?: Record<string, string>;
  options?: { label: string; value: string; labels?: Record<string, string> }[];
  description?: string;
  /** Locale → preference description. */
  descriptions?: Record<string, string>;
  /** Optional rows for `textarea` (default 4). */
  rows?: number;
  placeholder?: string;
  /** Locale → input placeholder. */
  placeholders?: Record<string, string>;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface PluginCommand {
  name: string;
  title: string;
  /** Locale → command title. */
  titles?: Record<string, string>;
  description?: string;
  /** Locale → command description. */
  descriptions?: Record<string, string>;
  icon?: string;
  keywords?: string[];
  mode?: string;
  interval?: string;
}

export type PluginPlatform = "macos" | "windows" | "linux";
export type PluginCompatibilityStatus = "supported" | "partial" | "mac-only" | "unsupported";
/** Resolved Qx UI locale exposed to plugins. */
export type PluginLocale = "en" | "zh-CN";
/** User's Qx language setting, before the `system` preference is resolved. */
export type PluginLanguagePreference = "system" | PluginLocale;

export interface PluginLocaleState {
  /** Effective Qx UI language. Use this for plugin copy and `Intl` formatting. */
  current: PluginLocale;
  /** User setting that produced `current`; `system` follows Qx's OS-language policy. */
  preference: PluginLanguagePreference;
}

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
  /** Locale → panel title. */
  titles?: Record<string, string>;
  icon?: string;
  keywords?: string[];
}

export interface PluginCacheTargetDeclaration {
  id: string;
  label: string;
  description?: string;
  /** Exact context.storage.persist keys that are safe to rebuild and clear. */
  keys: string[];
  /** Plugin-owned automatic pruning window advertised to the host. */
  retentionDays?: number;
}

export interface PluginStorageManifest {
  cacheTargets?: PluginCacheTargetDeclaration[];
}

export type PluginHomeWidgetSource =
  | "system.cpu"
  | "system.memory"
  | "system.power"
  | "system.network"
  | "system.display-brightness";

/**
 * A plugin may associate one of its panels with a host-rendered Home widget.
 * It contributes no DOM or CSS; Qx owns sampling, chrome and responsiveness.
 */
export interface PluginHomeWidgetDeclaration {
  id: string;
  source: PluginHomeWidgetSource;
}

export type PluginSurfaceProviderSource = "system.display-brightness";
export type PluginSurfaceProviderTarget = "tray" | "home";
export type PluginSurfaceProviderPresentation = "compact" | "standard" | "wide";

/**
 * Declarative lightweight data provider rendered and executed by Qx. It is
 * discovered from manifest metadata and never loads the plugin JavaScript.
 */
export interface PluginSurfaceProviderDeclaration {
  id: string;
  source: PluginSurfaceProviderSource;
  surfaces: PluginSurfaceProviderTarget[];
  presentation?: PluginSurfaceProviderPresentation;
  title?: string;
  titles?: Partial<Record<"en" | "zh-CN", string>>;
  defaultEnabled?: boolean;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /**
   * Optional locale → display name map (e.g. `{ "zh-CN": "天气", "en": "Weather" }`).
   * Host UI resolves via `localizePluginName` before falling back to `name`.
   */
  names?: Record<string, string>;
  /** Optional locale → description map; same resolution as `names`. */
  descriptions?: Record<string, string>;
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
  storage?: PluginStorageManifest;
  homeWidgets?: PluginHomeWidgetDeclaration[];
  surfaceProviders?: PluginSurfaceProviderDeclaration[];
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
  /** Locale → display name (from plugin manifest / package index). */
  names?: Record<string, string>;
  /** Locale → description (from plugin manifest / package index). */
  descriptions?: Record<string, string>;
  download_url: string;
  size_bytes?: number;
  checksum_sha256?: string;
  required_permissions?: string[];
  updated_at?: string;
  author?: string;
  min_app_version?: string;
  /**
   * Host OS targets from the package manifest (`macos` / `windows` / `linux`).
   * Empty or missing means every platform. Used to hide install/launch on the
   * wrong OS so Windows does not install macOS-only packages like Homebrew.
   */
  platforms?: PluginPlatform[];
  /** Newest first. Historical entries are informational, not rollback URLs. */
  releases?: PluginReleaseNote[];
  /** Host-stamped registry attribution after multi-source fetch. */
  source_id?: string;
  source_name?: string;
  source_index_url?: string;
}

export interface PluginReleaseNote {
  version: string;
  notes?: string;
  notes_localizations?: Record<string, string>;
  published_at?: string;
}

export interface PluginIndexSourceStatus {
  id: string;
  name: string;
  index_url: string;
  ok: boolean;
  error?: string | null;
  plugin_count: number;
}

export interface PluginIndex {
  schema_version: number;
  plugins: PluginIndexEntry[];
  sources?: PluginIndexSourceStatus[];
}

/** Stable list key when the same plugin id appears from multiple libraries. */
export function marketplaceEntryKey(entry: PluginIndexEntry): string {
  const source = (entry.source_id || entry.source_index_url || "default").trim();
  return `${source}::${entry.id}`;
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
  reasoning?: boolean;
}

export interface PluginAiStreamEvent {
  type: "text_delta" | "reasoning_delta";
  delta: string;
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
  reasoning?: boolean;
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
  /** @deprecated Compatibility alias for pathListSep. */
  pathSep: string;
  /** Separator between entries in PATH-like environment variables (`;` or `:`). */
  pathListSep: string;
  /** Native directory separator (`\\` on Windows, `/` elsewhere). */
  dirSep: string;
  exePath?: string | null;
}

/** One row a plugin contributes to the host system tray menu. */
export interface PluginTrayItem {
  id: string;
  title: string;
  /** Optional native-menu titles selected from the current Qx locale. */
  titles?: Partial<Record<"en" | "zh-CN", string>>;
  enabled?: boolean;
  /** Run this plugin command name when the user clicks the row. */
  command?: string;
  /**
   * Native presentation, not web CSS. `status` is shown as a disabled
   * informational row so it cannot accidentally invoke a command.
   */
  presentation?: "action" | "status";
  /** Optional native submenu label for related plugin rows. */
  group?: string;
  /** Optional localized label for the submenu identified by `group`. */
  groupTitles?: Partial<Record<"en" | "zh-CN", string>>;
}

/** Live host metrics for tray labels / dashboards (`system-stats`). */
export interface PluginSystemStats {
  cpu: number;
  memory: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  memoryPressure: "normal" | "warning" | "critical" | "unknown";
  memoryPressureLevel: number;
  swapUsedGb: number;
  swapTotalGb: number;
  gpu?: number | null;
}

/** Network byte counters (`system-info`); sample twice to derive rates. */
export interface PluginNetworkCounters {
  totalBytesIn: number;
  totalBytesOut: number;
  interfaces?: Array<{ name: string; bytesIn: number; bytesOut: number }>;
}

export type PluginSystemSettingsSection =
  | "about"
  | "display"
  | "storage"
  | "network"
  | "power"
  | "privacy"
  | "apps";

/** Cross-platform host identity. Legacy field names remain stable for plugins. */
export interface PluginCpuCacheInfo {
  level: number;
  kind: "data" | "instruction" | "unified" | string;
  sizeBytes: number;
  /** macOS core class (`performance`/`efficiency`/`shared`) or Linux shared CPU list. */
  scope?: string | null;
}

export interface PluginSystemInfo {
  hostname: string;
  chip: string;
  cpuPhysicalCores?: number | null;
  cpuLogicalCores?: number | null;
  cpuPerformanceCores?: number | null;
  cpuEfficiencyCores?: number | null;
  cpuMaxFrequencyMhz?: number | null;
  cpuCacheLineBytes?: number | null;
  cpuCaches?: PluginCpuCacheInfo[];
  memory: string;
  memoryTotalBytes?: number;
  platform?: string;
  architecture?: string;
  os?: string;
  /** OS display label; older hosts serialize this property as `macOS` on both platforms. */
  macOS: string;
  kernel: string;
  kernelName?: string;
  kernelVersion?: string;
  serialNumber: string;
}

export interface PluginStorageInfo {
  total: string;
  used: string;
  free: string;
  percentUsed: string;
  summary: string;
}

export interface PluginDisplayInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  refreshRateHz?: number | null;
  scaleFactor?: number | null;
  rotationDegrees?: number | null;
  connection?: string | null;
  edidManufacturerId?: number | null;
  edidProductCode?: number | null;
  isPrimary: boolean;
  isBuiltin: boolean;
}

export interface PluginDisplayBrightnessControl {
  id: string;
  name: string;
  backend: string;
  current: number | null;
  max: number;
  rawCurrent: number | null;
  rawMax: number | null;
  isBuiltin: boolean;
  supported: boolean;
  error?: string | null;
  errorStage?: string | null;
  errorCode?: number | null;
}

export interface PluginNetworkInfo {
  devices: Array<{ name: string; ip: string }>;
  count: number;
}

export interface PluginPowerInfo {
  batteryPresent: boolean;
  batteryLevel: number | null;
  isCharging: boolean;
  fullyCharged: boolean;
  externalConnected?: boolean | null;
  cycleCount?: number | null;
  condition?: string | null;
  maximumCapacityPercent?: number | null;
  temperatureCelsius?: number | null;
  timeRemainingMinutes?: number | null;
  timeToFullMinutes?: number | null;
  designCapacity?: number | null;
  fullChargeCapacity?: number | null;
  remainingCapacity?: number | null;
  capacityUnit?: "mAh" | "mWh" | null;
  powerWatts?: number | null;
  source: string;
  summary: string;
}

export interface PluginProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
}

export interface PluginProcessList {
  processes: PluginProcessInfo[];
  count: number;
}

export interface PluginKillProcessResult {
  success: boolean;
  message: string;
}

export type PluginIslandTone = "neutral" | "success" | "warning" | "danger";
export type PluginIslandActionIcon = "pause" | "play" | "stop" | "open";
export type PluginIslandActivity = "wave" | "dots" | "spinner" | "pulse";
export type PluginIslandProgressStyle =
  | "surface-fill"
  | "icon-ring"
  | "island-ring"
  | "compact-line";

/** Structured, host-rendered content for the optional external QxIsland surface. */
export interface PluginIslandDisplayInput {
  primary: string;
  secondary?: string;
  tone?: PluginIslandTone;
  /** Real progress from 0–100. Omit for a non-progress display. */
  progress?: number;
  /** Host-owned progress presentation. Defaults to surface-fill. */
  progressStyle?: PluginIslandProgressStyle;
  /** Host-rendered indeterminate loading animation. Ignored when progress is set. */
  activity?: PluginIslandActivity;
  /** Host-rendered real-time countdown; use endsAt while running. */
  countdown?: {
    endsAt?: number;
    remainingMs?: number;
    durationMs?: number;
    paused?: boolean;
  };
  /** Primary manifest command shown on the island (compat alias of actions[0]). */
  action?: {
    label: string;
    command: string;
    icon?: PluginIslandActionIcon;
    variant?: "default" | "danger";
  };
  /**
   * Up to two host-rendered trailing actions (e.g. Pause + Stop). Each command
   * must exist on the plugin manifest. When both `action` and `actions` are set,
   * `actions` wins.
   */
  actions?: Array<{
    label: string;
    command: string;
    icon?: PluginIslandActionIcon;
    variant?: "default" | "danger";
  }>;
  /** Optional expiry. Omit for a standing data display. */
  ttlMs?: number;
}

export interface PluginLatestWriter<T> {
  /**
   * Queue one JSON-serializable snapshot. Writes are serialized and a queued
   * obsolete revision is skipped in favor of the newest snapshot.
   */
  write: (value: T) => Promise<void>;
  /** Wait until the latest queued write has settled. */
  flush: () => Promise<void>;
}

export interface PluginReadLedgerOptions {
  initial?: Record<string, number>;
  retentionDays?: number;
  maxEntries?: number;
}

export interface PluginReadLedger {
  has: (id: string) => boolean;
  /** Mark only when absent, so repeatedly opening an item does not extend retention. */
  mark: (id: string, at?: number) => boolean;
  unmark: (id: string) => boolean;
  markMany: (ids: string[], at?: number) => number;
  merge: (values: Record<string, number>) => void;
  replace: (values: Record<string, number>) => void;
  configure: (options: Pick<PluginReadLedgerOptions, "retentionDays" | "maxEntries">) => void;
  prune: () => void;
  snapshot: () => Record<string, number>;
  ids: () => string[];
  size: () => number;
  clear: () => void;
}

export interface PluginLruOptions<T> {
  maxEntries?: number;
  maxSize?: number;
  sizeOf?: (value: T) => number;
}

export interface PluginLruCache<T> {
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => boolean;
  has: (key: string) => boolean;
  delete: (key: string) => boolean;
  clear: () => void;
  size: () => number;
  totalSize: () => number;
}

export interface PluginGenerationGate {
  current: () => number;
  next: () => number;
  invalidate: () => number;
  isCurrent: (generation: number) => boolean;
}

export interface PluginContext {
  pluginId: string;
  /**
   * Qx language port. It reflects the product setting, not the iframe/browser
   * locale, so plugins must not infer UI language from `navigator.language`.
   * No manifest permission is required.
   */
  locale: PluginLocaleState & {
    onChange: (listener: (state: PluginLocaleState) => void) => () => void;
  };
  display: {
    raycastActionPanel: boolean;
  };
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  showToast: (msg: string) => void;
  log: {
    error: (message: string, fields?: Record<string, unknown>) => void;
    warn: (message: string, fields?: Record<string, unknown>) => void;
    info: (message: string, fields?: Record<string, unknown>) => void;
    debug: (message: string, fields?: Record<string, unknown>) => void;
  };
  prompt: (label: string, defaultValue?: string) => Promise<string | null>;
  openUrl: (url: string) => Promise<void>;
  getPreference: (id: string) => Promise<unknown>;
  setTimeout: (handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => number;
  setInterval: (handler: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => number;
  clearTimeout: (id: number) => void;
  clearInterval: (id: number) => void;
  /**
   * Pure in-process state primitives shared by direct and sandboxed plugins.
   * These helpers perform no host I/O and require no manifest permission.
   */
  state: {
    createLatestWriter: <T>(
      writer: (snapshot: T) => Promise<void> | void,
    ) => PluginLatestWriter<T>;
    createReadLedger: (options?: PluginReadLedgerOptions) => PluginReadLedger;
    createLru: <T>(options?: PluginLruOptions<T>) => PluginLruCache<T>;
    createGenerationGate: () => PluginGenerationGate;
  };
  clipboard: {
    read: () => Promise<string>;
    write: (text: string) => Promise<void>;
  };
  /**
   * System OCR port. Requires manifest permission `ocr` and Settings → OCR enabled.
   * Safe from user commands and `mode: "no-view"` + `interval` background jobs.
   */
  ocr: {
    /** Host OCR status (enabled flag, engine, model pack). */
    status: () => Promise<{
      enabled: boolean;
      engine: string;
      modelSize: string;
      models: { downloaded?: boolean };
      platform: string;
    }>;
    /** Recognize text from a local image path (png/jpg/…). */
    recognizePath: (
      path: string,
      options?: { source?: "clipboard" | "screenshot" | "file" | string },
    ) => Promise<{
      id: string;
      text: string;
      engine: string;
      source: string;
      sourcePath?: string | null;
      charCount: number;
      createdAt: string;
    }>;
    /** Recognize text from a clipboard history image item id. */
    recognizeClipboardImage: (id: string) => Promise<{
      id: string;
      text: string;
      engine: string;
      source: string;
      sourcePath?: string | null;
      charCount: number;
      createdAt: string;
    }>;
    listHistory: (limit?: number) => Promise<Array<{
      id: string;
      text: string;
      source: string;
      sourcePath?: string | null;
      engine: string;
      createdAt: string;
      charCount: number;
    }>>;
    deleteHistory: (id: string) => Promise<void>;
    clearHistory: () => Promise<void>;
    /** Copy recognized text to the system clipboard. */
    copyText: (text: string) => Promise<void>;
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
        /** Raw request bytes encoded as standard base64. Takes precedence over `body`. */
        bodyBase64?: string;
        body?: string;
        timeoutMs?: number;
        /** Host-enforced response limit. Defaults to 16 MiB and is capped at 32 MiB. */
        maxBytes?: number;
      },
    ) => Promise<{
      status: number;
      ok: boolean;
      /** Effective response URL after redirects. */
      url: string;
      headers: Record<string, string>;
      body: string;
      /** Raw response bytes encoded by the host; present for binary bodies. */
      bodyBase64: string;
      binary: boolean;
      text: () => Promise<string>;
      json: () => Promise<unknown>;
      arrayBuffer: () => Promise<ArrayBuffer>;
      blob: () => Promise<Blob>;
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
        onFilter?: (id: string, value: string) => void;
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
        onInput?: (id: string, value: string, item?: PluginWorkbenchItem) => void;
        onDownload?: (id: string, item?: PluginWorkbenchItem) => void;
      },
    ) => import("./workbenchTypes").PluginWorkbenchController;
    /** Publish host-rendered Actions for a custom HTML panel. */
    mountActions: (
      actions: Array<{
        id: string;
        label: string;
        menuKey: string;
        kbd?: string;
        disabled?: boolean;
        primary?: boolean;
        tone?: "normal" | "primary" | "danger";
      }>,
      handlers?: {
        onAction?: (id: string) => void;
        selectionTitle?: string;
      },
    ) => {
      update: (
        actions: Array<{
          id: string;
          label: string;
          menuKey: string;
          kbd?: string;
          disabled?: boolean;
          primary?: boolean;
          tone?: "normal" | "primary" | "danger";
        }>,
        selectionTitle?: string,
      ) => void;
      destroy: () => void;
    };
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
    streamEvents: (
      input: string | PluginAiChatOptions | PluginAiMessage[],
      onEvent: (event: PluginAiStreamEvent) => void,
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
   * Rows can use an OS-native `status` presentation and a shared submenu `group`.
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
   * - `env` / `openPath` / `revealPath` / `setWallpaper`: permission `system`
   * - `stats` / `networkCounters`: `system-stats` / `system-info` (for tray live labels, etc.)
   */
  system: {
    /** Platform / home / temp (permission `system`). */
    env: () => Promise<PluginSystemEnv>;
    /** Open path with OS default app (permission `system`). */
    openPath: (path: string) => Promise<void>;
    /** Reveal path in Finder / Explorer (permission `system`). */
    revealPath: (path: string) => Promise<void>;
    /** Save base64 bytes in the user's Downloads directory (permission `system`). */
    saveDownload: (input: {
      filename: string;
      mimeType?: string;
      dataBase64: string;
    }) => Promise<string>;
    /** Open a semantic System Settings destination without platform URI knowledge. */
    openSettings: (section: PluginSystemSettingsSection) => Promise<void>;
    /** Set one local image as wallpaper through the host platform adapter. */
    setWallpaper: (path: string, options?: { scope?: "current" | "every" }) => Promise<void>;
    /** CPU / memory snapshot (permission `system-stats`). */
    stats: () => Promise<PluginSystemStats>;
    /** Raw interface byte counters (permission `system-info`). Diff for rates. */
    networkCounters: () => Promise<PluginNetworkCounters>;
    info: () => Promise<PluginSystemInfo>;
    storage: () => Promise<PluginStorageInfo>;
    displays: () => Promise<PluginDisplayInfo[]>;
    displayBrightness: () => Promise<PluginDisplayBrightnessControl[]>;
    setDisplayBrightness: (displayId: string, value: number) => Promise<void>;
    network: () => Promise<PluginNetworkInfo>;
    power: () => Promise<PluginPowerInfo>;
    qxStorageOverview: () => Promise<unknown>;
    processes: {
      list: () => Promise<PluginProcessList>;
      kill: (pid: number) => Promise<PluginKillProcessResult>;
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

export interface QxPluginCommand {
  name: string;
  title: string;
  description?: string;
  icon?: string;
  keywords?: string[];
  /** Command execution must be cancellable by the host lifecycle where applicable. */
  run: (ctx: PluginContext) => Promise<void> | void;
}

export interface QxPluginPanel {
  title?: string;
  icon?: string;
  keywords?: string[];
  /** Mount the first frame quickly; start slow work in the background. */
  render: (container: HTMLElement, ctx: PluginContext) => Promise<void> | void;
  /** Release views, timers, subscriptions, media strings, and pending work. */
  destroy?: (container: HTMLElement) => Promise<void> | void;
}

/** Canonical runtime contract for an installed Qx plugin. */
export interface QxPlugin {
  commands?: QxPluginCommand[];
  panel?: QxPluginPanel;
}

/** Compatibility wrapper for an ES module with a default QxPlugin export. */
export interface PluginModule {
  default?: QxPlugin;
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
