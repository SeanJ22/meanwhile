import { askResponseText, type AskAnswerPayload } from "@/lib/ask/answer";
import type { BodyConfirmation } from "@/lib/ask/body-confirmation";

/** One keyboard-operable confirmation, shared by both Ask surfaces. */
export function AskBodyConfirmation({ answer, working, onConfirm, onClarify }: {
  answer: AskAnswerPayload; working: boolean;
  onConfirm: (confirmation: BodyConfirmation) => void; onClarify: () => void;
}) {
  const suggestion = answer.confirmation;
  if (!suggestion && !answer.clarification) return null;
  return <div data-ask-body-confirmation className="t-body leading-relaxed text-paper" role="status">
    <p>{askResponseText(answer)}</p>
    <div className="mt-2 flex flex-wrap gap-3">
      {suggestion && <button type="button" disabled={working} onClick={() => onConfirm(suggestion)}
        className="rounded-md border border-[var(--panel-border)] px-3 py-1.5 text-link focus-visible:outline-2 focus-visible:outline-offset-2">
        Yes, answer for this body
      </button>}
      <button type="button" disabled={working} onClick={onClarify}
        className="rounded-md px-2 py-1.5 text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2">
        {suggestion ? "No, let me clarify" : "Clarify my question"}
      </button>
    </div>
  </div>;
}
