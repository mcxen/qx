import type { ModelCapabilityOverride } from "../settings/store";
import type { QxAiModelInfo } from "./store";

export type ModelCapabilityFlags = {
  id: string;
  name: string;
  reasoning?: boolean;
  vision?: boolean;
  vision_known?: boolean;
  visionKnown?: boolean;
  context_length?: number;
  contextLength?: number;
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
  return resolveModelVisionState(providerId, model, overrides) === "supported";
}

export type ModelVisionState = "supported" | "unsupported" | "unknown";

export function resolveModelVisionState(
  providerId: string,
  model: ModelCapabilityFlags | undefined,
  overrides?: Record<string, ModelCapabilityOverride>,
): ModelVisionState {
  if (!model?.id) return "unknown";
  const key = modelCapabilityKey(providerId, model.id);
  const override = overrides?.[key]?.vision;
  if (typeof override === "boolean") return override ? "supported" : "unsupported";
  if (model.vision) return "supported";
  if (model.vision_known || model.visionKnown) return "unsupported";
  return detectVisionFromModelId(model.id) ? "supported" : "unknown";
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

/** Resolved context window in tokens when catalog or override provides it. */
export function resolveModelContextLength(
  providerId: string,
  model: ModelCapabilityFlags | undefined,
  overrides?: Record<string, ModelCapabilityOverride>,
): number | undefined {
  if (!model?.id) return undefined;
  const key = modelCapabilityKey(providerId, model.id);
  const override = overrides?.[key]?.context_length;
  if (typeof override === "number" && override > 0) return Math.floor(override);
  const raw = model.context_length ?? model.contextLength;
  if (typeof raw === "number" && raw > 0) return Math.floor(raw);
  return undefined;
}

/** Compact label: 128K, 1M, 8192. */
export function formatContextLength(tokens: number | undefined): string | null {
  if (!tokens || tokens <= 0) return null;
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return String(tokens);
}

export function isFavoriteModel(
  providerId: string,
  modelId: string,
  favorites: string[] | undefined,
): boolean {
  if (!providerId || !modelId || !favorites?.length) return false;
  return favorites.includes(modelCapabilityKey(providerId, modelId));
}

export function toggleFavoriteModelList(
  favorites: string[] | undefined,
  providerId: string,
  modelId: string,
): string[] {
  const key = modelCapabilityKey(providerId, modelId);
  const current = favorites ?? [];
  return current.includes(key)
    ? current.filter((item) => item !== key)
    : [...current, key];
}

/** Favorites first, then name; stable for selectors. */
export function sortModelsForPicker<T extends { id: string; name?: string }>(
  providerId: string,
  models: T[],
  favorites: string[] | undefined,
): T[] {
  const fav = new Set(favorites ?? []);
  return [...models].sort((a, b) => {
    const aFav = fav.has(modelCapabilityKey(providerId, a.id)) ? 0 : 1;
    const bFav = fav.has(modelCapabilityKey(providerId, b.id)) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return (a.name || a.id).localeCompare(b.name || b.id);
  });
}

/** Build a Jan-style label: "★ gpt-4o · Vision · 128K". */
export function formatModelPickerLabel(options: {
  providerId: string;
  model: ModelCapabilityFlags;
  favorites?: string[];
  overrides?: Record<string, ModelCapabilityOverride>;
  starGlyph?: string;
  visionLabel?: string;
  reasoningLabel?: string;
}): string {
  const {
    providerId,
    model,
    favorites,
    overrides,
    starGlyph = "★",
    visionLabel = "Vision",
    reasoningLabel = "Reasoning",
  } = options;
  const parts: string[] = [];
  if (isFavoriteModel(providerId, model.id, favorites)) {
    parts.push(starGlyph);
  }
  parts.push(model.name || model.id);
  const badges: string[] = [];
  if (resolveModelVision(providerId, model, overrides)) badges.push(visionLabel);
  if (resolveModelReasoning(providerId, model, overrides)) badges.push(reasoningLabel);
  const ctx = formatContextLength(resolveModelContextLength(providerId, model, overrides));
  if (ctx) badges.push(ctx);
  if (badges.length) return `${parts.join(" ")} · ${badges.join(" · ")}`;
  return parts.join(" ");
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

/** Normalize fetch/API model rows into QxAiModelInfo. */
export function normalizeCatalogModel(raw: QxAiModelInfo | ModelCapabilityFlags): QxAiModelInfo {
  const context =
    typeof raw.context_length === "number"
      ? raw.context_length
      : typeof raw.contextLength === "number"
        ? raw.contextLength
        : undefined;
  return {
    id: raw.id,
    name: raw.name || raw.id,
    reasoning: raw.reasoning,
    vision: raw.vision,
    vision_known: raw.vision_known ?? raw.visionKnown,
    context_length: context,
  };
}
