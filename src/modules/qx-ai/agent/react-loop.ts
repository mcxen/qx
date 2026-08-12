import type { G4fMessage } from "../store";
import { parseAgentResponse } from "./parse";
import { buildReactSystemPrompt } from "./prompts";
import { streamOnce } from "./stream";
import { getEnabledTools } from "./tools";
import {
  appendAttachments,
  compactMessages,
  nextStepId,
  normalizeToolResult,
  type AgentRunOptions,
  type AgentRunResult,
  type AgentStep,
  type QxAiFileAttachment,
} from "./types";

export async function runReactAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const enabled = getEnabledTools(opts.agentSettings);
  let systemPrompt = buildReactSystemPrompt(opts.basePrompt, enabled);
  if (opts.memorySnapshot?.trim()) {
    systemPrompt = `${systemPrompt}\n\n${opts.memorySnapshot.trim()}`;
  }

  const working: G4fMessage[] = opts.messages.map((m) => ({ ...m }));
  if (working.length > 0 && working[0].role === "system") {
    working[0] = { role: "system", content: systemPrompt };
  } else {
    working.unshift({ role: "system", content: systemPrompt });
  }

  const steps: AgentStep[] = [];
  const attachments: QxAiFileAttachment[] = [];
  const maxIterations = opts.maxIterations ?? opts.agentSettings.agent_max_iterations ?? 12;
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

    lastRaw = await streamOnce(
      messagesForTurn,
      opts.provider,
      opts.model,
      (partial) => opts.onAssistantStream(scratchpad ? `${scratchpad}\n${partial}` : partial),
    );

    const parsed = parseAgentResponse(lastRaw);

    if (parsed.thought) {
      const thoughtStep: AgentStep = {
        id: nextStepId(),
        kind: "thought",
        text: parsed.thought,
        state: "completed",
      };
      steps.push(thoughtStep);
      opts.onStep(thoughtStep);
    }

    if (parsed.kind === "final") {
      const finalStep: AgentStep = {
        id: nextStepId(),
        kind: "final",
        text: parsed.finalAnswer ?? "",
        state: "completed",
      };
      steps.push(finalStep);
      opts.onStep(finalStep);
      return {
        finalAnswer: parsed.finalAnswer ?? "",
        steps,
        attachments,
      };
    }

    if (parsed.kind === "action" && parsed.tool) {
      const tool = enabled.find((t) => t.name === parsed.tool);
      const actionStep: AgentStep = {
        id: nextStepId(),
        kind: "action",
        tool: parsed.tool,
        input: parsed.input,
        state: "running",
      };
      steps.push(actionStep);
      opts.onStep(actionStep);

      let observation: string;
      if (!tool) {
        observation = `Error: unknown tool "${parsed.tool}". Available: ${
          enabled.map((t) => t.name).join(", ") || "(none)"
        }.`;
        opts.onStepUpdate(actionStep.id, { state: "error", output: observation });
      } else {
        try {
          const result = normalizeToolResult(await tool.run(parsed.input));
          observation = result.observation;
          appendAttachments(attachments, result.attachments);
          opts.onStepUpdate(actionStep.id, { state: "completed", output: observation });
        } catch (err) {
          observation = `Error: ${err instanceof Error ? err.message : String(err)}`;
          opts.onStepUpdate(actionStep.id, { state: "error", output: observation });
        }
      }

      const obsStep: AgentStep = {
        id: nextStepId(),
        kind: "observation",
        tool: parsed.tool,
        output: observation,
        state: "completed",
      };
      steps.push(obsStep);
      opts.onStep(obsStep);

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
    opts.onStep(finalStep);
    return { finalAnswer: finalText, steps, attachments };
  }

  const truncatedFinal =
    lastRaw.trim()
    || "I reached the iteration limit before producing a Final Answer. Please narrow the request or raise the Agent max-steps setting.";
  return {
    finalAnswer: truncatedFinal,
    steps,
    attachments,
  };
}
