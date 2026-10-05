import type { AgentStep } from "./contracts";

export interface QxAiQuestion {
  header: string;
  question: string;
  multiSelect: boolean;
  options: Array<{ label: string; description: string; recommended: boolean }>;
}

export interface QxAiQuestionRequest { questions: QxAiQuestion[] }
export interface QxAiSuggestion { label: string; prompt: string; recommended: boolean }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function text(value: unknown, limit: number, required = true): string {
  const result = typeof value === "string" ? value.trim() : "";
  if ((required && !result) || result.length > limit) throw new Error("Invalid or oversized interaction text.");
  return result;
}

/** Validate model input and durable session data through the same bounded port. */
export function parseQuestionRequest(value: unknown): QxAiQuestionRequest {
  const questions = record(value).questions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 4) {
    throw new Error("Provide 1–4 questions.");
  }
  return { questions: questions.map((value) => {
    const q = record(value);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) {
      throw new Error("Each question needs 2–4 options; custom input is provided by Qx.");
    }
    const options = q.options.map((value) => {
      const option = record(value);
      return { label: text(option.label, 100), description: text(option.description, 300, false), recommended: option.recommended === true };
    });
    if (new Set(options.map((option) => option.label)).size !== options.length
      || options.filter((option) => option.recommended).length > 1) {
      throw new Error("Use distinct options and at most one recommendation per question.");
    }
    return { header: text(q.header, 24, false), question: text(q.question, 500), multiSelect: q.multiSelect === true, options };
  }) };
}

export function parseSuggestions(value: unknown): QxAiSuggestion[] {
  const suggestions = record(value).suggestions;
  if (!Array.isArray(suggestions) || suggestions.length < 1 || suggestions.length > 3) {
    throw new Error("Provide 1–3 next-step suggestions.");
  }
  const result = suggestions.map((value) => {
    const item = record(value);
    return { label: text(item.label, 80), prompt: text(item.prompt, 1000), recommended: item.recommended === true };
  });
  if (new Set(result.map((item) => item.prompt)).size !== result.length
    || new Set(result.map((item) => item.label)).size !== result.length
    || result.filter((item) => item.recommended).length > 1) {
    throw new Error("Use distinct suggestions and at most one recommendation.");
  }
  return result;
}

export function questionFromSteps(steps?: AgentStep[]): QxAiQuestionRequest | undefined {
  const step = [...steps ?? []].reverse().find((step) => step.kind === "action" && step.state === "completed" && step.question);
  if (!step) return;
  try { return parseQuestionRequest(step.question); } catch { return; }
}

export function suggestionsFromSteps(steps?: AgentStep[]): QxAiSuggestion[] {
  const step = [...steps ?? []].reverse().find((step) => step.kind === "action" && step.state === "completed" && step.suggestions);
  if (!step) return [];
  try { return parseSuggestions({ suggestions: step.suggestions }); } catch { return []; }
}

/** Send explicit choices as ordinary user text; never synthesize an unchosen answer. */
export function formatQuestionAnswers(request: QxAiQuestionRequest, answers: string[][]): string {
  if (answers.length !== request.questions.length || answers.some((answer) => !answer.length)) {
    throw new Error("Answer every question before submitting.");
  }
  return request.questions.map((question, index) => {
    const answer = answers[index].map((value) => text(value, 2000));
    return `${question.question}\n${answer.join("; ")}`;
  }).join("\n\n");
}

export function canonicalInteractionTool(name: string): string {
  return name === "AskYourQuestion" || name === "AskUserQuestion" ? "ask_user_question" : name;
}

export function pausedQuestionResult(steps: AgentStep[]) {
  const question = questionFromSteps(steps);
  return question ? {
    // Keep option meaning in ordinary model context when the user's next turn resumes.
    finalAnswer: question.questions.map((question) => `${question.question}\n${question.options
      .map((option) => `- ${option.label}${option.description ? `: ${option.description}` : ""}`).join("\n")}`).join("\n\n"),
    steps, attachments: [], awaitingUserInput: true,
  } : undefined;
}
