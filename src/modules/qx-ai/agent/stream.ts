import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { G4fMessage } from "../store";
import type { AgentRunOptions, AgentStep, AgentStreamMetrics } from "./types";
import { nextStepId } from "./types";

interface StreamEvent {
  requestId: string;
  chunk: string;
  done: boolean;
  error?: string;
  tokenCount?: number;
  promptTokenCount?: number;
  totalTokenCount?: number;
  durationMs?: number;
  tokenSpeed?: number;
}

export async function streamOnce(
  messages: G4fMessage[],
  provider: string,
  model: string,
  onChunk: (text: string) => void,
  onMetrics?: (metrics: AgentStreamMetrics) => void,
): Promise<string> {
  const requestId = `qxai-agent-${Math.random().toString(36).slice(2, 10)}`;
  let acc = "";

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | undefined;
    const finish = (err: Error | null, value: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      try {
        unlisten?.();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve(value);
    };
    const timeout = window.setTimeout(
      () => finish(new Error("AI stream timed out"), ""),
      180_000,
    );

    // Throttle UI updates so long streams do not re-render on every chunk.
    const THROTTLE_MS = 48;
    let lastFlush = 0;
    let flushTimer: number | undefined;
    const flush = () => {
      window.clearTimeout(flushTimer);
      flushTimer = undefined;
      lastFlush = Date.now();
      if (!settled) onChunk(acc);
    };
    const scheduleFlush = () => {
      if (flushTimer !== undefined) return;
      const now = Date.now();
      const delay = Math.max(0, THROTTLE_MS - (now - lastFlush));
      flushTimer = window.setTimeout(flush, delay);
    };

    listen<StreamEvent>("qxai-stream", (event) => {
      if (event.payload.requestId !== requestId) return;
      if (event.payload.error) {
        finish(new Error(event.payload.error), "");
        return;
      }
      if (event.payload.done) {
        if (event.payload.chunk && !acc) acc = event.payload.chunk;
        flush();
        onMetrics?.({
          tokenCount: event.payload.tokenCount,
          promptTokenCount: event.payload.promptTokenCount,
          totalTokenCount: event.payload.totalTokenCount,
          durationMs: event.payload.durationMs,
          tokenSpeed: event.payload.tokenSpeed,
        });
        finish(null, acc || event.payload.chunk);
        return;
      }
      acc += event.payload.chunk;
      if (Date.now() - lastFlush >= THROTTLE_MS) {
        flush();
      } else {
        scheduleFlush();
      }
    })
      .then((un) => {
        if (settled) {
          try {
            un();
          } catch {
            // ignore
          }
          return;
        }
        unlisten = un;
        return invoke("qxai_stream_chat_events", {
          requestId,
          provider,
          model,
          messages,
        });
      })
      .catch((err) => finish(err instanceof Error ? err : new Error(String(err)), ""));
  });
}

export interface OpenAIToolCall {
  id: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  reasoning_content?: string;
  reasoning_details?: unknown[];
}

interface FunctionStreamEvent {
  requestId: string;
  kind: "text" | "reasoning" | "done";
  chunk: string;
  done: boolean;
  message?: OpenAIMessage;
  error?: string;
  tokenCount?: number;
  promptTokenCount?: number;
  totalTokenCount?: number;
  durationMs?: number;
  tokenSpeed?: number;
}

function assertNamedToolCalls(message: OpenAIMessage, transport: string): OpenAIMessage {
  for (const [index, call] of (message.tool_calls ?? []).entries()) {
    if (!call.function?.name?.trim()) {
      throw new Error(`${transport} returned tool call ${index + 1} without a function name`);
    }
  }
  return message;
}

export async function streamFunctionCallingOnce(
  opts: AgentRunOptions,
  messages: Array<Record<string, unknown>>,
  tools: Array<Record<string, unknown>>,
  onReasoningStream: (text: string) => void = opts.onReasoningStream,
): Promise<OpenAIMessage> {
  const requestId = `qxai-tools-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
  let content = "";
  let reasoning = "";
  let unlisten: (() => void) | undefined;
  let settled = false;
  let timeout: number | undefined;
  let flushTimer: number | undefined;
  let lastFlushAt = 0;

  // Bound React updates for providers that stream tool-call text in very small
  // deltas. The full strings remain lossless; only the render cadence changes.
  const flush = () => {
    if (flushTimer !== undefined) {
      window.clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    lastFlushAt = Date.now();
    if (!settled) {
      if (opts.onStreamUpdate) {
        opts.onStreamUpdate(content, reasoning);
        if (reasoning) onReasoningStream(reasoning);
      } else {
        if (content) opts.onAssistantStream(content);
        if (reasoning) onReasoningStream(reasoning);
      }
    }
  };
  const scheduleFlush = () => {
    if (flushTimer !== undefined) return;
    const delay = Math.max(0, 48 - (Date.now() - lastFlushAt));
    flushTimer = window.setTimeout(flush, delay);
  };

  const stop = () => {
    if (settled) return false;
    settled = true;
    if (timeout !== undefined) window.clearTimeout(timeout);
    if (flushTimer !== undefined) window.clearTimeout(flushTimer);
    try {
      unlisten?.();
    } catch {
      // ignore listener cleanup failures
    }
    return true;
  };

  const streamPromise = new Promise<OpenAIMessage>((resolve, reject) => {
    timeout = window.setTimeout(() => {
      if (stop()) reject(new Error("AI stream timed out"));
    }, 180_000);

    listen<FunctionStreamEvent>("qxai-stream", (event) => {
      if (event.payload.requestId !== requestId) return;
      if (event.payload.error) {
        if (stop()) reject(new Error(event.payload.error));
        return;
      }
      if (event.payload.done) {
        flush();
        opts.onStreamMetrics?.({
          tokenCount: event.payload.tokenCount,
          promptTokenCount: event.payload.promptTokenCount,
          totalTokenCount: event.payload.totalTokenCount,
          durationMs: event.payload.durationMs,
          tokenSpeed: event.payload.tokenSpeed,
        });
        if (stop()) {
          resolve(event.payload.message ?? {
            role: "assistant",
            content: content || null,
            reasoning_content: reasoning || undefined,
          });
        }
        return;
      }
      if (event.payload.kind === "reasoning") {
        reasoning += event.payload.chunk;
      } else {
        content += event.payload.chunk;
      }
      scheduleFlush();
    })
      .then((un) => {
        if (settled) {
          un();
          return;
        }
        unlisten = un;
        return invoke("qxai_stream_chat_with_tools_events", {
          requestId,
          provider: opts.provider,
          model: opts.model,
          messages,
          tools,
          toolChoice: "auto",
          reasoning: opts.reasoning,
        });
      })
      .catch((error) => {
        if (stop()) reject(error instanceof Error ? error : new Error(String(error)));
      });
  });

  try {
    return assertNamedToolCalls(await streamPromise, "Streaming provider");
  } catch (streamError) {
    try {
      const message = assertNamedToolCalls(await invoke<OpenAIMessage>("qxai_chat_with_tools", {
        provider: opts.provider,
        model: opts.model,
        messages,
        tools,
        toolChoice: tools.length > 0 ? "auto" : "none",
      }), "Compatibility provider");
      if (opts.onStreamUpdate) {
        opts.onStreamUpdate(message.content ?? "", message.reasoning_content ?? "");
        if (message.reasoning_content) onReasoningStream(message.reasoning_content);
      } else {
        if (message.reasoning_content) onReasoningStream(message.reasoning_content);
        if (message.content) opts.onAssistantStream(message.content);
      }
      return message;
    } catch (fallbackError) {
      const streamMessage =
        streamError instanceof Error ? streamError.message : String(streamError);
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(
        `Streaming tool call failed: ${streamMessage}; compatibility fallback failed: ${fallbackMessage}`,
      );
    }
  }
}

export function createOrderedReasoningRecorder(steps: AgentStep[], opts: AgentRunOptions) {
  let reasoningStep: AgentStep | undefined;
  return {
    update(text: string) {
      if (!text) return;
      if (!reasoningStep) {
        reasoningStep = {
          id: nextStepId(),
          kind: "thought",
          text,
          state: "running",
        };
        steps.push(reasoningStep);
        opts.onStep(reasoningStep);
        return;
      }
      reasoningStep.text = text;
      opts.onStepUpdate(reasoningStep.id, { text });
    },
    complete() {
      if (!reasoningStep) return;
      reasoningStep.state = "completed";
      opts.onStepUpdate(reasoningStep.id, { state: "completed" });
    },
  };
}
