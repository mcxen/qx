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
const settingsSource = readFileSync(
  new URL("../src/modules/settings/store.ts", import.meta.url),
  "utf8",
);
const messageSource = readFileSync(
  new URL("../src/modules/qx-ai/message-rendering.tsx", import.meta.url),
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
assert.match(agentSource, /assertNamedToolCalls\(await streamPromise/);
assert.match(agentSource, /without a function name/);

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
assert.match(agentSource, /required:\s*\["query",\s*"root"\]/);
assert.match(agentSource, /Use files for filename or folder-name searches/);
assert.match(agentSource, /Use apps only when the user is looking for an installed application/);

// The complete Agent surface is available on first run and host-side file
// actions produce real attachments / native clipboard payloads.
assert.match(settingsSource, /agent_mode_enabled:\s*true/);
assert.match(settingsSource, /tools_enabled:\s*true/);
assert.match(settingsSource, /bash_enabled:\s*true/);
assert.match(agentSource, /name:\s*"reveal_path"/);
assert.match(agentSource, /name:\s*"copy_to_clipboard"/);
assert.match(agentSource, /name:\s*"send_file"/);
assert.match(agentSource, /clipboard_write_file_paths/);
assert.match(storeSource, /attachments:\s*result\.attachments/);
assert.match(messageSource, /qx-ai-attachments/);

// Native reasoning is recorded as an ordered Agent step for every model turn.
// It must be appended before that turn's tool action and updated in place,
// rather than rendered through one global reasoning block that moves as tools arrive.
assert.match(agentSource, /createOrderedReasoningRecorder/);
assert.match(agentSource, /steps\.push\(reasoningStep\)/);
assert.match(agentSource, /onStepUpdate\(reasoningStep\.id, \{ text \}\)/);
assert.match(
  agentSource,
  /createOrderedReasoningRecorder\(steps, opts\)[\s\S]*?streamFunctionCallingOnce[\s\S]*?const toolCalls/,
);
assert.doesNotMatch(agentSource, /reasoning:\s*message\.reasoning_content/);

const chatSource = readFileSync(
  new URL("../src/modules/qx-ai/QxAiChat.tsx", import.meta.url),
  "utf8",
);
const skillsSource = readFileSync(
  new URL("../src/modules/qx-ai/skills.ts", import.meta.url),
  "utf8",
);
const nativeSkillsSource = readFileSync(
  new URL("../src-tauri/src/qx_ai_skills.rs", import.meta.url),
  "utf8",
);
assert.match(chatSource, /activity:\s*"dots"/);
assert.doesNotMatch(chatSource, /progress:\s*55/);

// Generating a response must not lock the composer: later submissions enter a
// visible FIFO queue, and slash search resolves a managed Qx Skill document.
assert.match(storeSource, /messageQueue:\s*\[/);
assert.match(storeSource, /runNextQueuedMessage/);
assert.match(chatSource, /t\("qxai\.queue\.add"/);
assert.doesNotMatch(chatSource, /disabled=\{isCurrentConversationStreaming \|\| !conv\}/);
assert.match(chatSource, /input\.startsWith\("\/"\)/);
assert.match(chatSource, /<Sparkles/);
assert.match(skillsSource, /filterQxAiSkills/);
assert.match(nativeSkillsSource, /state_dir\(\)\.join\("skills"\)/);
assert.match(nativeSkillsSource, /spawn_blocking/);

console.log("QxAI agent tool-call checks passed");
