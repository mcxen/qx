import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { Button, Textarea } from "../../components/ui";
import { useT } from "../../i18n";
import { formatQuestionAnswers, questionFromSteps, suggestionsFromSteps, type QxAiQuestionRequest } from "./interaction";
import type { AgentStep } from "./contracts";

function retainNativeActivation(event: KeyboardEvent<HTMLElement>) {
  // Inner controls get first refusal: keep native button activation ahead of Shell Enter.
  if ((event.key === "Enter" || event.key === " ")
    && event.target instanceof Element && event.target.closest("button")) event.stopPropagation();
}

function QuestionForm({ request, disabled, onSend }: {
  request: QxAiQuestionRequest; disabled: boolean; onSend: (text: string) => void;
}) {
  const t = useT();
  const [choices, setChoices] = useState<string[][]>(() => request.questions.map(() => []));
  const [custom, setCustom] = useState<string[]>(() => request.questions.map(() => ""));
  const answers = choices.map((answer, index) => custom[index].trim() ? [...answer, custom[index].trim()] : answer);
  const ready = answers.every((answer) => answer.length > 0);
  const single = request.questions.length === 1 && !request.questions[0].multiSelect;
  return <section className="qx-ai-question" onKeyDown={retainNativeActivation} aria-label={t("qxai.question.title", "Your input")}>
    <div className="qx-ai-interaction-label">{t("qxai.question.title", "Your input")}</div>
    {request.questions.map((question, index) => <fieldset key={index} disabled={disabled}>
      <legend>{question.header && <small>{question.header}</small>}{question.question}</legend>
      <div className="qx-ai-question-options">
        {question.options.map((option) => <Button type="button" variant="ghost" key={option.label}
          className="qx-ai-question-option" aria-pressed={choices[index].includes(option.label)}
          disabled={disabled} onClick={() => {
            if (single) { onSend(formatQuestionAnswers(request, [[option.label]])); return; }
            setChoices((current) => current.map((selected, i) => i !== index ? selected
              : question.multiSelect ? selected.includes(option.label) ? selected.filter((label) => label !== option.label) : [...selected, option.label]
                : [option.label]));
            if (!question.multiSelect) setCustom((current) => current.map((value, i) => i === index ? "" : value));
          }}>
          <span className="qx-ai-question-option-copy"><strong>{option.label}</strong>
            {option.description && <small>{option.description}</small>}</span>
          {option.recommended && <span className="qx-ai-interaction-recommended">{t("qxai.interaction.recommended", "Recommended")}</span>}
          {choices[index].includes(option.label) && <Check size={13} aria-hidden="true" />}
        </Button>)}
      </div>
      <Textarea className="qx-ai-question-custom" value={custom[index]} maxLength={2000} rows={1}
        aria-label={`${question.question} — ${t("qxai.question.custom", "Your own answer")}`}
        placeholder={t("qxai.question.custom", "Your own answer")} disabled={disabled}
        onChange={(event) => {
          const value = event.target.value;
          setCustom((current) => current.map((text, i) => i === index ? value : text));
          if (!question.multiSelect) setChoices((current) => current.map((selected, i) => i === index ? [] : selected));
        }} />
    </fieldset>)}
    <div className="qx-ai-question-actions">
      <Button type="button" size="sm" variant="ghost" disabled={disabled}
        onClick={() => onSend(t("qxai.question.skipMessage", "I prefer not to answer these questions. Continue without assuming any choice."))}>
        {t("qxai.question.skip", "Skip")}
      </Button>
      <Button type="button" size="sm" disabled={disabled || !ready}
        onClick={() => onSend(formatQuestionAnswers(request, answers))}>
        {t("qxai.question.submit", "Send answer")}
      </Button>
    </div>
  </section>;
}

/** Only the latest finished reply offers live controls. Historical questions remain readable. */
export function QxAiInteraction({ steps, active, onSend }: {
  steps?: AgentStep[]; active: boolean; onSend: (text: string) => Promise<void>;
}) {
  const t = useT();
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const question = questionFromSteps(steps);
  const suggestions = suggestionsFromSteps(steps);
  const send = (text: string) => {
    if (!active || lock.current) return;
    lock.current = true; setSending(true);
    // The chat port owns Island error reporting; always release the local click guard.
    void onSend(text).catch(() => {}).finally(() => { lock.current = false; setSending(false); });
  };
  if (question) return <QuestionForm request={question} disabled={!active || sending} onSend={send} />;
  if (!active || !suggestions.length) return null;
  return <section className="qx-ai-suggestions" onKeyDown={retainNativeActivation} aria-label={t("qxai.suggestions.title", "Next steps")}>
    <div className="qx-ai-interaction-label">{t("qxai.suggestions.title", "Next steps")}</div>
    <div className="qx-ai-suggestion-options">{suggestions.map((item) => <Button type="button" variant="outline" size="sm"
      key={item.prompt} title={item.prompt} disabled={sending} onClick={() => send(item.prompt)}>
      <span>{item.label}</span>
      {item.recommended && <small className="qx-ai-interaction-recommended">{t("qxai.interaction.recommended", "Recommended")}</small>}
      <ArrowUpRight size={12} aria-hidden="true" />
    </Button>)}</div>
  </section>;
}
