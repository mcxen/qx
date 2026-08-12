export type QxAiErrorPresentation =
  | { kind: "missing-api-key"; provider: string }
  | { kind: "generic"; detail: string };

/** Collapse transport wrappers into one actionable user-facing failure. */
export function presentQxAiError(raw: string): QxAiErrorPresentation {
  const detail = raw.replace(/^Error:\s*/i, "").trim();
  const missingKey = detail.match(/API key missing for\s+([^.;]+)[.;]?/i);
  if (missingKey?.[1]) {
    return { kind: "missing-api-key", provider: missingKey[1].trim() };
  }

  const wrapped = detail.match(
    /^Streaming tool call failed:\s*(.+?);\s*compatibility fallback failed:\s*(.+)$/is,
  );
  if (wrapped) {
    const first = wrapped[1].trim();
    const fallback = wrapped[2].trim();
    return {
      kind: "generic",
      detail: first === fallback ? first : `${first}\n${fallback}`,
    };
  }

  return { kind: "generic", detail };
}

type RepairableMessage = {
  role: string;
  content: string;
  steps?: Array<{ kind?: string; state?: string; text?: string }>;
};

/** Remove only legacy failed turns that were persisted as fake assistant replies. */
export function removeLegacySyntheticErrorMessages<T extends RepairableMessage>(messages: T[]): T[] {
  const repaired = messages.filter((message) => {
    if (message.role !== "assistant" || !message.content.trim()) return true;
    const errorTexts = (message.steps ?? [])
      .filter((step) => step.kind === "error" || step.state === "error")
      .map((step) => step.text?.trim())
      .filter((text): text is string => Boolean(text));
    return !errorTexts.some((text) => text === message.content.trim());
  });
  return repaired.length === messages.length ? messages : repaired;
}
