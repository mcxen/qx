export const BUILTIN_MODULE_CATALOG = {
  clipboard: { maturity: "stable", userDisableable: true },
  "qx-ai": { maturity: "stable", userDisableable: true },
  rss: { maturity: "stable", userDisableable: true },
  screencap: { maturity: "beta", userDisableable: true },
  /** Prefer marketplace plugin `weather`. Built-in panel is opt-in. */
  weather: { maturity: "beta", userDisableable: true },
  documents: { maturity: "stable", userDisableable: true },
  "file-actions": { maturity: "stable", userDisableable: true },
  macros: { maturity: "beta", userDisableable: true },
  "qx-tty": { maturity: "stable", userDisableable: true },
  /** AI reading companion on RSS + workbench (summary/draft). */
  "p-zai": { maturity: "beta", userDisableable: true },
} as const;

export type BuiltinModuleId = keyof typeof BUILTIN_MODULE_CATALOG;
export type ConfigurableBuiltinModuleId = {
  [K in BuiltinModuleId]: typeof BUILTIN_MODULE_CATALOG[K]["userDisableable"] extends true ? K : never;
}[BuiltinModuleId];

export const CONFIGURABLE_BUILTIN_MODULE_IDS = Object.entries(BUILTIN_MODULE_CATALOG)
  .filter(([, metadata]) => metadata.userDisableable)
  .map(([id]) => id as ConfigurableBuiltinModuleId);

export function normalizeBuiltinModuleId(value: string): string {
  return value.startsWith("builtin:") ? value.slice("builtin:".length) : value;
}

export function isBuiltinModuleId(value: string): value is BuiltinModuleId {
  return Object.prototype.hasOwnProperty.call(BUILTIN_MODULE_CATALOG, normalizeBuiltinModuleId(value));
}

export function isConfigurableBuiltinModule(value: string): value is ConfigurableBuiltinModuleId {
  const id = normalizeBuiltinModuleId(value);
  return isBuiltinModuleId(id) && BUILTIN_MODULE_CATALOG[id].userDisableable;
}

export function isBetaModule(value: string | null | undefined): boolean {
  if (!value) return false;
  const id = normalizeBuiltinModuleId(value);
  return isBuiltinModuleId(id) && BUILTIN_MODULE_CATALOG[id].maturity === "beta";
}
