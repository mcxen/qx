#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  defaultPluginShortcutBinding,
  pluginLaunchShortcutSettingsKey,
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
assert.equal(pluginLaunchShortcutSettingsKey("file-actions"), "open:file-actions");
assert.equal(
  pluginLaunchShortcutSettingsKey("plugin:clipboard-actions"),
  "open:plugin:clipboard-actions",
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
assert.match(registry, /listen<\{ pluginId: string; command: string \}>\("plugin-global-shortcut"/);
assert.doesNotMatch(registry, /@tauri-apps\/plugin-global-shortcut/);
assert.match(registry, /await get\(\)\.unload\(\)/);
assert.ok(
  registry.indexOf("await get().unload()") < registry.indexOf("await get().load(hooks)"),
  "refresh must unload runtimes before loading replacements",
);

const nativeShortcuts = await readFile(
  new URL("../src-tauri/src/settings/shortcuts.rs", import.meta.url),
  "utf8",
);
assert.match(nativeShortcuts, /strip_prefix\("open:"\)/);
assert.match(nativeShortcuts, /strip_prefix\("plugin:"\)/);
assert.match(nativeShortcuts, /"plugin-global-shortcut"/);

const manager = await readFile(
  new URL("../src/modules/settings/plugins/PluginManager.tsx", import.meta.url),
  "utf8",
);
assert.match(manager, /pluginShortcutSettingsKey\(/);
assert.match(manager, /pluginLaunchShortcutSettingsKey\(/);
assert.match(manager, /<ShortcutRecorder/);
assert.match(manager, /patchShortcut\(settingKey, next\)/);
assert.match(manager, /"shortcuts\.extension\.open"/);

console.log("plugin shortcut smoke: ok");
