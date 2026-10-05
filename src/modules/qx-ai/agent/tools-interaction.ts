import { parseQuestionRequest, parseSuggestions } from "../interaction";
import type { ToolSpec } from "./types";

const optionSchema = {
  type: "object", properties: {
    label: { type: "string", maxLength: 100 },
    description: { type: "string", maxLength: 300 },
    recommended: { type: "boolean" },
  }, required: ["label"],
};

/** Structured UI intent only. Clicks use ordinary chat turns and existing safety gates. */
export const INTERACTION_TOOLS: ToolSpec[] = [
  {
    name: "ask_user_question",
    description: "AskYourQuestion / AskUserQuestion: ask the user when essential information is missing. Qx displays 1–4 questions, 2–4 options each and custom input. This ENDS the current turn; wait for an explicit user answer. Do not use it for optional follow-ups or as tool execution approval.",
    inputHint: '{"questions":[{"header":"Scope","question":"Which apps should I inspect?","options":[{"label":"All apps","recommended":true},{"label":"Only games"}]}]}',
    parameters: {
      type: "object", properties: { questions: {
        type: "array", minItems: 1, maxItems: 4, items: {
          type: "object", properties: {
            header: { type: "string", maxLength: 24 }, question: { type: "string", maxLength: 500 },
            multiSelect: { type: "boolean" }, options: { type: "array", minItems: 2, maxItems: 4, items: optionSchema },
          }, required: ["question", "options"],
        },
      } }, required: ["questions"],
    },
    isEnabled: () => true,
    run: async (input) => {
      const question = parseQuestionRequest(input);
      return { observation: "Questions displayed. Await an explicit user answer; no option has been chosen.", question };
    },
  },
  {
    name: "suggest_next_actions",
    description: "Offer 1–3 brief, useful optional follow-up messages after addressing the request. A click sends the exact prompt as a new user turn; it never executes a host action directly. Mark at most one recommended. Do not suggest unnecessary work or duplicate the answer. Call once, then give the final answer.",
    inputHint: '{"suggestions":[{"label":"Check app versions","prompt":"Check the installed apps for outdated versions.","recommended":true}]}',
    parameters: { type: "object", properties: { suggestions: {
      type: "array", minItems: 1, maxItems: 3, items: {
        type: "object", properties: {
          label: { type: "string", maxLength: 80 }, prompt: { type: "string", maxLength: 1000 }, recommended: { type: "boolean" },
        }, required: ["label", "prompt"],
      },
    } }, required: ["suggestions"] },
    isEnabled: () => true,
    run: async (input) => ({ observation: "Next-step suggestions recorded. Now finish the answer; do not execute suggestions unless the user selects one.", suggestions: parseSuggestions(input) }),
  },
];
