#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const storeSource = readFileSync(
  new URL("../src/modules/qx-ai/store.ts", import.meta.url),
  "utf8",
);
const agentSource = [
  "../src/modules/qx-ai/react-agent.ts",
  "../src/modules/qx-ai/agent/index.ts",
  "../src/modules/qx-ai/agent/tools.ts",
  "../src/modules/qx-ai/agent/tools-files.ts",
  "../src/modules/qx-ai/agent/tools-host-management.ts",
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
const memoryBackendSource = [
  "../src-tauri/src/qx_ai_memory.rs",
  "../src-tauri/src/qx_ai_memory/consolidation.rs",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
const memoryExtractorSource = readFileSync(
  new URL("../src-tauri/src/qx_ai_memory/extraction.rs", import.meta.url),
  "utf8",
);
const messageSource = readFileSync(
  new URL("../src/modules/qx-ai/message-rendering.tsx", import.meta.url),
  "utf8",
);
const reasoningTimeSource = readFileSync(
  new URL("../src/modules/qx-ai/ReasoningElapsedTime.tsx", import.meta.url),
  "utf8",
);
const aiFilesBackendSource = readFileSync(
  new URL("../src-tauri/src/qx_ai_files.rs", import.meta.url),
  "utf8",
);
const messageVariantsSource = readFileSync(
  new URL("../src/modules/qx-ai/message-variants.ts", import.meta.url),
  "utf8",
);
const messageActionsSource = readFileSync(
  new URL("../src/modules/qx-ai/message-actions.tsx", import.meta.url),
  "utf8",
);
const qxAiChatSource = readFileSync(
  new URL("../src/modules/qx-ai/QxAiChat.tsx", import.meta.url),
  "utf8",
);
const sessionBackendSource = readFileSync(
  new URL("../src-tauri/src/qx_ai_sessions.rs", import.meta.url),
  "utf8",
);
const conversationModelSource = readFileSync(
  new URL("../src/modules/qx-ai/conversation-model.ts", import.meta.url),
  "utf8",
);
const agentSettingsSource = readFileSync(
  new URL("../src/modules/settings/AgentSettings.tsx", import.meta.url),
  "utf8",
);
const memorySettingsSource = readFileSync(
  new URL("../src/modules/qx-ai/MemorySection.tsx", import.meta.url),
  "utf8",
);
const contractsSource = readFileSync(
  new URL("../src/modules/qx-ai/contracts.ts", import.meta.url),
  "utf8",
);
const markdownSource = readFileSync(
  new URL("../src/modules/qx-ai/MarkdownRenderer.tsx", import.meta.url),
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
const toolRunnerSource = readFileSync(
  new URL("../src/modules/qx-ai/agent/tool-runner.ts", import.meta.url),
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
const hostManagementSource = readFileSync(
  new URL("../src/modules/qx-ai/agent/host-management.ts", import.meta.url),
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
for (const toolName of ["file_info", "list_directory", "glob_files", "read_file", "write_file", "edit_file"]) {
  assert.match(agentSource, new RegExp(`name:\\s*"${toolName}"`));
}
assert.match(aiFilesBackendSource, /MAX_TEXT_BYTES/);
assert.match(aiFilesBackendSource, /expectedRevision from read_file/);
assert.match(aiFilesBackendSource, /oldText must match exactly once/);
assert.match(aiFilesBackendSource, /crate::runtime::blocking/);
assert.match(agentSource, /clipboard_write_file_paths/);
assert.match(storeSource, /attachments:\s*result\.attachments/);
assert.match(messageSource, /qx-ai-attachments/);
for (const settingId of [
  "plugins.background.wallpaper.enabled",
  "general.auto_update.enabled",
  "appearance.floating_island.enabled",
  "rss.background_refresh.enabled",
  "agent.background_tasks.enabled",
  "agent.host_actions.enabled",
]) {
  assert.match(hostManagementSource, new RegExp(settingId.replaceAll(".", "\\.")));
}
assert.match(hostManagementSource, /await store\.flush\(\)/);
assert.match(hostManagementSource, /invoke<Settings>\("update_settings"/);
assert.doesNotMatch(hostManagementSource, /window\.(?:localStorage|sessionStorage)/);
assert.match(messageSource, /function StepRow[\s\S]*?useDisclosureState\(false, disclosureKey\)/);
assert.match(messageSource, /className="qx-jan-step-header"/);
assert.match(messageSource, /aria-expanded=\{open\}/);
assert.match(messageSource, /defaultOpen=\{false\}/);
assert.doesNotMatch(messageSource, /defaultOpen=\{step\.state === "running"\}/);
assert.match(messageSource, /function latestActivityLine/);
assert.match(messageSource, /function isJsonStructureOnly/);
assert.match(messageSource, /Array\.isArray\(parsed\) \|\| parsed === null/);
assert.match(messageSource, /!isJsonStructureOnly\(line\)/);
assert.match(messageSource, /function ToolCallGroupPanel/);
assert.match(messageSource, /className="qx-ai-reasoning-summary"/);
assert.match(messageSource, /className="qx-ai-tool-activity"/);
assert.match(messageSource, /output=\{step\.output\}/);
assert.match(messageSource, /const hasOutput = output !== undefined/);
assert.match(messageSource, /qxai\.tool\.noOutput/);
assert.match(messageSource, /function useDisclosureState/);
assert.match(messageSource, /DISCLOSURE_UNMOUNT_DELAY_MS = 300/);
assert.doesNotMatch(messageSource, /if \(isStreaming\) setOpen\(true\)/);
assert.match(qxAiCssSource, /\.qx-ai-reasoning-summary,[\s\S]*?white-space:\s*nowrap/);
assert.match(qxAiCssSource, /\.qx-ai-activity-roll-line\.is-entering/);
assert.match(qxAiCssSource, /\.qx-ai-tool-group-body/);
assert.match(qxAiCssSource, /\.qx-ai-disclosure-content\s*\{[\s\S]*?grid-template-rows:\s*0fr/);
assert.match(qxAiCssSource, /\.qx-ai-disclosure-content\.is-open\s*\{[\s\S]*?grid-template-rows:\s*1fr/);
assert.match(qxAiCssSource, /prefers-reduced-motion[\s\S]*?qx-ai-activity-roll-line\.is-leaving/);
assert.match(qxAiCssSource, /\.qx-jan-cot\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent/);
assert.match(qxAiCssSource, /prefers-reduced-motion[\s\S]*?qx-ai-reasoning-status\.is-shimmer/);
assert.match(messageSource, /reasoningStartedAt=\{reasoningStartedAt\}/);
assert.match(reasoningTimeSource, /now - startedAt/);
assert.match(reasoningTimeSource, /window\.setTimeout\(tick/);
assert.doesNotMatch(reasoningTimeSource, /setInterval/);
assert.match(reasoningTimeSource, /qx-ai-flip-digit-old/);
assert.match(reasoningTimeSource, /formatReasoningClock/);
assert.match(qxAiCssSource, /@keyframes qx-ai-flip-digit-in/);
assert.match(qxAiCssSource, /@keyframes qx-ai-flip-digit-out/);
assert.doesNotMatch(messageSource, /<span className="qx-jan-shimmer">/);
assert.match(messageActionsSource, /useLocale\(\)/);
assert.match(messageActionsSource, /new Intl\.DateTimeFormat\(locale/);
assert.match(messageActionsSource, /dateStyle: "short"/);
assert.doesNotMatch(messageActionsSource, /toLocaleString\(undefined/);
assert.match(qxAiCssSource, /\.qx-jan-message-actions\.is-user\s*\{[\s\S]*?justify-content:\s*flex-end/);
assert.match(qxAiCssSource, /\.qx-jan-message-actions\s*\{[\s\S]*?justify-content:\s*flex-start/);

// Model selection has three ownership levels: settings are only the default for
// new chats, each conversation owns its next-turn selection, and every completed
// assistant message/variant freezes the provider/model that actually generated it.
assert.match(storeSource, /withMessageModelSnapshots\(repairedConversation\)/);
assert.match(conversationModelSource, /function withMessageModelSnapshots/);
assert.match(storeSource, /provider: selection\.provider,[\s\S]*?model: selection\.model,[\s\S]*?role: "assistant"|role: "assistant",[\s\S]*?provider: selection\.provider,[\s\S]*?model: selection\.model/);
assert.match(messageVariantsSource, /provider: message\.provider/);
assert.match(messageVariantsSource, /model: message\.model/);
assert.match(qxAiChatSource, /msg\.provider \|\| conv\?\.provider/);
assert.match(qxAiChatSource, /msg\.model \|\| conv\?\.model/);
assert.match(sessionBackendSource, /object\.remove\("provider"\)/);
assert.match(sessionBackendSource, /object\.remove\("model"\)/);

// Model settings stay focused on providers/default selection. Memory belongs
// with tool controls, and selected-model capabilities are not duplicated below
// the already annotated model label.
{
  const modelsStart = agentSettingsSource.indexOf('{section === "agent-models"');
  const toolsStart = agentSettingsSource.indexOf('{section === "tools-safety"');
  const memoryStart = agentSettingsSource.indexOf("<MemorySection />");
  assert.ok(modelsStart >= 0 && toolsStart > modelsStart);
  assert.ok(memoryStart > toolsStart, "memory management must live under Tools & Safety");
  assert.doesNotMatch(
    agentSettingsSource.slice(modelsStart, toolsStart),
    /<MemorySection\s*\/>/,
  );
}
assert.doesNotMatch(agentSettingsSource, /qx-agent-model-meta/);
assert.match(memorySettingsSource, /useT\(\)/);
assert.match(memorySettingsSource, /useLocale\(\)/);
assert.match(memorySettingsSource, /new Intl\.DateTimeFormat\(locale/);
assert.match(qxAiCssSource, /\.qx-ai-memory-list\s*\{[\s\S]*?max-height:/);

// Tool completion must update both the live streaming projection and the
// durable steps returned with the finished assistant message. Otherwise the
// completed message restores stale `running` actions and their spinners.
assert.match(
  toolRunnerSource,
  /function updateActionStep[\s\S]*?Object\.assign\(actionStep, patch\)[\s\S]*?opts\.onStepUpdate\(actionStep\.id, patch\)/,
);
assert.match(
  toolRunnerSource,
  /updateActionStep\(actionStep, opts, \{ state: "completed", output: observation \}\)/,
);

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

// Selective memory: policy-driven, empty candidates allowed, original source
// rows preserved, and only core records stay resident in the prompt.
assert.match(agentSource, /loadMemorySnapshot/);
assert.match(agentSource, /qxai_memory_dream/);
assert.match(agentSource, /session_search/);
assert.match(storeSource, /memorySnapshot/);
assert.match(settingsSource, /memory_policy:\s*"smart"/);
assert.match(storeSource, /memory_policy === "smart"/);
assert.doesNotMatch(storeSource, /toolCallCount\s*>=|steps\.length\s*>=/);
assert.match(memoryExtractorSource, /empty candidates array/);
assert.match(memoryBackendSource, /list_active_core/);
assert.match(memoryBackendSource, /source: format!\("dream\.\{mode\}"\)/);
assert.doesNotMatch(memoryBackendSource, /fn rewrite_hot_set/);

// Execute the real cache adapter with deferred IPC: an old snapshot must never
// repopulate cache after a write, or while compression completes.
{
  const calls = [];
  const exported = {};
  const source = readFileSync(new URL("../src/modules/qx-ai/agent/memory.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, {
    exports: exported,
    require: () => ({ invoke: (command, input) => new Promise((resolve, reject) => {
      calls.push({ command, input, resolve, reject });
    }) }),
  });
  const oldRead = exported.loadMemorySnapshot();
  exported.invalidateMemorySnapshot();
  calls.shift().resolve("old");
  assert.equal(await oldRead, "old"); // that turn keeps its frozen snapshot
  const nextRead = exported.loadMemorySnapshot();
  assert.equal(calls.length, 1, "invalidated in-flight reads cannot refill cache");
  calls.shift().resolve("current");
  assert.equal(await nextRead, "current");
  assert.equal(await exported.loadMemorySnapshot(), "current");
  assert.equal(calls.length, 0);

  const compression = exported.runMemoryDream(undefined, "compress");
  const operation = calls.shift();
  assert.equal(operation.command, "qxai_memory_dream");
  assert.equal(operation.input.mode, "compress");
  const duringRead = exported.loadMemorySnapshot();
  calls.shift().resolve("before compression");
  await duringRead;
  operation.resolve({ savedChars: 5 });
  await compression;
  const afterRead = exported.loadMemorySnapshot();
  assert.equal(calls.length, 1, "completion invalidates snapshots read during compression");
  calls.shift().resolve("after compression");
  assert.equal(await afterRead, "after compression");

  const mutation = exported.mutateMemory({ action: "add" });
  calls.shift().resolve({ success: true });
  await mutation;
  const afterWrite = exported.loadMemorySnapshot();
  assert.equal(calls.length, 1, "tool writes invalidate the snapshot");
  calls.shift().resolve("after write");
  await afterWrite;
  const failure = exported.runMemoryDream(undefined, "compress");
  calls.shift().reject(new Error("provider unavailable"));
  await assert.rejects(failure, /provider unavailable/);

  const frozen = { provider: "turn-provider", model: "turn-model", scope: "A" };
  const first = exported.runMemoryDream("one", "smart", frozen, "one");
  const firstCall = calls.shift();
  const second = exported.runMemoryDream("two", "smart", frozen, "two");
  frozen.model = "changed";
  assert.equal(calls.length, 0, "busy extraction queues rather than dropping a later turn");
  firstCall.reject(new Error("first failed"));
  await assert.rejects(first, /first failed/);
  await Promise.resolve();
  const secondCall = calls.shift();
  assert.equal(secondCall.input.context.model, "turn-model");
  secondCall.resolve({ candidateCount: 0 });
  await second;
  const scopeA = exported.loadMemorySnapshot(false, "A");
  calls.shift().resolve("scope A");
  await scopeA;
  const scopeB = exported.loadMemorySnapshot(false, "B");
  assert.equal(calls.length, 1, "scope A cannot satisfy scope B's snapshot");
  calls.shift().resolve("scope B");
  assert.equal(await scopeB, "scope B");
  assert.equal(await exported.loadMemorySnapshot(false, "A"), "scope A");
}

// Real turn scheduler: Unicode batches, frozen routing, successful-prefix cursor,
// explicit retry, and no-op completion. No model calls or user database access.
{
  const calls = [], errors = [], exported = {};
  const source = readFileSync(new URL("../src/modules/qx-ai/turn-memory.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, { exports: exported, require: (id) => {
    if (id.endsWith("/island")) return { islandHost: { dismiss() {}, show: (value) => errors.push(value) } };
    if (id.endsWith("/i18n")) return { resolveLocale: () => "en", translate: (_locale, _key, fallback) => fallback };
    if (id.endsWith("/store")) return { useSettingsStore: { getState: () => ({ settings: {
      general: { language: "en" }, agent: { memory_tool_enabled: true, memory_policy: "smart" },
    } }) } };
    return { runMemoryDream: (...args) => new Promise((resolve, reject) => calls.push({ args, resolve, reject })) };
  } });
  const user = "中文🙂".repeat(2500);
  const batches = exported.memoryBatches(user, "done");
  assert.equal(batches.join(""), `user: ${user}\nassistant: done`);
  assert.ok(batches.every((batch) => Array.from(batch).length <= 6000));
  const context = { provider: "old", model: "old-model", conversationId: "chat", scope: "Qx" };
  exported.scheduleTurnMemory({ user, assistant: "done", context, turnKey: "turn", name: "Test" });
  context.model = "new-model";
  calls.shift().resolve({ candidateCount: 0 });
  await new Promise(setImmediate);
  const failed = calls.shift();
  assert.equal(failed.args[2].model, "old-model");
  failed.reject(new Error("offline"));
  await new Promise(setImmediate);
  assert.equal(exported.failedMemoryCount(), 1);
  assert.equal(errors[0].priority, "error");
  const retry = exported.retryFailedMemories();
  const retried = calls.shift();
  assert.equal(retried.args[3], failed.args[3], "retry resumes the failed batch, not successful prefix");
  retried.resolve({ candidateCount: 0 });
  await retry;
  assert.equal(exported.failedMemoryCount(), 0);
}

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
assert.match(agentSource, /name:\s*"list_qx_settings"/);
assert.match(agentSource, /name:\s*"set_qx_setting"/);
assert.match(agentSource, /name:\s*"set_plugin_enabled"/);
assert.match(agentSource, /name:\s*"uninstall_plugin"/);
assert.match(capabilitiesSource, /parseSkillCapabilities/);
assert.match(capabilitiesSource, /buildSkillCapabilityPromptBlock/);
assert.match(capabilitiesSource, /command:\$\{/);
assert.match(capabilitiesSource, /getDangerousTool\(name\)/);
assert.match(skillsSourceGate, /withSkillCapabilityBinding/);
assert.match(skillsSourceGate, /buildSkillCapabilityPromptBlock/);
assert.match(hostManagementSource, /plugins\.background\.wallpaper\.enabled/);
assert.match(hostManagementSource, /registerQxSettingAdapter/);
assert.match(hostManagementSource, /setBackgroundCategoryEnabled\("wallpaper"/);
assert.match(hostManagementSource, /usePluginRegistry\.getState\(\)\.setEnabled/);
assert.match(hostManagementSource, /usePluginRegistry\.getState\(\)\.uninstall/);
assert.doesNotMatch(hostManagementSource, /window\.localStorage|sessionStorage/);

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
assert.match(storeIsolationSource, /import type \{[\s\S]*?AgentStep[\s\S]*?\} from "\.\/contracts"/);

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
assert.match(dangerousToolsSource, /name:\s*"set_qx_setting"/);
assert.match(dangerousToolsSource, /name:\s*"set_plugin_enabled"/);
assert.match(dangerousToolsSource, /name:\s*"uninstall_plugin"[\s\S]*?level:\s*"high"/);
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

// Regeneration keeps durable assistant alternatives, restores the original
// transcript on failure, and sends only the active variant to the model.
assert.match(contractsSource, /variants\?: QxAiAssistantVariant\[\]/);
assert.match(messageVariantsSource, /function assistantWithRegeneratedVariant/);
assert.match(messageVariantsSource, /function withoutAssistantVariants/);
assert.match(storeSource, /regenerationBackup:\s*\{/);
assert.match(storeSource, /messages:\s*conversation\.regenerationBackup\.messages/);
assert.match(storeSource, /\.map\(withoutAssistantVariants\)/);
assert.match(storeSource, /selectMessageVariant:/);
assert.match(chatSource, /variantCount=\{msg\.variants\?\.length \?\? 0\}/);
assert.match(chatSource, /onPreviousVariant=/);
assert.match(chatSource, /onNextVariant=/);
assert.match(qxAiCssSource, /\.qx-ai-message-branches\s*\{/);

// Thinking and tool activity stay dense: latest-wins rolling summaries,
// semantic tool categories, grouped consecutive calls, and compact affordances.
assert.match(messageSource, /function getToolCategory/);
assert.match(messageSource, /function ActivitySummary/);
assert.match(messageSource, /function ToolCallGroupPanel/);
assert.match(qxAiCssSource, /\.qx-ai-activity-roll\s*\{/);
assert.match(qxAiCssSource, /prefers-reduced-motion:\s*reduce/);
assert.match(qxAiCssSource, /\.qx-jan-chevron\s*\{[\s\S]*?opacity:\s*0/);
assert.match(qxAiCssSource, /\.qx-ai-message-queue-actions\s*\{[\s\S]*?opacity:\s*0/);
assert.match(markdownSource, /<WrapText/);
assert.match(markdownSource, /qx-md-codeblock-action/);
assert.match(qxAiCssSource, /\.qx-md-codeblock-body\s*\{[\s\S]*?max-height:/);

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
