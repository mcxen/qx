#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const storeSource = readFileSync(
  new URL("../src/modules/qx-ai/store.ts", import.meta.url),
  "utf8",
);
const agentSource = [
  "../src/modules/qx-ai/react-agent.ts",
  "../src/modules/qx-ai/agent/index.ts",
  "../src/modules/qx-ai/agent/tools.ts",
  "../src/modules/qx-ai/agent/tools-modules.ts",
  "../src/modules/qx-ai/agent/module-actions.ts",
  "../src/modules/qx-ai/agent/prompts.ts",
  "../src/modules/qx-ai/agent/stream.ts",
  "../src/modules/qx-ai/agent/function-loop.ts",
  "../src/modules/qx-ai/agent/react-loop.ts",
  "../src/modules/qx-ai/agent/memory.ts",
]
  .map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
  .join("\n");
const settingsSource = readFileSync(
  new URL("../src/modules/settings/store.ts", import.meta.url),
  "utf8",
);
const messageSource = readFileSync(
  new URL("../src/modules/qx-ai/message-rendering.tsx", import.meta.url),
  "utf8",
);
const qxAiCssSource = readFileSync(
  new URL("../src/styles/qx-ai.css", import.meta.url),
  "utf8",
);
const errorPresentationSource = readFileSync(
  new URL("../src/modules/qx-ai/error-presentation.ts", import.meta.url),
  "utf8",
);
const conversationTitleSource = readFileSync(
  new URL("../src/modules/qx-ai/conversation-title.ts", import.meta.url),
  "utf8",
);
const pzaiAssistantSource = readFileSync(
  new URL("../src/modules/p-zai/PzaiAssistantPanel.tsx", import.meta.url),
  "utf8",
);
const rssArticleSource = readFileSync(
  new URL("../src/modules/rss/ArticleList.tsx", import.meta.url),
  "utf8",
);
const builtinSource = readFileSync(
  new URL("../src/plugin/builtin.ts", import.meta.url),
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

// Basic provider failures are rejected before transport, failed agent runs are
// never persisted as assistant replies, and broken generated titles are ignored.
assert.match(storeSource, /selectedProvider\?\.requiresApiKey/);
assert.match(storeSource, /builtInCredentials\.some/);
assert.match(storeSource, /if \(result\.failed\)\s*\{\s*throw new Error\(result\.finalAnswer\)/);
assert.match(conversationTitleSource, /\[\\p\{L\}\\p\{N\}\]\/u/);
assert.match(conversationTitleSource, /title\.includes\("\\uFFFD"\)/);
assert.match(agentSource, /failed:\s*true/);
assert.match(errorPresentationSource, /missing-api-key/);
assert.match(errorPresentationSource, /first === fallback/);
assert.match(errorPresentationSource, /removeLegacySyntheticErrorMessages/);
assert.match(errorPresentationSource, /text === message\.content\.trim\(\)/);

// Context assistants project the durable QxAI session port instead of owning a
// second chat runtime. P仔 is opened from RSS article Actions, injects the open
// article as system context, writes edits through narrow tools, and has no
// standalone builtin panel entry.
assert.match(storeSource, /options\?: \{ background\?: boolean; name\?: string; systemPrompt\?: string \}/);
assert.match(storeSource, /options\?\.systemPrompt\?\.trim\(\) \|\| defaultSystemPrompt/);
assert.match(rssArticleSource, /id: "ask-pzai"/);
assert.match(rssArticleSource, /<PzaiAssistantPanel/);
assert.match(pzaiAssistantSource, /background: true/);
assert.match(pzaiAssistantSource, /systemPrompt: buildArticleSystemPrompt\(article\)/);
assert.match(pzaiAssistantSource, /pzai_set_summary/);
assert.match(pzaiAssistantSource, /pzai_set_draft/);
assert.match(pzaiAssistantSource, /messageQueue\.filter/);
const pzaiBuiltinStart = builtinSource.indexOf('id: "p-zai"');
const pzaiBuiltinEnd = builtinSource.indexOf("\n  },", pzaiBuiltinStart);
const pzaiBuiltinEntry = pzaiBuiltinStart >= 0 && pzaiBuiltinEnd > pzaiBuiltinStart
  ? builtinSource.slice(pzaiBuiltinStart, pzaiBuiltinEnd)
  : "";
assert.ok(pzaiBuiltinEntry, "P仔 builtin metadata must remain registered for capability gating");
assert.doesNotMatch(pzaiBuiltinEntry, /panel:\s*\{/);

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
assert.match(messageSource, /function StepRow[\s\S]*?useState\(false\)/);
assert.match(messageSource, /className="qx-jan-step-header"/);
assert.match(messageSource, /aria-expanded=\{open\}/);
assert.match(messageSource, /defaultOpen=\{false\}/);
assert.doesNotMatch(messageSource, /defaultOpen=\{step\.state === "running"\}/);

// Native reasoning is recorded as an ordered Agent step for every model turn.
// It must be appended before that turn's tool action and updated in place,
// rather than rendered through one global reasoning block that moves as tools arrive.
assert.match(agentSource, /createOrderedReasoningRecorder/);
assert.match(agentSource, /steps\.push\(reasoningStep\)/);
assert.match(agentSource, /onStepUpdate\(reasoningStep\.id, \{ text \}\)/);
assert.match(
  agentSource,
  /createOrderedReasoningRecorder\(steps, (opts|runOpts)\)[\s\S]*?streamFunctionCallingOnce[\s\S]*?const toolCalls/,
);
assert.doesNotMatch(agentSource, /reasoning:\s*message\.reasoning_content/);

// Hermes harness: frozen memory snapshot + dream consolidator.
assert.match(agentSource, /loadMemorySnapshot/);
assert.match(agentSource, /qxai_memory_dream/);
assert.match(agentSource, /session_search/);
assert.match(storeSource, /memorySnapshot/);

// Module Action port: discover + run stable module/plugin actions (RSS refresh, P仔, plugins).
const moduleActionsSource = readFileSync(
  new URL("../src/modules/qx-ai/agent/module-actions.ts", import.meta.url),
  "utf8",
);
assert.match(agentSource, /name:\s*"list_module_actions"/);
assert.match(agentSource, /name:\s*"run_module_action"/);
assert.match(agentSource, /name:\s*"rss_refresh_all"/);
assert.match(moduleActionsSource, /rss\.refresh_all/);
assert.match(moduleActionsSource, /registerPluginModuleActions/);
assert.match(moduleActionsSource, /listModuleActions/);

// Skill-driven capability port: modules + plugins + skill frontmatter capabilities.
const capabilitiesSource = readFileSync(
  new URL("../src/modules/qx-ai/agent/capabilities.ts", import.meta.url),
  "utf8",
);
const skillsSourceGate = readFileSync(
  new URL("../src/modules/qx-ai/skills.ts", import.meta.url),
  "utf8",
);
assert.match(agentSource, /name:\s*"list_qx_capabilities"/);
assert.match(agentSource, /name:\s*"run_qx_capability"/);
assert.match(agentSource, /name:\s*"list_plugins"/);
assert.match(agentSource, /name:\s*"run_plugin_command"/);
assert.match(capabilitiesSource, /parseSkillCapabilities/);
assert.match(capabilitiesSource, /buildSkillCapabilityPromptBlock/);
assert.match(capabilitiesSource, /command:\$\{/);
assert.match(skillsSourceGate, /withSkillCapabilityBinding/);
assert.match(skillsSourceGate, /buildSkillCapabilityPromptBlock/);

// Isolation: App must not statically import the AI store/agent graph; schedule
// bridge starts deferred; sendMessage loads harness dynamically.
const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const scheduleBridgeSource = readFileSync(
  new URL("../src/modules/qx-ai/schedule-bridge.ts", import.meta.url),
  "utf8",
);
const storeIsolationSource = readFileSync(
  new URL("../src/modules/qx-ai/store.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(appSource, /from ["']\.\/modules\/qx-ai\/schedule-bridge["']/);
assert.match(appSource, /startQxAiScheduleBridgeDeferred/);
assert.match(scheduleBridgeSource, /startQxAiScheduleBridgeDeferred/);
assert.match(scheduleBridgeSource, /import\(["']\.\/store["']\)/);
assert.match(storeIsolationSource, /loadAgentHarness|import\(["']\.\/agent["']\)/);
assert.match(storeIsolationSource, /import type \{ AgentStep/);

// Agent hooks: pre/post/error/tool lifecycle wired into both loops.
const hooksSource = readFileSync(
  new URL("../src/modules/qx-ai/agent/hooks.ts", import.meta.url),
  "utf8",
);
const functionLoopSource = readFileSync(
  new URL("../src/modules/qx-ai/agent/function-loop.ts", import.meta.url),
  "utf8",
);
const reactLoopSource = readFileSync(
  new URL("../src/modules/qx-ai/agent/react-loop.ts", import.meta.url),
  "utf8",
);
assert.match(hooksSource, /before_turn/);
assert.match(hooksSource, /after_turn/);
assert.match(hooksSource, /before_tool/);
assert.match(hooksSource, /after_tool/);
assert.match(hooksSource, /on_error/);
assert.match(hooksSource, /registerQxAiHooks/);
assert.match(hooksSource, /builtin:host-context/);
assert.match(hooksSource, /builtin:dangerous-tools-guard/);
assert.match(hooksSource, /solo_mode/);
assert.match(hooksSource, /dangerous_tools_guard_enabled/);
assert.match(hooksSource, /evaluateSafetyGate/);
assert.match(hooksSource, /confirmSafetyGate/);
const dangerousToolsSource = readFileSync(
  new URL("../src/modules/qx-ai/agent/dangerous-tools.ts", import.meta.url),
  "utf8",
);
assert.match(dangerousToolsSource, /BASH_COMMAND_BLACKLIST/);
assert.match(dangerousToolsSource, /BASH_SAFE_COMMANDS/);
assert.match(dangerousToolsSource, /classifyBashScript/);
assert.match(dangerousToolsSource, /evaluateSafetyGate/);
assert.match(dangerousToolsSource, /resolveDangerousToolCall/);
assert.match(dangerousToolsSource, /rm\s+\\?-rf|rm -rf|recursive force delete/);
// bash must not be a whole-tool hard block in the catalogue array
{
  const start = dangerousToolsSource.indexOf("export const DANGEROUS_TOOLS");
  const end = dangerousToolsSource.indexOf("export const BASH_COMMAND_BLACKLIST", start);
  const catalogue = start >= 0 && end > start
    ? dangerousToolsSource.slice(start, end)
    : "";
  assert.ok(
    catalogue && !/name:\s*"bash"/.test(catalogue),
    "bash must be content-gated, not listed as a blanket DANGEROUS_TOOLS entry",
  );
}
const settingsStoreSource = readFileSync(
  new URL("../src/modules/settings/store.ts", import.meta.url),
  "utf8",
);
assert.match(settingsStoreSource, /dangerous_tools_guard_enabled:\s*true/);
assert.match(settingsStoreSource, /solo_mode:\s*false/);
const agentSettingsUi = readFileSync(
  new URL("../src/modules/settings/AgentSettings.tsx", import.meta.url),
  "utf8",
);
assert.match(agentSettingsUi, /agent\.safety\.solo/);
assert.match(agentSettingsUi, /dangerous_tools_guard_enabled/);
assert.match(functionLoopSource, /runBeforeTurnHooks/);
assert.match(functionLoopSource, /runAfterTurnHooks/);
assert.match(functionLoopSource, /executeToolWithHooks/);
assert.match(reactLoopSource, /runBeforeTurnHooks/);
assert.match(reactLoopSource, /executeToolWithHooks/);
assert.match(agentSource, /name:\s*"list_agent_hooks"/);
assert.match(storeIsolationSource, /userMessage:\s*content/);

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
assert.match(chatSource, /className="qx-jan-composer-actions"/);
assert.match(qxAiCssSource, /\.qx-jan-composer-actions\s*\{[\s\S]*?margin-left:\s*auto/);
assert.match(qxAiCssSource, /\.qx-jan-message-actions \.qx-shadcn-button\s*\{[\s\S]*?box-shadow:\s*none/);
assert.match(qxAiCssSource, /\.qx-jan-message-action-btns\s*\{[\s\S]*?opacity:\s*0/);

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
