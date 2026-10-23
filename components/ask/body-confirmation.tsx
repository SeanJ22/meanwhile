import type { AskAnswerPayload } from "@/lib/ask/answer";
import type { BodyConfirmation } from "@/lib/ask/body-confirmation";

/** One keyboard-operable confirmation, shared by both Ask surfaces. */
export function AskBodyConfirmation({ answer, working, onConfirm, onClarify }: {
  answer: AskAnswerPayload; working: boolean;
  onConfirm: (confirmation: BodyConfirmation) => void; onClarify: () => void;
}) {
  const suggestion = answer.confirmation;
  const choices = answer.bodyChoices ?? (suggestion ? [suggestion] : []);
  if (!choices.length && !answer.clarification) return null;
  return <div data-ask-body-confirmation className="t-body leading-relaxed text-paper" role="status">
    <p>{choices.length > 1 ? "Which do you mean?" : suggestion ? `Did you mean ${suggestion.name}?` : answer.clarification}</p>
    <div className="mt-2 flex flex-wrap gap-3">
      {choices.map(choice => <button key={choice.bodyId} type="button" disabled={working} onClick={() => onConfirm(choice)}
        className="rounded-md border border-[var(--panel-border)] px-3 py-1.5 text-link focus-visible:outline-2 focus-visible:outline-offset-2">
        {choice.name}
      </button>)}
      <button type="button" disabled={working} onClick={onClarify}
        className="rounded-md px-2 py-1.5 text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2">
        Clarify my question
      </button>
    </div>
  </div>;
}
