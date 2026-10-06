import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r/g, "");
// Prevent a new feature-local raw Show/Hide from bypassing the shared native
// transaction. Ephemeral pins deliberately destroy instead of reusing windows.
const reusableOwners = [
  "floating_panel.rs", "island_window.rs", "macro_cursor_overlay.rs", "tray_panel.rs",
  "screencap/controls.rs", "screencap/picker_window.rs", "screencap/selection.rs",
  "screencap/recording_session.rs", "updater/progress.rs", "lib.rs",
];
for (const path of reusableOwners) {
  assert.doesNotMatch(read(`src-tauri/src/${path}`), /\.\s*(?:show|hide)\(/, `${path} bypasses window_composition`);
}
const panel = read("src-tauri/src/floating_panel/interaction.rs");
const blur = panel.split("pub fn request_auto_hide_after_focus_settles")[1].split("pub fn set_onboarding_active")[0];
assert.match(blur, /ui\(&app,[\s\S]*AUTO_HIDE_BLUR_GENERATION[\s\S]*auto_hide_suppressed\(\)[\s\S]*hide_and_restore_focus/);

// Execute the production frontend port with deferred IPC and OS picker results.
function loadFileDialog(invoke, open) {
  const exports = {};
  const compiled = ts.transpileModule(read("src/system/fileDialog.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, {
    exports,
    require: (name) => name === "@tauri-apps/api/core" ? { invoke } : { open },
  });
  return exports.openNativeFileDialog;
}
for (const outcome of ["selection", "cancel", "failure"]) {
  const calls = [];
  let allowGuard;
  let finishPicker;
  const choose = loadFileDialog(
    (_command, args) => {
      calls.push(args.active ? "guard:start" : "guard:end");
      assert.equal(args.fileDialog, true);
      return args.active ? new Promise((resolve) => { allowGuard = resolve; }) : Promise.resolve();
    },
    () => {
      calls.push("picker:open");
      return new Promise((resolve, reject) => { finishPicker = { resolve, reject }; });
    },
  );
  const pending = choose({ multiple: true });
  assert.deepEqual(calls, ["guard:start"], "native picker must wait for confirmed protection");
  allowGuard();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["guard:start", "picker:open"], "guard remains held until picker settles");
  if (outcome === "failure") {
    finishPicker.reject(new Error("OS picker failed"));
    await assert.rejects(pending, /OS picker failed/);
  } else {
    const result = outcome === "cancel" ? null : ["C:\\files\\图片.png", "C:\\files\\note.txt"];
    finishPicker.resolve(result);
    assert.deepEqual(await pending, result);
  }
  assert.deepEqual(calls, ["guard:start", "picker:open", "guard:end"]);
}
await assert.rejects(loadFileDialog(
  async () => { throw new Error("IPC unavailable"); },
  () => { assert.fail("failed protection must not open an unguarded picker"); },
)({}), /IPC unavailable/);
assert.match(read("src/modules/qx-ai/sessions.ts"), /await openNativeFileDialog/);
assert.match(read("src/modules/screencap/CaptureToolbar.tsx"), /await openNativeFileDialog/);
const picker = read("src-tauri/src/screencap/picker_window.rs");
const ready = picker.split("fn screencap_region_picker_ready")[1].split("pub(crate) fn is_picker_surface")[0];
assert.match(ready, /run_ui[\s\S]*is_visible\(\)[\s\S]*is_recording\(\)[\s\S]*reassert_interactive/);
const island = read("src-tauri/src/island_window.rs");
assert.match(island, /run_ui\(&worker_app,[\s\S]*VISIBILITY_GENERATION[\s\S]*show_island/);
assert.match(read("src/island/float/IslandFloatBridge.tsx"), /disposed \|\| revision !== visibilityRevision/);
assert.doesNotMatch(read("src/modules/screencap/ScreenRecorder.tsx"), /await win\.show\(\)/);
const composition = read("src-tauri/src/lib.rs");
assert.match(composition, /\.plugin\(webview_policy::init\(\)\)/);
assert.match(read("src-tauri/src/webview_policy.rs"), /js_init_script_on_all_frames\(script\)/);
for (const file of readdirSync(new URL("../src-tauri/src/", import.meta.url), { recursive: true })) {
  if (file.endsWith(".rs") && file !== "webview_policy.rs") {
    assert.doesNotMatch(read(`src-tauri/src/${file}`), /WebviewWindowBuilder::new\(/, `${file} bypasses the creation-time WebView policy`);
  }
}
const configuredWindow = JSON.parse(read("src-tauri/tauri.conf.json")).app.windows[0];
assert.equal(configuredWindow.generalAutofillEnabled, false);
assert.equal(configuredWindow.zoomHotkeysEnabled, false);
assert.match(composition, /screencap::close_surface/);
assert.match(composition, /qx_update_progress_cancel/);
assert.match(composition, /"type": "close-float"/);
console.log("window lifecycle: reusable owners, late work, close and focus contracts passed; native ablation is opt-in");
