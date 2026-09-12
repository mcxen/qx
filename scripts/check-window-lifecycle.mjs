import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
const panel = read("src-tauri/src/floating_panel.rs");
const blur = panel.split("pub fn request_auto_hide_after_focus_settles")[1].split("pub fn set_onboarding_active")[0];
assert.match(blur, /ui\(&app,[\s\S]*AUTO_HIDE_BLUR_GENERATION[\s\S]*auto_hide_suppressed\(\)[\s\S]*hide_and_restore_focus/);
const picker = read("src-tauri/src/screencap/picker_window.rs");
const ready = picker.split("fn screencap_region_picker_ready")[1].split("pub(crate) fn is_picker_surface")[0];
assert.match(ready, /run_ui[\s\S]*is_visible\(\)[\s\S]*is_recording\(\)[\s\S]*reassert_interactive/);
const island = read("src-tauri/src/island_window.rs");
assert.match(island, /run_ui\(&worker_app,[\s\S]*VISIBILITY_GENERATION[\s\S]*show_island/);
assert.match(read("src/island/float/IslandFloatBridge.tsx"), /disposed \|\| revision !== visibilityRevision/);
assert.doesNotMatch(read("src/modules/screencap/ScreenRecorder.tsx"), /await win\.show\(\)/);
const composition = read("src-tauri/src/lib.rs");
assert.match(composition, /screencap::close_surface/);
assert.match(composition, /qx_update_progress_cancel/);
assert.match(composition, /"type": "close-float"/);
console.log("window lifecycle: reusable owners, late work, close and focus contracts passed; native ablation is opt-in");
