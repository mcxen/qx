#!/usr/bin/env node
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import plugin from "../qx-plugins/src/external-display-control/index.js";

const compiled = await build({ entryPoints: ["src/plugin/workbenchTypes.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const { normalizePluginWorkbenchState: normalize } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const controls = (list) => normalize({ detail: { form: { controls: list } } }).detail.form.controls;
// Baseline: extending the shared form must leave existing consumers unchanged.
for (const type of ["text", "number", "select", "textarea"]) {
  const [control] = controls([{ id: "legacy", type, value: "42" }]);
  assert.equal(control.type, type);
  assert.equal(control.value, "42");
}
const [slider] = controls([{ id: "s", type: "slider", value: "999", min: 10, max: 90, step: 5 }]);
assert.deepEqual([slider.min, slider.max, slider.step, slider.value], [10, 90, 5, "90"]);
const [invalid] = controls([{ id: "s", type: "slider", value: "NaN", min: "NaN", max: -1, step: 0 }]);
assert.deepEqual([invalid.min, invalid.max, invalid.step, invalid.value], [0, 100, 1, "0"]);

const tick = () => new Promise((done) => setImmediate(done));
function harness(displays, locale = "en") {
  let snapshot, handlers;
  let pendingWrite;
  const timers = new Map();
  const writes = [];
  let serial = 0, destroyed = false, reads = 0;
  const context = {
    locale,
    ui: { mountWorkbench(state, events) {
      snapshot = state; handlers = events;
      return { destroy() { destroyed = true; } };
    } },
    system: {
      async displayBrightness() { reads++; return structuredClone(displays); },
      setDisplayBrightness(id, value) {
        writes.push([id, value]);
        return new Promise((resolve, reject) => { pendingWrite = { resolve() {
          displays.find((d) => d.id === id).current = value; resolve();
        }, reject }; });
      },
    },
    setTimeout(fn) { timers.set(++serial, fn); return serial; },
    clearTimeout(id) { timers.delete(id); },
    setInterval() { return 1; }, clearInterval() {},
  };
  const container = {};
  plugin.panel.render(container, context);
  return {
    get state() { return snapshot; }, get events() { return handlers; }, writes,
    get write() { return pendingWrite; }, get reads() { return reads; },
    flush() { const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); },
    destroy() { plugin.panel.destroy(container); assert.equal(destroyed, true); },
  };
}
const target = (id, backend, supported = true) => ({ id, backend, name: id, supported, current: supported ? 40 : null, rawCurrent: supported ? 120 : null, rawMax: supported ? 300 : null, max: 100 });
// Independent adapter fixtures and their combination; fixtures are not hardware evidence.
for (const list of [
  [target("a", "native")], [target("b", "ddc")], [target("c", "software")],
  [target("a", "native"), target("b", "ddc", false), target("c", "software")],
]) {
  const h = harness(list, "zh-CN"); await tick();
  assert.equal(h.state.title, "显示器亮度");
  assert.equal(h.state.items.length, list.filter((d) => d.backend !== "software").length);
  h.events.onTab("software");
  assert.equal(h.state.items.length, list.filter((d) => d.backend === "software").length);
  h.destroy();
}
const h = harness([target("a", "native"), target("b", "ddc")]); await tick();
h.events.onInput("brightness", "50", { id: "a" });
h.events.onInput("brightness", "60", { id: "a" });
h.flush();
assert.deepEqual(h.writes, [["a", 60]]);
h.events.onInput("brightness", "70", { id: "a" });
h.events.onInput("brightness", "80", { id: "a" });
h.write.resolve(); await tick();
assert.deepEqual(h.writes, [["a", 60], ["a", 80]]);
h.write.reject(new Error("DDC disconnected")); await tick();
assert.match(h.state.error, /DDC disconnected/);
assert.equal(h.state.items[0].detail.form.controls[0].value, "60");
h.events.onSelect("b");
h.events.onInput("brightness", "55", { id: "b" }); h.flush();
assert.deepEqual(h.writes.at(-1), ["b", 55]);
h.events.onInput("brightness", "90", { id: "a" });
h.destroy(); const count = h.writes.length;
h.write.resolve(); await tick(); h.flush();
assert.equal(h.writes.length, count, "destroy must not schedule another native write");

// Exercise the exact pure C parser/matcher used by both macOS DDC adapters.
if (process.platform === "darwin") {
  const dir = mkdtempSync(join(tmpdir(), "qx-ddc-test-"));
  try {
    const source = join(dir, "test.c"); const binary = join(dir, "test");
    writeFileSync(source, `
#include <assert.h>
#include "ddc_protocol.h"
void checksum(uint8_t *r) { r[10]=0x50; for(int i=0;i<10;i++) r[10]^=r[i]; }
int main(void) {
 uint8_t r[11]={0x6e,0x88,2,0,0x10,0,1,44,0,150,0}; uint16_t cur=0,max=0;
 checksum(r); assert(qx_ddc_decode(r,11,&cur,&max)); assert(cur==150 && max==300);
 r[3]=1; checksum(r); assert(!qx_ddc_decode(r,11,&cur,&max));
 r[3]=0; r[4]=0x12; checksum(r); assert(!qx_ddc_decode(r,11,&cur,&max));
 r[4]=0x10; r[6]=0; r[7]=0; checksum(r); assert(!qx_ddc_decode(r,11,&cur,&max));
 r[7]=100; checksum(r); assert(!qx_ddc_decode(r,11,&cur,&max));
 r[9]=50; checksum(r); r[10]^=1; assert(!qx_ddc_decode(r,11,&cur,&max));
 bool used[2]={false,false}; int exact[4]={10,1,1,10}, tied[4]={3,3,3,3}, weak[4]={3,2,3,1};
 assert(qx_ddc_unique_match(exact,2,2,2,used,used,0,0));
 assert(!qx_ddc_unique_match(tied,2,2,2,used,used,0,0));
 assert(!qx_ddc_unique_match(weak,2,2,2,used,used,0,1));
 return 0;
}`);
    const cc = spawnSync("clang", ["-Wall", "-Wextra", "-Werror", "-I", resolve("src-tauri/src/display"), source, "-o", binary], { encoding: "utf8" });
    assert.equal(cc.status, 0, cc.stderr);
    assert.equal(spawnSync(binary).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log("brightness ablation: legacy forms, slider, native/DDC/software combinations, coalescing, failures and teardown passed");
console.log(process.platform === "darwin" ? "DDC C protocol: passed" : "DDC C protocol: skipped (macOS adapter)");
