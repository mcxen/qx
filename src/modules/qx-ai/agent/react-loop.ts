import type { G4fMessage } from "../store";
import { ensureBuiltinQxAiHooks } from "./hooks";
import { parseAgentResponse } from "./parse";
import { buildReactSystemPrompt } from "./prompts";
import { streamOnce } from "./stream";
import {
  executeToolWithHooks,
  runAfterTurnHooks,
  runBeforeTurnHooks,
  runTurnErrorHooks,
} from "./tool-runner";
import { getEnabledTools } from "./tools";
import {
  compactMessages,
  nextStepId,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentStep,
  type QxAiFileAttachment,
} from "./types";

export async function runReactAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
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
    return { finalAnswer: text, steps, attachments: [] };
  }

  const runOpts: AgentRunOptions = { ...opts, basePrompt: before.basePrompt };
  const enabled = getEnabledTools(runOpts.agentSettings);
  let systemPrompt = buildReactSystemPrompt(runOpts.basePrompt, enabled);
  if (runOpts.memorySnapshot?.trim()) {
    systemPrompt = `${systemPrompt}\n\n${runOpts.memorySnapshot.trim()}`;
  }

  const working: G4fMessage[] = runOpts.messages.map((m) => ({ ...m }));
  if (working.length > 0 && working[0].role === "system") {
    working[0] = { role: "system", content: systemPrompt };
  } else {
    working.unshift({ role: "system", content: systemPrompt });
  }

  const steps: AgentStep[] = [];
  const attachments: QxAiFileAttachment[] = [];
  const maxIterations = runOpts.maxIterations ?? runOpts.agentSettings.agent_max_iterations ?? 12;
  let lastRaw = "";
  let scratchpad = "";

  for (let i = 0; i < maxIterations; i++) {
    const messagesForTurn: G4fMessage[] = compactMessages(
      scratchpad
        ? [
            ...working,
            { role: "assistant", content: scratchpad.trim() },
            {
              role: "user",
              content:
                "Continue. If you have enough information, respond with `Final Answer: ...`. Otherwise emit the next `Thought / Action / Action Input`.",
            },
          ]
        : working,
    );

    try {
      lastRaw = await streamOnce(
        messagesForTurn,
        runOpts.provider,
        runOpts.model,
        (partial) =>
          runOpts.onAssistantStream(scratchpad ? `${scratchpad}\n${partial}` : partial),
        runOpts.onStreamMetrics,
      );
    } catch (err) {
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
      return { finalAnswer: text, steps, attachments };
    }

    const parsed = parseAgentResponse(lastRaw);

    if (parsed.thought) {
      const thoughtStep: AgentStep = {
        id: nextStepId(),
        kind: "thought",
        text: parsed.thought,
        state: "completed",
      };
      steps.push(thoughtStep);
      runOpts.onStep(thoughtStep);
    }

    if (parsed.kind === "final") {
      const finalText = parsed.finalAnswer ?? "";
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

    if (parsed.kind === "action" && parsed.tool) {
      let parsedInput: unknown = parsed.input;
      try {
        parsedInput = JSON.parse(parsed.input ?? "{}");
      } catch {
        parsedInput = parsed.input;
      }
      const observation = await executeToolWithHooks(
        runOpts,
        enabled,
        parsed.tool,
        parsedInput,
        parsed.input ?? "",
        steps,
        attachments,
      );
      scratchpad += `${lastRaw.trim()}\nObservation: ${observation}\n`;
      continue;
    }

    // Model produced free-form text without Final Answer — treat as final.
    const finalText = lastRaw.trim();
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
    return { finalAnswer, steps, attachments };
  }

  const truncatedFinal =
    lastRaw.trim()
    || "I reached the iteration limit before producing a Final Answer. Please narrow the request or raise the Agent max-steps setting.";
  const finalAnswer = await runAfterTurnHooks(runOpts, {
    finalAnswer: truncatedFinal,
    steps,
  });
  return {
    finalAnswer,
    steps,
    attachments,
  };
}
