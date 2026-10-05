import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function load(file, dependencies = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../src/modules/qx-ai/${file}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  runInNewContext(compiled, { exports, require: (name) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${file}: ${name}`);
    return dependencies[name];
  }, Date, Math, Set, Promise });
  return exports;
}
const interaction = load("interaction");
const types = load("agent/types");
const { INTERACTION_TOOLS } = load("agent/tools-interaction", { "../interaction": interaction });
const questionInput = { questions: [{ question: "Which apps?", options: [{ label: "All", recommended: true }, { label: "Games" }] }] };
assert.throws(() => interaction.parseQuestionRequest({ questions: [] }));
assert.throws(() => interaction.parseQuestionRequest({ questions: [{ question: "?", options: [{ label: "Same" }, { label: "Same" }] }] }));
assert.throws(() => interaction.parseQuestionRequest({ questions: [{ question: "x".repeat(501), options: questionInput.questions[0].options }] }));
assert.throws(() => interaction.parseSuggestions({ suggestions: Array(4).fill({ label: "Next", prompt: "go" }) }));
assert.throws(() => interaction.parseSuggestions({ suggestions: [{ label: "A", prompt: "same" }, { label: "B", prompt: "same" }] }));
assert.throws(() => interaction.formatQuestionAnswers(interaction.parseQuestionRequest(questionInput), [[]]));
assert.equal(interaction.formatQuestionAnswers(interaction.parseQuestionRequest(questionInput), [["自己的回答"]]), "Which apps?\n自己的回答");
assert.equal(interaction.questionFromSteps([{ kind: "action", state: "completed", question: { questions: [] } }]), undefined);

const hooks = { ensureBuiltinQxAiHooks() {}, applyBasePromptPatch: (prompt) => prompt, runQxAiHooks: async () => ({}) };
const runner = load("agent/tool-runner", { "./hooks": hooks, "./types": types, "../interaction": interaction });
const updates = [];
const baseOptions = { messages: [{ role: "user", content: "inspect apps" }], basePrompt: "", provider: "fixture", model: "fixture", reasoning: false,
  agentSettings: { agent_max_iterations: 3 }, onStep() {}, onStepUpdate: (id, patch) => updates.push({ id, patch }),
  onAssistantStream() {}, onReasoningStream() {} };
for (const alias of ["ask_user_question", "AskYourQuestion", "AskUserQuestion"]) {
  const steps = [];
  await runner.executeToolWithHooks(baseOptions, INTERACTION_TOOLS, alias, questionInput, JSON.stringify(questionInput), steps, []);
  assert.equal(steps[0].state, "completed");
  assert.equal(interaction.questionFromSteps(steps).questions[0].question, "Which apps?");
  assert.equal(interaction.questionFromSteps(JSON.parse(JSON.stringify(steps))).questions[0].question, "Which apps?");
  assert.equal(updates.at(-1).patch.question.questions.length, 1);
}
const tools = { getEnabledTools: () => INTERACTION_TOOLS, toolsToOpenAISchema: () => [] };
let requests = 0, sideEffects = 0;
tools.getEnabledTools = () => [...INTERACTION_TOOLS, { name: "bash", run: async () => { sideEffects++; return "must not execute"; } }];
const dependencies = { "../interaction": interaction, "./types": types, "./hooks": hooks, "./tool-runner": runner, "./tools": tools,
  "./prompts": { buildQxHostSystemPrompt: (p) => p, buildReactSystemPrompt: (p) => p } };
const native = load("agent/function-loop", { ...dependencies, "./stream": {
  createOrderedReasoningRecorder: () => ({ update() {}, complete() {} }),
  streamFunctionCallingOnce: async () => { requests++; return { content: "", tool_calls: [
    { id: "side", function: { name: "bash", arguments: "{}" } },
    { id: "invalid", function: { name: "ask_user_question", arguments: "{}" } },
    { id: "question", function: { name: "AskYourQuestion", arguments: JSON.stringify(questionInput) } },
  ] }; },
} });
const paused = await native.runFunctionCallingAgent(baseOptions);
assert.equal(paused.awaitingUserInput, true);
assert.equal(paused.finalAnswer, "Which apps?\n- All\n- Games");
assert.equal(requests, 1); assert.equal(sideEffects, 0);
assert.equal(paused.steps.find((step) => step.question).state, "completed");
const react = load("agent/react-loop", { ...dependencies, "./parse": load("agent/parse"), "./stream": {
  streamOnce: async () => { requests++; return `Action: AskUserQuestion\nAction Input: ${JSON.stringify(questionInput)}`; },
} });
assert.equal((await react.runReactAgent(baseOptions)).awaitingUserInput, true);
assert.equal(requests, 2);
const suggestions = [{ label: "Check versions", prompt: "Check installed app versions", recommended: true }];
let round = 0;
const recommendationRun = load("agent/function-loop", { ...dependencies, "./stream": {
  createOrderedReasoningRecorder: () => ({ update() {}, complete() {} }),
  streamFunctionCallingOnce: async () => round++ === 0 ? { content: "", tool_calls: [
    { id: "suggest", function: { name: "suggest_next_actions", arguments: JSON.stringify({ suggestions }) } },
  ] } : { content: "Done" },
} });
const result = await recommendationRun.runFunctionCallingAgent(baseOptions);
assert.equal(result.finalAnswer, "Done"); assert.equal(result.awaitingUserInput, undefined);
assert.equal(interaction.suggestionsFromSteps(result.steps)[0].prompt, suggestions[0].prompt);
assert.equal(sideEffects, 0);
console.log("QxAI interactions: bounded input, aliases, durable data, native/ReAct pause, sibling isolation and suggestions passed");
