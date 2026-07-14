import { useSettingsStore, type Settings } from "./settings/store";
import { isConfigurableBuiltinModule, normalizeBuiltinModuleId } from "./catalog";

export function isBuiltinModuleEnabled(
  value: string,
  settings: Settings = useSettingsStore.getState().settings,
): boolean {
  const id = normalizeBuiltinModuleId(value);
  if (!isConfigurableBuiltinModule(id)) return true;
  return settings.builtin_modules.modules[id] !== false;
}
