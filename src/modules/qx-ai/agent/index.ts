/**
 * QxAI agent harness — modular runtime (tools / memory / loops / stream).
 * Public surface mirrors the former react-agent.ts monolith.
 */

export type {
  AgentRunOptions,
  AgentRunResult,
  AgentStep,
  QxAiFileAttachment,
  ToolExecutionResult,
  ToolSpec,
} from "./types";

export {
  appendAttachments,
  asRecord,
  compactMessages,
  MAX_CONTEXT_MESSAGES,
  MAX_OBSERVATION_CHARS,
  nextStepId,
  normalizeToolResult,
  numberField,
  stringField,
  truncate,
} from "./types";

export {
  TOOLS,
  CAPABILITY_TOOLS,
  MODULE_ACTION_TOOLS,
  getEnabledTools,
  toolsToOpenAISchema,
} from "./tools";
export {
  ensureBuiltinModuleActionsRegistered,
  getModuleAction,
  listModuleActions,
  registerModuleActions,
  registerPluginModuleActions,
  runModuleAction,
  unregisterModuleActionsByOwner,
  type ModuleActionPublic,
  type ModuleActionRisk,
  type ModuleActionSpec,
  type PluginModuleActionRegistration,
} from "./module-actions";
export {
  buildSkillCapabilityPromptBlock,
  formatCapabilities,
  listInstalledPluginsForAgent,
  listQxCapabilities,
  parseSkillCapabilities,
  runPluginCommandCapability,
  runQxCapability,
  type QxCapabilityKind,
  type QxCapabilityPublic,
} from "./capabilities";
export { buildQxHostSystemPrompt, buildReactSystemPrompt } from "./prompts";
export { parseAgentResponse, type ParsedAction } from "./parse";
export { runReactAgent } from "./react-loop";
export { runFunctionCallingAgent } from "./function-loop";
export {
  ensureBuiltinQxAiHooks,
  listQxAiHooks,
  registerPluginQxAiHooks,
  registerQxAiHooks,
  runQxAiHooks,
  unregisterQxAiHooksByOwner,
  type PluginQxAiHookRegistration,
  type QxAiHook,
  type QxAiHookContext,
  type QxAiHookPatch,
  type QxAiHookPhase,
} from "./hooks";
export {
  DANGEROUS_TOOLS,
  formatDangerousToolsBlock,
  getDangerousTool,
  isDangerousToolName,
  listDangerousToolNames,
  resolveDangerousToolCall,
  type DangerousToolLevel,
  type DangerousToolSpec,
} from "./dangerous-tools";
export {
  invalidateMemorySnapshot,
  loadMemorySnapshot,
  runMemoryDream,
  shouldDreamAfterTurn,
} from "./memory";
