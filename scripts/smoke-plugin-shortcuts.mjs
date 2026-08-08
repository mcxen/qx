#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  defaultPluginShortcutBinding,
  pluginShortcutSettingsKey,
  resolvePluginShortcutBinding,
} from "../src/plugin/pluginShortcuts.ts";

const manifestShortcut = {
  command: "save-clipboard-image",
  key: "Alt+Shift+I",
  enabled: false,
};
const settings = {
  shortcuts: {
    [pluginShortcutSettingsKey("clipboard-actions", manifestShortcut.command)]: {
      key: "CmdOrCtrl+Shift+I",
      enabled: true,
    },
  },
};

assert.equal(
  pluginShortcutSettingsKey("clipboard-actions", manifestShortcut.command),
  "plugin:clipboard-actions:save-clipboard-image",
);
assert.deepEqual(defaultPluginShortcutBinding(manifestShortcut), {
  key: "Alt+Shift+I",
  enabled: false,
});
assert.deepEqual(
  resolvePluginShortcutBinding(settings, "clipboard-actions", manifestShortcut),
  { key: "CmdOrCtrl+Shift+I", enabled: true },
);
assert.deepEqual(
  resolvePluginShortcutBinding({ shortcuts: {} }, "clipboard-actions", manifestShortcut),
  { key: "Alt+Shift+I", enabled: false },
);

const registry = await readFile(new URL("../src/plugin/registry.ts", import.meta.url), "utf8");
assert.match(registry, /resolvePluginShortcutBinding\(/);
assert.match(registry, /await Promise\.all\(unregisterResults\)/);
assert.match(registry, /await get\(\)\.unload\(\)/);
assert.ok(
  registry.indexOf("await get().unload()") < registry.indexOf("await get().load(hooks)"),
  "refresh must unload (and await unregister) before loading new plugin bindings",
);

const manager = await readFile(
  new URL("../src/modules/settings/plugins/PluginManager.tsx", import.meta.url),
  "utf8",
);
assert.match(manager, /pluginShortcutSettingsKey\(/);
assert.match(manager, /<ShortcutRecorder/);
assert.match(manager, /patchShortcut\(settingKey, next\)/);
assert.match(manager, /onShortcutsChanged=\{\(\) => void refresh\(\)\}/);

console.log("plugin shortcut smoke: ok");
