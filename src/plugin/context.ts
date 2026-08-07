import type {
  InstalledPlugin,
  PluginAiModelSelection,
  PluginAiProvider,
  PluginAiStreamEvent,
  PluginContext,
  PluginSystemStats,
} from "./types";
import { listen } from "@tauri-apps/api/event";
import { handlePluginRpc } from "./rpcMethods";
import { DEFAULT_SETTINGS, useSettingsStore } from "../modules/settings/store";
import {
  normalizeLanguagePreference,
  resolveLocale,
} from "../i18n";
import {
  createPluginStateKit,
  createPluginUiKit,
  enhancePluginCli,
} from "./cliWorkbench";

export interface PluginContextHooks {
  onToast: (msg: string) => void;
  onPrompt: (label: string, defaultValue?: string) => Promise<string | null>;
  onGetPreference: (pluginId: string, id: string) => Promise<unknown>;
  onRunPluginCommand?: (pluginId: string, command: string) => Promise<void>;
}

function pluginLocaleState() {
  const preference = normalizeLanguagePreference(
    useSettingsStore.getState().settings.general.language,
  );
  return { current: resolveLocale(preference), preference };
}

function subscribePluginLocale(
  listener: (state: ReturnType<typeof pluginLocaleState>) => void,
): () => void {
  let previous = pluginLocaleState();
  const notifyIfChanged = () => {
    const next = pluginLocaleState();
    if (next.current === previous.current && next.preference === previous.preference) return;
    previous = next;
    listener(next);
  };
  const unsubscribe = useSettingsStore.subscribe(notifyIfChanged);
  window.addEventListener("languagechange", notifyIfChanged);
  return () => {
    unsubscribe();
    window.removeEventListener("languagechange", notifyIfChanged);
  };
}

function createAiChatPayload(
  input: Parameters<PluginContext["ai"]["chat"]>[0],
  options: Parameters<PluginContext["ai"]["chat"]>[1] = {},
) {
  if (typeof input === "string") return { ...options, prompt: input };
  if (Array.isArray(input)) return { ...options, messages: input };
  return { ...input };
}

export function createPluginContext(
  plugin: InstalledPlugin,
  hooks: PluginContextHooks,
): PluginContext {
  const rpc = (method: string, payload: Record<string, unknown> = {}) =>
    handlePluginRpc(plugin, method, payload, hooks);
  const streamAi = async (
    input: Parameters<PluginContext["ai"]["streamEvents"]>[0],
    onEvent: (event: PluginAiStreamEvent) => void,
    options: Parameters<PluginContext["ai"]["streamEvents"]>[2] = {},
  ): Promise<string> => {
    const streamRequestId = `plugin-ai-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 9)}`;
    let full = "";
    let unlisten: (() => void) | undefined;
    return await new Promise<string>((resolve, reject) => {
      listen<{
        requestId: string;
        kind: string;
        chunk: string;
        done: boolean;
        error?: string;
      }>("qxai://stream", (event) => {
        if (event.payload.requestId !== streamRequestId) return;
        if (event.payload.error) {
          unlisten?.();
          reject(new Error(event.payload.error));
          return;
        }
        if (event.payload.done) {
          unlisten?.();
          resolve(full || event.payload.chunk);
          return;
        }
        const type = event.payload.kind === "reasoning"
          ? "reasoning_delta"
          : "text_delta";
        if (type === "text_delta") full += event.payload.chunk;
        onEvent({ type, delta: event.payload.chunk });
      })
        .then((un) => {
          unlisten = un;
          return rpc("aiStreamChat", {
            ...createAiChatPayload(input, options),
            streamRequestId,
          });
        })
        .catch((error) => {
          unlisten?.();
          reject(error);
        });
    });
  };

  return {
    pluginId: plugin.id,
    locale: {
      get current() {
        return pluginLocaleState().current;
      },
      get preference() {
        return pluginLocaleState().preference;
      },
      onChange: subscribePluginLocale,
    },
    display: {
      raycastActionPanel: (
        useSettingsStore.getState().settings.plugin_display
          ?? DEFAULT_SETTINGS.plugin_display
      ).raycast_action_panel !== false,
    },
    invoke: (cmd: string, args?: Record<string, unknown>) => rpc("invoke", { cmd, args }),
    showToast: (msg: string) => {
      void rpc("showToast", { msg });
    },
    log: {
      error: (message, fields = {}) => {
        void rpc("log", { level: "error", message, fields });
      },
      warn: (message, fields = {}) => {
        void rpc("log", { level: "warn", message, fields });
      },
      info: (message, fields = {}) => {
        void rpc("log", { level: "info", message, fields });
      },
      debug: (message, fields = {}) => {
        void rpc("log", { level: "debug", message, fields });
      },
    },
    prompt: (label: string, defaultValue?: string) =>
      rpc("prompt", { label, defaultValue }) as Promise<string | null>,
    openUrl: (url: string) => rpc("openUrl", { url }) as Promise<void>,
    getPreference: (id: string) => rpc("getPreference", { id }),
    setTimeout: (handler, delay, ...args) => window.setTimeout(handler, delay, ...args),
    setInterval: (handler, delay, ...args) => window.setInterval(handler, delay, ...args),
    clearTimeout: (id) => window.clearTimeout(id),
    clearInterval: (id) => window.clearInterval(id),
    state: createPluginStateKit(),
    clipboard: {
      read: () => rpc("clipboardRead") as Promise<string>,
      write: (text: string) => rpc("clipboardWrite", { text }) as Promise<void>,
    },
    ocr: {
      status: () =>
        rpc("ocrStatus") as ReturnType<PluginContext["ocr"]["status"]>,
      recognizePath: (path, options) =>
        rpc("ocrRecognizePath", {
          path,
          source: options?.source,
        }) as ReturnType<PluginContext["ocr"]["recognizePath"]>,
      recognizeClipboardImage: (id) =>
        rpc("ocrRecognizeClipboardImage", { id }) as ReturnType<
          PluginContext["ocr"]["recognizeClipboardImage"]
        >,
      listHistory: (limit) =>
        rpc("ocrListHistory", { limit }) as ReturnType<PluginContext["ocr"]["listHistory"]>,
      deleteHistory: (id) =>
        rpc("ocrDeleteHistory", { id }) as Promise<void>,
      clearHistory: () => rpc("ocrClearHistory") as Promise<void>,
      copyText: (text) => rpc("ocrCopyText", { text }) as Promise<void>,
    },
    island: {
      show: (input) => rpc("islandShow", { input }) as Promise<void>,
      update: (input) => rpc("islandUpdate", { input }) as Promise<void>,
      dismiss: () => rpc("islandDismiss") as Promise<void>,
    },
    cli: enhancePluginCli({
      run: (request) =>
        rpc("cliRun", {
          program: request.program,
          args: request.args,
          cwd: request.cwd,
          env: request.env,
          timeoutMs: request.timeoutMs,
        }) as ReturnType<PluginContext["cli"]["run"]>,
      bash: (request) => {
        const body =
          typeof request === "string"
            ? { script: request }
            : {
                script: request.script,
                cwd: request.cwd,
                env: request.env,
                timeoutMs: request.timeoutMs,
              };
        return rpc("cliBash", body) as ReturnType<PluginContext["cli"]["bash"]>;
      },
      which: (program) =>
        rpc("cliWhich", { program }) as ReturnType<PluginContext["cli"]["which"]>,
      start: (request) =>
        rpc("cliStart", {
          kind: request.kind,
          program: "program" in request ? request.program : undefined,
          args: "args" in request ? request.args : undefined,
          script: "script" in request ? request.script : undefined,
          cwd: request.cwd,
          env: request.env,
          timeoutMs: request.timeoutMs,
        }) as ReturnType<PluginContext["cli"]["start"]>,
      poll: (jobId) => rpc("cliPoll", { jobId }) as ReturnType<PluginContext["cli"]["poll"]>,
      cancel: (jobId) =>
        rpc("cliCancel", { jobId }) as ReturnType<PluginContext["cli"]["cancel"]>,
      listJobs: () => rpc("cliListJobs") as ReturnType<PluginContext["cli"]["listJobs"]>,
    }),
    ui: createPluginUiKit(),
    http: {
      fetch: async (url, options = {}) => {
        const result = (await rpc("httpFetch", { url, options })) as {
          status: number;
          ok: boolean;
          url?: string;
          headers: Record<string, string>;
          body: string;
          bodyBase64?: string;
          body_base64?: string;
          binary?: boolean;
        };
        const body = String(result.body ?? "");
        const bodyBase64 = String(result.bodyBase64 || result.body_base64 || "");
        const headers = result.headers || {};
        const responseBytes = () => {
          if (bodyBase64) {
            const binary = atob(bodyBase64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
            return bytes;
          }
          return new TextEncoder().encode(body);
        };
        return {
          ...result,
          body,
          bodyBase64,
          binary: Boolean(result.binary),
          url: String(result.url || url),
          headers,
          text: async () => (body ? body : new TextDecoder().decode(responseBytes())),
          json: async () =>
            JSON.parse(body || new TextDecoder().decode(responseBytes())) as unknown,
          arrayBuffer: async () => {
            const bytes = responseBytes();
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          },
          blob: async () => {
            const type = headers["content-type"] || headers["Content-Type"] || "";
            return new Blob([responseBytes()], type ? { type } : undefined);
          },
        };
      },
    },
    notification: {
      show: (input) => rpc("notificationShow", input) as Promise<void>,
    },
    ai: {
      providers: () => rpc("aiListProviders") as Promise<PluginAiProvider[]>,
      models: async (provider) => {
        const providers = (await rpc("aiListProviders")) as PluginAiProvider[];
        const selected = provider
          ? providers.find((item) => item.id === provider)
          : providers[0];
        return selected?.models ?? [];
      },
      defaultModel: () => rpc("aiDefaultModel") as Promise<PluginAiModelSelection | null>,
      agentSettings: () =>
        rpc("aiAgentSettings") as ReturnType<PluginContext["ai"]["agentSettings"]>,
      chat: (input, options) =>
        rpc("aiChat", createAiChatPayload(input, options)) as Promise<string>,
      stream: (input, onChunk, options) =>
        streamAi(input, (event) => {
          if (event.type === "text_delta") onChunk(event.delta);
        }, options),
      streamEvents: streamAi,
      runBash: (script, options = {}) =>
        rpc("aiRunBash", {
          script,
          cwd: options.cwd,
          timeoutMs: options.timeoutMs,
        }) as ReturnType<PluginContext["ai"]["runBash"]>,
      memory: {
        list: () => rpc("aiMemoryList") as ReturnType<PluginContext["ai"]["memory"]["list"]>,
        add: (text, tags = []) =>
          rpc("aiMemoryAdd", { text, tags }) as ReturnType<PluginContext["ai"]["memory"]["add"]>,
        delete: (id) =>
          rpc("aiMemoryDelete", { id }) as ReturnType<PluginContext["ai"]["memory"]["delete"]>,
      },
      search: {
        grep: (query, options = {}) =>
          rpc("aiGrepSearch", {
            query,
            root: options.root,
            maxResults: options.maxResults,
          }) as ReturnType<PluginContext["ai"]["search"]["grep"]>,
      },
      tasks: {
        submit: (input) =>
          rpc(
            "aiTaskSubmit",
            typeof input === "string" ? { prompt: input } : { ...input },
          ) as ReturnType<PluginContext["ai"]["tasks"]["submit"]>,
        list: () => rpc("aiTaskList") as ReturnType<PluginContext["ai"]["tasks"]["list"]>,
        get: (id) => rpc("aiTaskGet", { id }) as ReturnType<PluginContext["ai"]["tasks"]["get"]>,
        cancel: (id) =>
          rpc("aiTaskCancel", { id }) as ReturnType<PluginContext["ai"]["tasks"]["cancel"]>,
      },
    },
    tray: {
      setItems: (items) =>
        rpc("traySetItems", { items }) as ReturnType<PluginContext["tray"]["setItems"]>,
      clear: () => rpc("trayClear") as ReturnType<PluginContext["tray"]["clear"]>,
      list: () => rpc("trayList") as ReturnType<PluginContext["tray"]["list"]>,
    },
    system: {
      env: () => rpc("systemEnv") as ReturnType<PluginContext["system"]["env"]>,
      openPath: (path) =>
        rpc("systemOpenPath", { path }) as ReturnType<PluginContext["system"]["openPath"]>,
      revealPath: (path) =>
        rpc("systemRevealPath", { path }) as ReturnType<PluginContext["system"]["revealPath"]>,
      saveDownload: (input) =>
        rpc("systemSaveDownload", input) as ReturnType<PluginContext["system"]["saveDownload"]>,
      openSettings: (section) =>
        rpc("systemOpenSettings", { section }) as ReturnType<
          PluginContext["system"]["openSettings"]
        >,
      setWallpaper: (path, options = {}) =>
        rpc("systemSetWallpaper", { path, scope: options.scope }) as ReturnType<
          PluginContext["system"]["setWallpaper"]
        >,
      stats: async () => {
        const raw = (await rpc("invoke", {
          cmd: "get_system_stats",
          args: {},
        })) as Record<string, unknown>;
        return {
          cpu: Number(raw.cpu ?? 0),
          memory: Number(raw.memory ?? 0),
          memoryUsedGb: Number(raw.memoryUsedGb ?? raw.memory_used_gb ?? 0),
          memoryTotalGb: Number(raw.memoryTotalGb ?? raw.memory_total_gb ?? 0),
          memoryPressure: String(raw.memoryPressure ?? raw.memory_pressure ?? "unknown") as PluginSystemStats["memoryPressure"],
          memoryPressureLevel: Number(raw.memoryPressureLevel ?? raw.memory_pressure_level ?? 0),
          swapUsedGb: Number(raw.swapUsedGb ?? raw.swap_used_gb ?? 0),
          swapTotalGb: Number(raw.swapTotalGb ?? raw.swap_total_gb ?? 0),
          gpu: raw.gpu == null ? null : Number(raw.gpu),
        };
      },
      networkCounters: async () => {
        const raw = (await rpc("invoke", {
          cmd: "qx_system_monitor_network_counters",
          args: {},
        })) as Record<string, unknown>;
        const interfaces = Array.isArray(raw.interfaces)
          ? (raw.interfaces as Array<Record<string, unknown>>).map((row) => ({
              name: String(row.name ?? ""),
              bytesIn: Number(row.bytesIn ?? row.bytes_in ?? 0),
              bytesOut: Number(row.bytesOut ?? row.bytes_out ?? 0),
            }))
          : [];
        return {
          totalBytesIn: Number(raw.totalBytesIn ?? raw.total_bytes_in ?? 0),
          totalBytesOut: Number(raw.totalBytesOut ?? raw.total_bytes_out ?? 0),
          interfaces,
        };
      },
      info: () => rpc("invoke", {
        cmd: "qx_system_information_check_system_info",
        args: {},
      }) as ReturnType<PluginContext["system"]["info"]>,
      storage: () => rpc("invoke", {
        cmd: "qx_system_information_check_storage",
        args: {},
      }) as ReturnType<PluginContext["system"]["storage"]>,
      displays: () => rpc("invoke", {
        cmd: "display_list",
        args: {},
      }) as ReturnType<PluginContext["system"]["displays"]>,
      displayBrightness: () => rpc("invoke", {
        cmd: "display_brightness_list",
        args: {},
      }) as ReturnType<PluginContext["system"]["displayBrightness"]>,
      setDisplayBrightness: (displayId, value) => rpc("invoke", {
        cmd: "display_brightness_set",
        args: { displayId, value: Math.max(0, Math.min(100, Math.round(value))) },
      }) as ReturnType<PluginContext["system"]["setDisplayBrightness"]>,
      network: () => rpc("invoke", {
        cmd: "qx_system_information_check_network",
        args: {},
      }) as ReturnType<PluginContext["system"]["network"]>,
      power: () => rpc("invoke", {
        cmd: "qx_system_monitor_power",
        args: {},
      }) as ReturnType<PluginContext["system"]["power"]>,
      qxStorageOverview: () => rpc("invoke", { cmd: "qx_storage_overview", args: {} }),
      processes: {
        list: () => rpc("invoke", {
          cmd: "qx_system_information_list_processes",
          args: {},
        }) as ReturnType<PluginContext["system"]["processes"]["list"]>,
        kill: (pid: number) =>
          rpc("invoke", {
            cmd: "qx_system_information_kill_process",
            args: { pid },
          }) as ReturnType<PluginContext["system"]["processes"]["kill"]>,
      },
    },
    permissions: {
      status: () => rpc("invoke", { cmd: "qx_permissions_status", args: {} }),
      request: (id) =>
        rpc("invoke", {
          cmd: "qx_permissions_request",
          args: { id },
        }) as Promise<boolean>,
      openSettings: (id) =>
        rpc("invoke", {
          cmd: "qx_permissions_open_settings",
          args: { id },
        }) as Promise<void>,
    },
    apps: {
      search: (query) =>
        rpc("invoke", { cmd: "search_apps", args: { query } }) as Promise<unknown[]>,
    },
    files: {
      search: async (query, limit) => {
        const results = (await rpc("invoke", {
          cmd: "search_files",
          args: { query },
        })) as unknown[];
        return typeof limit === "number" ? results.slice(0, Math.max(0, limit)) : results;
      },
    },
    qx: {
      invokeRust: (cmd, args) => rpc("invokeRust", { cmd, args }),
    },
    storage: {
      get: (key: string) => rpc("storageGet", { key }),
      set: (key: string, value: unknown) => rpc("storageSet", { key, value }) as Promise<void>,
      delete: (key: string) => rpc("storageDelete", { key }) as Promise<void>,
      session: {
        get: (key: string) => rpc("sessionStorageGet", { key }),
        set: (key: string, value: unknown) =>
          rpc("sessionStorageSet", { key, value }) as Promise<void>,
        delete: (key: string) => rpc("sessionStorageDelete", { key }) as Promise<void>,
      },
      persist: {
        get: (key: string) => rpc("storageGet", { key }),
        set: (key: string, value: unknown) => rpc("storageSet", { key, value }) as Promise<void>,
        delete: (key: string) => rpc("storageDelete", { key }) as Promise<void>,
        keys: () =>
          rpc("storageList") as Promise<Array<{ key: string; bytes: number }>>,
        clear: () => rpc("storageClear") as Promise<void>,
      },
    },
  };
}

function makeUnavailable(): () => never {
  return () => {
    throw new Error("Direct context not available; command runs inside plugin iframe");
  };
}

function mapLeavesToUnavailable<T>(value: T): T {
  if (typeof value === "function") {
    return makeUnavailable() as unknown as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = mapLeavesToUnavailable(val);
    }
    return result as unknown as T;
  }
  return value;
}

export function createUnavailableContext(pluginId: string): PluginContext {
  const template = createPluginContext(
    {
      id: pluginId,
      name: "",
      version: "",
      description: "",
      path: "",
      enabled: false,
      permissions: [],
      author: "",
    },
    {
      onToast: () => {},
      onPrompt: async () => null,
      onGetPreference: async () => undefined,
    },
  );
  return mapLeavesToUnavailable(template);
}
