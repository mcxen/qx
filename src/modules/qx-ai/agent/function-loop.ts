import type { G4fMessage } from "../store";
import { ensureBuiltinQxAiHooks } from "./hooks";
import { buildQxHostSystemPrompt } from "./prompts";
import { createOrderedReasoningRecorder, streamFunctionCallingOnce } from "./stream";
import {
  executeToolWithHooks,
  runAfterTurnHooks,
  runBeforeTurnHooks,
  runTurnErrorHooks,
} from "./tool-runner";
import { getEnabledTools, toolsToOpenAISchema } from "./tools";
import {
  compactMessages,
  nextStepId,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentStep,
  type QxAiFileAttachment,
} from "./types";

function messageContentToOpenAI(content: G4fMessage["content"]): unknown {
  if (typeof content === "string") return content;
  return content;
}

/**
 * Execute independent tool calls in parallel when there are 2+ calls.
 * Sequential when only one (common path) to keep step ordering simple.
 */
async function runToolCalls(
  enabled: ReturnType<typeof getEnabledTools>,
  toolCalls: Array<{ id: string; function?: { name?: string; arguments?: string } }>,
  steps: AgentStep[],
  opts: AgentRunOptions,
  attachments: QxAiFileAttachment[],
): Promise<Array<{ callId: string; name: string; observation: string }>> {
  const jobs = toolCalls.map(async (call) => {
    const name = call.function?.name ?? "";
    const rawArgs = call.function?.arguments ?? "{}";
    let parsedArgs: unknown = rawArgs;
    try {
      parsedArgs = JSON.parse(rawArgs);
    } catch {
      // pass raw string
    }
    const observation = await executeToolWithHooks(
      opts,
      enabled,
      name,
      parsedArgs,
      rawArgs,
      steps,
      attachments,
    );
    return { callId: call.id, name, observation };
  });

  // Parallel execution for multi-tool turns (harness speed path).
  return Promise.all(jobs);
}

export async function runFunctionCallingAgent(
  opts: AgentRunOptions,
): Promise<AgentRunResult> {
  ensureBuiltinQxAiHooks();
  const before = await runBeforeTurnHooks(opts);
  if (before.cancel) {
    const text =
      before.cancelReason?.trim()
      || "This turn was cancelled by a before_turn hook.";
    const steps: AgentStep[] = [
      {
        id: nextStepId(),
        kind: "error",
        text,
        state: "error",
      },
    ];
    opts.onStep(steps[0]);
    return { finalAnswer: text, steps, attachments: [], failed: true };
  }

  const runOpts: AgentRunOptions = { ...opts, basePrompt: before.basePrompt };
  const enabled = getEnabledTools(runOpts.agentSettings);
  const tools = toolsToOpenAISchema(enabled);

  const working: Array<Record<string, unknown>> = [];
  let systemPrompt = buildQxHostSystemPrompt(runOpts.basePrompt);
  if (runOpts.memorySnapshot?.trim()) {
    systemPrompt = systemPrompt
      ? `${systemPrompt}\n\n${runOpts.memorySnapshot.trim()}`
      : runOpts.memorySnapshot.trim();
  }
  // Compact tool catalog for prefix cache / speed (only tools that passed
  // agent switches + module availability gates).
  if (enabled.length > 0) {
    const catalog = enabled.map((t) => t.name).join(", ");
    const memoryHint = enabled.some((t) => t.name === "memory" || t.name.startsWith("memory_"))
      ? " Use memory tools to persist durable facts when appropriate."
      : "";
    systemPrompt = `${systemPrompt}\n\nAvailable tools: ${catalog}. Prefer tools when they reduce guesswork.${memoryHint} Only call tools from this list — do not assume disabled or uninstalled module capabilities exist.`;
  }
  if (systemPrompt) {
    working.push({ role: "system", content: systemPrompt });
  }
  for (const m of runOpts.messages) {
    if (m.role === "system" && working.length > 0 && working[0].role === "system") {
      working[0] = {
        role: "system",
        content: `${working[0].content as string}\n${
          typeof m.content === "string" ? m.content : JSON.stringify(m.content)
        }`,
      };
      continue;
    }
    working.push({
      role: m.role,
      content: messageContentToOpenAI(m.content),
      ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    });
  }

  const steps: AgentStep[] = [];
  const attachments: QxAiFileAttachment[] = [];
  const maxIterations = runOpts.maxIterations ?? runOpts.agentSettings.agent_max_iterations ?? 12;
  let lastFinal = "";

  for (let i = 0; i < maxIterations; i++) {
    let message: Awaited<ReturnType<typeof streamFunctionCallingOnce>>;
    const reasoning = createOrderedReasoningRecorder(steps, runOpts);
    try {
      message = await streamFunctionCallingOnce(
        runOpts,
        compactMessages(working as Array<{ role: string }>) as Array<Record<string, unknown>>,
        tools,
        reasoning.update,
      );
      reasoning.complete();
    } catch (err) {
      reasoning.complete();
      const raw = err instanceof Error ? err.message : String(err);
      const text = await runTurnErrorHooks(runOpts, raw, steps);
      const errStep: AgentStep = {
        id: nextStepId(),
        kind: "error",
        text,
        state: "error",
      };
      steps.push(errStep);
      runOpts.onStep(errStep);
      return { finalAnswer: text, steps, attachments, failed: true };
    }

    const toolCalls = message.tool_calls ?? [];

    if (toolCalls.length === 0) {
      const finalText = message.content?.trim() ?? "";
      lastFinal = finalText;
      const finalStep: AgentStep = {
        id: nextStepId(),
        kind: "final",
        text: finalText,
        state: "completed",
      };
      steps.push(finalStep);
      runOpts.onStep(finalStep);
      const finalAnswer = await runAfterTurnHooks(runOpts, {
        finalAnswer: finalText,
        steps,
      });
      return {
        finalAnswer,
        steps,
        attachments,
      };
    }

    working.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: toolCalls,
      ...(message.reasoning_content
        ? { reasoning_content: message.reasoning_content }
        : {}),
      ...(message.reasoning_details
        ? { reasoning_details: message.reasoning_details }
        : {}),
    });

    const results = await runToolCalls(enabled, toolCalls, steps, runOpts, attachments);
    for (const result of results) {
      working.push({
        role: "tool",
        tool_call_id: result.callId,
        content: result.observation,
      });
    }
  }

  const recoveryMessages: Array<Record<string, unknown>> = [
    ...compactMessages(working as Array<{ role: string }>) as Array<Record<string, unknown>>,
    {
      role: "user",
      content:
        "You have reached the maximum number of steps. Review the observations above and provide your final answer to the user's request. Respond with text only, no more tool calls.",
    },
  ];

  const recoveryReasoning = createOrderedReasoningRecorder(steps, runOpts);
  try {
    const recoveryMessage = await streamFunctionCallingOnce(
      runOpts,
      recoveryMessages,
      [],
      recoveryReasoning.update,
    );
    recoveryReasoning.complete();
    const finalText = (recoveryMessage.content?.trim() ?? lastFinal).trim();
    const finalStep: AgentStep = {
      id: nextStepId(),
      kind: "final",
      text: finalText,
      state: "completed",
    };
    steps.push(finalStep);
    runOpts.onStep(finalStep);
    const finalAnswer = await runAfterTurnHooks(runOpts, {
      finalAnswer: finalText,
      steps,
    });
    return {
      finalAnswer,
      steps,
      attachments,
    };
  } catch {
    recoveryReasoning.complete();
  }

  const errText = await runTurnErrorHooks(
    runOpts,
    "Function calling agent hit iteration limit without producing a final answer.",
    steps,
  );
  const errStep: AgentStep = {
    id: nextStepId(),
    kind: "error",
    text: errText,
    state: "error",
  };
  steps.push(errStep);
  runOpts.onStep(errStep);
  return { finalAnswer: lastFinal || errText, steps, attachments, failed: true };
}
