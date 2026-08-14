/**
 * Shared tool execution with before_tool / after_tool hooks.
 */
import {
  applyBasePromptPatch,
  runQxAiHooks,
  type QxAiHookPatch,
} from "./hooks";
import {
  appendAttachments,
  nextStepId,
  normalizeToolResult,
  type AgentRunOptions,
  type AgentStep,
  type QxAiFileAttachment,
  type ToolSpec,
} from "./types";

export type EnabledTools = ToolSpec[];

export async function executeToolWithHooks(
  opts: AgentRunOptions,
  enabled: EnabledTools,
  name: string,
  rawInput: unknown,
  rawInputText: string,
  steps: AgentStep[],
  attachments: QxAiFileAttachment[],
): Promise<string> {
  let toolInput = rawInput;

  const before = await runQxAiHooks("before_tool", {
    conversationId: opts.conversationId,
    provider: opts.provider,
    model: opts.model,
    userMessage: opts.userMessage,
    basePrompt: opts.basePrompt,
    memorySnapshot: opts.memorySnapshot,
    toolName: name,
    toolInput,
    steps,
  });

  if (before.cancel) {
    const observation =
      before.cancelReason?.trim()
      || `Tool "${name}" blocked by a before_tool hook.`;
    pushAction(steps, opts, name, rawInputText, observation, "error");
    pushObservation(steps, opts, name, observation);
    return observation;
  }
  if (before.toolInput !== undefined) toolInput = before.toolInput;

  const actionStep: AgentStep = {
    id: nextStepId(),
    kind: "action",
    tool: name,
    input:
      typeof toolInput === "string"
        ? toolInput
        : (() => {
            try {
              return JSON.stringify(toolInput);
            } catch {
              return rawInputText;
            }
          })(),
    state: "running",
  };
  steps.push(actionStep);
  opts.onStep(actionStep);

  const tool = enabled.find((t) => t.name === name);
  let observation: string;
  if (!tool) {
    observation = `Error: tool "${name}" is not available. Enabled: ${
      enabled.map((t) => t.name).join(", ") || "(none)"
    }.`;
    updateActionStep(actionStep, opts, { state: "error", output: observation });
  } else {
    try {
      const result = normalizeToolResult(await tool.run(toolInput));
      observation = result.observation;
      appendAttachments(attachments, result.attachments);
      updateActionStep(actionStep, opts, { state: "completed", output: observation });
    } catch (err) {
      observation = `Error: ${err instanceof Error ? err.message : String(err)}`;
      updateActionStep(actionStep, opts, { state: "error", output: observation });
      const errPatch = await runQxAiHooks("on_error", {
        conversationId: opts.conversationId,
        provider: opts.provider,
        model: opts.model,
        userMessage: opts.userMessage,
        basePrompt: opts.basePrompt,
        memorySnapshot: opts.memorySnapshot,
        toolName: name,
        toolInput,
        error: observation,
        steps,
      });
      if (errPatch.toolObservation) observation = errPatch.toolObservation;
      if (errPatch.finalAnswer) {
        // Keep tool observation; turn-level final is handled by loop.
      }
    }
  }

  const after = await runQxAiHooks("after_tool", {
    conversationId: opts.conversationId,
    provider: opts.provider,
    model: opts.model,
    userMessage: opts.userMessage,
    basePrompt: opts.basePrompt,
    memorySnapshot: opts.memorySnapshot,
    toolName: name,
    toolInput,
    toolObservation: observation,
    steps,
  });
  if (typeof after.toolObservation === "string") {
    observation = after.toolObservation;
  }

  pushObservation(steps, opts, name, observation);
  return observation;
}

function updateActionStep(
  actionStep: AgentStep,
  opts: AgentRunOptions,
  patch: Partial<AgentStep>,
) {
  // Keep the durable Agent result aligned with the live store projection.
  // The completed message replaces streamingSteps with this same steps array.
  Object.assign(actionStep, patch);
  opts.onStepUpdate(actionStep.id, patch);
}

function pushAction(
  steps: AgentStep[],
  opts: AgentRunOptions,
  name: string,
  input: string,
  output: string,
  state: AgentStep["state"],
) {
  const actionStep: AgentStep = {
    id: nextStepId(),
    kind: "action",
    tool: name,
    input,
    output,
    state,
  };
  steps.push(actionStep);
  opts.onStep(actionStep);
  opts.onStepUpdate(actionStep.id, { state, output });
}

function pushObservation(
  steps: AgentStep[],
  opts: AgentRunOptions,
  name: string,
  observation: string,
) {
  const obsStep: AgentStep = {
    id: nextStepId(),
    kind: "observation",
    tool: name,
    output: observation,
    state: "completed",
  };
  steps.push(obsStep);
  opts.onStep(obsStep);
}

/** Shared before_turn: returns updated basePrompt or a cancel result. */
export async function runBeforeTurnHooks(
  opts: AgentRunOptions,
): Promise<{ basePrompt: string; cancel?: boolean; cancelReason?: string; patch: QxAiHookPatch }> {
  const patch = await runQxAiHooks("before_turn", {
    conversationId: opts.conversationId,
    provider: opts.provider,
    model: opts.model,
    userMessage: opts.userMessage,
    basePrompt: opts.basePrompt,
    memorySnapshot: opts.memorySnapshot,
  });
  return {
    basePrompt: applyBasePromptPatch(opts.basePrompt, patch),
    cancel: patch.cancel,
    cancelReason: patch.cancelReason,
    patch,
  };
}

export async function runAfterTurnHooks(
  opts: AgentRunOptions,
  result: { finalAnswer: string; steps: AgentStep[] },
): Promise<string> {
  const patch = await runQxAiHooks("after_turn", {
    conversationId: opts.conversationId,
    provider: opts.provider,
    model: opts.model,
    userMessage: opts.userMessage,
    basePrompt: opts.basePrompt,
    memorySnapshot: opts.memorySnapshot,
    finalAnswer: result.finalAnswer,
    steps: result.steps,
  });
  return typeof patch.finalAnswer === "string" ? patch.finalAnswer : result.finalAnswer;
}

export async function runTurnErrorHooks(
  opts: AgentRunOptions,
  error: string,
  steps: AgentStep[],
): Promise<string> {
  const patch = await runQxAiHooks("on_error", {
    conversationId: opts.conversationId,
    provider: opts.provider,
    model: opts.model,
    userMessage: opts.userMessage,
    basePrompt: opts.basePrompt,
    memorySnapshot: opts.memorySnapshot,
    error,
    steps,
  });
  return typeof patch.finalAnswer === "string" ? patch.finalAnswer : error;
}
