import type { ModelCapabilityOverride } from "../settings/store";

export type ModelCapabilityFlags = {
  id: string;
  name: string;
  reasoning?: boolean;
  vision?: boolean;
};

export function modelCapabilityKey(providerId: string, modelId: string): string {
  return `${providerId}|${modelId}`;
}

/** Frontend id heuristics — mirrors Rust detect_model_capabilities fallbacks. */
export function detectVisionFromModelId(modelId: string): boolean {
  const id = modelId.toLowerCase();
  const tokens = [
    "vision",
    "-vl",
    "vl-",
    "vl.",
    "vl_",
    "gpt-4o",
    "gpt-4.1",
    "gpt-4-turbo",
    "gpt-5",
    "o1",
    "o3",
    "o4",
    "claude-3",
    "claude-4",
    "claude-sonnet",
    "claude-opus",
    "claude-haiku",
    "gemini",
    "pixtral",
    "llava",
    "qwen-vl",
    "qwen2-vl",
    "qwen2.5-vl",
    "internvl",
    "phi-4-multimodal",
    "phi-3.5-vision",
    "llama-4",
    "llama4",
    "grok-2-vision",
    "grok-vision",
    "sonar-pro",
    "openrouter/auto",
  ];
  return tokens.some((token) => id.includes(token));
}

export function resolveModelVision(
  providerId: string,
  model: ModelCapabilityFlags | undefined,
  overrides?: Record<string, ModelCapabilityOverride>,
): boolean {
  if (!model?.id) return false;
  const key = modelCapabilityKey(providerId, model.id);
  const override = overrides?.[key]?.vision;
  if (typeof override === "boolean") return override;
  if (typeof model.vision === "boolean") return model.vision;
  return detectVisionFromModelId(model.id);
}

export function resolveModelReasoning(
  providerId: string,
  model: ModelCapabilityFlags | undefined,
  overrides?: Record<string, ModelCapabilityOverride>,
): boolean {
  if (!model?.id) return false;
  const key = modelCapabilityKey(providerId, model.id);
  const override = overrides?.[key]?.reasoning;
  if (typeof override === "boolean") return override;
  return Boolean(model.reasoning);
}

export function messageHasImages(
  attachments?: Array<{ kind?: string; mimeType?: string }>,
): boolean {
  return Boolean(
    attachments?.some(
      (item) => item.kind === "image" || item.mimeType?.startsWith("image/"),
    ),
  );
}
