import type {
  G4fMessage,
  QxAiAssistantVariant,
  QxAiRegenerationBackup,
} from "./contracts";

export function withoutAssistantVariants(message: G4fMessage): G4fMessage {
  const { variants: _variants, activeVariant: _activeVariant, ...modelMessage } = message;
  return modelMessage;
}

export function toAssistantVariant(message: G4fMessage): QxAiAssistantVariant {
  return {
    content: message.content,
    createdAt: message.createdAt,
    provider: message.provider,
    model: message.model,
    reasoning: message.reasoning,
    steps: message.steps,
    attachments: message.attachments,
    tokenCount: message.tokenCount,
    tokenSpeed: message.tokenSpeed,
    durationMs: message.durationMs,
    reasoningDurationMs: message.reasoningDurationMs,
    usage: message.usage,
  };
}

export function applyAssistantVariant(
  message: G4fMessage,
  variantIndex: number,
): G4fMessage {
  const variants = message.variants;
  const variant = variants?.[variantIndex];
  if (message.role !== "assistant" || !variants || !variant) return message;
  return {
    ...message,
    ...variant,
    variants,
    activeVariant: variantIndex,
  };
}

export function assistantWithRegeneratedVariant(
  backup: QxAiRegenerationBackup | undefined,
  message: G4fMessage,
): G4fMessage {
  const previous = backup?.messages[backup.assistantIndex];
  if (!backup || previous?.role !== "assistant") return message;
  const previousVariants = previous.variants?.length
    ? previous.variants
    : [toAssistantVariant(previous)];
  const variants = [...previousVariants, toAssistantVariant(message)];
  return {
    ...message,
    variants,
    activeVariant: variants.length - 1,
  };
}
