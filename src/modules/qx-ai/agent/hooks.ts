/**
 * QxAI Agent Hooks — pre / post / error + tool lifecycle.
 *
 * Phases:
 * - before_turn  前置：改 prompt、注入上下文、取消本轮
 * - after_turn   后置：润色 finalAnswer、旁路统计（不可阻塞用户答案失败）
 * - on_error     错误：模型/工具失败时的补偿或文案
 * - before_tool  工具前：改写参数、拦截危险调用
 * - after_tool   工具后：改写 observation、补全结果
 *
 * Isolation: hooks run inside the agent turn only; failures of individual hooks
 * are swallowed (logged) unless the hook sets `cancel` on before_turn.
 * Built-in hooks seed once; plugins register via context.ai.hooks or host API.
 */

import { getQxDesktopPlatform } from "../../../utils/keyboard";
import { useSettingsStore } from "../../settings/store";
import {
  confirmSafetyGate,
  evaluateSafetyGate,
  formatDangerousToolsBlock,
} from "./dangerous-tools";
import type { AgentStep } from "./types";

export type QxAiHookPhase =
  | "before_turn"
  | "after_turn"
  | "on_error"
  | "before_tool"
  | "after_tool";

export interface QxAiHookPatch {
  basePrompt?: string;
  /** Appended to system / base prompt (before_turn). */
  systemAppend?: string;
  toolInput?: unknown;
  toolObservation?: string;
  finalAnswer?: string;
  /** before_turn only: abort the agent turn with this message. */
  cancel?: boolean;
  cancelReason?: string;
}

export interface QxAiHookContext {
  phase: QxAiHookPhase;
  conversationId?: string;
  provider: string;
  model: string;
  userMessage?: string;
  basePrompt: string;
  memorySnapshot?: string;
  toolName?: string;
  toolInput?: unknown;
  toolObservation?: string;
  finalAnswer?: string;
  error?: string;
  steps?: AgentStep[];
  /** Mutable result of the current phase pipeline. */
  patch: QxAiHookPatch;
}

export interface QxAiHook {
  id: string;
  /** One phase or several (same handler). */
  phase: QxAiHookPhase | QxAiHookPhase[];
  /**
   * Sort key. before_* / on_error: lower first.
   * after_* : higher first (LIFO-style post-processing).
   */
  priority?: number;
  owner?: string;
  enabled?: () => boolean;
  run: (ctx: QxAiHookContext) => void | QxAiHookPatch | Promise<void | QxAiHookPatch>;
}

/** Plugin registration (command-backed; no iframe callback). */
export interface PluginQxAiHookRegistration {
  id: string;
  phase: QxAiHookPhase | QxAiHookPhase[];
  priority?: number;
  /** Plugin command name to dispatch when the phase fires. */
  command?: string;
}

const registry = new Map<string, QxAiHook>();
let builtinsSeeded = false;

function phasesOf(hook: QxAiHook): QxAiHookPhase[] {
  return Array.isArray(hook.phase) ? hook.phase : [hook.phase];
}

function sortHooks(phase: QxAiHookPhase, hooks: QxAiHook[]): QxAiHook[] {
  const after = phase === "after_turn" || phase === "after_tool";
  return [...hooks].sort((a, b) => {
    const pa = a.priority ?? 100;
    const pb = b.priority ?? 100;
    return after ? pb - pa : pa - pb;
  });
}

export function registerQxAiHooks(hooks: QxAiHook[]): () => void {
  ensureBuiltinQxAiHooks();
  const ids: string[] = [];
  for (const hook of hooks) {
    const id = hook.id.trim();
    if (!id) continue;
    registry.set(id, { ...hook, id });
    ids.push(id);
  }
  return () => {
    for (const id of ids) registry.delete(id);
  };
}

export function unregisterQxAiHooksByOwner(owner: string): void {
  for (const [id, hook] of [...registry.entries()]) {
    if ((hook.owner ?? "") === owner) registry.delete(id);
  }
}

export function listQxAiHooks(phase?: QxAiHookPhase): Array<{
  id: string;
  phase: QxAiHookPhase[];
  priority: number;
  owner?: string;
}> {
  ensureBuiltinQxAiHooks();
  const out: Array<{
    id: string;
    phase: QxAiHookPhase[];
    priority: number;
    owner?: string;
  }> = [];
  for (const hook of registry.values()) {
    const phases = phasesOf(hook);
    if (phase && !phases.includes(phase)) continue;
    out.push({
      id: hook.id,
      phase: phases,
      priority: hook.priority ?? 100,
      owner: hook.owner,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

function mergePatch(target: QxAiHookPatch, incoming: QxAiHookPatch | void): void {
  if (!incoming) return;
  if (typeof incoming.basePrompt === "string") target.basePrompt = incoming.basePrompt;
  if (typeof incoming.systemAppend === "string") {
    target.systemAppend = [target.systemAppend, incoming.systemAppend]
      .filter(Boolean)
      .join("\n\n");
  }
  if (incoming.toolInput !== undefined) target.toolInput = incoming.toolInput;
  if (typeof incoming.toolObservation === "string") {
    target.toolObservation = incoming.toolObservation;
  }
  if (typeof incoming.finalAnswer === "string") target.finalAnswer = incoming.finalAnswer;
  if (incoming.cancel === true) {
    target.cancel = true;
    if (incoming.cancelReason) target.cancelReason = incoming.cancelReason;
  }
}

/**
 * Run all hooks for a phase. Returns accumulated patch.
 * Individual hook errors are logged and skipped (never fail the turn).
 */
export async function runQxAiHooks(
  phase: QxAiHookPhase,
  seed: Omit<QxAiHookContext, "phase" | "patch"> & { patch?: QxAiHookPatch },
): Promise<QxAiHookPatch> {
  ensureBuiltinQxAiHooks();
  const patch: QxAiHookPatch = { ...(seed.patch ?? {}) };
  const hooks = sortHooks(
    phase,
    [...registry.values()].filter((hook) => {
      if (!phasesOf(hook).includes(phase)) return false;
      try {
        return hook.enabled ? hook.enabled() : true;
      } catch {
        return false;
      }
    }),
  );

  for (const hook of hooks) {
    const ctx: QxAiHookContext = {
      ...seed,
      phase,
      patch: { ...patch },
      basePrompt: patch.basePrompt ?? seed.basePrompt,
    };
    try {
      const result = await hook.run(ctx);
      mergePatch(patch, result);
      mergePatch(patch, ctx.patch);
      if (phase === "before_turn" && patch.cancel) break;
    } catch (error) {
      console.error(`qxai hook "${hook.id}" (${phase}) failed`, error);
    }
  }
  return patch;
}

export function applyBasePromptPatch(basePrompt: string, patch: QxAiHookPatch): string {
  let next = typeof patch.basePrompt === "string" ? patch.basePrompt : basePrompt;
  if (patch.systemAppend?.trim()) {
    next = `${next.trim()}\n\n${patch.systemAppend.trim()}`;
  }
  return next;
}

/** Register plugin hooks that dispatch launcher commands (no JS callback across iframe). */
export function registerPluginQxAiHooks(
  pluginId: string,
  hooks: PluginQxAiHookRegistration[],
  options: {
    runCommand?: (commandName: string, phase: QxAiHookPhase, meta: Record<string, unknown>) => Promise<void>;
  } = {},
): void {
  const owner = `plugin:${pluginId}`;
  unregisterQxAiHooksByOwner(owner);
  const specs: QxAiHook[] = [];
  for (const raw of hooks) {
    const localId = String(raw.id || "").trim();
    if (!localId) continue;
    const command = raw.command?.trim();
    if (!command || !options.runCommand) continue;
    const phases = Array.isArray(raw.phase) ? raw.phase : [raw.phase];
    specs.push({
      id: `plugin:${pluginId}:hook:${localId}`,
      phase: phases,
      priority: raw.priority ?? 100,
      owner,
      run: async (ctx) => {
        await options.runCommand?.(command, ctx.phase, {
          conversationId: ctx.conversationId,
          provider: ctx.provider,
          model: ctx.model,
          toolName: ctx.toolName,
          userMessage: ctx.userMessage?.slice(0, 500),
        });
      },
    });
  }
  registerQxAiHooks(specs);
}

/** Built-in hooks that raise baseline agent quality without plugins. */
export function ensureBuiltinQxAiHooks(): void {
  if (builtinsSeeded) return;
  builtinsSeeded = true;

  registerQxAiHooks([
    {
      id: "builtin:host-context",
      phase: "before_turn",
      priority: 10,
      owner: "builtin",
      run: () => {
        const now = new Date();
        const platform = getQxDesktopPlatform();
        const agent = useSettingsStore.getState().settings.agent;
        const guardOn = agent.dangerous_tools_guard_enabled !== false;
        const solo = agent.solo_mode === true;
        const safetyLines =
          !guardOn
            ? [
                "- Dangerous-tools guard is OFF (user disabled). High-impact tools are not auto-gated.",
              ]
            : solo
              ? [
                  "- SOLO mode is ON: writes, schedules, plugin commands, and non-blacklisted bash run without prompts.",
                  "- Blacklisted shell patterns (e.g. rm -rf, mkfs, pipe-to-shell) still apply only when the guard is on and SOLO is off; with SOLO they are not auto-blocked.",
                  "- Still prefer the least-destructive tool that solves the request.",
                ]
              : [
                  "- Dangerous-tools guard is ON (default).",
                  "- bash is content-gated: safe/read-only (ps, ls, git status, …) auto-allow; blacklist (rm -rf, mkfs, …) hard-deny; other shell asks the user once.",
                  "- Writes and other high-impact tools ask the user once (not blanket-blocked). SOLO skips prompts.",
                  `- Classified tools:\n${formatDangerousToolsBlock()}`,
                  "- If denied or the user declines, explain and offer a safer alternative or SOLO for trusted tasks.",
                ];
        return {
          systemAppend: [
            "## Host session context (hook: builtin:host-context)",
            `- Local time: ${now.toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone || "local"})`,
            `- Platform: ${platform}`,
            "- Prefer live Qx tools/capabilities over inventing host state.",
            "## Safety",
            ...safetyLines,
          ].join("\n"),
        };
      },
    },
    {
      id: "builtin:dangerous-tools-guard",
      phase: "before_tool",
      priority: 5,
      owner: "builtin",
      run: (ctx) => {
        const agent = useSettingsStore.getState().settings.agent;
        // User can turn the whole recognition/gate off.
        if (agent.dangerous_tools_guard_enabled === false) return;
        // SOLO mode: autonomous — do not prompt or block.
        if (agent.solo_mode === true) return;

        const decision = evaluateSafetyGate(ctx.toolName, ctx.toolInput);
        if (!decision || decision.action === "allow") return;

        if (decision.action === "deny") {
          return {
            cancel: true,
            cancelReason: [
              `Blocked "${decision.name}" [${decision.level}]: ${decision.reason}.`,
              "This pattern is on the safety blacklist and cannot run while the guard is on.",
              "Use a safer command, or have the user disable the Dangerous tools guard / enable SOLO only if they fully trust the task.",
            ].join(" "),
          };
        }

        // ask: one-shot user confirmation (not a blanket tool ban)
        if (confirmSafetyGate(decision)) return;

        return {
          cancel: true,
          cancelReason: [
            `User declined "${decision.name}" [${decision.level}]: ${decision.reason}.`,
            "Do not retry the same call without a safer alternative or explicit user approval (SOLO / confirm).",
          ].join(" "),
        };
      },
    },
    {
      id: "builtin:tool-input-normalize",
      phase: "before_tool",
      priority: 20,
      owner: "builtin",
      run: (ctx) => {
        if (
          ctx.toolName !== "run_qx_capability"
          && ctx.toolName !== "run_module_action"
        ) {
          return;
        }
        const input =
          ctx.toolInput && typeof ctx.toolInput === "object" && !Array.isArray(ctx.toolInput)
            ? { ...(ctx.toolInput as Record<string, unknown>) }
            : {};
        const id =
          typeof input.id === "string"
            ? input.id
            : typeof input.action === "string"
              ? input.action
              : "";
        if (!id.trim()) return;
        // Normalize action: / command: prefixes users or models sometimes emit.
        let normalized = id.trim();
        if (normalized.startsWith("action:")) normalized = normalized.slice("action:".length);
        if (input.id !== normalized) {
          return { toolInput: { ...input, id: normalized } };
        }
      },
    },
    {
      id: "builtin:error-friendly",
      phase: "on_error",
      priority: 50,
      owner: "builtin",
      run: (ctx) => {
        const err = (ctx.error || "").trim();
        if (!err) return;
        // Provider/configuration failures already contain their recovery path.
        // Appending tool-discovery advice makes a basic setup error noisy and
        // misleading (and used to be duplicated into the assistant message).
        if (/api key|provider|model|unauthorized|forbidden|network|timed?\s*out/i.test(err)) {
          return { finalAnswer: err };
        }
        // Keep model error text; append recovery hint once.
        if (err.includes("list_qx_capabilities") || err.includes("SOLO mode")) return;
        return {
          finalAnswer: [
            err,
            "",
            "Hint: use list_qx_capabilities / list_module_actions to discover available host ports, or list_plugins for marketplace commands. Dangerous tools may be blocked until SOLO mode is enabled in Settings → AI Agent.",
          ].join("\n"),
        };
      },
    },
  ]);
}
