import assert from "node:assert/strict";
import { build } from "esbuild";

const calls = [];
globalThis.__macroInvoke = async (command, args) => {
  calls.push({ command, args });
  if (command === "macro_play") {
    return { playback_id: 1, macro_id: args.id, macro_name: "test", total_steps: 2, delay_ms: args.delayMs };
  }
  if (command === "macro_stop_recording") return { steps: [], total_duration_ms: 0 };
};
const { outputFiles } = await build({
  entryPoints: ["src/modules/macros/store.ts"], bundle: true, write: false,
  platform: "node", format: "esm",
  plugins: [{
    name: "macro-native-boundary",
    setup(builder) {
      builder.onResolve({ filter: /^@tauri-apps\/api\/core$|^\.\.\/settings\/store$/ }, ({ path }) => ({ path, namespace: "stub" }));
      builder.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({
        contents: path.includes("tauri")
          ? "export const invoke = (...args) => globalThis.__macroInvoke(...args);"
          : "export const useSettingsStore = { getState: () => ({settings: {macros: {stop_tail_seconds: 2}}}) };",
      }));
    },
  }],
});
const { useMacroStore: store, idleMacroPlayback } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
await store.getState().playMacro(7, 3000);
assert.deepEqual(calls[0], { command: "macro_play", args: { id: 7, delayMs: 3000 } });
await store.getState().startRecording();
assert.equal(calls.length, 1, "recording must not capture playback output");
store.setState({ playback: { ...store.getState().playback, status: "paused" } });
const stoppingPlayback = store.getState().stopPlayback();
await store.getState().startRecording();
await stoppingPlayback;
assert.equal(calls.at(-1).command, "macro_stop_playback", "paused Stop reaches native cancellation");
assert.equal(store.getState().isRecording, false, "recording waits until playback cancellation settles");
store.setState({ playback: idleMacroPlayback });
await store.getState().startRecording();
const count = calls.length;
await store.getState().startRecording();
await store.getState().playMacro(7);
assert.equal(calls.length, count, "duplicate recording and concurrent playback are ignored");
await store.getState().stopRecording();
assert.equal(store.getState().isRecording, false);
delete globalThis.__macroInvoke;
console.log("macro store: delay contract, paused cancellation and recording/playback exclusion passed");
