#!/usr/bin/env node
// Exercise the production bridge, replacing only unrelated theme/settings I/O.
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: ["src/plugin/pluginShellBridge.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  plugins: [{
    name: "unrelated-host-surfaces",
    setup(builder) {
      builder.onResolve({ filter: /(?:pluginTheme|openSettings)$/ }, (args) => ({
        path: args.path, namespace: "host-stub",
      }));
      builder.onLoad({ filter: /.*/, namespace: "host-stub" }, () => ({
        contents: "export const currentPluginThemePayload = () => ({}); export const openSettings = () => {};",
        loader: "js",
      }));
    },
  }],
});

const listeners = new Map();
globalThis.window = {
  location: { origin: "tauri://localhost" },
  addEventListener(type, callback) { listeners.set(type, callback); },
};
globalThis.document = { documentElement: {} };
globalThis.MutationObserver = class { observe() {} };
const bridge = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const received = [];
const stop = bridge.subscribePluginWorkbenchEdit((payload) => received.push(payload));
const posted = [];
const source = { postMessage(message) { posted.push(message); } };
const iframe = { contentWindow: source };
bridge.registerPluginRuntime("notes", "runtime-a", iframe);
bridge.setPanelRuntimeSession({ pluginId: "notes", runtimeId: "runtime-a", iframe });
const result = {
  phase: "start", status: "ready", itemId: "note-1", sessionId: "edit-1",
  requestId: "request-1", value: "完整原文\n\nNot a preview", revision: "opaque-revision",
};
const dispatch = (changes = {}, envelope = {}) => listeners.get("message")({
  origin: "null", source,
  ...envelope,
  data: {
    type: "qx:plugin:workbench:edit-response",
    pluginId: "notes", runtimeId: "runtime-a", result, ...changes,
  },
});

dispatch();
assert.equal(received.length, 1, "current registered panel delivers its response");
assert.equal(received[0].result.value, result.value, "body is preserved verbatim");
dispatch({}, { source: {} });
dispatch({}, { origin: "https://unrelated.invalid" });
dispatch({ pluginId: "other-plugin" });
dispatch({ runtimeId: "old-runtime" });
assert.equal(received.length, 1, "source, origin, plugin and runtime identity are mandatory");

const worker = { contentWindow: { postMessage() {} } };
bridge.registerPluginRuntime("notes", "worker", worker);
dispatch({ runtimeId: "worker" }, { source: worker.contentWindow });
assert.equal(received.length, 1, "a registered background worker cannot impersonate a panel");

dispatch({ result: { ...result, phase: "unknown" } });
dispatch({ result: { ...result, requestId: "" } });
dispatch({ result: { ...result, requestId: "x".repeat(257) } });
dispatch({ result: { ...result, sessionId: {} } });
assert.equal(received.length, 1, "invalid correlation data is not delivered");
dispatch({ result: { ...result, value: "字".repeat(22_000) } });
assert.equal(received.at(-1).result.status, "error", "oversized originals become errors");
assert.equal(received.at(-1).result.value, undefined, "oversized originals are never truncated into writable text");

bridge.postPluginWorkbenchEvent("notes", {
  kind: "edit", phase: "start", itemId: result.itemId,
  sessionId: result.sessionId, requestId: result.requestId,
});
assert.equal(posted.at(-1).runtimeId, "runtime-a", "requests target the current runtime");
const replacement = { contentWindow: { postMessage() {} } };
bridge.registerPluginRuntime("notes", "runtime-b", replacement);
bridge.setPanelRuntimeSession({ pluginId: "notes", runtimeId: "runtime-b", iframe: replacement });
const count = received.length;
dispatch();
assert.equal(received.length, count, "late responses from replaced panels are rejected");
bridge.deletePanelRuntimeSession("notes", "runtime-a");
assert.equal(bridge.getPanelRuntimeSession("notes").runtimeId, "runtime-b", "old cleanup does not delete the replacement");
dispatch({ runtimeId: "runtime-b" }, { source: replacement.contentWindow });
assert.equal(received.length, count + 1);
bridge.unregisterPluginRuntime("notes", "runtime-b");
dispatch({ runtimeId: "runtime-b" }, { source: replacement.contentWindow });
assert.equal(received.length, count + 1, "unregistered runtimes cannot deliver responses");
stop();
console.log("workbench edit bridge: current panel, spoofing, worker isolation, late replies, teardown and UTF-8 limits passed");
