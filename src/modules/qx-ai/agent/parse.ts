export interface ParsedAction {
  kind: "action" | "final" | "none";
  thought?: string;
  tool?: string;
  input?: string;
  finalAnswer?: string;
}

export function parseAgentResponse(text: string): ParsedAction {
  const finalMatch = text.match(/Final Answer\s*:\s*([\s\S]*?)$/i);
  const actionMatch = text.match(
    /Action\s*:\s*([^\n]+)\n\s*Action Input\s*:\s*([\s\S]*?)(?=\n(?:Observation|Thought|Action|Final Answer)\s*:|$)/i,
  );
  const thoughtMatch = text.match(/Thought\s*:\s*([^\n]+)/i);
  const thought = thoughtMatch?.[1]?.trim();

  if (actionMatch && (!finalMatch || actionMatch.index! < finalMatch.index!)) {
    return {
      kind: "action",
      thought,
      tool: actionMatch[1].trim(),
      input: actionMatch[2].trim(),
    };
  }

  if (finalMatch) {
    return {
      kind: "final",
      thought,
      finalAnswer: finalMatch[1].trim(),
    };
  }

  return { kind: "none", thought };
}
