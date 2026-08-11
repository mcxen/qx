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

// Every transport receives the real host platform, and tool descriptions must
// not advertise macOS-only implementations as cross-platform behavior.
assert.match(agentSource, /buildQxHostSystemPrompt/);
assert.match(agentSource, /The current operating system is Windows/);
assert.doesNotMatch(agentSource, /Search installed macOS applications by name/);
assert.doesNotMatch(agentSource, /Search files on the system by name fragment using Spotlight\/mdfind/);
assert.match(storeSource, /messages:\s*requestMessages/);

const chatSource = readFileSync(
  new URL("../src/modules/qx-ai/QxAiChat.tsx", import.meta.url),
  "utf8",
);
assert.match(chatSource, /activity:\s*"dots"/);
assert.doesNotMatch(chatSource, /progress:\s*55/);

console.log("QxAI agent tool-call checks passed");
