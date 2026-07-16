import type {
  InstalledPlugin,
  PluginAiModelSelection,
  PluginAiProvider,
  PluginContext,
} from "./types";
import { handlePluginRpc } from "./rpcMethods";
import { DEFAULT_SETTINGS, useSettingsStore } from "../modules/settings/store";

export interface PluginContextHooks {
  onToast: (msg: string) => void;
  onPrompt: (label: string, defaultValue?: string) => Promise<string | null>;
  onGetPreference: (pluginId: string, id: string) => Promise<unknown>;
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

  return {
    pluginId: plugin.id,
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
    prompt: (label: string, defaultValue?: string) =>
      rpc("prompt", { label, defaultValue }) as Promise<string | null>,
    openUrl: (url: string) => rpc("openUrl", { url }) as Promise<void>,
    getPreference: (id: string) => rpc("getPreference", { id }),
    setTimeout: (handler, delay, ...args) => window.setTimeout(handler, delay, ...args),
    setInterval: (handler, delay, ...args) => window.setInterval(handler, delay, ...args),
    clearTimeout: (id) => window.clearTimeout(id),
    clearInterval: (id) => window.clearInterval(id),
    clipboard: {
      read: () => rpc("clipboardRead") as Promise<string>,
      write: (text: string) => rpc("clipboardWrite", { text }) as Promise<void>,
    },
    cli: {
      run: (request) =>
        rpc("cliRun", {
          program: request.program,
          args: request.args,
          cwd: request.cwd,
          env: request.env,
          timeoutMs: request.timeoutMs,
        }) as ReturnType<PluginContext["cli"]["run"]>,
      which: (program) =>
        rpc("cliWhich", { program }) as ReturnType<PluginContext["cli"]["which"]>,
    },
    http: {
      fetch: async (url, options = {}) => {
        const result = (await rpc("httpFetch", { url, options })) as {
          status: number;
          ok: boolean;
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
      stream: async (input, onChunk, options) => {
        const chunks = (await rpc("aiStreamChat", createAiChatPayload(input, options))) as string[];
        let full = "";
        for (const chunk of chunks) {
          const text = String(chunk ?? "");
          full += text;
          onChunk(text);
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
        return full;
      },
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
    system: {
      stats: () => rpc("invoke", { cmd: "get_system_stats", args: {} }),
      info: () => rpc("invoke", { cmd: "qx_system_information_check_system_info", args: {} }),
      storage: () => rpc("invoke", { cmd: "qx_system_information_check_storage", args: {} }),
      network: () => rpc("invoke", { cmd: "qx_system_information_check_network", args: {} }),
      qxStorageOverview: () => rpc("invoke", { cmd: "qx_storage_overview", args: {} }),
      processes: {
        list: () => rpc("invoke", { cmd: "qx_system_information_list_processes", args: {} }),
        kill: (pid) =>
          rpc("invoke", {
            cmd: "qx_system_information_kill_process",
            args: { pid },
          }),
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
