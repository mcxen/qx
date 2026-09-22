/** Model-facing adapters for the narrow host settings and plugin lifecycle port. */
import type { AgentSettings } from "../../settings/store";
import {
  listQxManageableSettings,
  setInstalledPluginEnabled,
  uninstallInstalledPlugin,
  updateQxManageableSetting,
} from "./host-management";
import { asRecord, stringField, type ToolSpec } from "./types";

const hostOn = (settings: AgentSettings) => settings.qx_host_actions_enabled;

export const HOST_MANAGEMENT_TOOLS: ToolSpec[] = [
  {
    name: "list_qx_settings",
    description:
      "List Qx settings that the agent may inspect and change through stable host adapters. Returns current values and exact ids; use before set_qx_setting.",
    inputHint: '{"query": "wallpaper"}',
    parameters: { type: "object", properties: { query: { type: "string" } } },
    isEnabled: hostOn,
    run: async (input) => {
      const settings = listQxManageableSettings(stringField(asRecord(input), "query"));
      if (settings.length === 0) return "No matching manageable Qx settings.";
      return settings
        .map(
          (item) =>
            `- ${item.id} [${item.type}/${item.risk}] = ${JSON.stringify(item.value)}\n  ${item.title} — ${item.description}`,
        )
        .join("\n");
    },
  },
  {
    name: "set_qx_setting",
    description:
      "Change one Qx setting by an exact id returned by list_qx_settings. The host validates the value and applies the owning subsystem's live update path.",
    inputHint: '{"id": "plugins.background.wallpaper.enabled", "value": false}',
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        value: { type: ["boolean", "number", "string"] },
      },
      required: ["id", "value"],
    },
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      const id = stringField(rec, "id");
      if (!id) return "Error: setting id is required. Call list_qx_settings first.";
      const value = rec.value;
      if (typeof value !== "boolean" && typeof value !== "number" && typeof value !== "string") {
        return "Error: value must be a boolean, number, or string.";
      }
      const updated = await updateQxManageableSetting(id, value);
      return `Updated ${updated.id} to ${JSON.stringify(updated.value)}.`;
    },
  },
  {
    name: "set_plugin_enabled",
    description:
      "Enable or disable one installed marketplace plugin through the Qx plugin lifecycle. Call list_plugins first. Built-in modules are intentionally excluded.",
    inputHint: '{"pluginId": "v2ex", "enabled": false}',
    parameters: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["pluginId", "enabled"],
    },
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      const pluginId = stringField(rec, "pluginId") || stringField(rec, "plugin_id");
      if (typeof rec.enabled !== "boolean") return "Error: enabled must be a boolean.";
      return setInstalledPluginEnabled(pluginId, rec.enabled);
    },
  },
  {
    name: "uninstall_plugin",
    description:
      "Uninstall one installed marketplace plugin through the Qx plugin lifecycle, including runtime cleanup and durable plugin-data removal. Call list_plugins first. This is destructive and requires safety confirmation unless SOLO is enabled.",
    inputHint: '{"pluginId": "v2ex"}',
    parameters: {
      type: "object",
      properties: { pluginId: { type: "string" } },
      required: ["pluginId"],
    },
    isEnabled: hostOn,
    run: async (input) => {
      const rec = asRecord(input);
      return uninstallInstalledPlugin(
        stringField(rec, "pluginId") || stringField(rec, "plugin_id"),
      );
    },
  },
];
