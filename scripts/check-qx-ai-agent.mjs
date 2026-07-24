#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storeSource = readFileSync(
  new URL("../src/modules/qx-ai/store.ts", import.meta.url),
  "utf8",
);
const agentSource = readFileSync(
  new URL("../src/modules/qx-ai/react-agent.ts", import.meta.url),
  "utf8",
);

// Tool execution and model transport are separate switches. Models without
// native tool schemas must retain the prompt-based ReAct path.
assert.match(
  storeSource,
  /model_tools_enabled\s*\?\s*runFunctionCallingAgent\s*:\s*runReactAgent/,
);

// Native tool commands re-read settings from disk, so the debounced frontend
// settings write must complete before the first tool invocation.
assert.match(storeSource, /await useSettingsStore\.getState\(\)\.flush\(\)/);

// Streaming tool calls must retain the previous complete-response transport as
// a provider compatibility fallback.
assert.match(agentSource, /invoke<OpenAIMessage>\("qxai_chat_with_tools"/);
assert.match(agentSource, /compatibility fallback failed/);

// Rust serializes PluginAiBashResult with camelCase.
assert.match(agentSource, /timedOut: boolean/);
assert.doesNotMatch(agentSource, /timed_out: boolean/);

console.log("QxAI agent tool-call checks passed");
