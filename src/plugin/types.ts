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
  keywords?: string[];
  permissions?: string[];
  preferences?: PluginPreference[];
  commands?: PluginCommand[];
  panel?: PluginPanel;
  dependencies?: string[];
  min_app_version?: string;
  entry?: string;
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

export interface PluginContext {
  pluginId: string;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  showToast: (msg: string) => void;
  prompt: (label: string, defaultValue?: string) => Promise<string | null>;
  openUrl: (url: string) => Promise<void>;
  getPreference: (id: string) => Promise<unknown>;
  storage: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
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
