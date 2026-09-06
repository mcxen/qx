#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPreferenceSaveQueue } from "../src/modules/settings/plugins/pluginPreferenceSaveQueue.ts";
import { buildPreferenceSaveRequest } from "../src/modules/settings/plugins/pluginPreferenceSavePolicy.ts";

const manager = await readFile(
  new URL("../src/modules/settings/plugins/PluginManager.tsx", import.meta.url),
  "utf8",
);
const preferences = await readFile(
  new URL("../src/modules/settings/plugins/PluginPreferences.tsx", import.meta.url),
  "utf8",
);
const types = await readFile(new URL("../src/plugin/types.ts", import.meta.url), "utf8");
const registry = await readFile(new URL("../src/plugin/registry.ts", import.meta.url), "utf8");
const rustManifest = await readFile(
  new URL("../src-tauri/src/marketplace/mod.rs", import.meta.url),
  "utf8",
);
const rustValidation = await readFile(
  new URL("../src-tauri/src/marketplace/preference_groups.rs", import.meta.url),
  "utf8",
);

assert.match(types, /preferenceGroups|preference_groups/);
assert.match(types, /saveMode|PluginPreferenceSaveMode/);
assert.match(types, /connectionCheck/);
assert.match(preferences, /groupPreferences/);
assert.match(preferences, /Save and check/);
assert.match(preferences, /type=\{revealed \? "text" : "password"\}/);
assert.match(preferences, /checkingGroupId/);
assert.match(manager, /plugin_preferences_set/);
assert.match(manager, /runCommandWithResult/);
assert.match(manager, /loadTokenRef/);
assert.match(manager, /discardPromptOpen/);
assert.doesNotMatch(manager, /connection check completed/i);
assert.match(registry, /runCommandWithResult/);
assert.match(rustManifest, /rename = "preferenceGroups"/);
assert.match(rustManifest, /validate_preference_groups/);
assert.match(rustValidation, /rejects_duplicate_preference_ids/);
assert.match(rustValidation, /unknown connection check command/);

const persisted = { endpoint: "https://old.example", pat: "old", density: 1 };
const manualDraftB = { ...persisted, endpoint: "https://draft.example", pat: "manual" };
const autosaveWithoutManualSave = buildPreferenceSaveRequest(
  persisted,
  { kind: "autosave", preferenceId: "density", value: 2 },
);
assert.equal(
  autosaveWithoutManualSave.snapshot.pat,
  "old",
  "an autosave must not write an unsaved manual connection draft",
);
const explicitManualB = buildPreferenceSaveRequest(
  persisted,
  { kind: "manual", preferenceIds: ["endpoint", "pat"], values: manualDraftB },
);
const autosaveAfterManualB = buildPreferenceSaveRequest(
  explicitManualB.nextRequested,
  { kind: "autosave", preferenceId: "density", value: 2 },
);
assert.equal(autosaveAfterManualB.snapshot.pat, "manual");
const newDraftD = { ...autosaveAfterManualB.snapshot, pat: "new-unsaved-draft" };
assert.notEqual(
  newDraftD.pat,
  autosaveAfterManualB.snapshot.pat,
  "a new manual draft remains dirty after the previous save completes",
);

const gate = {};
gate.promise = new Promise((resolve) => { gate.resolve = resolve; });
const writes = [];
const queue = createPreferenceSaveQueue({
  write: async (snapshot) => {
    writes.push(snapshot);
    if (snapshot.values.endpoint === "a") await gate.promise;
  },
});

const inFlightA = queue.enqueue({
  pluginId: "blueprint",
  token: 1,
  values: { endpoint: "a", pat: "old" },
});
const manualB = queue.enqueue({
  pluginId: "blueprint",
  token: 1,
  values: explicitManualB.snapshot,
});
const checkAfterSave = manualB.then(() => {
  assert.equal(writes.length, 2, "check must wait for the queued save write");
  assert.equal(writes[1].values.pat, "manual", "a later autosave must retain manual fields");
});
const autosaveC = queue.enqueue({
  pluginId: "blueprint",
  token: 1,
  values: { ...autosaveAfterManualB.snapshot, note: "autosaved" },
});
gate.resolve();
await Promise.all([inFlightA, manualB, checkAfterSave, autosaveC]);
assert.deepEqual(writes.map((snapshot) => snapshot.values.endpoint), ["a", "https://draft.example"]);
assert.equal(writes[1].values.note, "autosaved");
assert.equal(queue.isBusy(), false);

let failureWrites = 0;
const failureGate = {};
failureGate.promise = new Promise((resolve) => { failureGate.resolve = resolve; });
const failingQueue = createPreferenceSaveQueue({
  write: async (snapshot) => {
    failureWrites += 1;
    if (snapshot.values.endpoint === "a") await failureGate.promise;
    throw new Error("offline");
  },
});
const failedA = failingQueue.enqueue({ pluginId: "blueprint", token: 2, values: { endpoint: "a" } });
const failedB = failingQueue.enqueue({ pluginId: "blueprint", token: 2, values: { endpoint: "b" } });
const failedC = failingQueue.enqueue({ pluginId: "blueprint", token: 2, values: { endpoint: "c" } });
failureGate.resolve();
const failures = await Promise.allSettled([failedA, failedB, failedC]);
assert.equal(failureWrites, 2, "coalesced waiters share one actual failed write");
assert.deepEqual(failures.map((result) => result.status), ["rejected", "rejected", "rejected"]);

console.log("plugin preferences smoke: ok");
