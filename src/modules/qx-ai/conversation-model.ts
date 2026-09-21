import type { G4fMessage } from "./contracts";

export interface ConversationModelSnapshotSource {
  messages: G4fMessage[];
  provider: string;
  model: string;
}

/**
 * Freeze the best-known model on legacy assistant messages and variants.
 * Older sessions only stored a conversation-level selection, so this migration
 * cannot recover a model used before that field last changed; it does prevent
 * future selection changes from relabelling the existing transcript.
 */
export function withMessageModelSnapshots<T extends ConversationModelSnapshotSource>(
  conversation: T,
): T {
  let changed = false;
  const messages = conversation.messages.map((message) => {
    if (message.role !== "assistant") return message;
    const provider = message.provider || conversation.provider;
    const model = message.model || conversation.model;
    let variantsChanged = false;
    const variants = message.variants?.map((variant) => {
      const variantProvider = variant.provider || provider;
      const variantModel = variant.model || model;
      if (variant.provider === variantProvider && variant.model === variantModel) return variant;
      variantsChanged = true;
      return { ...variant, provider: variantProvider, model: variantModel };
    });
    if (
      message.provider === provider
      && message.model === model
      && !variantsChanged
    ) {
      return message;
    }
    changed = true;
    return {
      ...message,
      provider,
      model,
      ...(variants ? { variants } : {}),
    };
  });
  return changed ? { ...conversation, messages } : conversation;
}
